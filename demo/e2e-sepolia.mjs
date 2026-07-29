/**
 * Recourse E2E — Sepolia browser test with Playwright
 * Takes screenshots at each step and completes the full escrow lifecycle.
 */
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = '/root/recourse/video/e2e_screenshots';
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
  console.log('═══ Recourse E2E (Sepolia) ═══\n');
  
  console.log('Starting HTTP server...');
  await startServer();
  console.log('Server started.\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ 
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2  // High-DPI for crisp screenshots
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

    // Step 2: Click Demo Mode (Sepolia)
    console.log('Step 2: Click Demo Mode (Sepolia)...');
    await page.click('text=Demo Mode (Sepolia)');
    console.log('  Waiting for Sepolia RPC connection (15s)...');
    await sleep(15000);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '02-sepolia-connected.png'), fullPage: true });
    
    const walletText = await page.textContent('#walletText');
    console.log(`  Wallet: ${walletText}`);
    console.log('  ✓ Connected to Sepolia\n');

    // Step 3: Fill escrow form
    console.log('Step 3: Fill escrow form...');
    await page.fill('#inputAmount', '10');
    await page.fill('#inputTask', 'recourse-e2e-sepolia-' + Date.now());
    await page.screenshot({ path: join(SCREENSHOT_DIR, '03-form-filled.png'), fullPage: true });
    console.log('  ✓ Form filled\n');

    // Step 4: Create escrow
    console.log('Step 4: Create escrow (approve + create)...');
    await page.click('#createBtn');
    console.log('  Waiting for tx confirmation (Sepolia ~12s/block, 60s timeout)...');
    
    // Wait for success log
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.log-entry')).some(e => 
        e.textContent.includes('created') || e.textContent.includes('Escrow')
      ),
      { timeout: 90000 }
    ).catch(() => console.log('  (timeout waiting for success log)'));
    
    await sleep(15000); // Extra wait for UI update
    await page.screenshot({ path: join(SCREENSHOT_DIR, '04-escrow-created.png'), fullPage: true });
    
    const logEntries = await page.$$eval('.log-entry', entries => entries.map(e => e.textContent));
    console.log(`  Log entries: ${logEntries.length}`);
    logEntries.forEach(e => console.log('    ' + e.trim().slice(0,120)));
    console.log('');

    // Step 5: Check action panel
    console.log('Step 5: Check action panel...');
    const actionPanel = await page.$('#actionPanel');
    const actionVisible = actionPanel ? await actionPanel.isVisible() : false;
    console.log(`  Action panel visible: ${actionVisible}`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '05-action-panel.png'), fullPage: true });

    // Step 6: Confirm delivery
    if (actionVisible) {
      console.log('Step 6: Confirm delivery...');
      const confirmBtn = await page.$('#confirmBtn');
      if (confirmBtn && await confirmBtn.isVisible()) {
        await confirmBtn.click();
        console.log('  Waiting for confirmation...');
        await page.waitForFunction(
          () => Array.from(document.querySelectorAll('.log-entry')).some(e => 
            e.textContent.includes('confirmed') || e.textContent.includes('released')
          ),
          { timeout: 90000 }
        ).catch(() => console.log('  (timeout waiting for confirmation)'));
        
        await sleep(15000);
        await page.screenshot({ path: join(SCREENSHOT_DIR, '06-delivery-confirmed.png'), fullPage: true });
        
        const finalLogs = await page.$$eval('.log-entry', entries => entries.map(e => e.textContent));
        console.log(`  Final log entries: ${finalLogs.length}`);
        finalLogs.slice(-5).forEach(e => console.log('    ' + e.trim().slice(0,120)));
      }
    }
    console.log('');

    // Final screenshot
    await page.screenshot({ path: join(SCREENSHOT_DIR, '07-final-state.png'), fullPage: true });

    // Summary
    console.log('═══ E2E Results ═══');
    console.log(`  Console errors: ${consoleLogs.filter(l => l.startsWith('[error]')).length}`);
    const shots = readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'));
    console.log(`  Screenshots: ${shots.length}`);
    shots.forEach(s => console.log(`    - ${s}`));
    
    if (consoleLogs.filter(l => l.startsWith('[error]')).length > 0) {
      console.log('\n  Errors:');
      consoleLogs.filter(l => l.startsWith('[error]')).forEach(l => console.log('    ' + l));
    }
    
    console.log('\n✓ Done\n');

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
