#!/usr/bin/env node
/**
 * Deploy RecourseEscrow to Sepolia using viem + Foundry ABI.
 * Requires: SEPOLIA_RPC, PRIVATE_KEY env vars.
 * Writes deployed address to ./deployed.json
 */
import { createWalletClient, createPublicClient, http, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const RPC_URL = process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('ERROR: PRIVATE_KEY env var required'); process.exit(1); }

// USDC address: read from env, then deployed.json, then fallback to Sepolia USDC
let USDC_ADDR = process.env.USDC_ADDR;
if (!USDC_ADDR) {
  const deployedFile = new URL('./deployed.json', import.meta.url);
  if (existsSync(deployedFile)) {
    const d = JSON.parse(readFileSync(deployedFile, 'utf-8'));
    if (d.usdc) USDC_ADDR = d.usdc;
  }
}
if (!USDC_ADDR) USDC_ADDR = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'; // Sepolia fallback
const abi = JSON.parse(readFileSync(new URL('./abi.json', import.meta.url), 'utf-8'));

const account = privateKeyToAccount(PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : '0x' + PRIVATE_KEY);

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ chain: sepolia, transport: http(RPC_URL), account });

async function main() {
  console.log('\n═══ Deploy RecourseEscrow to Sepolia ═══\n');
  console.log(`  Deployer: ${account.address}`);
  const ethBal = await publicClient.getBalance({ address: account.address });
  console.log(`  ETH:      ${formatEther(ethBal)} ETH\n`);
  if (ethBal === 0n) { console.error('❌ No ETH for gas'); process.exit(1); }

  // Deploy
  console.log('  Deploying...');
  const artifact = JSON.parse(readFileSync(new URL('../contracts/out/RecourseEscrow.sol/RecourseEscrow.json', import.meta.url), 'utf-8'));
  const bytecode = artifact.bytecode.object;

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [USDC_ADDR, account.address],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const contractAddr = receipt.contractAddress;

  console.log(`  ✅ Deployed at: ${contractAddr}`);
  console.log(`     tx: ${hash}`);
  console.log(`     gas: ${Number(receipt.gasUsed)}`);
  console.log(`     block: ${Number(receipt.blockNumber)}`);
  console.log(`     https://sepolia.etherscan.io/address/${contractAddr}\n`);

  // Save
  const deployed = { address: contractAddr, deployer: account.address, tx: hash, block: Number(receipt.blockNumber), usdc: USDC_ADDR, deployedAt: new Date().toISOString() };
  writeFileSync(new URL('./deployed.json', import.meta.url), JSON.stringify(deployed, null, 2));
  console.log(`  Saved to demo/deployed.json\n`);
}

main().catch(e => { console.error('\n❌', e.message?.slice(0, 500) || e); process.exit(1); });
