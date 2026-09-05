// LIVE ONLY. Never starts a server. Refuses occupied rooms and old deployments.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const WebSocket = require('ws');
const base = new URL(process.argv[2] || 'https://skullbond-gs-4p-2026.onrender.com');
assert.equal(base.origin, 'https://skullbond-gs-4p-2026.onrender.com', 'Only the approved live origin is allowed');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];
const prefix = `SPEC${Date.now().toString(36).toUpperCase()}`;
const names = new Set([...Array(6)].map((_, i) => `${prefix}${i}`));
let foreignPlayer = false;
let browser;
async function json(path) {
  const res = await fetch(new URL(path, base), { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  assert(res.ok, `${path}: ${res.status}`);
  return res.json();
}
async function waitFor(test) {
  for (let i = 0; i < 200; i++) {
    assert(!foreignPlayer, 'A non-test player joined; verification aborted');
    const result = await test();
    if (result) return result;
    await sleep(50);
  }
  throw new Error('Timed out waiting for live evidence');
}
async function join(role, index = 0) {
  const c = { events: [], states: 0 };
  clients.push(c);
  c.ws = new WebSocket(new URL('/ws', base).href.replace('https:', 'wss:'));
  c.ws.on('error', error => { c.error = error; });
  c.ws.on('message', raw => {
    const msg = JSON.parse(String(raw));
    c.events.push(msg);
    if (msg.type === 'welcome') c.welcome = msg;
    if (msg.type === 'state') { c.state = msg; c.states++; }
    if ((msg.type === 'state' && msg.players.some(p => !names.has(p.name))) ||
        (msg.type === 'join' && !names.has(msg.player.name))) {
      foreignPlayer = true;
      for (const client of clients) client.ws.close();
      void browser?.close();
    }
  });
  await waitFor(() => { if (c.error) throw c.error; return c.ws.readyState === WebSocket.OPEN; });
  c.ws.send(JSON.stringify({ type: 'join', role, name: `${prefix}${index}`, mapId: 'stadium' }));
  await waitFor(() => c.welcome || c.events.find(e => e.type === 'error'));
  if (c.welcome) await waitFor(() => c.state);
  return c;
}
async function close(c) {
  c.ws.close();
  await waitFor(() => c.ws.readyState === WebSocket.CLOSED);
}
async function main() {
  const version = await json('/version');
  console.log('LIVE VERSION', version);
  assert.equal(version.spectatorVersion, 1, 'Spectator changes are not deployed; no gameplay connections attempted');
  assert.equal((await json('/health')).players, 0, 'Live room occupied; refusing to test');
  const watcher = await join('spectator');
  assert.equal(watcher.welcome.role, 'spectator');
  assert.equal(watcher.welcome.id, null);
  assert.equal(watcher.state.started, false);
  assert.equal(watcher.state.players.length, 0);
  const initialMap = watcher.state.mapId;
  const count = watcher.states;
  for (const type of ['input', 'reload', 'use', 'join']) {
    watcher.ws.send(JSON.stringify({ type, role: 'player', name: `${prefix}0`, mapId: 'lunch',
      f: true, sprint: true, shoot: true, click: true, yaw: 0, pitch: 0 }));
  }
  await waitFor(() => watcher.states > count + 10);
  assert.equal(watcher.state.started, false);
  assert.equal(watcher.state.mapId, initialMap);
  assert.equal(watcher.state.players.length, 0);
  assert(!watcher.events.some(e => ['shot', 'pickup', 'mapEvent', 'match'].includes(e.type)));
  console.log('PASS empty watcher: snapshots, no slot, no match, all gameplay inputs ignored');

  const agents = [];
  for (let i = 0; i < 4; i++) agents.push(await join('player', i));
  await waitFor(() => watcher.state.players.length === 4 && watcher.state.mapId === 'stadium');
  assert.equal(watcher.state.started, true);
  const fullWatcher = await join('spectator');
  assert.equal(fullWatcher.welcome.role, 'spectator');
  assert.equal(fullWatcher.state.players.length, 4);
  const rejected = await join('player', 4);
  assert(!rejected.welcome);
  assert(rejected.events.some(e => e.type === 'error'));
  const shotCount = watcher.events.filter(e => e.type === 'shot').length;
  agents[0].ws.send(JSON.stringify({ type: 'input', yaw: 0, pitch: 1.3, click: true }));
  await waitFor(() => watcher.events.filter(e => e.type === 'shot').length > shotCount);
  assert(watcher.events.filter(e => e.type === 'shot').every(e => e.from === agents[0].welcome.id));
  const before = watcher.state.timeLeft;
  await close(fullWatcher);
  await sleep(300);
  assert.equal(watcher.state.players.length, 4);
  assert(watcher.state.timeLeft <= before && watcher.state.started);
  console.log('PASS full room: four agents plus watchers, fifth player rejected, shots delivered, watcher exit preserves match');
  for (const c of agents) await close(c);
  await waitFor(() => watcher.state.players.length === 0 && !watcher.state.started && watcher.state.mapId === 'facility');
  console.log('PASS watcher remains connected through last-player disconnect and map reset');

  const executablePath = process.env.BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find(file => fs.existsSync(file));
  assert(executablePath, 'Protocol passed; browser unavailable. Set BROWSER_PATH to verify menu rejoin');
  const puppeteer = require('puppeteer-core');
  browser = await puppeteer.launch({ executablePath, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    const Native = window.WebSocket;
    window.__sent = [];
    window.WebSocket = class extends Native {
      send(data) { window.__sent.push(JSON.parse(data)); super.send(data); }
    };
  });
  await page.goto(base.href, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => !!window.SKULL_DEBUG);
  await page.type('#nameInput', `${prefix}5`);
  await page.click('#toSelectBtn');
  await page.click('#spectateBtn');
  await page.waitForFunction(() => SKULL_DEBUG.state().spectator);
  // Real canvas gesture, not synthetic pointer-lock/debug hooks.
  await page.click('#game', { offset: { x: 30, y: 250 } });
  await page.waitForFunction(() => SKULL_DEBUG.state().locked);
  const initial = await page.evaluate(() => SKULL_DEBUG.state());
  await page.keyboard.down('w');
  await sleep(400);
  await page.keyboard.up('w');
  const forward = await page.evaluate(() => SKULL_DEBUG.state().camera);
  assert(Math.hypot(forward.x - initial.camera.x, forward.z - initial.camera.z) > 0.5);
  await page.keyboard.down('Space');
  await sleep(300);
  await page.keyboard.up('Space');
  const raised = await page.evaluate(() => SKULL_DEBUG.state().camera);
  assert(raised.y > forward.y + 0.5, 'Space must ascend');
  await page.keyboard.down('Control');
  await sleep(300);
  await page.keyboard.up('Control');
  const lowered = await page.evaluate(() => SKULL_DEBUG.state().camera);
  assert(lowered.y < raised.y - 0.5, 'Ctrl must descend');
  await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  await sleep(400);
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');
  const fast = await page.evaluate(() => SKULL_DEBUG.state().camera);
  assert(Math.hypot(fast.x - lowered.x, fast.z - lowered.z) >
    Math.hypot(forward.x - initial.camera.x, forward.z - initial.camera.z) * 1.5, 'Shift must accelerate flight');
  await page.mouse.move(100, 300);
  await sleep(100);
  const looked = await page.evaluate(() => SKULL_DEBUG.state().camera);
  assert(looked.yaw !== fast.yaw || looked.pitch !== fast.pitch, 'Mouse must change view direction');
  await page.keyboard.press('r');
  await page.keyboard.press('g');
  await page.keyboard.press('e');
  const flown = await page.evaluate(() => ({ state: SKULL_DEBUG.state(), sent: window.__sent }));
  assert.notDeepEqual(flown.state.camera, initial.camera);
  assert.equal(flown.state.shots, initial.shots);
  assert(!flown.sent.some(m => ['input', 'reload', 'use'].includes(m.type)));
  await page.keyboard.press('Escape');
  await page.click('#menuBtn');
  await page.waitForFunction(() => !SKULL_DEBUG.state().inMatch && SKULL_DEBUG.state().socketState === null);
  await page.click('#joinBtn');
  await page.waitForFunction(() => SKULL_DEBUG.state().inMatch && !SKULL_DEBUG.state().spectator);
  await waitFor(() => watcher.state.players.length === 1);
  await page.keyboard.press('Escape');
  await page.click('#menuBtn');
  await waitFor(() => watcher.state.players.length === 0);
  await page.click('#spectateBtn');
  await page.waitForFunction(() => SKULL_DEBUG.state().spectator);
  await page.keyboard.press('Escape');
  await page.click('#menuBtn');
  await page.click('#joinBtn');
  await page.click('#menuBtn'); // Cancel an uplink or its welcome without leaving an orphan.
  await sleep(3500); // Old retry callbacks must not reconnect from the menu.
  const menu = await page.evaluate(() => SKULL_DEBUG.state());
  assert.equal(menu.inMatch, false);
  assert.equal(menu.socketState, null);
  assert.equal(menu.onlinePlayers, 0);
  assert.equal(menu.remoteBodies, 0);
  await waitFor(() => watcher.state.players.length === 0);
  assert.deepEqual(errors, []);
  for (const width of [390, 1280]) {
    await page.setViewport({ width, height: 850 });
    assert(await page.$eval('#spectateBtn', el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left >= 0 && r.right <= innerWidth;
    }), `Spectate menu button overflows at ${width}px`);
  }
  console.log('PASS browser: free flight, no combat packets, escape/menu cleanup, player/spectator rejoin, responsive menu');
}
main().catch(error => { console.error('FAIL', error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  for (const c of clients) c.ws?.close();
  if (clients.length) {
    await sleep(1200);
    console.log('FINAL HEALTH', await json('/health'));
  }
});
