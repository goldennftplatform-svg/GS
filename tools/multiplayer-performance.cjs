// Real two-browser measurement. --baseline serves HEAD's client without changing files.
// Requires the same puppeteer-core and Edge/Chrome setup as game-smoke.mjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const port = Number(process.env.SKULLBOND_TEST_PORT || 3107);
const url = `http://localhost:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const executablePath = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((file) => fs.existsSync(file));

async function main() {
  assert(executablePath, 'Edge/Chrome required');
  // Refuse to measure against or stop a pre-existing server.
  const occupied = await fetch(`${url}/health`).then(() => true, () => false);
  assert(!occupied, `Port ${port} already occupied`);
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  let serverOutput = '';
  server.stdout.on('data', (data) => { serverOutput += data; });
  server.stderr.on('data', (data) => { serverOutput += data; });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      ready = await fetch(`${url}/health`).then((res) => res.ok, () => false);
      if (ready) break;
      await sleep(100);
    }
    assert(ready, serverOutput);
    browser = await puppeteer.launch({ executablePath, headless: true, args: [
      '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--autoplay-policy=no-user-gesture-required',
    ] });
    const source = baseline
      ? execFileSync('git', ['show', 'HEAD:public/js/client.js'], { cwd: root, encoding: 'utf8' })
      : fs.readFileSync(path.join(root, 'public/js/client.js'), 'utf8');
    // Test-only access to module state; no shipped instrumentation or game overrides.
    const probe = `
      window.MP = {
        join(name) { selectedMapId = 'stadium'; connect(name); },
        move(on) { yaw = 0; keys.r = on; },
        fire(on) { keys.shootHeld = on; if (on) shootPulse = true; },
        hudChanges() {
          const state = structuredClone(lastState);
          const me = state.players.find(p => p.id === myId);
          me.hp = me.maxHp / 3; me.kills++;
          state.killFeed.push({ text: 'PERF HUD CHECK' });
          const before = { ...measure.html };
          updateHud(state); updateHud(state);
          const writes = Object.fromEntries(Object.keys(before).map(key => [key, measure.html[key] - before[key]]));
          updateHud(lastState);
          return writes;
        },
        async transitions() {
          const handler = ws.onmessage;
          ws.onmessage = null;
          const original = [...players.values()].map(p => ({ ...p }));
          try {
            const list = original.map(p => ({ ...p }));
            const p = list.find(p => p.id !== myId);
            const mesh = remoteMeshes.get(p.id);
            p.x += 20; p.yaw = Math.PI - 0.01;
            syncRemotes(list);
            const teleport = mesh.position.x === p.x;
            p.x += 1; p.yaw = -Math.PI + 0.01;
            syncRemotes(list);
            const deferred = mesh.position.x !== p.x;
            await new Promise(resolve => setTimeout(resolve, 250));
            // Remotes render face-toward +Z models with a half-turn offset, so a
            // logical yaw of -PI lands the mesh near 0, not PI.
            const shortTurn = Math.abs(mesh.rotation.y) < 0.05 || Math.abs(Math.abs(mesh.rotation.y) - 2 * Math.PI) < 0.05;
            p.alive = false; syncRemotes(list);
            const hidden = !mesh.visible;
            p.alive = true; p.x += 1; syncRemotes(list);
            return { teleport, deferred, shortTurn, hidden, respawn: mesh.visible && mesh.position.x === p.x };
          } finally { syncRemotes(original); ws.onmessage = handler; }
        },
        sample() { return [...remoteMeshes].map(([id, mesh]) => ({
          id, x: mesh.position.x, z: mesh.position.z, yaw: mesh.rotation.y,
          targetX: players.get(id).x, targetZ: players.get(id).z,
        })); },
        reset() { window.measure = { inputs: 0, bytes: 0, states: 0, shots: 0,
          html: { hearts: 0, killFeed: 0, scoreboard: 0 }, frames: [], poses: [] }; },
      };
      MP.reset();
      let previousFrame = performance.now();
      function measureFrame(now) {
        measure.frames.push(now - previousFrame); previousFrame = now;
        measure.poses.push({ state: measure.states, remotes: MP.sample() });
        requestAnimationFrame(measureFrame);
      }
      requestAnimationFrame(measureFrame);
    `;
    const errors = [];
    const pages = [];
    for (let i = 0; i < 2; i++) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      pages.push(page);
      await page.setViewport({ width: 640, height: 360 });
      page.on('pageerror', (error) => { errors.push(error.message); console.error('PAGE ERROR:', error.message); });
      await page.evaluateOnNewDocument(() => {
        const NativeWebSocket = window.WebSocket;
        window.WebSocket = class extends NativeWebSocket {
          constructor(...args) {
            super(...args);
            this.addEventListener('message', (event) => {
              const msg = JSON.parse(event.data);
              if (msg.type === 'welcome') window.probeId = msg.id;
              if (msg.type === 'state') {
                window.lastState = msg;
                if (window.measure) measure.states++;
              }
              if (msg.type === 'shot' && window.measure) measure.shots++;
            });
          }
          send(data) {
            if (JSON.parse(data).type === 'input' && window.measure) {
              measure.inputs++; measure.bytes += data.length;
            }
            return super.send(data);
          }
        };
        const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        Object.defineProperty(Element.prototype, 'innerHTML', {
          ...descriptor,
          set(value) {
            if (window.measure && Object.hasOwn(measure.html, this.id)) measure.html[this.id]++;
            descriptor.set.call(this, value);
          },
        });
      });
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/js/client.js') {
          request.respond({ status: 200, contentType: 'application/javascript', body: source + probe });
        } else request.continue();
      });
      await page.goto(`${url}/?ws=${encodeURIComponent(`ws://localhost:${port}/ws`)}`, { waitUntil: 'networkidle2' });
      await page.waitForFunction(() => !!window.MP);
      await page.evaluate((name) => MP.join(name), `PERF ${i + 1}`);
    }
    for (const page of pages) {
      await page.waitForFunction(() => lastState?.players.length === 2 && SKULL_DEBUG.state().remoteBodies === 1);
      assert(await page.evaluate(() => lastState.you === probeId), 'personalized snapshot identity');
    }
    await sleep(500);
    for (const page of pages) await page.evaluate(() => MP.reset());
    const started = Date.now();
    await sleep(4000);
    const seconds = (Date.now() - started) / 1000;
    const idle = [];
    for (const page of pages) idle.push(await page.evaluate(() => measure));
    console.log(baseline ? 'BASELINE CLIENT (HEAD)' : 'WORKTREE CLIENT');
    idle.forEach((m, i) => {
      const frames = m.frames.slice(1).sort((a, b) => a - b);
      console.log(JSON.stringify({ client: i + 1, seconds, inputs: m.inputs,
        inputsPerSecond: +(m.inputs / seconds).toFixed(1), inputBytes: m.bytes,
        snapshots: m.states, htmlWrites: m.html,
        frameMedianMs: +frames[Math.floor(frames.length / 2)].toFixed(1),
        frameP95Ms: +frames[Math.floor(frames.length * 0.95)].toFixed(1) }));
      assert(m.states >= 50, 'snapshots keep arriving');
      if (!baseline) {
        assert(m.inputs / seconds <= 22, 'input rate capped at 20 Hz');
        assert.equal(Object.values(m.html).reduce((a, b) => a + b, 0), 0, 'unchanged HUD markup retained');
      }
    });
    const startX = await pages[0].evaluate(() => lastState.players.find((p) => p.id === probeId).x);
    await pages[1].evaluate(() => MP.reset());
    await pages[0].evaluate(() => MP.move(true));
    await sleep(1000);
    await pages[0].evaluate(() => MP.move(false));
    await sleep(400);
    const endX = await pages[0].evaluate(() => lastState.players.find((p) => p.id === probeId).x);
    assert(endX - startX > 3, 'authoritative movement');
    const motion = await pages[1].evaluate(() => measure.poses);
    let betweenSnapshots = 0;
    for (let i = 1; i < motion.length; i++) {
      if (motion[i].state === motion[i - 1].state &&
          Math.abs(motion[i].remotes[0].x - motion[i - 1].remotes[0].x) > 0.001) betweenSnapshots++;
    }
    const last = motion.at(-1).remotes[0];
    const error = Math.hypot(last.x - last.targetX, last.z - last.targetZ);
    const blendedFrames = motion.filter((frame) => Math.abs(frame.remotes[0].x - frame.remotes[0].targetX) > 0.001).length;
    console.log(JSON.stringify({ movementUnits: +(endX - startX).toFixed(3),
      movingFramesBetweenSnapshots: betweenSnapshots, blendedFrames, settledRemoteError: +error.toFixed(4) }));
    if (!baseline) assert(blendedFrames > 0 && error < 0.1, 'remote smoothing and convergence');
    await pages[0].evaluate(() => MP.fire(true));
    await sleep(650);
    await pages[0].evaluate(() => MP.fire(false));
    await sleep(250);
    const shots = await pages[1].evaluate(() => measure.shots);
    assert(shots >= 2, 'remote automatic fire events');
    await sleep(350);
    assert.equal(await pages[1].evaluate(() => measure.shots), shots, 'fire stops on release');
    await pages[0].evaluate(() => { MP.fire(true); MP.fire(false); });
    await sleep(250);
    assert.equal(await pages[1].evaluate(() => measure.shots), shots + 1, 'short click survives until input timer');
    if (!baseline) {
      const transitions = await pages[1].evaluate(() => MP.transitions());
      assert(Object.values(transitions).every(Boolean), JSON.stringify(transitions));
      console.log('PASS - teleport snap, deferred movement, shortest yaw wrap, death visibility, respawn snap');
      assert.deepEqual(await pages[1].evaluate(() => MP.hudChanges()), { hearts: 1, killFeed: 1, scoreboard: 1 });
      console.log('PASS - changed HUD markup updates once, identical follow-up does not rebuild');
    }
    await pages[0].close();
    await pages[1].waitForFunction(() => lastState.players.length === 1 && SKULL_DEBUG.state().remoteBodies === 0);
    assert.deepEqual(errors, [], 'no browser errors');
    console.log(`PASS - two browser clients: identities, movement, ${shots} shots, release, disconnect, no page errors`);
    if (process.argv.includes('--smoke')) {
      await browser.close(); browser = null;
      await sleep(200);
      for (const script of ['two-player-smoke.cjs', 'four-player-smoke.cjs', 'server-map-smoke.cjs', 'game-smoke.mjs']) {
        await new Promise((resolve, reject) => {
          // The existing browser smoke hardcodes :3000; redirect its source in memory.
          const args = script === 'game-smoke.mjs'
            ? ['--input-type=module', '-e', fs.readFileSync(path.join(root, 'tools', script), 'utf8').replace('http://localhost:3000', url)]
            : [`tools/${script}`];
          const child = spawn(process.execPath, args, {
            cwd: root, env: { ...process.env, SKULLBOND_WS: `ws://localhost:${port}/ws` }, stdio: 'inherit',
          });
          child.on('error', reject);
          child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${script}: exit ${code}`)));
        });
        await sleep(200);
      }
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
