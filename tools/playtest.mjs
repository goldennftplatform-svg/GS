/**
 * Autonomous playtest — plays 10 full solo matches with randomized agents,
 * maps, and modes, driving real inputs (movement, aim sweeps, fire bursts,
 * ADS, reloads) and recording per-match telemetry for the feedback report.
 * Run: node tools/playtest.mjs   (server on :3000)
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

const AGENTS = ['skullpepe', 'daisy', 'mini', 'boss', 'drone', 'hazard'];
const MAPS = ['stadium', 'lunch', 'starbucks', 'megacorp', 'facility'];
const MATCH_MS = 75000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

let browser = null;
let page = null;
async function launch() {
  if (browser) { try { await browser.close(); } catch {} }
  browser = await puppeteer.launch({
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
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
}
await launch();

const results = [];

// Build 10 match configs: every map twice, modes mixed, agents shuffled
const configs = [];
for (let i = 0; i < 10; i++) {
  configs.push({
    agent: AGENTS[i % AGENTS.length],
    map: MAPS[i % MAPS.length],
    mode: i % 3 === 2 ? 'l2t' : 'dm',
  });
}

for (let m = 0; m < 10; m++) {
  const cfg = configs[m];
  const rec = { ...cfg, shots: 0, hits: 0, kills: 0, deaths: 0, weapons: new Set(), goldGot: false, armorGot: false, hpMin: 999, endReason: 'time', feed: [], tFirstKill: null, tFirstDeath: null, winner: null };
  const t0 = Date.now();
  try {
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!window.SKULL_DEBUG, { timeout: 30000 });
  await page.evaluate((c) => {
    SKULL_DEBUG.setMode(c.mode);
    SKULL_DEBUG.startSolo(c.agent, c.map);
  }, cfg);
  await sleep(1500);

  // hide HUD chrome only for the mid screenshot? keep HUD — it's part of feel. Screenshot as-is.
  let held = new Set();
  let firing = false;
  let ads = false;
  const key = (code, down) =>
    page.evaluate(
      (c, d) =>
        window.dispatchEvent(
          new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c, bubbles: true })
        ),
      code,
      down
    );
  const releaseAll = async () => {
    for (const c of held) await key(c, false);
    held.clear();
    if (firing) { await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', { button: 0, buttons: 0, bubbles: true }))); firing = false; }
    if (ads) { await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', { button: 2, buttons: 0, bubbles: true }))); ads = false; }
  };

  let shot = false;
  while (Date.now() - t0 < MATCH_MS) {
    const el = Date.now() - t0;
    // movement: pick a fresh direction every ~1.2s
    if (Math.random() < 0.14) {
      await releaseAll();
      const dirs = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
      const n = 1 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const c = rnd(dirs);
        if (!held.has(c)) { held.add(c); await key(c, true); }
      }
      if (Math.random() < 0.3) { held.add('ShiftLeft'); await key('ShiftLeft', true); }
    }
    // aim sweep
    const dx = (Math.random() - 0.5) * 260;
    const dy = (Math.random() - 0.5) * 40;
    await page.evaluate((d, d2) => SKULL_DEBUG.aim(d, d2), dx, dy);
    // fire bursts
    if (Math.random() < 0.16) {
      if (firing) {
        await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', { button: 0, buttons: 0, bubbles: true })));
        firing = false;
      } else {
        await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { button: 0, buttons: 1, bubbles: true })));
        firing = true;
      }
    }
    // ADS toggles
    if (Math.random() < 0.04) {
      const type = ads ? 'pointerup' : 'pointerdown';
      const btns = ads ? 0 : 2;
      await page.evaluate(
        (t, b) =>
          document
            .querySelector('canvas')
            .dispatchEvent(new PointerEvent(t, { button: 2, buttons: b, bubbles: true })),
        type,
        btns
      );
      ads = !ads;
    }
    // occasional reload
    if (Math.random() < 0.02) await key('KeyR', true) && await key('KeyR', false);

    // telemetry poll
    const st = await page.evaluate(() => SKULL_DEBUG.stats());
    const s2 = await page.evaluate(() => SKULL_DEBUG.state());
    if (st && st.me) {
      rec.shots = s2.shots;
      rec.hits = s2.hits;
      if (st.me.k > rec.kills) { rec.kills = st.me.k; if (rec.tFirstKill === null) rec.tFirstKill = el; }
      if (st.me.d > rec.deaths) { rec.deaths = st.me.d; if (rec.tFirstDeath === null) rec.tFirstDeath = el; }
      if (st.me.alive) rec.hpMin = Math.min(rec.hpMin, st.me.hp);
      rec.weapons.add(st.me.weapon);
      if (st.me.weapon === 'gold') rec.goldGot = true;
      if (st.me.armor > 0) rec.armorGot = true;
      if (st.feed.length) rec.feed = st.feed;
    }

    // Deterministic aim-assist probe at ~20s: TRACK a bot (re-aim every shot
    // like a human would) with tiny jitter, fire 12 — measures hip-fire feel
    if (el > 20000 && rec.aimedAcc === undefined && st && st.me && st.me.alive) {
      const bot = (st.bots || []).find((b) => b.alive);
      if (bot) {
        await releaseAll();
        await page.evaluate(() => SKULL_DEBUG.resetShots());
        for (let s = 0; s < 12; s++) {
          const cur = await page.evaluate(() => SKULL_DEBUG.stats());
          const live = (cur ? cur.bots : []).find((b) => b.alive) || bot;
          await page.evaluate((x, z) => SKULL_DEBUG.aimAt(x, z), live.x, live.z);
          await page.evaluate(() => SKULL_DEBUG.aim((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 5));
          await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerdown', { button: 0, buttons: 1, bubbles: true })));
          await sleep(90);
          await page.evaluate(() => document.querySelector('canvas').dispatchEvent(new PointerEvent('pointerup', { button: 0, buttons: 0, bubbles: true })));
          await sleep(300);
        }
        const after = await page.evaluate(() => SKULL_DEBUG.state());
        rec.aimedAcc = after.shots > 0 ? Math.round((after.hits / after.shots) * 100) : 0;
        rec.aimedShots = after.shots;
      }
    }
    if (el > 35000 && !shot) {
      shot = true;
      await page.screenshot({ path: path.join(OUT, `match-${m + 1}-${cfg.map}.png`) });
    }
    if (st && st.ended) { rec.endReason = 'l2t-decided'; break; }
    await sleep(220);
  }
  await releaseAll();
  const st = await page.evaluate(() => SKULL_DEBUG.stats());
  if (st && st.ended) {
    const aliveBots = st.bots.filter((b) => b.alive).length;
    rec.winner = st.me && st.me.alive ? 'ME' : aliveBots ? 'BOT' : 'nobody';
  }
  rec.weapons = [...rec.weapons];
  rec.durationS = Math.round((Date.now() - t0) / 1000);
  results.push(rec);
  } catch (err) {
    rec.endReason = 'page-crash';
    results.push(rec);
    console.log(`M${m + 1} ${cfg.agent}/${cfg.map}/${cfg.mode}: PAGE CRASH � ${String(err.message).slice(0, 70)}`);
    await launch();
  }
  if (results[results.length - 1] !== rec || rec.endReason === 'page-crash') continue;
  console.log(
    `M${m + 1} ${cfg.agent}/${cfg.map}/${cfg.mode}: ${rec.kills}K ${rec.deaths}D ` +
    `acc=${rec.shots ? Math.round((rec.hits / rec.shots) * 100) : 0}% ` +
    `aimed=${rec.aimedAcc ?? '-'}%(${rec.aimedShots || 0}) ` +
    `weapons=${rec.weapons.join('+')} gold=${rec.goldGot} end=${rec.endReason}${rec.winner ? '/' + rec.winner : ''}`
  );
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'playtest-results.json'), JSON.stringify(results, null, 2));

// aggregate
const tot = results.reduce(
  (a, r) => {
    a.k += r.kills; a.d += r.deaths; a.shots += r.shots; a.hits += r.hits;
    a.gold += r.goldGot ? 1 : 0; a.armor += r.armorGot ? 1 : 0;
    a.padFights += r.weapons.length > 1 ? 1 : 0;
    if (r.tFirstKill !== null) { a.tfk.push(r.tFirstKill); }
    if (r.tFirstDeath !== null) { a.tfd.push(r.tFirstDeath); }
    return a;
  },
  { k: 0, d: 0, shots: 0, hits: 0, gold: 0, armor: 0, padFights: 0, tfk: [], tfd: [] }
);
const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : -1);
console.log('\n==== AGGREGATE ====');
console.log(`K/D: ${tot.k}/${tot.d} | accuracy: ${tot.shots ? Math.round((tot.hits / tot.shots) * 100) : 0}% (${tot.hits}/${tot.shots})`);
console.log(`gold grabs: ${tot.gold}/10 | armor grabs: ${tot.armor}/10 | matches touching pads: ${tot.padFights}/10`);
console.log(`avg time-to-first-kill: ${avg(tot.tfk)}ms | avg time-to-first-death: ${avg(tot.tfd)}ms`);
console.log('DONE');
