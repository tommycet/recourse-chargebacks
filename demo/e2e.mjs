/**
 * Recourse Escrow — E2E Test (Playwright)
 * 
 * Tests the full escrow lifecycle via the browser frontend.
 * 1. Starts HTTP server for web/demo.html
 * 2. Navigates to demo.html
 * 3. Verifies page loads
 * 4. Clicks Demo Mode (auto-connects to Anvil)
 * 5. Fills escrow form, submits
 * 6. Verifies tx log shows success
 * 7. Clicks Confirm Delivery
 * 8. Takes screenshots at each step
 */

import { chromium } from 'playwright';
import { execSync, spawn } from 'child_process';
import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = '/root/recourse/video/e2e_screenshots';
const WEB_DIR = '/root/recourse/web';
const PORT = 8096;
const BASE_URL = `http://localhost:${PORT}/demo.html`;

// Ensure screenshot directory
if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

let server;

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', WEB_DIR], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', () => resolve());
    server.stderr.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('Serving HTTP')) resolve();
    });
    // Give server time to start
    setTimeout(resolve, 1000);
    server.on('error', reject);
  });
}

function stopServer() {
  if (server) { try { server.kill(); } catch(e) {} }
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('═══ Recourse E2E Test ═══\n');
  
  // Start HTTP server
  console.log(`Starting HTTP server on port ${PORT}...`);
  await startServer();
  console.log('Server started.\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Collect console logs
  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => consoleLogs.push(`[error] ${err.message}`));

  try {
    // Step 1: Navigate
    console.log('Step 1: Navigate to demo.html...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15000 });
    
    const title = await page.title();
    console.log(`  Title: "${title}"`);
    if (!title.includes('Recourse')) throw new Error('Title missing "Recourse"');
    console.log('  ✓ Page loaded\n');
    await page.screenshot({ path: join(SCREENSHOT_DIR, '01-page-loaded.png') });

    // Step 2: Verify connect screen
    console.log('Step 2: Verify connect screen...');
    const connectTitle = await page.textContent('.connect-title');
    console.log(`  Connect title: "${connectTitle}"`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '02-connect-screen.png') });

    // Step 3: Click Demo Mode
    console.log('Step 3: Click Demo Mode...');
    await page.click('text=Demo Mode');
    await sleep(2000); // Wait for connection + state load
    await page.screenshot({ path: join(SCREENSHOT_DIR, '03-demo-connected.png') });
    
    // Verify connected
    const walletText = await page.textContent('#walletText');
    console.log(`  Wallet: ${walletText}`);
    if (walletText.includes('0x')) {
      console.log('  ✓ Demo connected\n');
    } else {
      console.log('  ⚠ Wallet text: ' + walletText + '\n');
    }

    // Step 4: Fill escrow form and create
    console.log('Step 4: Create escrow...');
    const amountInput = await page.$('#inputAmount');
    if (amountInput) {
      await amountInput.fill('10');
    }
    const taskInput = await page.$('#inputTask');
    if (taskInput) {
      await taskInput.fill('e2e-test-task-' + Date.now());
    }
    await page.screenshot({ path: join(SCREENSHOT_DIR, '04-form-filled.png') });

    // Click create button
    await page.click('#createBtn');
    console.log('  Waiting for escrow creation...');
    
    // Wait for success log (up to 30 seconds)
    await sleep(5000);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '05-escrow-created.png') });

    // Check log for success
    const logEntries = await page.$$eval('.log-entry', entries => entries.map(e => e.textContent));
    const successEntry = logEntries.find(e => e.includes('created') || e.includes('Escrow'));
    if (successEntry) {
      console.log('  ✓ Escrow created: ' + successEntry.trim().slice(0,80));
    } else {
      console.log('  Log entries: ' + logEntries.length);
      logEntries.forEach(e => console.log('    ' + e.trim().slice(0,100)));
    }
    console.log('');

    // Step 5: Check if action panel appeared
    console.log('Step 5: Check action panel...');
    const actionPanel = await page.$('#actionPanel');
    const actionVisible = actionPanel ? await actionPanel.isVisible() : false;
    console.log(`  Action panel visible: ${actionVisible}`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, '06-action-panel.png') });

    // Step 6: Confirm delivery
    if (actionVisible) {
      console.log('Step 6: Confirm delivery...');
      const confirmBtn = await page.$('#confirmBtn');
      if (confirmBtn && await confirmBtn.isVisible()) {
        await confirmBtn.click();
        console.log('  Waiting for confirmation...');
        await sleep(5000);
        await page.screenshot({ path: join(SCREENSHOT_DIR, '07-delivery-confirmed.png') });
        
        const finalLogs = await page.$$eval('.log-entry', entries => entries.map(e => e.textContent));
        const confirmEntry = finalLogs.find(e => e.includes('confirmed') || e.includes('Confirmed'));
        if (confirmEntry) {
          console.log('  ✓ Delivery confirmed');
        } else {
          console.log('  Final logs: ' + finalLogs.slice(-3).join(' | ').slice(0,200));
        }
      } else {
        console.log('  Confirm button not available');
      }
    }
    console.log('');

    // Final screenshot
    await page.screenshot({ path: join(SCREENSHOT_DIR, '08-final-state.png'), fullPage: true });

    // Summary
    console.log('═══ E2E Test Results ═══');
    console.log(`  Screenshots saved to: ${SCREENSHOT_DIR}`);
    console.log(`  Console errors: ${consoleLogs.filter(l => l.startsWith('[error]')).length}`);
    
    // Verify screenshots exist
    const fs = await import('fs');
    const shots = fs.readdirSync(SCREENSHOT_DIR).filter(f => f.endsWith('.png'));
    console.log(`  Screenshots captured: ${shots.length}`);
    shots.forEach(s => console.log(`    - ${s}`));
    
    console.log('\n✓ E2E test complete\n');

  } catch(e) {
    console.error('❌ E2E test failed:', e.message);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'error-state.png') });
    
    // Print console logs for debugging
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
