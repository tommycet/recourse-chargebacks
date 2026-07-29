#!/usr/bin/env node
/**
 * Deploy to Anvil (local) — E2E prelude.
 * Starts Anvil, deploys MockUSDC + RecourseEscrow, mints USDC, writes deployed.json.
 */
import { spawn, execSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ANVIL_PORT = 8545;
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const CONTRACTS_DIR = '/root/recourse/contracts';
const DEPLOYED_PATH = '/root/recourse/demo/deployed.json';
const WEB_DEPLOYED = '/root/recourse/web/deployed.json';
const FOUNDRY = 'export PATH="/root/.foundry/bin:$PATH"';

function sh(cmd, opts = {}) {
  return execSync(`${FOUNDRY} && ${cmd}`, { encoding: 'utf-8', timeout: 30000, ...opts }).trim();
}

async function main() {
  // Kill existing Anvil
  try { execSync('pkill -f anvil', { timeout: 5000 }); } catch(e) {}
  
  // Start Anvil
  console.log('Starting Anvil...');
  const anvil = spawn('anvil', ['--port', String(ANVIL_PORT), '--balance', '1000', '--silent'], {
    stdio: 'ignore',
    env: { ...process.env, PATH: `/root/.foundry/bin:${process.env.PATH}` }
  });
  await new Promise(r => setTimeout(r, 2000));
  console.log('Anvil running.\n');

  // Deploy MockUSDC
  console.log('Deploying MockUSDC...');
  const usdcOut = sh(`forge create --rpc-url ${ANVIL_RPC} --private-key ${PK} --broadcast src/MockUSDC.sol:MockUSDC --json`, { cwd: CONTRACTS_DIR });
  const usdcJson = JSON.parse(usdcOut);
  const usdcAddr = usdcJson.deployedTo || usdcJson.transaction?.contractAddress;
  console.log(`  MockUSDC: ${usdcAddr}\n`);

  // Deploy RecourseEscrow
  console.log('Deploying RecourseEscrow...');
  const escrowOut = sh(`forge create --rpc-url ${ANVIL_RPC} --private-key ${PK} --broadcast src/RecourseEscrow.sol:RecourseEscrow --constructor-args ${usdcAddr} ${DEPLOYER} --json`, { cwd: CONTRACTS_DIR });
  const escrowJson = JSON.parse(escrowOut);
  const escrowAddr = escrowJson.deployedTo || escrowJson.transaction?.contractAddress;
  console.log(`  RecourseEscrow: ${escrowAddr}\n`);

  // Mint USDC
  console.log('Minting USDC...');
  const mintOut = sh(`cast send --rpc-url ${ANVIL_RPC} --private-key ${PK} ${usdcAddr} "mint(address,uint256)" ${DEPLOYER} 1000000000000 --json`);
  console.log(`  Minted: ${JSON.parse(mintOut).status}\n`);

  // Write deployed.json
  const deployed = { address: escrowAddr, usdc: usdcAddr, arbiter: DEPLOYER, rpc: ANVIL_RPC, chainId: 31337 };
  writeFileSync(DEPLOYED_PATH, JSON.stringify(deployed, null, 2));
  writeFileSync(DEPLOYED, JSON.stringify(deployed, null, 2));
  console.log('✅ Saved deployed.json');
  console.log(JSON.stringify(deployed, null, 2));
}

main().catch(e => { console.error(e.message); process.exit(1); });