import * as THREE from 'three';

const PALETTE = {
  cream: 0xfff2b3,
  green: 0x6baf6e,
  greenDark: 0x2e6e3e,
  brown: 0xb56a4d,
  grey: 0x8e8e8e,
  red: 0xe5392d,
  ink: 0x0a0a0a,
  floor: 0x3a4a38,
  wall: 0x5a6b52,
  accent: 0x1e2a1c,
};

const canvas = document.getElementById('game');
const boot = document.getElementById('boot');
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const bootStatus = document.getElementById('bootStatus');

const els = {
  score: document.getElementById('hudScore'),
  time: document.getElementById('hudTime'),
  count: document.getElementById('hudCount'),
  hearts: document.getElementById('hearts'),
  energy: document.getElementById('energyBar'),
  tokens: document.getElementById('hudTokens'),
  lives: document.getElementById('hudLives'),
  kills: document.getElementById('hudKills'),
  deaths: document.getElementById('hudDeaths'),
  killFeed: document.getElementById('killFeed'),
  scoreboard: document.getElementById('scoreboard'),
  hitMarker: document.getElementById('hitMarker'),
  damage: document.getElementById('damageVignette'),
  centerMsg: document.getElementById('centerMsg'),
  standings: document.getElementById('standings'),
  overlayTitle: document.getElementById('overlayTitle'),
};

const keys = { f: false, b: false, l: false, r: false, sprint: false, shoot: false };
let yaw = 0;
let pitch = 0;
let pointerLocked = false;
let myId = null;
let players = new Map();
let remoteMeshes = new Map();
let lastHp = 100;
let energy = 100;
let ws = null;
let localAlive = true;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1410);
scene.fog = new THREE.Fog(0x0c1410, 28, 70);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 120);
camera.position.set(0, 1.6, 8);

const gunGroup = new THREE.Group();
camera.add(gunGroup);
scene.add(camera);

function buildGun() {
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.14, 0.55),
    new THREE.MeshStandardMaterial({ color: PALETTE.grey, metalness: 0.6, roughness: 0.35 })
  );
  body.position.set(0.22, -0.22, -0.55);
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.035, 0.35, 8),
    new THREE.MeshStandardMaterial({ color: PALETTE.cream, emissive: PALETTE.green, emissiveIntensity: 0.35 })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.22, -0.18, -0.9);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.08, 0.05),
    new THREE.MeshBasicMaterial({ color: PALETTE.green })
  );
  screen.position.set(0.22, -0.14, -0.4);
  gunGroup.add(body, barrel, screen);
}
buildGun();

const muzzleFlash = new THREE.PointLight(PALETTE.green, 0, 4);
muzzleFlash.position.set(0.22, -0.18, -1.05);
gunGroup.add(muzzleFlash);

function addLights() {
  scene.add(new THREE.AmbientLight(0x668866, 0.55));
  const sun = new THREE.DirectionalLight(0xfff2b3, 0.85);
  sun.position.set(20, 30, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);
  const fill = new THREE.PointLight(PALETTE.green, 1.2, 40);
  fill.position.set(0, 6, 0);
  scene.add(fill);
}

