// LIVE Render only. All WebSockets are blocked before application code loads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');
const base = 'https://skullbond-gs-4p-2026.onrender.com';
const initialMap = process.argv[2] || 'facility';
assert(['stadium', 'lunch', 'starbucks', 'megacorp', 'facility'].includes(initialMap));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
async function main() {
  const version = await fetch(base + '/version', { signal: AbortSignal.timeout(90000) }).then(r => r.json());
  console.log('LIVE VERSION', version);
  if (process.env.LIVE_REVISION) assert.equal(version.revision, process.env.LIVE_REVISION, 'Unexpected deployment');
  const executablePath = process.env.BROWSER_PATH || [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find(p => fs.existsSync(p));
  browser = await puppeteer.launch({ executablePath, headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 640 });
  const errors = [], requests = [];
  page.on('pageerror', error => { errors.push(error.stack || error.message); if (errors.length <= 5) console.log('PAGE ERROR', error.stack || error.message); });
  page.on('requestfailed', request => { requests.push({ url: request.url(), error: request.failure() }); });
  page.on('response', response => { if (response.status() >= 400) requests.push({ url: response.url(), status: response.status() }); });
  page.on('console', message => { if (message.type() === 'error') console.log('CONSOLE', message.text()); });
  await page.evaluateOnNewDocument(map => {
    window.__wsAttempts = 0;
    window.WebSocket = class { constructor() { window.__wsAttempts++; throw new Error('Solo verifier forbids WebSockets'); } };
    localStorage.setItem('skullbond-agent', 'hazard');
    localStorage.setItem('skullbond-map', map);
    localStorage.setItem('skullbond-mode', 'dm');
  }, initialMap);
  await page.goto(base, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => !!window.SKULL_DEBUG);
  // Read module-private simulation state without replacing the live game code.
  const cdp = await page.createCDPSession();
  const scripts = [];
  cdp.on('Debugger.scriptParsed', script => scripts.push(script));
  await cdp.send('Debugger.enable');
  const client = scripts.find(s => /\/js\/client\.js/.test(s.url));
  assert(client, 'Client module not found');
  const { scriptSource } = await cdp.send('Debugger.getScriptSource', { scriptId: client.scriptId });
  const lineNumber = scriptSource.split('\n').findIndex(line => line.startsWith('function offlineTick(dt)')) + 1;
  assert(lineNumber > 0);
  const captured = new Promise((resolve, reject) => {
    cdp.once('Debugger.paused', async event => {
      try {
        const result = await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: event.callFrames[0].callFrameId,
          expression: `window.__soloRead = () => ({ botsFrozen, matchSkipCountdown,
            countdown: matchStartedAt - Date.now(), photoCount: window.SKULL_DEBUG._photo?.length || 0,
            roster: offlineMatch?.roster.map(p => ({ id:p.id, agentId:p.agentId, x:p.x, y:p.y, z:p.z,
              blocked: pointBlocked(p.x, p.z), blockers: WALLS.filter(w => p.x >= w.minX && p.x <= w.maxX && p.z >= w.minZ && p.z <= w.maxZ),
              yaw:p.yaw, pitch:p.pitch, hp:p.hp, alive:p.alive, lastShot:p.lastShot, sawAt:p.sawAt })) })` });
        assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
        await cdp.send('Debugger.resume');
        await cdp.detach();
        resolve();
      } catch (error) { reject(error); }
    });
  });
  await cdp.send('Debugger.setBreakpointByUrl', { url: client.url, lineNumber });
  await page.click('#toSelectBtn');
  await page.click('#soloBtn');
  await page.waitForFunction(() => SKULL_DEBUG.state().offline);
  await captured;
  const spawnState = await page.evaluate(() => window.__soloRead());
  console.log('SPAWN BLOCKERS', initialMap, JSON.stringify(spawnState));
  const samples = [];
  for (let i = 0; i < 8; i++) {
    await sleep(1000);
    const sample = await page.evaluate(() => ({ state: SKULL_DEBUG.state(), stats: SKULL_DEBUG.stats(), sim: window.__soloRead(), ws: window.__wsAttempts }));
    samples.push(sample);
    console.log('SOLO SAMPLE', i, JSON.stringify({ sim: sample.sim, shots: sample.state.shots, hits: sample.state.hits, locked: sample.state.locked, ws: sample.ws }));
  }
  if (process.argv.includes('--spawns')) {
    assert.equal(errors.length, 0);
    assert(samples.every(s => s.ws === 0));
    assert(!requests.some(r => !r.url.endsWith('/favicon.ico')), 'Game assets failed to load');
    assert(spawnState.roster.every(p => !p.blocked), 'Spawn is inside a collider');
    assert(samples.some(s => s.sim.roster.some((p, i) => p.id !== 'local' &&
      Math.hypot(p.x - spawnState.roster[i].x, p.z - spawnState.roster[i].z) > 0.5)), 'Bots did not leave spawn');
    return;
  }
  await page.click('#game', { offset: { x: 30, y: 250 } });
  await page.keyboard.down('f');
  await sleep(800);
  await page.keyboard.up('f');
  console.log('INPUT RESULT', await page.evaluate(() => ({ shots: SKULL_DEBUG.state().shots, locked: SKULL_DEBUG.state().locked })));

  // A controlled shot uses the live input/aim/hitscan path; only bot placement
  // is fixed so navigation, shields and random movement cannot masquerade as misses.
  if (initialMap !== 'stadium') {
    await page.evaluate(() => SKULL_DEBUG.startSolo('hazard', 'stadium'));
    await sleep(3000);
    if (!await page.evaluate(() => SKULL_DEBUG.state().locked)) await page.click('#game');
  }
  await page.evaluate(() => {
    SKULL_DEBUG.freezeBots(true);
    SKULL_DEBUG.teleport(-34, -34);
    SKULL_DEBUG.placeBot(0, -34, 20);
    SKULL_DEBUG.placeBot(1, 34, 20);
    SKULL_DEBUG.placeBot(2, -26, -34);
  });
  await sleep(1800);
  async function shootMini(center) {
    const setup = await page.evaluate(center => {
      const state = SKULL_DEBUG.state();
      const box = state.remoteAgents.find(p => p.agentId === 'mini').bodyBox;
      SKULL_DEBUG.aimAt(-26, -34);
      const height = center ? (box.min[1] + box.max[1]) / 2 : 1.65;
      SKULL_DEBUG.aim(0, -Math.atan2(height - state.camera.y, 8) / 0.0016);
      return { height, bodyTop: box.max[1], sim: window.__soloRead(), shots: state.shots, hits: state.hits };
    }, center);
    await page.keyboard.press('f');
    await sleep(300);
    const after = await page.evaluate(() => ({ sim: window.__soloRead(), shots: SKULL_DEBUG.state().shots, hits: SKULL_DEBUG.state().hits }));
    console.log(center ? 'MINI BODY-CENTER SHOT' : 'MINI EYE-HEIGHT SHOT', JSON.stringify({ setup, after }));
    return after.hits > setup.hits;
  }
  const highHit = await shootMini(false);
  const centeredHit = await shootMini(true);
  assert(!highHit, 'Eye-height ray should miss above Mini, not enlarge the hitbox');
  assert(centeredHit, 'Player must be able to hit Mini at its actual body height');

  // Reproduce session contamination explicitly, then enter a fresh solo match.
  await page.evaluate(async () => {
    SKULL_DEBUG.freezeBots(true);
    SKULL_DEBUG.skipCountdown(true);
    await SKULL_DEBUG.photoMode('stadium');
    await SKULL_DEBUG.startSolo('hazard', 'stadium');
  });
  const restartBefore = await page.evaluate(() => window.__soloRead());
  await sleep(4000);
  const restartAfter = await page.evaluate(() => window.__soloRead());
  console.log('RESTART AFTER PHOTO/FREEZE', JSON.stringify({ before: restartBefore, after: restartAfter }));

  // Isolate bot aim against the smallest agent in an open lane. Do not change
  // fire probability, damage, health, shields or random numbers.
  await page.evaluate(async () => {
    await SKULL_DEBUG.startSolo('mini', 'stadium');
    SKULL_DEBUG.freezeBots(false); // explicit only for this isolated aim trial
    SKULL_DEBUG.teleport(-34, -34);
    SKULL_DEBUG.placeBot(0, -26, -34);
    SKULL_DEBUG.placeBot(1, 34, 34);
    SKULL_DEBUG.placeBot(2, 34, 24);
  });
  const duelBefore = await page.evaluate(() => window.__soloRead());
  let duelAfter = duelBefore, botFired = false, miniDamaged = false;
  for (let i = 0; i < 120; i++) {
    await sleep(100);
    duelAfter = await page.evaluate(() => window.__soloRead());
    const bot = duelAfter.roster.find(p => p.id === 'bot0');
    const mini = duelAfter.roster.find(p => p.id === 'local');
    botFired ||= bot.lastShot > duelBefore.roster.find(p => p.id === 'bot0').lastShot;
    miniDamaged ||= mini.hp < duelBefore.roster.find(p => p.id === 'local').hp;
    if (botFired && miniDamaged) break;
  }
  console.log('BOT VS MINI', JSON.stringify({ before: duelBefore, after: duelAfter, botFired, miniDamaged }));
  console.log('REQUEST ERRORS', JSON.stringify(requests));
  console.log('EXCEPTIONS', errors.length, JSON.stringify([...new Set(errors)]));
  assert(samples.every(s => s.ws === 0), 'Solo must never open a socket');
  assert.equal(errors.length, 0, 'Offline loop raised exceptions');
  assert.equal(await page.evaluate(() => window.__wsAttempts), 0, 'No phase may open a WebSocket');
  assert(spawnState.roster.every(p => !p.blocked), 'Spawn is inside a collider');
  assert(!requests.some(r => !r.url.endsWith('/favicon.ico')), 'Game assets failed to load');
  assert(samples.some(s => s.stats.bots.some((b, i) => Math.hypot(b.x - samples[0].stats.bots[i].x, b.z - samples[0].stats.bots[i].z) > 0.5)), 'Bots did not move');
  console.log('CHECKS', { playerHitBot: centeredHit, botFired, miniDamaged,
    cleanRestart: !restartAfter.botsFrozen && !restartAfter.matchSkipCountdown && restartAfter.photoCount === 0 });
  assert(botFired, 'Nearby active bot must actually shoot');
  assert(miniDamaged, 'Bot shots must reach the scaled Mini body');
  assert(!restartAfter.botsFrozen && !restartAfter.matchSkipCountdown && restartAfter.photoCount === 0,
    'Fresh solo inherited diagnostic freeze/photo state');
  assert(restartAfter.roster.some((p, i) => p.id !== 'local' &&
    Math.hypot(p.x - restartBefore.roster[i].x, p.z - restartBefore.roster[i].z) > 0.5), 'Restarted bots must move');
  console.log('PASS: fresh/restarted solo movement, bot fire and damage, player hit, no exceptions or WebSockets');
}
main().catch(error => { console.error('FAIL', error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
