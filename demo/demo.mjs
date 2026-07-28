#!/usr/bin/env node
/**
 * Recourse Escrow — Sepolia Demo CLI
 * 
 * Demonstrates the full escrow lifecycle with real on-chain transactions:
 *   1. Create escrow (buyer deposits USDC)
 *   2. Confirm delivery OR raise dispute
 *   3. Arbiter resolves dispute (if raised)
 *   4. Auto-refund after timeout (optional, for demo: warp not possible on Sepolia)
 * 
 * Usage:
 *   node demo.mjs                    — happy path: create → confirm delivery
 *   node demo.mjs --dispute          — dispute path: create → raise dispute → arbiter refunds buyer
 *   node demo.mjs --auto-refund      — create → raise dispute → auto-refund (needs 14d elapsed)
 * 
 * Requires:
 *   .env with SEPOLIA_RPC, PRIVATE_KEY, ESCROW_CONTRACT (deployed address)
 *   Sufficient Sepolia ETH for gas + Sepolia USDC for escrow
 * 
 * If buyer has no USDC, the script will:
 *   - Use deployer as buyer AND seller (self-escrow for demo purposes)
 *   - Mint test USDC if the token has a faucet/mint function
 */

import { createWalletClient, createPublicClient, http, formatEther, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { keccak256, encodePacked, parseUnits, formatUnits } from 'viem';

// ─── Config ───
const RPC_URL = process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) { console.error('ERROR: PRIVATE_KEY env var required'); process.exit(1); }

// Load deployed contract address
const ADDR_FILE = new URL('./deployed.json', import.meta.url);
let contractAddr = process.env.ESCROW_CONTRACT;
if (!contractAddr && existsSync(ADDR_FILE)) {
  const deployed = JSON.parse(readFileSync(ADDR_FILE, 'utf-8'));
  contractAddr = deployed.address;
}
if (!contractAddr) { console.error('ERROR: ESCROW_CONTRACT not set and no deployed.json found. Run deploy.mjs first.'); process.exit(1); }

// Read USDC from deployed.json (preferred) or query contract's USDC() view
let USDC_ADDR;
const deployed = existsSync(ADDR_FILE) ? JSON.parse(readFileSync(ADDR_FILE, 'utf-8')) : null;
if (deployed?.usdc) {
  USDC_ADDR = deployed.usdc;
} else {
  // Fallback: query contract's USDC() view function
  const tmpAbi = JSON.parse(readFileSync(new URL('./abi.json', import.meta.url), 'utf-8'));
  const tmpPublic = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
  try {
    USDC_ADDR = await tmpPublic.readContract({ address: contractAddr, abi: tmpAbi, functionName: 'USDC' });
  } catch {
    console.error('ERROR: Cannot determine USDC address. Set it in deployed.json or check contract.');
    process.exit(1);
  }
}
const abi = JSON.parse(readFileSync(new URL('./abi.json', import.meta.url), 'utf-8'));

const USDC_ABI = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'transfer', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'name', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'mint', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
];

const account = privateKeyToAccount(PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : '0x' + PRIVATE_KEY);
const mode = process.argv.includes('--dispute') ? 'dispute' : process.argv.includes('--auto-refund') ? 'auto-refund' : 'happy';

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) });
const walletClient = createWalletClient({ chain: sepolia, transport: http(RPC_URL), account });

const SCAN = 'https://sepolia.etherscan.io';

function shortHash(h) { return h.slice(0, 10) + '...' + h.slice(-4); }

