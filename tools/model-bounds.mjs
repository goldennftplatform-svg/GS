/**
 * Measures weapon GLB bounding boxes via SKULL_DEBUG.debugModelBounds().
 * Run: node tools/model-bounds.mjs   (server on :3000)
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const exe = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
await page.waitForFunction(() => !!window.SKULL_DEBUG, { timeout: 30000 });
await page.evaluate(() => SKULL_DEBUG.startSolo('skullpepe', 'stadium'));
await new Promise((r) => setTimeout(r, 5000));

const models = await page.evaluate(() => SKULL_DEBUG.debugModelBounds());
for (const [name, m] of Object.entries(models)) {
  console.log(`${name.padEnd(12)} ${m.w}w × ${m.h}h × ${m.d}d   center.y=${m.cy}`);
}
await browser.close();
