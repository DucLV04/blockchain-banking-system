import { task } from "hardhat/config.js";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@nomicfoundation/hardhat-chai-matchers";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";
// hardhat-deploy removed - using direct deploy-all.js script
import "hardhat-gas-reporter";
import "solidity-coverage";
import "@typechain/hardhat";
import * as dotenv from "dotenv";

dotenv.config();

// =====================
// Hardhat Configuration
// =====================

// Lấy biến môi trường
const {
  TESTNET_PRIVATE_KEY = "",
  RPC_URL_SEPOLIA = "https://rpc.sepolia.org",
  RPC_URL_MAINNET = "https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY",
  MAINNET_PRIVATE_KEY = "",
  REPORT_GAS = "0",
  ETHERSCAN_API_KEY = "",
} = process.env;

// Helper: chỉ thêm accounts nếu có private key hợp lệ
const getAccounts = (key: string) =>
  key && key.length === 66 ? [key] : [];

// Hardhat task hiển thị danh sách accounts
task("accounts", "Prints the list of accounts", async (_taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();
  for (const account of accounts) {
    console.log(account.address);
  }
});

// Hardhat task hiển thị balance của một account
task("balance", "Prints an account's balance")
  .addPositionalParam("address", "The account's address")
  .setAction(async (taskArgs, hre) => {
    const balance = await hre.ethers.provider.getBalance(taskArgs.address);
    console.log(ethers.formatEther(balance), "ETH");
  });

const config = {
  networks: {
    // Local Hardhat node (default: http://127.0.0.1:8545)
    hardhat: {
      chainId: 31337,
    },

    // Sepolia Testnet
    sepolia: {
      url: RPC_URL_SEPOLIA,
      chainId: 11155111,
      accounts: getAccounts(TESTNET_PRIVATE_KEY),
      timeout: 60000,
      gas: "auto",
      gasPrice: "auto",
    },

    // Ethereum Mainnet
    ethereum: {
      url: RPC_URL_MAINNET,
      chainId: 1,
      accounts: getAccounts(MAINNET_PRIVATE_KEY),
      timeout: 120000,
      gas: "auto",
      gasPrice: "auto",
    },
  },

  // Solidity compiler configuration
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
    ],
  },

  // Cấu hình deploy
  namedAccounts: {
    deployer: 0,
  },

  // Cấu hình gas reporter
  gasReporter: {
    enabled: REPORT_GAS === "1",
    currency: "USD",
    outputFile: "gas-report.txt",
    noColors: false,
  },

  // Cấu hình contract size
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
  },

  // Cấu hình ABI exporter
  abiExporter: {
    path: "./data/abi",
    runOnCompile: true,
    clear: true,
    flat: false,
    only: [],
    spacing: 4,
  },

  // Cấu hình etherscan verification
  etherscan: {
    apiKey: {
      sepolia: ETHERSCAN_API_KEY,
      mainnet: ETHERSCAN_API_KEY,
    },
  },

  // Cấu hình sourcify verification
  sourcify: {
    enabled: false,
  },

  // Cấu hình TypeChain
  typechain: {
    outDir: "typechain",
    target: "ethers-v6",
  },

  // Cấu hình mocha (test timeout)
  mocha: {
    timeout: 60000,
  },
};

export default config;
