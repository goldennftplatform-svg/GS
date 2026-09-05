/**
 * Visual QA: renders the six-agent lineup in two arenas and saves PNGs
 * for review. Run: node tools/skins-shot.mjs https://YOUR-LIVE-HOST
 * Never starts a match. WebSockets are blocked before the live client loads.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'C:/Users/PreSafu/AppData/Local/Temp/opencode/skullshots/isolated';
const live = new URL(process.argv[2]);
if (live.protocol !== 'https:' || /localhost|127\.|\[|\.local$|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./i.test(live.hostname)) {
  throw new Error('An explicit public live HTTPS URL is required');
}
fs.mkdirSync(OUT, { recursive: true });

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const exe = BROWSERS.find((p) => fs.existsSync(p));
if (!exe) {
  console.error('no browser');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--window-size=1280,720',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.evaluateOnNewDocument(() => {
  window.WebSocket = class { constructor() { throw new Error('Skin QA forbids multiplayer connections'); } };
});
await page.goto(live.href, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction(() => !!window.SKULL_DEBUG, { timeout: 30000 });
await page.waitForFunction(() => document.getElementById('bootStatus')?.textContent.includes('ASSETS LOCKED'), { timeout: 60000 });
await page.waitForFunction(() => performance.getEntriesByType('resource').some(r => r.name.includes('/js/agent-surfaces.js?v=20260904d')), { timeout: 30000 });

// Hide HUD chrome for clean skin shots
await page.evaluate(() => {
  document.querySelectorAll('#boot, #selectScreen, #overlay, #hud, #radar, #crosshair, #hitMarker').forEach((el) => {
    el.style.display = 'none';
  });
});

async function shot(mapId, name) {
  await page.evaluate((m) => SKULL_DEBUG.photoMode(m), mapId);
  await sleep(1200); // let FOV/bob/shadows settle
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('saved', name);
}

await shot('stadium', 'lineup-stadium.png');
await shot('facility', 'lineup-facility.png');

// Both sides in both lighting rigs, without hiding character adornments for QA.
for (const map of ['stadium', 'facility']) {
  await page.evaluate(m => SKULL_DEBUG.photoMode(m), map);
  for (const [i, name] of ['og', 'daisy', 'spike', 'courier', 'tech', 'hazard'].entries()) {
    await page.evaluate((idx) => {
      SKULL_DEBUG._photo.forEach((m, j) => { m.visible = j === idx; });
      SKULL_DEBUG.focusAgent(idx);
    }, i);
    await sleep(350);
    await page.screenshot({ path: path.join(OUT, `${map}-close-${name}.png`) });
    console.log('saved', map, name);
    await page.evaluate(idx => { SKULL_DEBUG._photo[idx].rotation.y = Math.PI; }, i);
    await sleep(350);
    await page.screenshot({ path: path.join(OUT, `${map}-back-${name}.png`) });
  }
}

await browser.close();
console.log('DONE ->', OUT);
