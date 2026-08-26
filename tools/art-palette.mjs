/**
 * Mines the art sheets: loads each PNG, samples pixels, extracts the dominant
 * color palette so the game UI/HUD can be calibrated to the real art.
 * Run: node tools/art-palette.mjs
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const exe = BROWSERS.find((p) => fs.existsSync(p));

const SHEETS = [
  'characters', 'concept-map', 'features', 'landing',
  'pitch', 'story', 'style-sheet',
];

const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });

for (const name of SHEETS) {
  const out = await page.evaluate(async (n) => {
    const img = new Image();
    img.src = `/assets/${n}.png`;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const c = document.createElement('canvas');
    const S = 96;
    c.width = S;
    c.height = Math.round((img.height / img.width) * S);
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    // quantize to 4-bit channels, count buckets (skip near-white bg / transparent)
    const buckets = new Map();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const r = d[i], gr = d[i + 1], b = d[i + 2];
      if (r > 235 && gr > 235 && b > 235) continue;
      const key = ((r >> 4) << 8) | ((gr >> 4) << 4) | (b >> 4);
      const e = buckets.get(key) || [0, 0, 0, 0];
      e[0] += r; e[1] += gr; e[2] += b; e[3]++;
      buckets.set(key, e);
    }
    return [...buckets.values()]
      .sort((a, b) => b[3] - a[3])
      .slice(0, 8)
      .map((e) => '#' + [e[0], e[1], e[2]].map((v) => Math.round(v / e[3]).toString(16).padStart(2, '0')).join(''))
      .join(' ');
  }, name);
  console.log(`${name.padEnd(12)} ${out}`);
}
await browser.close();
