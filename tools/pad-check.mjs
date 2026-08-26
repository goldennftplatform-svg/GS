/** Are the flagged pads genuinely inside static boxes, or just neighbors? */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const exe = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage();
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
await page.waitForFunction(() => !!window.SKULL_DEBUG);
for (const [map, spots] of Object.entries({
  lunch: [[-22, 22], [22, 22]],
  starbucks: [[20, -20]],
  facility: [[-29, 29]],
})) {
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => !!window.SKULL_DEBUG);
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate((m) => SKULL_DEBUG.startSolo('skullpepe', m), map);
  await new Promise((r) => setTimeout(r, 1800));
  const res = await page.evaluate((s) => s.map(([x, z]) => ({ x, z, inside: SKULL_DEBUG.debugBlocked(x, z, -0.35).length })), spots);
  console.log(map, JSON.stringify(res));
}
await browser.close();
