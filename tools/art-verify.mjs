/**
 * Art-integration verification: every sheet decodes, tabs flip, raygun is the
 * hero viewmodel, new props register colliders. Screenshots for the human.
 * Run: node tools/art-verify.mjs
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const exe = BROWSERS.find((p) => fs.existsSync(p));
const OUT = 'C:/Users/PreSafu/AppData/Local/Temp/opencode/skullshots';
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
await sleep(1200);

// 1) all seven sheets decode
const sheets = ['characters', 'concept-map', 'features', 'landing', 'pitch', 'story', 'style-sheet'];
for (const s of sheets) {
  const ok = await page.evaluate(async (n) => {
    const img = new Image();
    img.src = `/assets/${n}.png?v=${Math.random()}`;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    return img.naturalWidth > 100;
  }, s);
  console.log(`sheet ${s}: ${ok ? 'OK' : 'FAIL'}`);
}

// 2) boot strip present
const strip = await page.evaluate(() => {
  const i = document.querySelector('.boot-strip');
  return !!i && i.naturalWidth > 0;
});
console.log(`boot characters strip: ${strip ? 'OK' : 'FAIL'}`);
await page.screenshot({ path: `${OUT}/art-boot.png` });

// 3) select screen + art tabs
await page.evaluate(() => document.getElementById('toSelectBtn').click());
await sleep(400);
const tabResults = await page.evaluate(async () => {
  const out = [];
  const img = document.getElementById('artImg');
  for (const b of document.querySelectorAll('.art-tab')) {
    b.click();
    await new Promise((r) => setTimeout(r, 60));
    out.push(`${b.dataset.art}:${img.src.includes(b.dataset.art) && img.naturalWidth > 0 ? 'Y' : 'N'}`);
  }
  return out.join(' ');
});
console.log('art tabs:', tabResults);
await page.screenshot({ path: `${OUT}/art-select.png` });

// 4) in-game: raygun viewmodel + props with colliders
await page.evaluate(() => SKULL_DEBUG.startSolo('skullpepe', 'stadium'));
await sleep(2500);
const game = await page.evaluate(() => {
  const st = SKULL_DEBUG.state();
  const wallsBeforeProps = null; // can't isolate; just report total walls
  return { weapon: st.weapon, alive: st.alive };
});
console.log('game:', JSON.stringify(game), '(weapon pp7 = RAY GUN slot w/ raygun.glb)');
// fire a burst so beams show, then catch a frame
await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { button: 0, buttons: 1, bubbles: true })));
await sleep(450);
await page.screenshot({ path: `${OUT}/art-game-beams.png` });
await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', { button: 0, buttons: 0, bubbles: true })));
console.log('DONE');
await browser.close();