async function txHash(wc, tx) {
  const h = await wc.writeContract(tx);
  const r = await publicClient.waitForTransactionReceipt({ hash: h });
  return { h, r, gas: Number(r.gasUsed) };
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     Recourse Escrow — Sepolia Demo                      ║');
  console.log('║     Chargebacks for the Machine Economy                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`  Chain:      Sepolia (11155111)`);
  console.log(`  Contract:   ${contractAddr}`);
  console.log(`  USDC:       ${USDC_ADDR}`);
  console.log(`  Wallet:     ${account.address}`);
  console.log(`  Mode:       ${mode}`);
  console.log(`  Explorer:   ${SCAN}/address/${contractAddr}\n`);

  // ─── Check ETH balance ───
  const ethBal = await publicClient.getBalance({ address: account.address });
  console.log(`  ETH:        ${formatEther(ethBal)} ETH`);
  if (ethBal === 0n) {
    console.error('\n❌ No Sepolia ETH. Faucet required.');
    process.exit(1);
  }

  // ─── Check USDC balance ───
  let usdcBal = 0n;
  try {
    usdcBal = await publicClient.readContract({ address: USDC_ADDR, abi: USDC_ABI, functionName: 'balanceOf', args: [account.address] });
  } catch (e) {
    console.log('  (USDC balance check failed — token may not be deployed on this RPC)');
  }
  const usdcDecimals = 6;
  console.log(`  USDC:       ${formatUnits(usdcBal, usdcDecimals)} USDC\n`);

  // ─── Demo amounts ───
  const ESCROW_AMOUNT = parseUnits('10', usdcDecimals); // 10 USDC
  const buyerAddr = account.address;
  const sellerAddr = account.address; // self-escrow for demo

  // ─── Step 0: Approve USDC for escrow contract ───
  if (usdcBal < ESCROW_AMOUNT) {
    console.log('⚠️  Insufficient USDC. Attempting to mint test USDC...');
    try {
      const mintTx = await txHash(walletClient, { address: USDC_ADDR, abi: USDC_ABI, functionName: 'mint', args: [account.address, ESCROW_AMOUNT * 10n] });
      console.log(`  ✅ Minted ${formatUnits(ESCROW_AMOUNT * 10n, usdcDecimals)} USDC`);
      console.log(`     tx: ${shortHash(mintTx.h)} (${mintTx.gas} gas)\n`);
    } catch (e) {
      console.error(`  ❌ Mint failed: ${e.message?.slice(0, 200)}`);
      console.error('  Get Sepolia USDC from a faucet.');
      process.exit(1);
    }
  }

  console.log('─── Step 0: Approve USDC ───');
  const approveTx = await txHash(walletClient, { address: USDC_ADDR, abi: USDC_ABI, functionName: 'approve', args: [contractAddr, ESCROW_AMOUNT] });
  console.log(`  ✅ Approved escrow contract to spend ${formatUnits(ESCROW_AMOUNT, usdcDecimals)} USDC`);
  console.log(`     tx: ${shortHash(approveTx.h)} (${approveTx.gas} gas)`);
  console.log(`     ${SCAN}/tx/${approveTx.h}\n`);

  // ─── Step 1: Create Escrow ───
  const taskId = keccak256(encodePacked(['string'], ['summarize-article-2026-07-27']));
  const evidenceHash = keccak256(encodePacked(['string'], ['evidence-bundle-v1-sha256-of-canonical-json']));

  console.log('─── Step 1: Create Escrow ───');
  console.log(`  buyer:     ${buyerAddr}`);
  console.log(`  seller:    ${sellerAddr}`);
  console.log(`  amount:    ${formatUnits(ESCROW_AMOUNT, usdcDecimals)} USDC`);
  console.log(`  taskId:    ${taskId}`);
  console.log(`  evidence:  ${evidenceHash}`);

  const createTx = await txHash(walletClient, { address: contractAddr, abi, functionName: 'createEscrow', args: [buyerAddr, sellerAddr, ESCROW_AMOUNT, taskId, evidenceHash] });
  // Parse escrow ID from EscrowCreated event
  const escrowId = createTx.r.logs.length > 0 ? Number(createTx.r.logs[0].topics[1]) : 1;
  console.log(`  ✅ Escrow #${escrowId} created`);
  console.log(`     tx: ${shortHash(createTx.h)} (${createTx.gas} gas)`);
  console.log(`     ${SCAN}/tx/${createTx.h}\n`);

  // ─── Step 2: Resolve ───
  if (mode === 'happy') {
    // Happy path: confirm delivery → seller gets paid
    console.log('─── Step 2: Confirm Delivery ───');
    const confirmEvidence = keccak256(encodePacked(['string'], ['delivery-confirmed-sha256']));
    const confirmTx = await txHash(walletClient, { address: contractAddr, abi, functionName: 'confirmDelivery', args: [BigInt(escrowId), confirmEvidence] });
    console.log(`  ✅ Delivery confirmed — USDC released to seller`);
    console.log(`     tx: ${shortHash(confirmTx.h)} (${confirmTx.gas} gas)`);
    console.log(`     ${SCAN}/tx/${confirmTx.h}\n`);

    const finalBal = await publicClient.readContract({ address: USDC_ADDR, abi: USDC_ABI, functionName: 'balanceOf', args: [account.address] });
    console.log(`  Final USDC balance: ${formatUnits(finalBal, usdcDecimals)} USDC`);
    console.log('  Status: RESOLVED (seller paid)\n');

  } else if (mode === 'dispute') {
    // Dispute path: raise dispute → arbiter resolves → buyer refunded
    console.log('─── Step 2: Raise Dispute ───');
    const disputeEvidence = keccak256(encodePacked(['string'], ['content-digest-mismatch-evidence-pack']));
    const disputeTx = await txHash(walletClient, { address: contractAddr, abi, functionName: 'raiseDispute', args: [BigInt(escrowId), disputeEvidence] });
    console.log(`  ✅ Dispute raised — escrow frozen`);
    console.log(`     tx: ${shortHash(disputeTx.h)} (${disputeTx.gas} gas)`);
    console.log(`     ${SCAN}/tx/${disputeTx.h}\n`);

    // Check status
    const status = await publicClient.readContract({ address: contractAddr, abi, functionName: 'statusOf', args: [BigInt(escrowId)] });
    console.log(`  Escrow status: ${['Active','Confirmed','Disputed','Resolved','Refunded'][Number(status)]}\n`);

    console.log('─── Step 3: Arbiter Resolves (buyer wins — refund) ───');
    const resolveTx = await txHash(walletClient, { address: contractAddr, abi, functionName: 'resolveDispute', args: [BigInt(escrowId), true, buyerAddr] });
    console.log(`  ✅ Arbiter ruled: BUYER WINS — USDC refunded to buyer`);
    console.log(`     tx: ${shortHash(resolveTx.h)} (${resolveTx.gas} gas)`);
    console.log(`     ${SCAN}/tx/${resolveTx.h}\n`);

    const finalBal = await publicClient.readContract({ address: USDC_ADDR, abi: USDC_ABI, functionName: 'balanceOf', args: [account.address] });
    console.log(`  Final USDC balance: ${formatUnits(finalBal, usdcDecimals)} USDC`);
    console.log('  Status: RESOLVED (buyer refunded)\n');

  } else if (mode === 'auto-refund') {
    // Auto-refund path: raise dispute → wait 14 days → autoRefund
    // NOTE: On real Sepolia this requires waiting 14 days. For demo, we just create the dispute.
    console.log('─── Step 2: Raise Dispute ───');
    const disputeEvidence = keccak256(encodePacked(['string'], ['timeout-auto-refund-evidence']));
    const disputeTx = await txHash(walletClient, { address: contractAddr, abi, functionName: 'raiseDispute', args: [BigInt(escrowId), disputeEvidence] });
    console.log(`  ✅ Dispute raised — escrow frozen`);
    console.log(`     tx: ${shortHash(disputeTx.h)} (${disputeTx.gas} gas)\n`);

    console.log('─── Step 3: Auto-Refund (requires 14-day timeout) ───');
    console.log('  ⏳ On real Sepolia, autoRefund() must be called after 14 days.');
    console.log('     For demo, showing the dispute state. Run autoRefund after timeout.');
    console.log('     tx: cast call <contract> autoRefund(' + escrowId + ') --rpc-url $SEPOLIA_RPC --private-key $PK\n');
  }

  // ─── Summary ───
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Demo complete. All transactions on Sepolia testnet.     ║');
  console.log('║  Verify on Etherscan:                                   ║');
  console.log(`║  ${SCAN}/address/${contractAddr}`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');
}

main().catch(e => { console.error('\n❌', e.message?.slice(0, 500) || e); process.exit(1); });
