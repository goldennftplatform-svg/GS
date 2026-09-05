// LIVE ONLY, menu only. No server, asset overrides, player or spectator joins.
// Usage: node tools/live-music.cjs [approved Render URL]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = new URL(process.argv[2] || 'https://skullbond-gs-4p-2026.onrender.com');
assert.equal(base.origin, 'https://skullbond-gs-4p-2026.onrender.com');
let browser;
async function main() {
  const response = await fetch(new URL('/js/music.js?v=20260904j', base));
  assert(response.ok && (await response.text()).includes('Cipher After Midnight'),
    'Soundtrack not deployed; browser not opened and no joins attempted');
  const executablePath = process.env.BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find(file => fs.existsSync(file));
  assert(executablePath, 'Set BROWSER_PATH to Chrome or Edge');
  browser = await require('puppeteer-core').launch({ executablePath, headless: true,
    args: ['--autoplay-policy=user-gesture-required', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader'] });
  for (const mobile of [false, true]) {
    const session = await browser.createBrowserContext();
    const page = await session.newPage();
    await page.setViewport({ width: mobile ? 390 : 1280, height: mobile ? 844 : 800,
      isMobile: mobile, hasTouch: mobile });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      // Observe real native audio, never replace resume/state with mocks.
      window.__musicProbe = { contexts: [], gains: [], sources: 0, gestures: [], packets: 0 };
      const probe = window.__musicProbe;
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        send() { probe.packets++; throw new Error('Menu verifier blocked all WebSocket sends'); }
      };
      const Native = window.AudioContext || window.webkitAudioContext;
      if (Native) {
        const Observed = class extends Native {
          constructor(...args) {
            super(...args);
            probe.contexts.push(this);
            probe.gestures.push(navigator.userActivation.isActive);
          }
          createGain() { const gain = super.createGain(); probe.gains.push(gain); return gain; }
          createOscillator() { probe.sources++; return super.createOscillator(); }
          createBufferSource() { probe.sources++; return super.createBufferSource(); }
        };
        window.AudioContext = Observed;
        if (window.webkitAudioContext) window.webkitAudioContext = Observed;
      }
    });
    await page.goto(base.href, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForSelector('#musicButton');
    assert.equal(await page.$eval('#musicVolume', el => el.value), '25');
    assert.equal(await page.evaluate(() => __musicProbe.contexts.length), 0,
      'No audio context or sound before gesture');
    const activate = selector => mobile ? page.tap(selector) : page.click(selector);
    await activate('#musicButton');
    await page.waitForFunction(() => __musicProbe.contexts[0]?.state === 'running' && __musicProbe.sources > 0);
    assert.equal(await page.evaluate(() => __musicProbe.gestures[0]), true);
    assert.equal(await page.evaluate(() => __musicProbe.gains[0].gain.value), 0.25);
    assert.equal(await page.evaluate(() => __musicProbe.contexts.length), 1,
      'Music interaction must not initialize SFX');
    await page.focus('#musicVolume');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('skullbond.music.v1')).volume === 2);
    await page.waitForFunction(() => Math.abs(__musicProbe.gains[0].gain.value - 0.02) < 0.001);
    await activate('#musicMute');
    await page.waitForFunction(() => __musicProbe.contexts[0].state === 'suspended');
    assert.equal(await page.$eval('#musicMute', el => el.getAttribute('aria-pressed')), 'true');
    await page.reload({ waitUntil: 'networkidle2' });
    assert.equal(await page.$eval('#musicVolume', el => el.value), '2');
    assert.equal(await page.$eval('#musicMute', el => el.getAttribute('aria-pressed')), 'true');
    assert.equal(await page.evaluate(() => __musicProbe.contexts.length), 0);
    await activate('#musicButton');
    await page.waitForFunction(() => __musicProbe.contexts[0]?.state === 'suspended');
    assert.equal(await page.evaluate(() => __musicProbe.sources), 0, 'Persisted mute schedules no sound');
    await activate('#musicMute');
    await page.waitForFunction(() => __musicProbe.contexts[0].state === 'running' && __musicProbe.sources > 0);
    // Emulate visibility notification; native AudioContext suspension is still verified.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => __musicProbe.contexts[0].state === 'suspended');
    const count = await page.evaluate(() => __musicProbe.sources);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await page.evaluate(() => __musicProbe.sources), count, 'Hidden scheduler must stop');
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => __musicProbe.contexts[0].state === 'running' && __musicProbe.sources > 0);
    // Check shared control layout without joining or changing multiplayer state.
    for (const spectatorLayout of [false, true]) {
      await page.evaluate(value => document.body.classList.toggle('mobile-spectator', value), mobile && spectatorLayout);
      for (const size of mobile ? [[390, 844], [844, 390]] : [[1280, 800]]) {
        await page.setViewport({ width: size[0], height: size[1], isMobile: mobile, hasTouch: mobile });
        assert(await page.evaluate(() => ['musicButton', 'musicVolume', 'musicMute'].every(id => {
          const el = document.getElementById(id), r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return r.height >= 44 && r.width >= 44 && r.x >= 0 && r.y >= 0 &&
            r.right <= innerWidth && r.bottom <= innerHeight && (top === el || el.contains(top));
        })), `Controls visible and reachable: ${size}, spectator layout=${spectatorLayout}`);
      }
    }
    assert.equal(await page.evaluate(() => __musicProbe.packets), 0);
    assert.equal(await page.evaluate(() => document.pointerLockElement), null);
    assert.deepEqual(errors, []);
    console.log(`PASS ${mobile ? 'mobile' : 'desktop'}: native gesture audio, 25% bus, mute/volume persistence, visibility, menu controls; no joins`);
    await session.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(async () => { if (browser) await browser.close(); });
