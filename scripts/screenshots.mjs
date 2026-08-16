/**
 * Drive a headless browser over the real pages and capture them.
 *
 * Called by scripts/screenshots.sh, which is responsible for having an instance
 * running with sources on air. Two passes, because they need different setups:
 *
 *   --pass admin   the admin console, against the real H.264 encoder
 *   --pass viewer  the player, against a VP8 programme the browser can decode
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const BASE = arg('base', 'http://127.0.0.1:13222');
const OUT = arg('out', '/tmp/stream-composer-shots');
const PASSWORD = arg('password', 'demo-Passw0rd!');
const PASS = arg('pass', 'admin');

fs.mkdirSync(OUT, { recursive: true });

/**
 * Chromium builds without proprietary codecs report no H.264 support, so the
 * player's capability gate refuses to connect before it ever negotiates. The
 * instance publishes VP8 for this pass, which the browser decodes fine, so tell
 * the gate what it wants to hear. SDP negotiation still uses the browser's real
 * capabilities, so nothing else is faked.
 */
const UNGATE = `
  const orig = RTCRtpReceiver.getCapabilities.bind(RTCRtpReceiver);
  RTCRtpReceiver.getCapabilities = (kind) => {
    const caps = orig(kind);
    if (kind === 'video' && caps && !caps.codecs.some((c) => /h264/i.test(c.mimeType))) {
      return { ...caps, codecs: [...caps.codecs, { mimeType: 'video/H264', clockRate: 90000 }] };
    }
    return caps;
  };
`;

async function signIn(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"], #username', 'admin');
  await page.fill('input[name="password"], #password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
}

/** Capture the page content only, without the dead space below it. */
async function shootContent(page, name, pad = 24) {
  const box = await page.evaluate(() => {
    let bottom = 0;
    for (const el of document.querySelectorAll('main > *, .panel.is-active > *')) {
      const r = el.getBoundingClientRect();
      if (r.height > 0) bottom = Math.max(bottom, r.bottom + window.scrollY);
    }
    return { bottom, width: document.documentElement.scrollWidth };
  });
  const height = Math.min(Math.ceil(box.bottom + pad), 2600);
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 0, y: 0, width: box.width, height } });
  console.log(`    ${name}  ${box.width}x${height}`);
}

async function adminPass(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await signIn(page);
  await page.waitForTimeout(2000);
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await shootContent(page, '03-admin-streams');

  for (const [tab, name] of [
    ['composition', '04-admin-composition'],
    ['users', '05-admin-users'],
    ['server', '06-admin-server'],
    ['logs', '07-admin-logs'],
  ]) {
    await page.locator('#tabs button, #tabs a').filter({ hasText: new RegExp(tab, 'i') }).first().click();
    // The server tab samples every couple of seconds; let a few land so the
    // bitrate chart has a line in it rather than a single point.
    await page.waitForTimeout(tab === 'server' ? 9000 : 2000);
    await shootContent(page, name);
  }
  await ctx.close();
}

async function viewerPass(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1240 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(UNGATE);
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/01-login.png`, clip: { x: 0, y: 0, width: 1440, height: 760 } });
  console.log('    01-login');

  await signIn(page);
  // Wait for pictures, not for a guess: the video element only reports a size
  // once frames are decoding, so this survives a slow encoder start.
  await page.waitForFunction(
    () => {
      const v = document.querySelector('#program-video');
      return v && v.videoWidth > 0 && v.currentTime > 1;
    },
    null,
    { timeout: 120000 },
  );
  // A few more seconds so the stats tiles have something to average.
  await page.waitForTimeout(8000);
  await page.mouse.move(20, 1220); // off the player, so the transport fades out
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/02-viewer.png` });
  console.log('    02-viewer');

  const pick = page.locator('#audio-list').getByText('Main Stage', { exact: true }).first();
  if (await pick.count()) {
    await pick.click();
    await page.waitForTimeout(6000);
    await page.mouse.move(20, 1220);
    await page.screenshot({ path: `${OUT}/08-audio-monitor.png` });
    console.log('    08-audio-monitor');
  }
  await ctx.close();
}

const browser = await chromium.launch({
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  if (PASS === 'viewer') await viewerPass(browser);
  else await adminPass(browser);
} finally {
  await browser.close();
}
