import * as THREE from 'three';

const PALETTE = {
  cream: 0xfff2b3,
  green: 0x6baf6e,
  greenDark: 0x2e6e3e,
  brown: 0xb56a4d,
  grey: 0x8e8e8e,
  red: 0xe5392d,
  floor: 0x3a4a38,
  wall: 0x5a6b52,
  accent: 0x1e2a1c,
  metal: 0x6a7068,
};

const MAP = 96; // world size
const HALF = MAP / 2;
const EYE = 1.65;
const GRAVITY = 28;
const JUMP_VEL = 9.5;
const FIRE_MS = 180;
const DMG = 34;

const canvas = document.getElementById('game');
const boot = document.getElementById('boot');
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const soloBtn = document.getElementById('soloBtn');
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

const keys = {
  f: false,
  b: false,
  l: false,
  r: false,
  sprint: false,
  jump: false,
  shootHeld: false,
};
let shootPulse = false;
let yaw = 0;
let pitch = 0;
let pointerLocked = false;
let myId = null;
let players = new Map();
let remoteMeshes = new Map();
let lastHp = 100;
let ws = null;
let localAlive = true;
let offlineMode = false;
let offlineMatch = null;

/** Solid XZ boxes for collision (axis-aligned). */
const WALLS = [];
const PILLARS = [];

const SPAWNS = [
  { x: -38, y: EYE, z: -38, yaw: Math.PI / 4 },
  { x: 38, y: EYE, z: -38, yaw: (3 * Math.PI) / 4 },
  { x: -38, y: EYE, z: 38, yaw: -Math.PI / 4 },
  { x: 38, y: EYE, z: 38, yaw: (-3 * Math.PI) / 4 },
];
const BOT_NAMES = ['AGENT PEPE', 'AGENT DAISY', 'AGENT BONES'];
const BOT_COLORS = ['#E5392D', '#B56A4D', '#8E8E8E'];

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a100c);
scene.fog = new THREE.Fog(0x0a100c, 40, 110);

const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 160);
camera.position.set(0, EYE, 8);

const gunGroup = new THREE.Group();
camera.add(gunGroup);
scene.add(camera);

function buildGun() {
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.16, 0.62),
    new THREE.MeshStandardMaterial({ color: PALETTE.grey, metalness: 0.65, roughness: 0.3 })
  );
  body.position.set(0.24, -0.24, -0.58);
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.04, 0.42, 10),
    new THREE.MeshStandardMaterial({
      color: PALETTE.cream,
      emissive: PALETTE.green,
      emissiveIntensity: 0.45,
    })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0.24, -0.2, -0.98);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.09, 0.055),
    new THREE.MeshBasicMaterial({ color: PALETTE.green })
  );
  screen.position.set(0.24, -0.15, -0.42);
  gunGroup.add(body, barrel, screen);
}
buildGun();

const muzzleFlash = new THREE.PointLight(PALETTE.green, 0, 5);
muzzleFlash.position.set(0.24, -0.2, -1.15);
gunGroup.add(muzzleFlash);

function addLights() {
  scene.add(new THREE.AmbientLight(0x6a886a, 0.5));
  const sun = new THREE.DirectionalLight(0xfff2b3, 0.75);
  sun.position.set(30, 40, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  scene.add(sun);
  for (const [x, z] of [
    [0, 0],
    [-30, -30],
    [30, -30],
    [-30, 30],
    [30, 30],
    [0, -28],
    [0, 28],
  ]) {
    const p = new THREE.PointLight(PALETTE.green, 0.9, 28);
    p.position.set(x, 5.5, z);
    scene.add(p);
  }
}

function solidBox(w, h, d, color, x, y, z, opts = {}) {
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
  if (opts.collide !== false) {
    WALLS.push({
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2,
    });
  }
  return m;
}

function pillar(x, z, r = 1.4, h = 3.2) {
  solidBox(r * 2, h, r * 2, PALETTE.wall, x, h / 2, z);
  PILLARS.push({ x, z, r });
}

function roomFloor(x, z, w, d, color = PALETTE.floor) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.95 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.02, z);
  m.receiveShadow = true;
  scene.add(m);
}

