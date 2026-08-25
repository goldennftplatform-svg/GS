/**
 * Pickup-path probe: teleports onto the golden-gun drop and a weapon pad,
 * verifies the grab pipeline end to end. Run: node tools/probe-pickup.mjs
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const exe = BROWSERS.find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--window-size=1280,720', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction(() => !!window.SKULL_DEBUG, { timeout: 30000 });
await page.evaluate(() => SKULL_DEBUG.startSolo('skullpepe', 'stadium'));
await sleep(1500);

// 1) weapon pad grab (kf7 at -27,-27 on stadium)
let r = await page.evaluate(() => {
  SKULL_DEBUG.teleport(-27, -27);
  return SKULL_DEBUG.debugPads();
});
await sleep(800);
let st = await page.evaluate(() => SKULL_DEBUG.state());
console.log('PAD GRAB:', st.weapon, '(expect kf7) | pad active before:', JSON.stringify(r.pads.find((p) => p.w === 'kf7')));

// 2) golden gun: wait for spawn at T+20s, then stand on it
const wait = await page.evaluate(async () => {
  while (Date.now() - SKULL_DEBUG.debugPads().startedAt < 21000) {
    await new Promise((res) => setTimeout(res, 250));
  }
  const d = SKULL_DEBUG.debugPads();
  SKULL_DEBUG.teleport(d.gold.x, d.gold.z);
  return d.gold;
});
console.log('GOLD STATE at T+21s:', JSON.stringify(wait));
await sleep(800);
st = await page.evaluate(() => SKULL_DEBUG.state());
console.log('GOLD GRAB:', st.weapon, '(expect gold)');

await browser.close();
