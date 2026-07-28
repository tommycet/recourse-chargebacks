/**
 * Playwright recording script for Recourse demo video.
 * Single-page scroll controller: Part A (landing page) → Part B (forge test terminal animation).
 * Records at 1920×1080 with recordVideo.
 * Run: xvfb-run -a --server-args="-screen 0 1920x1080x24" node record.cjs
 */
const { chromium } = require('playwright');

const VIEWPORT_W = 1920;
const VIEWPORT_H = 1080;
const VIDEO_DIR = '/root/recourse/video/raw';
const PAGE_URL = 'http://localhost:8096/index_demo.html';

// Total target duration ~150s.
// Part A: ~120s (landing page scroll through 7 sections, ~15-20s each)
// Part B: ~30s (terminal typing animation)
const SCENES = [
  // [label, targetElement, dwellMs]
  { label: 'hero',        selector: '#top',           dwell: 16000 },
  { label: 'problem',     selector: '#problem',       dwell: 18000 },
  { label: 'evidence',    selector: '#evidence',      dwell: 18000 },
  { label: 'design',      selector: '#design',        dwell: 18000 },
  { label: 'demo',        selector: '#demo',          dwell: 18000 },
  { label: 'docs',        selector: '#docs',          dwell: 16000 },
  { label: 'terminal',    selector: '#terminal-scene', dwell: 32000 },
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1920,1080',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: VIEWPORT_W, height: VIEWPORT_H },
    },
  });

  // Ensure fonts render by waiting for them.
  const page = await context.newPage();
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Verify page loaded
  const title = await page.title();
  console.log(`[record] Page title: ${title}`);

  // Scroll through each scene
  for (const scene of SCENES) {
    console.log(`[record] Scrolling to: ${scene.label} (dwell ${scene.dwell}ms)`);
    const el = await page.$(scene.selector);
    if (!el) {
      console.log(`[record] WARNING: element ${scene.selector} not found, skipping`);
      await page.waitForTimeout(scene.dwell);
      continue;
    }
    await el.scrollIntoViewIfNeeded();
    // Give the terminal typing animation a moment to start when in view
    await page.waitForTimeout(800);
    await page.waitForTimeout(scene.dwell);
  }

  // Final hold to capture the end of the terminal output
  await page.waitForTimeout(3000);

  await context.close();
  await browser.close();
  console.log('[record] Recording complete.');
})();
