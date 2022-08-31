const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network, gasReporter } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle unit test", function () {
          let Raffle,
              raffleContract,
              vrfCoordinatorV2Mock,
              raffleEntranceFee,
              interval,
              player,
              deployer // ,
          const chainId = network.config.chainId

          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              Raffle = await ethers.getContract("Raffle")
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              raffleEntranceFee = await Raffle.getEntranceFee()
              interval = await Raffle.getInterval()
          })

          describe("constructor", function () {
              // ideally we make our tests have only 1 assert per 'it'
              it("Initializes the Raffle contract correctly", async function () {
                  const raffleState = await Raffle.getRaffleState()
                  assert.equal(raffleState.toString(), "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["keepersUpdateInterval"])
              })
          })
          describe("enterRaffle", function () {
              it("reverts with an error when not enough ETH entered", async function () {
                  await expect(Raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughETHEntered"
                  )
              })

              it("pushes sender to player array", async function () {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  const playerFromContract = await Raffle.getPlayer(0)
                  assert.equal(playerFromContract, deployer)
              })

              it("emits event on enter", async function () {
                  await expect(Raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      Raffle,
                      "RaffleEnter"
                  )
              })

              it("doesn't allow entrance when raffle is calculating", async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  // for a documentation of the methods below, go here: https://hardhat.org/hardhat-network/reference
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  // we pretend to be a keeper for a second
                  await Raffle.performUpkeep([]) // changes the state to calculating for our comparison below
                  await expect(Raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      // is reverted as raffle is calculating
                      "Raffle__NotOpen"
                  )
              })
          })

          describe("checkUpkeep", function () {
              it("returns false if people haven't sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await Raffle.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded)
              })

              it("returns false if raffle isn't open", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await Raffle.performUpkeep([]) // changes the state to calculating for our comparison below
                  const { upkeepNeeded } = await Raffle.callStatic.checkUpkeep([])
                  assert.equal(upkeepNeeded, false)
                  const raffleState = await Raffle.getRaffleState()
                  assert.equal(raffleState.toString(), "1")
              })

              it("returns false if enough time hasn't passed", async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await Raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(!upkeepNeeded)
              })

              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await Raffle.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(upkeepNeeded)
              })
          })

          describe("performUpkeep", function () {
              it("can only run if checkUpkeep is true", async function () {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  checkUpkeepStatus = await Raffle.callStatic.checkUpkeep([])
                  console.log(`checkUpkeepStatus: ${checkUpkeepStatus[0]}`)
                  const tx = await Raffle.performUpkeep([])
                  assert(tx)
              })

              it("reverts when checkUpkeep is false", async function () {
                  await expect(Raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  )
              })

              it("updates the raffle state and emits a requestId", async () => {
                  // Too many asserts in this test!
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const txResponse = await Raffle.performUpkeep("0x") // emits requestId
                  const txReceipt = await txResponse.wait(1) // waits 1 block
                  const raffleState = await Raffle.getRaffleState() // updates state
                  const requestId = txReceipt.events[3].args.requestId
                  assert(requestId.toNumber() > 0)
                  assert(raffleState == 1) // 0 = open, 1 = calculating
              })
          })

          describe("fulfillRandomWords", function () {
              beforeEach(async () => {
                  await Raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
              })
              it("can only be called after performupkeep", async () => {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, Raffle.address) // reverts if not fulfilled
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, Raffle.address) // reverts if not fulfilled
                  ).to.be.revertedWith("nonexistent request")
              })
              // This test is too big...
              it("picks a winner, resets, and sends money", async () => {
                  const additionalEntrances = 3 // to test
                  const startingIndex = 1
                  const accounts = await ethers.getSigners()
                  for (let i = startingIndex; i < startingIndex + additionalEntrances; i++) {
                      const accountConnectedRaffle = Raffle.connect(accounts[i])
                      await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
                      //   Raffle = raffleContract.connect(accounts[i]) // Returns a new instance of the Raffle contract connected to player
                      //   await Raffle.enterRaffle({ value: raffleEntranceFee })
                  }
                  const startingTimeStamp = await Raffle.getLatestTimestamp() // stores starting timestamp (before we fire our event)

                  // This will be more important for our staging tests...
                  await new Promise(async (resolve, reject) => {
                      Raffle.once("WinnerPicked", async () => {
                          // event listener for WinnerPicked
                          console.log("WinnerPicked event fired!")
                          // assert throws an error if it fails, so we need to wrap
                          // it in a try/catch so that the promise returns event
                          // if it fails.
                          try {
                              // Now lets get the ending values...

                              console.log(accounts[0].address)
                              console.log(accounts[1].address)
                              console.log(accounts[2].address)
                              console.log(accounts[3].address)
                              console.log("----------------")

                              const recentWinner = await Raffle.getRecentWinner()
                              console.log(recentWinner)
                              const raffleState = await Raffle.getRaffleState()
                              const winnerBalance = await accounts[1].getBalance()
                              const endingTimeStamp = await Raffle.getLatestTimestamp()
                              await expect(Raffle.getPlayer(0)).to.be.reverted
                              // Comparisons to check if our ending values are correct:
                              assert.equal(recentWinner.toString(), accounts[1].address)
                              assert.equal(raffleState, 0)
                              assert.equal(
                                  winnerBalance.toString(),
                                  startingBalance // startingBalance + ( (raffleEntranceFee * additionalEntrances) + raffleEntranceFee )
                                      .add(
                                          raffleEntranceFee
                                              .mul(additionalEntrances)
                                              .add(raffleEntranceFee)
                                      )
                                      .toString()
                              )
                              assert(endingTimeStamp > startingTimeStamp)
                          } catch (e) {
                              reject(e) // if try fails, rejects the promise
                          }
                          resolve() // if try passes, resolves the promise
                      })

                      const tx = await Raffle.performUpkeep("0x")
                      const txReceipt = await tx.wait(1)
                      const startingBalance = await accounts[1].getBalance()
                      await vrfCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[3].args.requestId,
                          Raffle.address
                      )
                  })
              })
          })
      })