function buildFacility() {
  WALLS.length = 0;
  PILLARS.length = 0;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP, MAP),
    new THREE.MeshStandardMaterial({ color: 0x2f3c2e, roughness: 0.97 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(MAP, MAP / 2, 0x2e6e3e, 0x182418);
  grid.position.y = 0.015;
  scene.add(grid);

  const wallH = 6;
  // Outer shell
  solidBox(MAP, wallH, 1.2, PALETTE.wall, 0, wallH / 2, -HALF + 0.6);
  solidBox(MAP, wallH, 1.2, PALETTE.wall, 0, wallH / 2, HALF - 0.6);
  solidBox(1.2, wallH, MAP, PALETTE.wall, -HALF + 0.6, wallH / 2, 0);
  solidBox(1.2, wallH, MAP, PALETTE.wall, HALF - 0.6, wallH / 2, 0);

  // === MAIN LAB (center) ===
  roomFloor(0, 0, 28, 28, 0x354534);
  solidBox(5, 5, 5, PALETTE.accent, 0, 2.5, 0, {
    emissive: PALETTE.greenDark,
    emissiveIntensity: 0.25,
  });
  solidBox(1.6, 0.35, 1.6, PALETTE.green, 0, 5.2, 0, {
    emissive: PALETTE.green,
    emissiveIntensity: 0.9,
    collide: false,
  });

  // Lab ring cover
  for (const [x, z] of [
    [-8, -8],
    [8, -8],
    [-8, 8],
    [8, 8],
    [-12, 0],
    [12, 0],
    [0, -12],
    [0, 12],
  ]) {
    pillar(x, z, 1.3, 2.8);
  }

  // Corridor walls with doorways (segmented)
  function wallSeg(w, h, d, x, y, z, color = PALETTE.wall) {
    solidBox(w, h, d, color, x, y, z);
  }

  // === NORTH ARCHIVES ===
  roomFloor(0, -32, 36, 20, 0x3a3228);
  for (let i = -14; i <= 14; i += 7) {
    wallSeg(1.2, 3.5, 10, i, 1.75, -34, PALETTE.brown);
  }
  wallSeg(8, 3, 1, -14, 1.5, -24, PALETTE.brown);
  wallSeg(8, 3, 1, 14, 1.5, -24, PALETTE.brown);

  // === SOUTH SERVER FARM ===
  roomFloor(0, 34, 40, 18, 0x243028);
  for (let x = -16; x <= 16; x += 8) {
    for (let z = 28; z <= 40; z += 6) {
      solidBox(2.4, 3.6, 2.4, PALETTE.metal, x, 1.8, z, {
        emissive: PALETTE.greenDark,
        emissiveIntensity: 0.15,
      });
    }
  }

  // === EAST ARMORY ===
  roomFloor(34, 0, 18, 30, 0x3a3a32);
  wallSeg(1, 4, 10, 24, 2, -10, PALETTE.grey);
  wallSeg(1, 4, 10, 24, 2, 10, PALETTE.grey);
  for (const z of [-8, 0, 8]) {
    solidBox(3, 1.2, 1.2, PALETTE.grey, 36, 0.6, z, { metalness: 0.4 });
  }
  pillar(30, -12, 1.1);
  pillar(30, 12, 1.1);

  // === WEST LOCKERS / BATH ===
  roomFloor(-34, 0, 18, 30, 0x32382f);
  wallSeg(1, 4, 10, -24, 2, -10, PALETTE.wall);
  wallSeg(1, 4, 10, -24, 2, 10, PALETTE.wall);
  for (let z = -10; z <= 10; z += 5) {
    solidBox(4, 2.2, 1.5, PALETTE.grey, -36, 1.1, z);
  }

  // Cross corridors (with cover)
  for (const z of [-18, 18]) {
    pillar(-20, z, 1.2);
    pillar(20, z, 1.2);
    pillar(0, z, 1.5, 3.5);
  }
  for (const x of [-18, 18]) {
    pillar(x, -6, 1.1);
    pillar(x, 6, 1.1);
  }

  // Long divider walls with gaps (doorways at center)
  wallSeg(14, 4.5, 1.1, -17, 2.25, -18, PALETTE.wall);
  wallSeg(14, 4.5, 1.1, 17, 2.25, -18, PALETTE.wall);
  wallSeg(14, 4.5, 1.1, -17, 2.25, 18, PALETTE.wall);
  wallSeg(14, 4.5, 1.1, 17, 2.25, 18, PALETTE.wall);
  wallSeg(1.1, 4.5, 14, -18, 2.25, -17, PALETTE.wall);
  wallSeg(1.1, 4.5, 14, -18, 2.25, 17, PALETTE.wall);
  wallSeg(1.1, 4.5, 14, 18, 2.25, -17, PALETTE.wall);
  wallSeg(1.1, 4.5, 14, 18, 2.25, 17, PALETTE.wall);

  // Corner spawn pads + bunkers
  for (const s of SPAWNS) {
    solidBox(4, 0.18, 4, PALETTE.green, s.x, 0.09, s.z, {
      emissive: PALETTE.green,
      emissiveIntensity: 0.4,
      collide: false,
    });
    pillar(s.x + 4, s.z, 1.2);
    pillar(s.x, s.z + 4, 1.2);
  }

  // Ceiling light strips
  for (let i = -40; i <= 40; i += 10) {
    solidBox(MAP - 4, 0.15, 0.35, PALETTE.cream, 0, 5.7, i, {
      emissive: PALETTE.cream,
      emissiveIntensity: 0.2,
      collide: false,
    });
    solidBox(0.35, 0.15, MAP - 4, PALETTE.cream, i, 5.7, 0, {
      emissive: PALETTE.cream,
      emissiveIntensity: 0.15,
      collide: false,
    });
  }

  // Tokens
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rad = 14 + (i % 3) * 12;
    const coin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.08, 16),
      new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        metalness: 0.7,
        roughness: 0.3,
        emissive: 0x664400,
        emissiveIntensity: 0.3,
      })
    );
    coin.rotation.x = Math.PI / 2;
    coin.position.set(Math.cos(a) * rad, 1.25, Math.sin(a) * rad);
    coin.userData.spin = true;
    scene.add(coin);
  }

  // Posters
  const loader = new THREE.TextureLoader();
  const posters = [
    { url: '/assets/characters.png', x: 0, z: -HALF + 1.3, ry: 0 },
    { url: '/assets/features.png', x: HALF - 1.3, z: 0, ry: -Math.PI / 2 },
    { url: '/assets/story.png', x: -HALF + 1.3, z: 0, ry: Math.PI / 2 },
    { url: '/assets/pitch.png', x: 0, z: HALF - 1.3, ry: Math.PI },
  ];
  for (const p of posters) {
    loader.load(p.url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 5),
        new THREE.MeshBasicMaterial({ map: tex })
      );
      mesh.position.set(p.x, 2.8, p.z);
      mesh.rotation.y = p.ry;
      scene.add(mesh);
    });
  }
}

