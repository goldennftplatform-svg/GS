// LIVE ONLY. User deploys first, then opts in with LIVE_VERIFY=1 and LIVE_REVISION.
// Never starts a server or modifies authoritative state through debug hooks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const WebSocket = require('ws');
const base = 'https://skullbond-gs-4p-2026.onrender.com';
const stamp = '20260904-head-ads-2';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const names = [`V${Date.now().toString(36)}A`, `V${Date.now().toString(36)}B`].map(n => n.toUpperCase());
const browsers = [];
const pages = [];
let watcher, state, foreign = false;
let releaseCore;
const shots = [];
async function json(path) {
  const res = await fetch(base + path, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  assert(res.ok);
  return res.json();
}
async function wait(test, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    assert(!foreign, 'Non-test player detected; aborting');
    const result = await test();
    if (result) return result;
    await sleep(50);
  }
  throw new Error('Timed out waiting for live evidence');
}
async function main() {
  assert.equal(process.env.LIVE_VERIFY, '1', 'Blocked: deploy first, then explicitly set LIVE_VERIFY=1');
  assert(process.env.LIVE_REVISION, 'Set LIVE_REVISION to the full deployed commit');
  const version = await json('/version');
  assert.equal(version.revision, process.env.LIVE_REVISION, 'Wrong deployment; no gameplay connections attempted');
  assert.equal(version.hitboxVersion, stamp, 'Changes not deployed; no gameplay connections attempted');
  assert.equal((await json('/health')).players, 0, 'Occupied room; refusing to join');
  watcher = new WebSocket(base.replace('https:', 'wss:') + '/ws');
  watcher.on('error', error => { console.error(error); foreign = true; });
  watcher.on('message', raw => {
    const msg = JSON.parse(String(raw));
    if (msg.type === 'state') state = msg;
    if (msg.type === 'shot') shots.push(msg);
    if ((msg.type === 'state' && msg.players.some(p => !names.includes(p.name))) ||
        (msg.type === 'join' && !names.includes(msg.player.name))) {
      foreign = true;
      // Close player browsers immediately, not just at the next assertion.
      for (const browser of browsers) void browser.close();
    }
  });
  await wait(() => watcher.readyState === 1);
  watcher.send(JSON.stringify({ type: 'join', role: 'spectator' }));
  await wait(() => state);
  assert.equal(state.players.length, 0);
  const puppeteer = require('puppeteer-core');
  const executablePath = process.env.BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find(p => fs.existsSync(p));
  assert(executablePath, 'Set BROWSER_PATH');
  const errors = [];
  async function leave(page) {
    await page.keyboard.press('Escape');
    await page.click('#menuBtn');
    await wait(() => state.players.length === 1);
  }
  for (let i = 0; i < 2; i++) {
    const browser = await puppeteer.launch({ executablePath, headless: true,
      args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-background-timer-throttling'] });
    browsers.push(browser);
    const page = await browser.newPage();
    pages.push(page);
    await page.setViewport({ width: 1000, height: 700 });
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument((agent, name) => {
      localStorage.setItem('skullbond-agent', agent);
      localStorage.setItem('skullbond-map', 'stadium');
      localStorage.setItem('skullbond-name', name);
    }, i ? 'boss' : 'hazard', names[i]);
    if (i === 1) {
      await page.setRequestInterception(true);
      page.on('request', request => {
        // Exercise joining with a delayed core and a failed unrelated prop.
        if (request.url().endsWith('/skullpepe.glb')) releaseCore = () => request.continue();
        else if (request.url().endsWith('/oneup_heart.glb')) void request.abort();
        else void request.continue();
      });
    }
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => !!window.SKULL_DEBUG);
    assert.equal(await page.evaluate(() => SKULL_DEBUG.state().hitboxVersion), stamp);
    assert.equal((await json('/health')).players, i);
    await page.click('#toSelectBtn');
    await page.click('#joinBtn');
    await wait(() => state.players.length === i + 1);
    await wait(() => page.evaluate(() => SKULL_DEBUG.state().inMatch));
  }
  async function reciprocal(label) {
    await wait(() => state.players.length === 2);
    for (let i = 0; i < 2; i++) {
      const target = state.players.find(p => p.name === names[1 - i]);
      await pages[i].evaluate(p => SKULL_DEBUG.lookAtWorld(p.x, p.y - 0.5, p.z), target);
      const evidence = await wait(async () => {
        const value = await pages[i].evaluate(id => ({ state: SKULL_DEBUG.state(), pixels: SKULL_DEBUG.visibility(id) }), target.id);
        return value.pixels.changedPixels > 0 && value.state.remoteAgents.some(a => a.id === target.id && a.attached && a.visible) && value;
      });
      console.log(label, names[i], JSON.stringify(evidence));
    }
  }
  await reciprocal('FRESH JOIN');
  assert(await pages[1].evaluate(() => SKULL_DEBUG.state().remoteAgents.some(r => r.agentId === 'hazard' && r.fallback)),
    'Delayed core must still render Hazard as a fallback');
  await wait(() => releaseCore);
  await releaseCore();
  await wait(() => pages[1].evaluate(() => SKULL_DEBUG.state().loadedModels.includes('agent')), 30000);
  await reciprocal('CORE LOADED, OPTIONAL PROP FAILED');
  for (const page of pages) {
    const remotes = await page.evaluate(() => SKULL_DEBUG.state().remoteAgents);
    assert(remotes.every(r => !r.fallback), 'Core must upgrade without waiting for failed optional props');
  }
  await leave(pages[1]);
  assert.equal((await json('/health')).players, 1);
  await pages[1].click('#joinBtn');
  await wait(() => state.players.length === 2);
  await reciprocal('COURIER REJOIN');
  await leave(pages[0]);
  assert.equal((await json('/health')).players, 1);
  await pages[0].click('#joinBtn');
  await wait(() => state.players.length === 2);
  await reciprocal('HAZARD REJOIN');

  const source = await fetch(base + '/js/body-geometry.mjs').then(r => { assert(r.ok); return r.text(); });
  const geometry = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const { verifyBodyRegions } = await import('./test-body-regions.mjs');
  verifyBodyRegions(geometry);
  const { getBodyBox, getHeadBox, EYE_HEIGHT, shotDamage } = geometry;
  // Rejoin the target for each shot: fresh HP, no armor/pickups/teleports required.
  for (const agent of ['hazard', 'boss', 'mini', 'skullpepe', 'daisy', 'drone']) {
    for (const region of ['body', 'head']) {
      await leave(pages[1]);
      // Use the actual selection UI, not a mutation of network player state.
      await pages[1].evaluate(async agentId => {
        const { getAgent } = await import('/js/roster.js?v=20260904f');
        const button = [...document.querySelectorAll('#agentGrid .agent-card')]
          .find(el => el.querySelector('.name')?.textContent === getAgent(agentId).name);
        if (!button) throw new Error(`Missing agent selector: ${agentId}`);
        button.click();
      }, agent);
      assert(!foreign);
      assert.equal((await json('/health')).players, 1);
      await pages[1].click('#joinBtn');
      await wait(() => state.players.some(p => p.name === names[1] && p.agentId === agent));
      await sleep(1800);
      assert(!foreign);
      const target = state.players.find(p => p.name === names[1]);
      const shooter = state.players.find(p => p.name === names[0]);
      const body = getBodyBox(agent), head = getHeadBox(agent);
      const height = region === 'head' ? (head.min[1] + head.max[1]) / 2 : (body.min[1] + head.min[1]) / 2;
      // Face the shooter: badge's narrow skull must be tested from its front,
      // not through a disk edge which correctly counts as body first.
      await pages[1].evaluate(p => SKULL_DEBUG.lookAtWorld(p.x, p.y, p.z), shooter);
      await sleep(150);
      await pages[0].evaluate(p => {
        SKULL_DEBUG.simulateLock();
        SKULL_DEBUG.lookAtWorld(p.x, p.y, p.z);
        document.querySelector('#game').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2 }));
      }, { x: target.x, y: target.y - EYE_HEIGHT + height, z: target.z });
      await wait(() => pages[0].evaluate(() => SKULL_DEBUG.state().fov < 49));
      const start = shots.length;
      assert(!foreign);
      await pages[0].keyboard.down('f');
      await pages[0].keyboard.up('f');
      const shot = await wait(() => shots.slice(start).find(s => s.from === shooter.id));
      assert.equal(shot.hit, target.id);
      assert.equal(shot.region, region);
      const expected = shotDamage({ dmg: 40 }, region);
      await wait(() => state.players.find(p => p.id === target.id)?.hp === target.hp - expected);
      const tracer = await wait(() => pages[0].evaluate(() => {
        const t = SKULL_DEBUG.state().lastTracer;
        return t?.rendered && t;
      }));
      assert(tracer.fov < 49);
      assert(Math.hypot(...tracer.start.map((v, i) => v - [shot.origin.x, shot.origin.y, shot.origin.z][i])) > 0.1, 'Tracer must start at gun, not eye');
      assert(Math.hypot(...tracer.impact.map((v, i) => v - [shot.impact.x, shot.impact.y, shot.impact.z][i])) < 1e-6);
      assert(tracer.startNdc[2] > -1 && tracer.startNdc[2] < 1);
      assert(Math.abs(tracer.startNdc[0]) < 1 && Math.abs(tracer.startNdc[1]) < 1, 'ADS muzzle must be on screen');
      assert(Math.hypot(tracer.startNdc[0] - tracer.endNdc[0], tracer.startNdc[1] - tracer.endNdc[1]) > 0.005, 'Rendered beam must not collapse into center dot');
      console.log('AUTHORITATIVE ADS', JSON.stringify({ agent, region, before: target.hp, damage: expected, shot, tracer }));
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: reciprocal rendered body pixels, async loading/rejoin, six-agent authoritative damage, ADS submitted geometry');
}
main().catch(error => { console.error('BLOCKED/FAIL', error); process.exitCode = 1; }).finally(async () => {
  await Promise.all(browsers.map(browser => browser.close().catch(() => {})));
  watcher?.close();
});