function box(w, h, d, color, x, y, z, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0.05,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

function buildFacility() {
  // Floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 50),
    new THREE.MeshStandardMaterial({ color: PALETTE.floor, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Grid lines (Facility vibe)
  const grid = new THREE.GridHelper(50, 50, 0x2e6e3e, 0x1a2a1c);
  grid.position.y = 0.01;
  scene.add(grid);

  // Outer walls
  const wallH = 5;
  const wallT = 1;
  box(50, wallH, wallT, PALETTE.wall, 0, wallH / 2, -25);
  box(50, wallH, wallT, PALETTE.wall, 0, wallH / 2, 25);
  box(wallT, wallH, 50, PALETTE.wall, -25, wallH / 2, 0);
  box(wallT, wallH, 50, PALETTE.wall, 25, wallH / 2, 0);

  // Central server stack
  box(3.2, 4, 3.2, PALETTE.accent, 0, 2, 0, { emissive: PALETTE.greenDark, emissiveIntensity: 0.2 });
  box(1.2, 0.3, 1.2, PALETTE.green, 0, 4.2, 0, { emissive: PALETTE.green, emissiveIntensity: 0.8 });

  // Pillars / cover
  const covers = [
    [-10, 0], [10, 0], [0, -10], [0, 10],
    [-14, -14], [14, -14], [-14, 14], [14, 14],
    [-8, 8], [8, -8],
  ];
  for (const [x, z] of covers) {
    box(2.2, 2.4, 2.2, PALETTE.wall, x, 1.2, z);
  }

  // Corridor dividers
  box(12, 3, 0.8, PALETTE.brown, -12, 1.5, -6);
  box(12, 3, 0.8, PALETTE.brown, 12, 1.5, 6);
  box(0.8, 3, 10, PALETTE.grey, -6, 1.5, 12);
  box(0.8, 3, 10, PALETTE.grey, 6, 1.5, -12);

  // Spawn pads
  const pads = [
    [-18, -18], [18, -18], [-18, 18], [18, 18],
  ];
  for (const [x, z] of pads) {
    box(3, 0.15, 3, PALETTE.green, x, 0.08, z, { emissive: PALETTE.green, emissiveIntensity: 0.35 });
  }

  // Ceiling strips
  for (let i = -20; i <= 20; i += 8) {
    box(48, 0.2, 0.4, PALETTE.cream, 0, 4.8, i, { emissive: PALETTE.cream, emissiveIntensity: 0.15 });
  }

  // Token pickups (visual only — score flavor)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const coin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.08, 16),
      new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.7, roughness: 0.3, emissive: 0x664400, emissiveIntensity: 0.3 })
    );
    coin.rotation.x = Math.PI / 2;
    coin.position.set(Math.cos(a) * 16, 1.2, Math.sin(a) * 16);
    coin.userData.spin = true;
    scene.add(coin);
  }

  // Billboard art on walls
  const loader = new THREE.TextureLoader();
  const posters = [
    { url: '/assets/characters.png', x: 0, z: -24.4, ry: 0 },
    { url: '/assets/features.png', x: 24.4, z: 0, ry: -Math.PI / 2 },
    { url: '/assets/story.png', x: -24.4, z: 0, ry: Math.PI / 2 },
  ];
  for (const p of posters) {
    loader.load(p.url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 4),
        new THREE.MeshBasicMaterial({ map: tex })
      );
      mesh.position.set(p.x, 2.4, p.z);
      mesh.rotation.y = p.ry;
      scene.add(mesh);
    });
  }
}

function makeAgentMesh(color) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const boneMat = new THREE.MeshStandardMaterial({ color: PALETTE.cream, roughness: 0.6 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.45), bodyMat);
  torso.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), boneMat);
  head.position.y = 1.65;
  const face = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.28, 0.1),
    new THREE.MeshStandardMaterial({ color: PALETTE.green, emissive: PALETTE.green, emissiveIntensity: 0.4 })
  );
  face.position.set(0, 1.65, 0.22);
  const strap = new THREE.Mesh(
    new THREE.BoxGeometry(0.75, 0.12, 0.5),
    new THREE.MeshStandardMaterial({ color: PALETTE.brown })
  );
  strap.position.y = 1.1;
  strap.rotation.z = 0.4;
  g.add(torso, head, face, strap);
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

function syncRemotes(list) {
  const seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    players.set(p.id, p);
    if (p.id === myId) {
      localAlive = p.alive;
      if (p.alive && pointerLocked) {
        camera.position.set(p.x, p.y, p.z);
      }
      continue;
    }
    let mesh = remoteMeshes.get(p.id);
    if (!mesh) {
      mesh = makeAgentMesh(new THREE.Color(p.color));
      remoteMeshes.set(p.id, mesh);
      scene.add(mesh);
    }
    mesh.visible = p.alive;
    mesh.position.set(p.x, 0, p.z);
    mesh.rotation.y = p.yaw;
  }
  for (const [id, mesh] of remoteMeshes) {
    if (!seen.has(id)) {
      scene.remove(mesh);
      remoteMeshes.delete(id);
      players.delete(id);
    }
  }
}

