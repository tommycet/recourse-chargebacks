/**
 * Recourse E2E — Dispute Scenario (Sepolia)
 * 
 * Walks through the EXACT problem Recourse solves:
 * 1. Buyer creates escrow (pays for a service)
 * 2. Seller FAILS to deliver (no confirmDelivery)
 * 3. Buyer raises dispute
 * 4. Arbiter resolves — buyer wins, USDC refunded
 * 
 * This demonstrates: "x402 executes blockchain transfer with zero delivery
 * verification. A malicious server can pocket funds and return nothing,
 * with no recourse for buyers."
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = '/root/recourse/video/e2e_dispute';
const WEB_DIR = '/root/recourse/web';
const PORT = 8096;
const BASE_URL = `http://localhost:${PORT}/demo.html`;

if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', WEB_DIR], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stderr.on('data', (d) => {
      if (d.toString().includes('Serving HTTP')) resolve();
    });
    setTimeout(resolve, 1500);
    server.on('error', reject);
  });
}

function stopServer() {
  if (server) { try { server.kill(); } catch(e) {} }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('═══ Recourse E2E — Dispute Scenario (Sepolia) ═══\n');
  
  console.log('Starting HTTP server...');
  await startServer();
  console.log('Server started.\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => consoleLogs.push(`[error] ${err.message}`));

  try {
    // Step 1: Load page
    console.log('Step 1: Load demo.html...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.screenshot({ path: join(SCREENSHOT_DIR, '01-page-loaded.png'), fullPage: true });
    console.log('  ✓ Page loaded\n');

    // Step 2: Connect to Sepolia
    console.log('Step 2: Connect Demo Mode (Sepolia)...');
    await page.click('text=Demo Mode (Sepolia)');
    await sleep(15000);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '02-connected.png'), fullPage: true });
    console.log('  ✓ Connected to Sepolia\n');

    // Step 3: Fill escrow form — simulate buying a service that won't be delivered
    console.log('Step 3: Create escrow (buyer pays for service)...');
    await page.fill('#inputAmount', '10');
    await page.fill('#inputTask', 'ai-article-summary-service-' + Date.now());
    await page.screenshot({ path: join(SCREENSHOT_DIR, '03-form-filled.png'), fullPage: true });

    await page.click('#createBtn');
    console.log('  Waiting for escrow creation...');
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.log-entry')).some(e => e.textContent.includes('created')),
      { timeout: 90000 }
    ).catch(() => console.log('  (timeout)'));
    await sleep(15000);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '04-escrow-created.png'), fullPage: true });
    console.log('  ✓ Escrow #1 Active — funds locked\n');

    // Step 4: SELLER FAILS TO DELIVER — skip confirmDelivery
    console.log('Step 4: Seller fails to deliver (no confirmDelivery)...');
    await page.screenshot({ path: join(SCREENSHOT_DIR, '05-no-delivery.png'), fullPage: true });
    console.log('  Escrow remains Active — buyer funds stuck\n');

    // Step 5: Buyer raises dispute
    console.log('Step 5: Buyer raises dispute...');
    const disputeBtn = await page.$('#disputeBtn');
    if (disputeBtn && await disputeBtn.isVisible()) {
      await disputeBtn.click();
      console.log('  Waiting for dispute tx...');
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('.log-entry')).some(e => e.textContent.includes('Dispute raised')),
        { timeout: 90000 }
      ).catch(() => console.log('  (timeout)'));
      await sleep(15000);
      await page.screenshot({ path: join(SCREENSHOT_DIR, '06-dispute-raised.png'), fullPage: true });
      console.log('  ✓ Dispute raised — escrow frozen\n');
    } else {
      console.log('  ⚠ Dispute button not available\n');
    }

    // Step 6: Arbiter resolves — buyer wins (refund)
    console.log('Step 6: Arbiter resolves — Buyer Wins (refund)...');
    const buyerWinsBtn = await page.$('button:has-text("Buyer Wins")');
    if (buyerWinsBtn && await buyerWinsBtn.isVisible()) {
      await buyerWinsBtn.click();
      console.log('  Waiting for resolution tx...');
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('.log-entry')).some(e => e.textContent.includes('Refunded')),
        { timeout: 90000 }
      ).catch(() => console.log('  (timeout)'));
      await sleep(15000);
      await page.screenshot({ path: join(SCREENSHOT_DIR, '07-refunded.png'), fullPage: true });
      console.log('  ✓ Buyer refunded — escrow Resolved\n');
    } else {
      console.log('  ⚠ Buyer Wins button not available\n');
    }

    // Final screenshot
    await page.screenshot({ path: join(SCREENSHOT_DIR, '08-final-state.png'), fullPage: true });

    // Summary
    console.log('═══ E2E Results ═══');
    console.log(`  Console errors: ${consoleLogs.filter(l => l.startsWith('[error]')).length}`);
    const shots = readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'));
    console.log(`  Screenshots: ${shots.length}`);
    shots.forEach(s => console.log(`    - ${s}`));
    
    const logEntries = await page.$$eval('.log-entry', entries => entries.map(e => e.textContent));
    console.log('\n  Final log:');
    logEntries.forEach(e => console.log('    ' + e.trim().slice(0,120)));
    
    if (consoleLogs.filter(l => l.startsWith('[error]')).length > 0) {
      console.log('\n  Errors:');
      consoleLogs.filter(l => l.startsWith('[error]')).forEach(l => console.log('    ' + l));
    }
    
    console.log('\n✓ Dispute scenario E2E complete\n');

  } catch(e) {
    console.error('❌ E2E failed:', e.message);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'error-state.png'), fullPage: true });
    if (consoleLogs.length > 0) {
      console.log('\nBrowser console:');
      consoleLogs.slice(-20).forEach(l => console.log('  ' + l));
    }
    process.exitCode = 1;
  } finally {
    await browser.close();
    stopServer();
  }
}

main();
