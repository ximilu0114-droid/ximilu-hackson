import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying InboxDemo (Sepolia) with', deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance:', ethers.formatEther(balance), 'ETH');
  if (balance === 0n) throw new Error('NO_FUNDS: need Sepolia ETH');

  const F = await ethers.getContractFactory('InboxDemo');
  const inbox = await F.deploy(deployer.address); // authorized relayer = agent key
  await inbox.waitForDeployment();
  const address = await inbox.getAddress();
  const receipt = await inbox.deploymentTransaction()?.wait();

  const artifact = {
    name: 'InboxDemo',
    address,
    deployer: deployer.address,
    txHash: receipt?.hash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    network: 'sepolia',
    deployedAt: new Date().toISOString(),
    abi: JSON.parse(inbox.interface.formatJson()),
  };
  const outDir = path.resolve(__dirname, '../../deployments');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'inboxdemo-sepolia.json');
  fs.writeFileSync(outFile, JSON.stringify(artifact, null, 2));
  console.log('Saved', outFile);
  console.log('InboxDemo address:', address);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