function resolveCollision(p, radius = 0.45) {
  p.x = Math.max(-HALF + 1.5, Math.min(HALF - 1.5, p.x));
  p.z = Math.max(-HALF + 1.5, Math.min(HALF - 1.5, p.z));

  for (const w of WALLS) {
    const nearestX = Math.max(w.minX, Math.min(p.x, w.maxX));
    const nearestZ = Math.max(w.minZ, Math.min(p.z, w.maxZ));
    const dx = p.x - nearestX;
    const dz = p.z - nearestZ;
    const dist2 = dx * dx + dz * dz;
    if (dist2 >= radius * radius) continue;
    if (dist2 < 1e-6) {
      // Deep inside — push toward nearest face
      const left = p.x - w.minX;
      const right = w.maxX - p.x;
      const up = p.z - w.minZ;
      const down = w.maxZ - p.z;
      const m = Math.min(left, right, up, down);
      if (m === left) p.x = w.minX - radius;
      else if (m === right) p.x = w.maxX + radius;
      else if (m === up) p.z = w.minZ - radius;
      else p.z = w.maxZ + radius;
      continue;
    }
    const dist = Math.sqrt(dist2);
    const push = (radius - dist) / dist;
    p.x += dx * push;
    p.z += dz * push;
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
    new THREE.MeshStandardMaterial({
      color: PALETTE.green,
      emissive: PALETTE.green,
      emissiveIntensity: 0.4,
    })
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
      continue;
    }
    let mesh = remoteMeshes.get(p.id);
    if (!mesh) {
      mesh = makeAgentMesh(new THREE.Color(p.color));
      remoteMeshes.set(p.id, mesh);
      scene.add(mesh);
    }
    mesh.visible = !!p.alive;
    mesh.position.set(p.x, (p.y || EYE) - EYE, p.z);
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

function flashMuzzle() {
  muzzleFlash.intensity = 4;
  gunGroup.position.z = 0.06;
  setTimeout(() => {
    muzzleFlash.intensity = 0;
    gunGroup.position.z = 0;
  }, 55);
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
    new THREE.SphereGeometry(0.14, 8, 8),
    new THREE.MeshBasicMaterial({ color: PALETTE.cream })
  );
  spark.position.copy(points[1]);
  scene.add(spark);
  setTimeout(() => {
    scene.remove(line);
    scene.remove(spark);
    geo.dispose();
  }, 90);
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
  els.energy.style.width = `${Math.max(15, Math.min(100, me.hp))}%`;

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

  if (!me.alive) showCenter('ELIMINATED — RESPAWNING', 2200);
}

