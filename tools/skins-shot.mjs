/**
 * Visual QA: renders the six-agent lineup in two arenas and saves PNGs
 * for review. Run: node tools/skins-shot.mjs   (server on :3000)
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'C:/Users/PreSafu/AppData/Local/Temp/opencode/skullshots';
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
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction(() => !!window.SKULL_DEBUG, { timeout: 30000 });
await page.evaluate(() => SKULL_DEBUG.startSolo('skullpepe', 'stadium'));
await sleep(1500);

// Hide HUD chrome for clean skin shots
await page.evaluate(() => {
  document.querySelectorAll('#hud, #radar, #crosshair, #hitMarker').forEach((el) => {
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

// Close-ups: mini(2), drone(4), daisy(1), hazard(5) on the dark map
for (const [i, name] of [[2, 'mini'], [4, 'drone'], [1, 'daisy'], [5, 'hazard']]) {
  await page.evaluate((idx) => SKULL_DEBUG.focusAgent(idx), i);
  await sleep(350);
  await page.screenshot({ path: path.join(OUT, `close-${name}.png`) });
  console.log('saved close-' + name);
}

await browser.close();
console.log('DONE ->', OUT);