function pad(n, w = 6) {
  return String(Math.max(0, n | 0)).padStart(w, '0');
}

function showCenter(text, ms = 1600) {
  els.centerMsg.textContent = text;
  els.centerMsg.classList.add('show');
  clearTimeout(showCenter._t);
  showCenter._t = setTimeout(() => els.centerMsg.classList.remove('show'), ms);
}

function updateHud(state) {
  const me = state.players.find((p) => p.id === myId);
  if (!me) return;

  const score = me.kills * 500 + me.tokens * 25;
  els.score.textContent = pad(score);
  els.time.textContent = String(state.timeLeft).padStart(2, '0');
  els.count.textContent = `${state.players.length}/${state.maxPlayers}`;
  els.tokens.textContent = `x ${String(me.tokens).padStart(2, '0')}`;
  els.lives.textContent = `x ${String(me.lives).padStart(2, '0')}`;
  els.kills.textContent = me.kills;
  els.deaths.textContent = me.deaths;

  const hearts = Math.ceil((me.hp / 100) * 3);
  els.hearts.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const h = document.createElement('div');
    h.className = 'heart' + (i < hearts ? ' full' : '');
    els.hearts.appendChild(h);
  }

  energy = Math.max(20, Math.min(100, me.hp));
  els.energy.style.width = `${energy}%`;

  if (me.hp < lastHp) {
    els.damage.classList.add('on');
    setTimeout(() => els.damage.classList.remove('on'), 180);
  }
  lastHp = me.hp;

  els.killFeed.innerHTML = state.killFeed
    .slice()
    .reverse()
    .map((k) => `<div>${k.text}</div>`)
    .join('');

  const board = [...state.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  els.scoreboard.innerHTML = board
    .map((p, i) => {
      const you = p.id === myId ? ' ›' : '';
      return `<div style="color:${p.color}">${i + 1}. ${p.name}${you}  ${p.kills}-${p.deaths}</div>`;
    })
    .join('');

  if (!me.alive) {
    showCenter('ELIMINATED — RESPAWNING', 2200);
  }
}

function spawnTracer(origin, impact) {
  const points = [
    new THREE.Vector3(origin.x, origin.y, origin.z),
    new THREE.Vector3(impact.x, impact.y, impact.z),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color: PALETTE.green, transparent: true, opacity: 0.95 })
  );
  scene.add(line);
  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshBasicMaterial({ color: PALETTE.cream })
  );
  spark.position.copy(points[1]);
  scene.add(spark);
  setTimeout(() => {
    scene.remove(line);
    scene.remove(spark);
    geo.dispose();
  }, 80);
}