function beginMission(title) {
  boot.classList.add('hidden');
  hud.classList.remove('hidden');
  overlay.classList.add('hidden');
  showCenter(title, 2000);
  canvas.requestPointerLock();
}

function endMatch(standings) {
  overlay.classList.remove('hidden');
  els.overlayTitle.textContent = 'MISSION COMPLETE';
  els.standings.innerHTML = standings
    .map((s, i) => `<li>#${i + 1} ${s.name} — ${s.kills}K / ${s.deaths}D · ${s.tokens} TOK</li>`)
    .join('');
  document.exitPointerLock();
  setTimeout(() => {
    overlay.classList.add('hidden');
    if (offlineMode) resetOfflineMatch();
  }, 7500);
}

function makeEntity(id, name, color, spawnIndex, bot = false) {
  const s = SPAWNS[spawnIndex % SPAWNS.length];
  return {
    id,
    name,
    color,
    x: s.x,
    y: s.y,
    z: s.z,
    yaw: s.yaw,
    pitch: 0,
    vy: 0,
    grounded: true,
    hp: 100,
    kills: 0,
    deaths: 0,
    tokens: 0,
    lives: 3,
    alive: true,
    lastShot: 0,
    respawnAt: 0,
    spawnIndex,
    bot,
  };
}

function pushFeed(text) {
  offlineMatch.killFeed.push({ t: Date.now(), text });
  if (offlineMatch.killFeed.length > 12) offlineMatch.killFeed.shift();
}

function resetOfflineMatch() {
  offlineMatch.endsAt = Date.now() + 180000;
  offlineMatch.killFeed = [];
  offlineMatch.ended = false;
  for (const p of offlineMatch.roster) {
    const s = SPAWNS[p.spawnIndex % SPAWNS.length];
    Object.assign(p, {
      x: s.x,
      y: s.y,
      z: s.z,
      yaw: s.yaw,
      pitch: 0,
      vy: 0,
      grounded: true,
      hp: 100,
      kills: 0,
      deaths: 0,
      tokens: 0,
      lives: 3,
      alive: true,
      respawnAt: 0,
    });
  }
  const me = offlineMatch.roster.find((p) => p.id === myId);
  if (me) {
    yaw = me.yaw;
    pitch = 0;
    camera.position.set(me.x, me.y, me.z);
  }
  showCenter('SOLO OPS — NEXT ROUND', 1800);
}

function startOffline(name) {
  offlineMode = true;
  myId = 'local';
  const me = makeEntity('local', (name || 'AGENT ZERO').slice(0, 16).toUpperCase(), '#6BAF6E', 0);
  const bots = BOT_NAMES.map((n, i) => makeEntity(`bot${i}`, n, BOT_COLORS[i], i + 1, true));
  offlineMatch = {
    roster: [me, ...bots],
    killFeed: [],
    endsAt: Date.now() + 180000,
    ended: false,
  };
  yaw = me.yaw;
  pitch = 0;
  camera.position.set(me.x, me.y, me.z);
  localAlive = true;
  lastHp = 100;
  beginMission('FACILITY — SOLO OPS');
  publishOfflineHud();
}

