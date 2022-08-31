const { network } = require("hardhat")
const { developmentChains } = require("../helper-hardhat-config")

const BASE_FEE = ethers.utils.parseEther("0.25") //0.25 is the premium . It costs 0.25 link per request
const GAS_PRICE_LINK = 1e9(
    // 1000000000
    // calculated value based on the price of the chain
    // ETH price skyrockets!!!
    // Chainlink Nodes pay the gas fees to give us randomness & do external execution
    // The price of a request changes based on the price of gas!

    (module.exports = async function ({ getNamedAccounts, deployments }) {
        const { deploy, log } = deployments
        const { deployer } = await getNamedAccounts()
        const args = [BASE_FEE, GAS_PRICE_LINK]

        if (developmentChains.includes(network.name)) {
            log("Local network detected! deploying mocks...")
            // deploy a mock vrfCoordinator...
            await deploy("VRFCoordinatorV2Mock", {
                from: deployer,
                log: true,
                args: args,
            })
            log("Mocks Deployed!!!")
            log("----------------------------")
        }
    })
)

module.exports.tags = ["all", "mocks"]
