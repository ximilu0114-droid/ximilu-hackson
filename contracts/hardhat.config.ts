import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const CC3_TESTNET_RPC =
  process.env.CREDITCOIN_TESTNET_RPC_URL ??
  'https://rpc.cc3-testnet.creditcoin.network';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },
  networks: {
    hardhat: {},
    cc3Testnet: {
      url: CC3_TESTNET_RPC,
      chainId: 102031,
      accounts: process.env.AGENT_PRIVATE_KEY
        ? [process.env.AGENT_PRIVATE_KEY]
        : [],
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
      chainId: 11155111,
      accounts: process.env.AGENT_PRIVATE_KEY
        ? [process.env.AGENT_PRIVATE_KEY]
        : [],
    },
  },
};

export default config;