function publishOfflineHud() {
  if (!offlineMatch) return;
  updateHud({
    players: offlineMatch.roster,
    killFeed: offlineMatch.killFeed,
    timeLeft: Math.max(0, Math.ceil((offlineMatch.endsAt - Date.now()) / 1000)),
    maxPlayers: 4,
  });
  syncRemotes(offlineMatch.roster);
}

function rayHit(shooter) {
  const dirX = Math.sin(shooter.yaw) * Math.cos(shooter.pitch);
  const dirY = Math.sin(shooter.pitch);
  const dirZ = -Math.cos(shooter.yaw) * Math.cos(shooter.pitch);
  let best = null;
  let bestT = 70;
  for (const target of offlineMatch.roster) {
    if (target.id === shooter.id || !target.alive) continue;
    const fx = shooter.x - target.x;
    const fy = shooter.y - (target.y - 0.15);
    const fz = shooter.z - target.z;
    const b = fx * dirX + fy * dirY + fz * dirZ;
    const c = fx * fx + fy * fy + fz * fz - 0.95 * 0.95;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0.15 && t < bestT) {
      bestT = t;
      best = target;
    }
  }
  return {
    best,
    impact: {
      x: shooter.x + dirX * Math.min(bestT, 60),
      y: shooter.y + dirY * Math.min(bestT, 60),
      z: shooter.z + dirZ * Math.min(bestT, 60),
    },
    origin: { x: shooter.x, y: shooter.y, z: shooter.z },
  };
}

function applyShot(shooter, now) {
  if (!shooter.alive || now - shooter.lastShot < FIRE_MS) return false;
  shooter.lastShot = now;
  const { best, impact, origin } = rayHit(shooter);
  spawnTracer(origin, impact);
  if (shooter.id === myId) {
    flashMuzzle();
    if (best) {
      els.hitMarker.classList.add('show');
      setTimeout(() => els.hitMarker.classList.remove('show'), 100);
    }
  }
  if (!best) return true;
  best.hp -= DMG;
  if (best.hp <= 0) {
    best.hp = 0;
    best.alive = false;
    best.deaths += 1;
    best.lives = Math.max(0, best.lives - 1);
    best.respawnAt = now + 2500;
    shooter.kills += 1;
    shooter.tokens += 5;
    const text = `${shooter.name} ⚡ ${best.name}`;
    pushFeed(text);
    showCenter(text, 900);
  }
  return true;
}

function moveEntity(p, forward, strafe, sprint, wantJump, dt) {
  const speed = sprint ? 10.5 : 7.2;
  let mx = strafe;
  let mz = forward;
  if (mx || mz) {
    const len = Math.hypot(mx, mz) || 1;
    mx /= len;
    mz /= len;
    const cos = Math.cos(p.yaw);
    const sin = Math.sin(p.yaw);
    p.x += (mx * cos + mz * sin) * speed * dt;
    p.z += (-mx * sin + mz * cos) * speed * dt;
    resolveCollision(p);
  }

  if (wantJump && p.grounded) {
    p.vy = JUMP_VEL;
    p.grounded = false;
  }
  p.vy -= GRAVITY * dt;
  p.y += p.vy * dt;
  if (p.y <= EYE) {
    p.y = EYE;
    p.vy = 0;
    p.grounded = true;
  }
}

function updateBots(dt, now) {
  const me = offlineMatch.roster.find((p) => p.id === myId);
  for (const bot of offlineMatch.roster.filter((p) => p.bot)) {
    if (!bot.alive) continue;
    const dx = me.x - bot.x;
    const dz = me.z - bot.z;
    const dist = Math.hypot(dx, dz);
    bot.yaw = Math.atan2(dx, -dz) + Math.sin(now * 0.0015 + bot.spawnIndex) * 0.2;
    bot.pitch = THREE.MathUtils.clamp((me.y - bot.y) * 0.02, -0.4, 0.4);
    if (dist > 5) moveEntity(bot, -1, Math.sin(now * 0.001 + bot.spawnIndex) * 0.5, dist > 16, false, dt);
    else if (dist < 2.8) moveEntity(bot, 1, 0.6, false, Math.random() < 0.01, dt);
    else moveEntity(bot, 0, Math.sin(now * 0.002) * 0.3, false, false, dt);
    if (dist < 36 && Math.random() < 0.04) applyShot(bot, now);
  }
}