function resolveWsUrl() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get('ws');
  const fromStorage = localStorage.getItem('skullbond-ws');
  const fromWindow = typeof window.SKULLBOND_WS === 'string' ? window.SKULLBOND_WS : '';
  const base = fromQuery || fromStorage || fromWindow;
  if (base) {
    if (base.startsWith('ws://') || base.startsWith('wss://')) {
      return base.endsWith('/ws') ? base : `${base.replace(/\/$/, '')}/ws`;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${base.replace(/\/$/, '')}/ws`;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function connect(name) {
  const url = resolveWsUrl();
  if (new URLSearchParams(location.search).get('ws')) {
    localStorage.setItem('skullbond-ws', new URLSearchParams(location.search).get('ws'));
  }
  ws = new WebSocket(url);

  ws.onopen = () => {
    bootStatus.textContent = 'LINKED — ARMING…';
    ws.send(JSON.stringify({ type: 'join', name }));
  };

  ws.onerror = () => {
    bootStatus.textContent = 'LINK FAILED — IS THE SERVER UP?';
  };

  ws.onclose = () => {
    if (!myId) bootStatus.textContent = 'DISCONNECTED';
    else showCenter('CONNECTION LOST', 4000);
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (msg.type === 'error') {
      bootStatus.textContent = msg.message;
      return;
    }

    if (msg.type === 'welcome') {
      myId = msg.id;
      boot.classList.add('hidden');
      hud.classList.remove('hidden');
      showCenter('MISSION: DEATHMATCH', 2000);
      canvas.requestPointerLock();
      return;
    }

    if (msg.type === 'state') {
      syncRemotes(msg.players);
      updateHud(msg);
      return;
    }

    if (msg.type === 'shot') {
      spawnTracer(msg.origin, msg.impact);
      if (msg.from === myId) {
        muzzleFlash.intensity = 3;
        gunGroup.position.z = 0.04;
        setTimeout(() => {
          muzzleFlash.intensity = 0;
          gunGroup.position.z = 0;
        }, 50);
      }
      if (msg.hit && msg.from === myId) {
        els.hitMarker.classList.add('show');
        setTimeout(() => els.hitMarker.classList.remove('show'), 90);
      }
      return;
    }

    if (msg.type === 'kill') {
      showCenter(msg.text, 1200);
      return;
    }

    if (msg.type === 'matchEnd') {
      overlay.classList.remove('hidden');
      els.overlayTitle.textContent = 'MISSION COMPLETE';
      els.standings.innerHTML = msg.standings
        .map((s, i) => `<li>#${i + 1} ${s.name} — ${s.kills}K / ${s.deaths}D · ${s.tokens} TOK</li>`)
        .join('');
      document.exitPointerLock();
      setTimeout(() => overlay.classList.add('hidden'), 7500);
      return;
    }
  };
}

function sendInput() {
  if (!ws || ws.readyState !== 1 || !myId) return;
  ws.send(
    JSON.stringify({
      type: 'input',
      f: keys.f,
      b: keys.b,
      l: keys.l,
      r: keys.r,
      sprint: keys.sprint,
      shoot: keys.shoot && localAlive,
      yaw,
      pitch,
    })
  );
}

joinBtn.addEventListener('click', () => {
  const name = (nameInput.value || localStorage.getItem('skullbond-name') || 'AGENT ZERO').trim();
  localStorage.setItem('skullbond-name', name);
  bootStatus.textContent = 'ESTABLISHING UPLINK…';
  joinBtn.disabled = true;
  connect(name);
});

nameInput.value = localStorage.getItem('skullbond-name') || '';
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

addEventListener('keydown', (e) => {
  if (e.code === 'KeyW') keys.f = true;
  if (e.code === 'KeyS') keys.b = true;
  if (e.code === 'KeyA') keys.l = true;
  if (e.code === 'KeyD') keys.r = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.sprint = true;
  if (e.code === 'KeyR' && !pointerLocked && myId) canvas.requestPointerLock();
});

addEventListener('keyup', (e) => {
  if (e.code === 'KeyW') keys.f = false;
  if (e.code === 'KeyS') keys.b = false;
  if (e.code === 'KeyA') keys.l = false;
  if (e.code === 'KeyD') keys.r = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.sprint = false;
});

canvas.addEventListener('mousedown', () => {
  if (!myId) return;
  if (!pointerLocked) {
    canvas.requestPointerLock();
    return;
  }
  keys.shoot = true;
});
addEventListener('mouseup', () => {
  keys.shoot = false;
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});

addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-1.35, Math.min(1.35, pitch));
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

addLights();
buildFacility();

const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const t = clock.getElapsedTime();

  scene.traverse((o) => {
    if (o.userData.spin) {
      o.rotation.z = t * 2;
      o.position.y = 1.2 + Math.sin(t * 3 + o.position.x) * 0.15;
    }
  });

  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  // Subtle gun sway
  gunGroup.position.x = Math.sin(t * 2.2) * 0.008;
  gunGroup.position.y = Math.cos(t * 3.1) * 0.006;

  sendInput();
  renderer.render(scene, camera);
}
tick();

setInterval(sendInput, 50);
