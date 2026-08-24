/**
 * Focused hit-path probe: pins a bot 8m ahead, fires straight, reports why
 * shots miss. Run: node tools/probe-hit.mjs
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

  for (let round = 0; round < 3; round++) {
    const out = await page.evaluate(() => {
      const me = SKULL_DEBUG.mePos();
      // camera forward = (-sin yaw, -cos yaw) — place the bot 8m ahead
      const fx = me.x - Math.sin(me.yaw) * 8;
      const fz = me.z - Math.cos(me.yaw) * 8;
      SKULL_DEBUG.placeBot(0, fx, fz);
      SKULL_DEBUG.aimAt(fx, fz);
      return { fx, fz, me };
    });
  await page.evaluate(() => SKULL_DEBUG.resetShots());
  const hpBefore = await page.evaluate(() => {
    const m = SKULL_DEBUG.stats();
    return m.bots[0];
  });
  for (let s = 0; s < 3; s++) {
    // re-pin + re-aim every shot, only at ALIVE bots
    const ok = await page.evaluate(() => {
      const st = SKULL_DEBUG.stats();
      const live = st.bots.findIndex((b) => b.alive);
      if (live < 0) return false;
      const me = SKULL_DEBUG.mePos();
      SKULL_DEBUG.placeBot(live, me.x - Math.sin(me.yaw) * 8, me.z - Math.cos(me.yaw) * 8);
      const st2 = SKULL_DEBUG.stats();
      SKULL_DEBUG.aimAt(st2.bots[live].x, st2.bots[live].z);
      return true;
    });
    if (!ok) break;
    await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { button: 0, buttons: 1, bubbles: true })));
    await page.evaluate(() => {
      const me = SKULL_DEBUG.mePos();
      SKULL_DEBUG.placeBot(0, me.x - Math.sin(me.yaw) * 8, me.z - Math.cos(me.yaw) * 8);
    });
    await sleep(60);
    await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', { button: 0, buttons: 0, bubbles: true })));
    await sleep(300);
  }
  const after = await page.evaluate(() => {
    const st = SKULL_DEBUG.stats();
    const s = SKULL_DEBUG.state();
    return { bot: st.bots[0], shots: s.shots, hits: s.hits, meAlive: s.alive };
  });
  console.log(`R${round}: shots=${after.shots} hits=${after.hits} botHP~${after.bot.k}/${after.bot.d} alive=${after.bot.alive} meAlive=${after.meAlive} pos=${JSON.stringify(out.me)}`);
  // move somewhere else for variety next round
  await page.evaluate(() => SKULL_DEBUG.aim((Math.random() - 0.5) * 400, 0));
  await sleep(400);
}
await browser.close();
