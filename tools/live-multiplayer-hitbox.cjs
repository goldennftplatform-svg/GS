// Live-only verification: menu browser stamp, then guarded authoritative shots.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const WebSocket = require('ws');
const puppeteer = require('puppeteer-core');
const base = new URL(process.argv[2]);
assert.equal(base.origin, 'https://skullbond-gs-4p-2026.onrender.com');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];
let foreignPlayer = false;
async function json(path) {
  const res = await fetch(new URL(path, base), { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  assert(res.ok, `${path}: ${res.status}`);
  return res.json();
}
async function waitFor(test) {
  for (let i = 0; i < 200; i++) {
    assert(!foreignPlayer, 'Non-test player detected; aborting');
    const value = test();
    if (value) return value;
    await sleep(50);
  }
  throw new Error('Timed out waiting for live evidence');
}
async function main() {
  console.log('INITIAL HEALTH', await json('/health'));
  const version = await json('/version');
  assert(version.revision, 'Live deployment must report its revision');
  assert.equal(version.hitboxVersion, '20260904-body-box-1');
  console.log('VERSION', version);
  const executablePath = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find(file => fs.existsSync(file));
  const browser = await puppeteer.launch({ executablePath, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  try {
    const page = await browser.newPage();
    const modules = [];
    page.on('response', res => {
      if (/\/js\/(client\.js|body-geometry\.mjs)/.test(res.url())) modules.push({ url: res.url(), status: res.status() });
    });
    page.on('pageerror', error => console.log('BROWSER ERROR', error.message));
    // Menu-only inspection must never open a gameplay connection.
    await page.evaluateOnNewDocument(() => {
      window.__liveWsAttempts = 0;
      window.WebSocket = class { constructor() { window.__liveWsAttempts++; throw new Error('Menu-only verification blocks WebSocket'); } };
    });
    await page.goto(base.href, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForFunction(() => !!window.SKULL_DEBUG, { timeout: 30000 });
    const menu = await page.evaluate(() => ({ state: SKULL_DEBUG.state(), wsAttempts: window.__liveWsAttempts,
      scripts: [...document.scripts].map(s => s.src).filter(Boolean) }));
    console.log('LIVE MENU', JSON.stringify({ ...menu, modules }));
    assert.equal(menu.state.hitboxVersion, version.hitboxVersion);
    assert.equal(menu.wsAttempts, 0);
    assert.equal(menu.state.onlinePlayers, 0);
    assert(modules.some(m => m.url.endsWith('/js/client.js?v=20260904a') && m.status === 200));
    assert(modules.some(m => m.url.endsWith('/js/body-geometry.mjs?v=20260904a') && m.status === 200));
  } finally { await browser.close(); }

  const source = await fetch(new URL('/js/body-geometry.mjs', base)).then(r => { assert(r.ok); return r.text(); });
  const { getBodyBox, EYE_HEIGHT } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const agents = ['skullpepe', 'daisy', 'mini', 'boss'];
  const prefix = `LIVE${Date.now().toString(36).toUpperCase()}`;
  const names = agents.map((_, i) => `${prefix}${i}`);
  try {
    for (let i = 0; i < agents.length; i++) {
      const health = await json('/health');
      assert.equal(health.players, clients.length, 'Room occupied or changed; refusing to join');
      const client = { name: names[i], shots: [] };
      clients.push(client);
      client.ws = new WebSocket(new URL('/ws', base).href.replace('https:', 'wss:'));
      client.ws.on('error', error => { client.error = error; });
      client.ws.on('message', raw => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'welcome') client.id = msg.id;
        if (msg.type === 'shot') client.shots.push(msg);
        if (msg.type === 'state') client.state = msg;
        if ((msg.type === 'state' && msg.players.some(p => !names.includes(p.name))) ||
            (msg.type === 'join' && !names.includes(msg.player.name))) {
          foreignPlayer = true;
          for (const c of clients) c.ws?.close();
        }
      });
      await waitFor(() => { if (client.error) throw client.error; return client.ws.readyState === WebSocket.OPEN; });
      client.ws.send(JSON.stringify({ type: 'join', name: client.name, agentId: agents[i], mapId: 'stadium' }));
      await waitFor(() => client.id && client.state);
    }
    await waitFor(() => clients.every(c => c.state?.players.length === 4));
    await sleep(1800);
    console.log('FOUR LIVE PLAYERS', JSON.stringify(clients[0].state.players));
    async function shot(si, ti, aim, expectHit) {
      assert(!foreignPlayer);
      const c = clients[si];
      const shooter = c.state.players.find(p => p.id === c.id);
      const target = c.state.players.find(p => p.id === clients[ti].id);
      const box = getBodyBox(target.agentId);
      const height = aim === 'center' ? (box.min[1] + box.max[1]) / 2 : aim === 'legacy' ? EYE_HEIGHT - 0.2 : box.max[1] + 0.25;
      const dx = target.x - shooter.x, dz = target.z - shooter.z;
      const dy = target.y - EYE_HEIGHT + height - shooter.y;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const start = c.shots.length;
      c.ws.send(JSON.stringify({ type: 'input', yaw, pitch, click: true, shoot: false }));
      const event = await waitFor(() => c.shots.slice(start).find(s => s.from === c.id));
      await sleep(250);
      const after = c.state.players.find(p => p.id === target.id);
      console.log('SHOT EVIDENCE', JSON.stringify({ shooter: shooter.agentId, target: target.agentId, aim,
        targetHeight: height, bodyTop: box.max[1], yaw, pitch, before: target.hp, after: after.hp, event }));
      assert.equal(event.hit, expectHit ? target.id : null);
      assert(expectHit ? after.hp < target.hp : after.hp === target.hp, 'HP outcome does not match expectation');
      await sleep(400);
    }
    await shot(0, 2, 'legacy', false);
    await shot(0, 2, 'center', true);
    await shot(0, 1, 'center', true);
    await shot(1, 0, 'center', true);
    await shot(2, 0, 'center', true);
    await shot(1, 3, 'above', false);
    await shot(1, 3, 'center', true);
    console.log('PASS: five authoritative hits and two authoritative misses');
  } finally {
    for (const c of clients) c.ws?.close();
    await sleep(1500);
    console.log('FINAL HEALTH', await json('/health'));
  }
}
main().catch(error => { console.error('FAIL', error); process.exitCode = 1; });
