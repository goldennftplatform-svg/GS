/**
 * Plays every map like a suspicious human: checks spawn/pad/prop collider
 * overlaps, does point-blank damage tests, fires bursts and pixel-scans the
 * frames for beams and impact sparks. Run: node tools/play-diag.mjs
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
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction(() => !!window.SKULL_DEBUG, { timeout: 30000 });

const MAPS = ['stadium', 'lunch', 'starbucks', 'megacorp', 'facility'];

for (const map of MAPS) {
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => !!window.SKULL_DEBUG);
  await sleep(800);
  await page.evaluate((m) => SKULL_DEBUG.startSolo('skullpepe', m), map);
  await sleep(2200);

  // 1) overlap audit — spawns / pads / gold vs prop+static colliders
  const audit = await page.evaluate(() => {
    const s = SKULL_DEBUG.debugSpots();
    const bad = [];
    for (const sp of s.spawns) {
      const b = SKULL_DEBUG.debugBlocked(sp.x, sp.z, 0.9); // tight pad: must be FREE at spawn
      if (b.length) bad.push({ type: 'SPAWN', x: sp.x, z: sp.z, boxes: b.length });
    }
    for (const p of [...s.pads, s.gold].filter(Boolean)) {
      const b = SKULL_DEBUG.debugBlocked(p.x, p.z, 1.4); // pad needs stand room
      if (b.length) bad.push({ type: 'PAD', x: p.x, z: p.z, boxes: b.length });
    }
    return { walls: s.walls, bad };
  });
  console.log(`[${map}] walls=${audit.walls} overlaps=${JSON.stringify(audit.bad)}`);

  // 2) point-blank damage test — park a bot 6u ahead of me, fire 6
  const dmg = await page.evaluate(async () => {
    const me = SKULL_DEBUG.mePos();
    // face +X for simplicity; park a FROZEN bot 6u ahead
    SKULL_DEBUG.freezeBots(true);
    SKULL_DEBUG.placeBot(0, me.x + 6, me.z);
    await new Promise((r) => setTimeout(r, 400));
    const info = SKULL_DEBUG.debugShotInfo(me.x + 6, me.z);
    const before = SKULL_DEBUG.stats().bots[0];
    SKULL_DEBUG.resetShots();
    for (let i = 0; i < 6; i++) {
      SKULL_DEBUG.aimAt(me.x + 6, me.z);
      document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { button: 0, buttons: 1, bubbles: true }));
      await new Promise((r) => setTimeout(r, 110));
      document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', { button: 0, buttons: 0, bubbles: true }));
      await new Promise((r) => setTimeout(r, 240));
    }
    const after = SKULL_DEBUG.stats().bots[0];
    const st = SKULL_DEBUG.state();
    SKULL_DEBUG.freezeBots(false);
    return {
      info,
      shots: st.shots,
      hits: st.hits,
      hpBefore: before.hp,
      hpAfter: after.hp,
      botAlive: after.alive,
    };
  });
  console.log(`[${map}] shot-info: ${JSON.stringify(dmg.info)}`);
  console.log(`[${map}] dmg-test: ${JSON.stringify({ ...dmg, info: undefined })} ${dmg.hits > 0 && dmg.hpAfter < dmg.hpBefore ? 'DAMAGE-OK' : '** NO DAMAGE **'}`);
}

// 3) burst-frame pixel scan on stadium — are beams/sparks actually rendered?
await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
await page.waitForFunction(() => !!window.SKULL_DEBUG);
await sleep(800);
await page.evaluate(() => SKULL_DEBUG.startSolo('skullpepe', 'stadium'));
await sleep(2200);
for (let burst = 0; burst < 3; burst++) {
  await page.evaluate(() => {
    window.__burstUntil = Date.now() + 500;
    const tick = () => {
      if (Date.now() > window.__burstUntil) return;
      document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { button: 0, buttons: 1, bubbles: true }));
      setTimeout(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', { button: 0, buttons: 0, bubbles: true })), 90);
      setTimeout(tick, 200);
    };
    tick();
  });
  await sleep(250);
  await page.screenshot({ path: `${OUT}/diag-burst-${burst}.png` });
  await sleep(300);
}
// pixel-scan via canvas in-page on the LAST screenshot file is awkward — scan live instead:
const pix = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 180;
  return new Promise((res) => {
    // grab one more burst and read the framebuffer mid-beam
    const cv = document.querySelector('canvas');
    document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { button: 0, buttons: 1, bubbles: true }));
    setTimeout(() => {
      const g = c.getContext('2d');
      g.drawImage(cv, 0, 0, 320, 180);
      document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', { button: 0, buttons: 0, bubbles: true }));
      const d = g.getImageData(0, 0, 320, 180).data;
      let green = 0, red = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], gg = d[i + 1], b = d[i + 2];
        if (gg > 150 && gg > r * 1.3 && gg > b * 1.3) green++;
        if (r > 170 && r > gg * 1.6 && r > b * 1.6) red++;
      }
      res({ greenPx: green, redPx: red });
    }, 60);
  });
});
console.log(`beam/spark pixel scan: ${JSON.stringify(pix)} ${pix.greenPx + pix.redPx > 20 ? 'VFX-VISIBLE' : '** VFX MISSING **'}`);

console.log('page errors:', errors.length ? errors.join(' | ') : 'none');
console.log('DONE');
await browser.close();