function offlineTick(dt) {
  if (!offlineMode || !offlineMatch || offlineMatch.ended) return;
  const now = Date.now();
  const me = offlineMatch.roster.find((p) => p.id === myId);
  if (!me) return;

  if (me.alive) {
    me.yaw = yaw;
    me.pitch = pitch;
    let forward = 0;
    let strafe = 0;
    if (keys.f) forward -= 1;
    if (keys.b) forward += 1;
    if (keys.l) strafe -= 1;
    if (keys.r) strafe += 1;
    moveEntity(me, forward, strafe, keys.sprint, keys.jump, dt);
    keys.jump = false;
    camera.position.set(me.x, me.y, me.z);

    if (shootPulse || keys.shootHeld) {
      applyShot(me, now);
      shootPulse = false;
    }
  } else {
    shootPulse = false;
  }

  updateBots(dt, now);

  for (const p of offlineMatch.roster) {
    if (!p.alive && p.respawnAt && now >= p.respawnAt) {
      const s = SPAWNS[p.spawnIndex % SPAWNS.length];
      p.x = s.x + (Math.random() - 0.5) * 3;
      p.y = s.y;
      p.z = s.z + (Math.random() - 0.5) * 3;
      p.yaw = s.yaw;
      p.vy = 0;
      p.grounded = true;
      p.hp = 100;
      p.alive = true;
      p.respawnAt = 0;
      if (p.lives <= 0) p.lives = 3;
      if (p.id === myId) {
        yaw = p.yaw;
        pitch = 0;
        camera.position.set(p.x, p.y, p.z);
      }
    }
  }

  localAlive = me.alive;
  if (now >= offlineMatch.endsAt) {
    offlineMatch.ended = true;
    endMatch([...offlineMatch.roster].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths));
  }
  publishOfflineHud();
}

function resolveWsUrl() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get('ws');
  if (fromQuery) localStorage.setItem('skullbond-ws', fromQuery);
  const base =
    fromQuery ||
    localStorage.getItem('skullbond-ws') ||
    (typeof window.SKULLBOND_WS === 'string' ? window.SKULLBOND_WS : '');
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

function isHostedStatic() {
  return /\.vercel\.app$/i.test(location.hostname) || location.search.includes('solo=1');
}

function connect(name) {
  if (
    isHostedStatic() &&
    !localStorage.getItem('skullbond-ws') &&
    !new URLSearchParams(location.search).get('ws')
  ) {
    bootStatus.textContent = 'NO GAME SERVER ON VERCEL — STARTING SOLO…';
    setTimeout(() => startOffline(name), 300);
    return;
  }

  const url = resolveWsUrl();
  let settled = false;
  const failToSolo = (why) => {
    if (settled || myId || offlineMode) return;
    settled = true;
    try {
      ws?.close();
    } catch {}
    localStorage.removeItem('skullbond-ws');
    bootStatus.textContent = `${why} — SOLO OPS`;
    setTimeout(() => startOffline(name), 350);
  };

  try {
    ws = new WebSocket(url);
  } catch {
    failToSolo('LINK FAILED');
    return;
  }

  const timer = setTimeout(() => failToSolo('UPLINK TIMEOUT'), 2500);

  ws.onopen = () => {
    bootStatus.textContent = 'LINKED — ARMING…';
    ws.send(JSON.stringify({ type: 'join', name }));
  };
  ws.onerror = () => {
    clearTimeout(timer);
    failToSolo('LINK FAILED');
  };
  ws.onclose = () => {
    clearTimeout(timer);
    if (!myId && !offlineMode) failToSolo('DISCONNECTED');
    else if (myId && !offlineMode) showCenter('CONNECTION LOST', 4000);
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'error') {
      clearTimeout(timer);
      bootStatus.textContent = msg.message;
      joinBtn.disabled = false;
      soloBtn.disabled = false;
      return;
    }
    if (msg.type === 'welcome') {
      settled = true;
      clearTimeout(timer);
      offlineMode = false;
      myId = msg.id;
      beginMission('FACILITY — DEATHMATCH');
      return;
    }
    if (msg.type === 'state') {
      syncRemotes(msg.players);
      const me = msg.players.find((p) => p.id === myId);
      if (me?.alive) camera.position.set(me.x, me.y, me.z);
      updateHud(msg);
      return;
    }
    if (msg.type === 'shot') {
      spawnTracer(msg.origin, msg.impact);
      if (msg.from === myId) {
        flashMuzzle();
        if (msg.hit) {
          els.hitMarker.classList.add('show');
          setTimeout(() => els.hitMarker.classList.remove('show'), 100);
        }
      }
      return;
    }
    if (msg.type === 'kill') {
      showCenter(msg.text, 1200);
      return;
    }
    if (msg.type === 'matchEnd') endMatch(msg.standings);
  };
}

