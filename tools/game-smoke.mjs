/**
 * Headless gameplay smoke test — drives the REAL game in Edge/Chrome.
 * Verifies: semi-autos fire once per click, autos stop on release,
 * and the stuck-trigger killswitches work when pointer lock drops.
 * Run: npm run test:game   (server must be running on :3000)
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const exe = BROWSERS.find((p) => fs.existsSync(p));
if (!exe) {
  console.error('FAIL: no Edge/Chrome found');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
  if (!cond) failures++;
}

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
await page.evaluate(() => { SKULL_DEBUG.skipCountdown(true); SKULL_DEBUG.startSolo('skullpepe', 'stadium'); });
await sleep(1200);
let st = await page.evaluate(() => SKULL_DEBUG.state());
check('solo match started', st.offline && st.alive);

const down = () =>
  page.evaluate(() =>
    document
      .querySelector('canvas')
      .dispatchEvent(
        new PointerEvent('pointerdown', { button: 0, buttons: 1, bubbles: true })
      )
    );
const up = () =>
  page.evaluate(() =>
    document
      .querySelector('canvas')
      .dispatchEvent(
        new PointerEvent('pointerup', { button: 0, buttons: 0, bubbles: true })
      )
    );
const adsDown = () =>
  page.evaluate(() =>
    document
      .querySelector('canvas')
      .dispatchEvent(
        new PointerEvent('pointerdown', { button: 2, buttons: 2, bubbles: true })
      )
    );
const adsUp = () =>
  page.evaluate(() =>
    document
      .querySelector('canvas')
      .dispatchEvent(
        new PointerEvent('pointerup', { button: 2, buttons: 0, bubbles: true })
      )
    );

// ---- T1: semi-auto fires exactly once per click ----
await page.evaluate(() => SKULL_DEBUG.give('dd'));
await page.evaluate(() => SKULL_DEBUG.resetShots());
await down();
await up();
await sleep(800); // longer than DD cd (560ms)
st = await page.evaluate(() => SKULL_DEBUG.state());
check('DD Skull: one click = one shot', st.shots === 1, `shots=${st.shots}`);

// ---- T2: holding LMB on a semi does NOT machine-gun ----
await page.evaluate(() => SKULL_DEBUG.resetShots());
await down(); // no up
await sleep(1300);
st = await page.evaluate(() => SKULL_DEBUG.state());
check('DD Skull: held trigger stays single-shot', st.shots === 1, `shots=${st.shots}`);
await up();

// ---- T3: full-auto stops the moment the trigger is released ----
await page.evaluate(() => SKULL_DEBUG.give('kf7'));
await page.evaluate(() => SKULL_DEBUG.resetShots());
await down();
await sleep(500);
st = await page.evaluate(() => SKULL_DEBUG.state());
check('KF7: auto fire produces shots while held', st.shots >= 2, `shots=${st.shots}`);
await up();
// Baseline only after the release has actually propagated — with fast
// cadences a CDP roundtrip can outrun one fire interval.
await page.waitForFunction(() => !window.SKULL_DEBUG.state().shootHeld, { timeout: 2000 });
const frozen0 = await page.evaluate(() => SKULL_DEBUG.state());
await sleep(400);
const frozen = await page.evaluate(() => SKULL_DEBUG.state());
check('KF7: release stops firing', frozen.shots === frozen0.shots, `${frozen0.shots} -> ${frozen.shots}`);

// ---- T4: swallowed pointerup / lost lock cannot stick the trigger ----
await down();
await sleep(200);
await page.evaluate(() => SKULL_DEBUG.simulateUnlock()); // ESC-style lock loss
await sleep(150);
st = await page.evaluate(() => SKULL_DEBUG.state());
check('lock drop clears trigger', st.shootHeld === false, `shootHeld=${st.shootHeld}`);
await sleep(600);
const after = await page.evaluate(() => SKULL_DEBUG.state());
check('no ghost shots after unlock', after.shots === st.shots, `${st.shots} -> ${after.shots}`);

// ---- T5: ADS zoom actually engages ----
await page.evaluate(() => SKULL_DEBUG.forceLock(true));
await adsDown();
await sleep(700);
st = await page.evaluate(() => SKULL_DEBUG.state());
check('RMB ADS zooms FOV', st.fov < 70 && st.ads === true, `fov=${st.fov.toFixed(1)} ads=${st.ads} locked=${st.locked}`);
await adsUp();

await browser.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL GREEN');
process.exit(failures ? 1 : 0);
