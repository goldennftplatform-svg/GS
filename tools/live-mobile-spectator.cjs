// LIVE ONLY: no server, no player joins, no debug mutations of gameplay.
// Usage: node tools/live-mobile-spectator.cjs [approved Render URL]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = new URL(process.argv[2] || 'https://skullbond-gs-4p-2026.onrender.com');
assert.equal(base.origin, 'https://skullbond-gs-4p-2026.onrender.com');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
async function main() {
  const source = await fetch(new URL('/js/mobile-spectator.js?v=20260904h', base));
  assert(source.ok && (await source.text()).includes('createMobileSpectator'),
    'Mobile spectator build not deployed; no socket connections attempted');
  const executablePath = process.env.BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find(file => fs.existsSync(file));
  assert(executablePath, 'Set BROWSER_PATH to Chrome or Edge');
  browser = await require('puppeteer-core').launch({ executablePath, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    window.__sent = [];
    window.__permissions = 0;
    window.__permission = 'denied';
    const Native = WebSocket;
    window.WebSocket = class extends Native {
      send(data) {
        const message = JSON.parse(data);
        // Fail closed before transmission, including accidental player joins.
        if (message.type !== 'join' || message.role !== 'spectator') {
          throw new Error(`Verifier blocked non-spectator packet: ${message.type}`);
        }
        window.__sent.push(message);
        super.send(data);
      }
    };
    if (window.DeviceOrientationEvent) {
      window.DeviceOrientationEvent.requestPermission = async () => {
        window.__permissions++;
        if (window.__permission === 'throw') throw new Error('Permission unavailable');
        return window.__permission;
      };
    }
  });
  await page.goto(base.href, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => !!window.SKULL_DEBUG);
  await page.click('#bootSpectateBtn');
  await page.waitForFunction(() => SKULL_DEBUG.state().spectator && !document.getElementById('mobileSpectator').hidden);
  const state = () => page.evaluate(() => SKULL_DEBUG.state());
  const initial = await state();
  assert.equal(initial.myId, null);
  assert.equal(initial.locked, false);
  assert.equal(await page.evaluate(() => window.__permissions), 0);
  const cdp = await page.createCDPSession();
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([id, x, y]) => ({ id, x, y, radiusX: 2, radiusY: 2 })) });
  await touch('touchStart', [[1, 180, 380]]);
  await touch('touchMove', [[1, 230, 410]]);
  await touch('touchEnd', []);
  assert.notEqual((await state()).camera.yaw, initial.camera.yaw);
  await touch('touchStart', [[1, 140, 380], [2, 240, 380]]);
  await touch('touchMove', [[1, 60, 380], [2, 320, 380]]);
  await touch('touchEnd', []);
  await sleep(150);
  const zoomed = (await state()).fov;
  assert(zoomed >= 35 && zoomed < 74);
  await sleep(350);
  assert.equal((await state()).fov, zoomed, 'Tick must preserve pinch FOV');
  await touch('touchStart', [[1, 60, 380], [2, 320, 380]]);
  await touch('touchMove', [[1, 185, 380], [2, 195, 380]]);
  await touch('touchEnd', []);
  await sleep(100);
  assert.equal((await state()).fov, 95);
  await page.tap('#zoomBtn');
  await sleep(100);
  assert.equal((await state()).fov, 74);
  for (const direction of ['forward', 'back', 'up', 'down']) {
    const point = await page.$eval(`[data-fly="${direction}"]`, button => {
      const r = button.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    });
    const before = (await state()).camera;
    await touch('touchStart', [[1, ...point]]);
    await sleep(250);
    await touch('touchCancel', []);
    const after = (await state()).camera;
    assert(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) > 0.5, direction);
    await sleep(150);
    assert.deepEqual((await state()).camera, after, 'Release/cancel must stop flight');
  }
  await page.tap('#motionBtn');
  await page.waitForFunction(() => /denied/.test(document.getElementById('motionStatus').textContent));
  await page.evaluate(() => { window.__permission = 'throw'; });
  await page.tap('#motionBtn');
  await page.waitForFunction(() => /unavailable/.test(document.getElementById('motionStatus').textContent));
  await page.evaluate(() => { window.__permission = 'granted'; });
  await page.tap('#motionBtn');
  await page.waitForFunction(() => /No sensor data/.test(document.getElementById('motionStatus').textContent), { timeout: 7000 });
  await page.tap('#motionBtn');
  // Emulated orientation samples exercise the same listener as a physical sensor.
  const sensor = (alpha, beta = 70, gamma = 0) => page.evaluate(([alpha, beta, gamma]) => {
    window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha, beta, gamma }));
  }, [alpha, beta, gamma]);
  const beforeMotion = (await state()).camera;
  await sensor(110);
  assert.deepEqual((await state()).camera, beforeMotion, 'Enable must not jump');
  await sensor(125, 80);
  assert.notEqual((await state()).camera.yaw, beforeMotion.yaw);
  assert(Math.abs((await state()).camera.pitch) <= 1.4);
  await page.tap('#recenterBtn');
  const centered = (await state()).camera;
  await sensor(200, 30);
  assert.deepEqual((await state()).camera, centered, 'Recenter must not jump');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 844, height: 390, deviceScaleFactor: 1, mobile: true,
    screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await sleep(100);
  const rotated = (await state()).camera;
  await sensor(210, 40, 20);
  assert.deepEqual((await state()).camera, rotated, 'Screen rotation must rebase');
  for (const size of [[844, 390], [390, 844]]) {
    await page.setViewport({ width: size[0], height: size[1], isMobile: true, hasTouch: true });
    assert(await page.evaluate(() => [...document.querySelectorAll('#mobileSpectator button, #menuBtn')].every(button => {
      const r = button.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.width >= 44 && r.height >= 44 && r.x >= 0 && r.y >= 0 && r.right <= innerWidth &&
        r.bottom <= innerHeight && (top === button || button.contains(top));
    })), `Controls must fit and be unobscured: ${size}`);
  }
  // Visibility is emulated, not a claim of physical OS background testing.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
  });
  const hidden = (await state()).camera;
  await sensor(300);
  assert.deepEqual((await state()).camera, hidden);
  assert.equal(await page.$eval('#motionBtn', button => button.getAttribute('aria-pressed')), 'false');
  assert.equal((await state()).shots, initial.shots);
  assert.equal((await state()).locked, false);
  await page.tap('#motionBtn');
  await sensor(100);
  await page.tap('#menuBtn');
  await page.waitForFunction(() => !SKULL_DEBUG.state().inMatch && SKULL_DEBUG.state().socketState === null);
  const exited = (await state()).camera;
  await sensor(170);
  assert.deepEqual((await state()).camera, exited, 'Exit must remove motion listener');
  assert(await page.$eval('#mobileSpectator', panel => panel.hidden));
  assert(await page.$eval('#game', canvas => getComputedStyle(canvas).touchAction !== 'none'));
  await page.click('#spectateBtn');
  await page.waitForFunction(() => SKULL_DEBUG.state().spectator);
  assert.equal((await state()).myId, null);
  assert.equal(await page.$eval('#motionBtn', button => button.getAttribute('aria-pressed')), 'false');
  await page.tap('#menuBtn');
  assert.deepEqual(errors, []);
  console.log('PASS live spectator-only touch, flight, zoom, permission fallback, relative sensor, rotation, layout, cleanup/rejoin');
  console.log('LIMITATION: browser-emulated touch/sensor/visibility, not physical iOS gyro or native permission UI');
}
main().catch(error => { console.error('FAIL', error); process.exitCode = 1; })
  .finally(async () => { await browser?.close(); });
