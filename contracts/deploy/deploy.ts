import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying AttestFlowASC with', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Deployer balance:', ethers.formatEther(balance), 'CTC');
  if (balance === 0n) throw new Error('NO_FUNDS: get CC3 testnet CTC via Discord /faucet first');

  const ASC = await ethers.getContractFactory('AttestFlowASC');
  const asc = await ASC.deploy();
  await asc.waitForDeployment();
  const address = await asc.getAddress();

  const receipt = await asc.deploymentTransaction()?.wait();

  const artifact = {
    name: 'AttestFlowASC',
    address,
    deployer: deployer.address,
    txHash: receipt?.hash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    network: 'cc3-testnet',
    deployedAt: new Date().toISOString(),
    abi: JSON.parse(asc.interface.formatJson()),
  };

  const outDir = path.resolve(__dirname, '../../deployments');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'attestflow-cc3-testnet.json');
  fs.writeFileSync(outFile, JSON.stringify(artifact, null, 2));
  console.log('Deployment saved to', outFile);
  console.log('ASC address:', address);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