function sendInput() {
  if (offlineMode || !ws || ws.readyState !== 1 || !myId) return;
  const shooting = (keys.shootHeld || shootPulse) && localAlive;
  ws.send(
    JSON.stringify({
      type: 'input',
      f: keys.f,
      b: keys.b,
      l: keys.l,
      r: keys.r,
      sprint: keys.sprint,
      jump: keys.jump,
      shoot: shooting,
      yaw,
      pitch,
    })
  );
  shootPulse = false;
  keys.jump = false;
}

function armJoin(mode) {
  const name = (nameInput.value || localStorage.getItem('skullbond-name') || 'AGENT ZERO').trim();
  localStorage.setItem('skullbond-name', name);
  joinBtn.disabled = true;
  soloBtn.disabled = true;
  if (mode === 'solo') {
    bootStatus.textContent = 'LOADING FACILITY…';
    startOffline(name);
    return;
  }
  bootStatus.textContent = 'ESTABLISHING UPLINK…';
  connect(name);
}

joinBtn.addEventListener('click', () => armJoin('net'));
soloBtn.addEventListener('click', () => armJoin('solo'));
nameInput.value = localStorage.getItem('skullbond-name') || '';
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') armJoin(isHostedStatic() ? 'solo' : 'net');
});

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'KeyW') keys.f = true;
  if (e.code === 'KeyS') keys.b = true;
  if (e.code === 'KeyA') keys.l = true;
  if (e.code === 'KeyD') keys.r = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.sprint = true;
  if (e.code === 'Space') {
    e.preventDefault();
    keys.jump = true;
  }
  // GoldenEye-style alt fire keys
  if (e.code === 'KeyF' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
    keys.shootHeld = true;
    shootPulse = true;
  }
  if (e.code === 'KeyR' && myId && !pointerLocked) canvas.requestPointerLock();
});

addEventListener('keyup', (e) => {
  if (e.code === 'KeyW') keys.f = false;
  if (e.code === 'KeyS') keys.b = false;
  if (e.code === 'KeyA') keys.l = false;
  if (e.code === 'KeyD') keys.r = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.sprint = false;
  if (e.code === 'KeyF' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
    keys.shootHeld = false;
  }
});

// Pointer-lock clicks must listen on document (canvas misses them after lock)
document.addEventListener('mousedown', (e) => {
  if (!myId || e.button !== 0) return;
  if (!pointerLocked) {
    canvas.requestPointerLock();
    return;
  }
  keys.shootHeld = true;
  shootPulse = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) keys.shootHeld = false;
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked) keys.shootHeld = false;
});

addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  yaw -= e.movementX * 0.0024;
  pitch -= e.movementY * 0.0024;
  pitch = Math.max(-1.4, Math.min(1.4, pitch));
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
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  scene.traverse((o) => {
    if (o.userData.spin) {
      o.rotation.z = t * 2.2;
      o.position.y = 1.25 + Math.sin(t * 3 + o.position.x) * 0.18;
    }
  });

  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  gunGroup.position.x = Math.sin(t * 2.2) * 0.01;
  gunGroup.position.y = Math.cos(t * 3.1) * 0.008;

  if (offlineMode) offlineTick(dt);
  else sendInput();

  renderer.render(scene, camera);
}
tick();
setInterval(sendInput, 50);
