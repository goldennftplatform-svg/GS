import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AGENTS, getAgent, statBar } from './roster.js';
import { MAPS, getMap, buildMapById, bindThree } from './maps.js';

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

let MAP = 128;
let HALF = MAP / 2;
const EYE = 1.65;
const GRAVITY = 28;
const JUMP_VEL = 9.5;
const FIRE_MS = 160;
const DMG = 34;
const BOLT_SPEED = 70;
const BOLT_LIFE = 0.7;
const MAX_BOLTS = 10;
/** @type {{ mesh: THREE.Mesh, vx:number, vy:number, vz:number, life:number, fromId:string }[]} */
const bolts = [];
/** @type {THREE.Object3D[]} */
const animatedProps = [];
let audioCtx = null;
let lastLocalShot = 0;

const canvas = document.getElementById('game');
const boot = document.getElementById('boot');
const selectScreen = document.getElementById('selectScreen');
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const nameInput = document.getElementById('nameInput');
const joinBtn = document.getElementById('joinBtn');
const soloBtn = document.getElementById('soloBtn');
const bootStatus = document.getElementById('bootStatus');
const selectStatus = document.getElementById('selectStatus');
const toSelectBtn = document.getElementById('toSelectBtn');
const backBoot = document.getElementById('backBoot');
const agentGrid = document.getElementById('agentGrid');
const agentTag = document.getElementById('agentTag');

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
  radar: document.getElementById('radar'),
  mapTag: document.getElementById('mapTag'),
};

let selectedAgentId = localStorage.getItem('skullbond-agent') || 'skullpepe';
let selectedMapId = localStorage.getItem('skullbond-map') || 'stadium';

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

let SPAWNS = [
  { x: -52, y: EYE, z: -52, yaw: Math.PI / 4 },
  { x: 52, y: EYE, z: -52, yaw: (3 * Math.PI) / 4 },
  { x: -52, y: EYE, z: 52, yaw: -Math.PI / 4 },
  { x: 52, y: EYE, z: 52, yaw: (-3 * Math.PI) / 4 },
];

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a100c);
scene.fog = new THREE.Fog(0x0a100c, 55, 145);
const world = new THREE.Group();
scene.add(world);

const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.05, 260);
camera.position.set(0, EYE, 8);

const gunGroup = new THREE.Group();
camera.add(gunGroup);
scene.add(camera);

/** @type {{ agent?: THREE.Object3D, raygun?: THREE.Object3D, crate?: THREE.Object3D, server?: THREE.Object3D }} */
const models = {};
const gltfLoader = new GLTFLoader();

function groundNormalize(root, targetHeight) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const h = Math.max(size.y, 0.001);
  const s = targetHeight / h;
  root.scale.setScalar(s);
  const box2 = new THREE.Box3().setFromObject(root);
  root.position.y -= box2.min.y;
  return root;
}

function tintClone(root, color) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const wasArray = Array.isArray(o.material);
    const mats = wasArray ? o.material : [o.material];
    const cloned = mats.map((m) => {
      const c = m.clone();
      if (c.emissive) c.emissive = new THREE.Color(color).multiplyScalar(0.12);
      return c;
    });
    o.material = wasArray ? cloned : cloned[0];
  });
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.12, 0.55),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 })
  );
  band.position.y = 1.05;
  root.add(band);
  return root;
}

function fallbackGun() {
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
  gunGroup.add(body, barrel);
}

function mountRaygun() {
  while (gunGroup.children.length) gunGroup.remove(gunGroup.children[0]);
  if (!models.raygun) {
    fallbackGun();
  } else {
    const gun = models.raygun.clone(true);
    gun.scale.setScalar(0.45);
    // Point down camera -Z (forward). Don't yaw the viewmodel 90° off-axis.
    gun.rotation.set(0, Math.PI, 0);
    gun.position.set(0.22, -0.2, -0.45);
    gun.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    gunGroup.add(gun);
  }
  muzzleFlash.position.set(0.28, -0.22, -1.05);
  gunGroup.add(muzzleFlash);
}

const muzzleFlash = new THREE.PointLight(PALETTE.green, 0, 5);

function loadModel(url) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

async function loadGameAssets() {
  if (bootStatus) bootStatus.textContent = 'PULLING BLENDER ASSETS…';
  const urls = {
    agent: '/assets/models/skullpepe.glb',
    raygun: '/assets/models/raygun.glb',
    crate: '/assets/models/crate.glb',
    server: '/assets/models/server.glb',
    hazard: '/assets/models/hazard_sign.glb',
    bag: '/assets/models/daily_bag.glb',
    token: '/assets/models/skull_token.glb',
    heart: '/assets/models/oneup_heart.glb',
    daisy: '/assets/models/daisy.glb',
    badge: '/assets/models/crew_badge.glb',
    skate: '/assets/models/skateboard.glb',
    barrel: '/assets/models/barrel.glb',
    tomb: '/assets/models/tombstone.glb',
    checker: '/assets/models/checker_wall.glb',
    pipes: '/assets/models/pipes.glb',
    mohawk: '/assets/models/mohawk_head.glb',
  };
  try {
    const entries = await Promise.all(
      Object.entries(urls).map(async ([key, url]) => [key, await loadModel(url)])
    );
    for (const [key, sceneRoot] of entries) models[key] = sceneRoot;

    models.agent = groundNormalize(models.agent, 1.85);
    models.crate = groundNormalize(models.crate, 1.1);
    models.server = groundNormalize(models.server, 3.4);
    models.hazard = groundNormalize(models.hazard, 2.2);
    models.bag = groundNormalize(models.bag, 1.0);
    models.token = groundNormalize(models.token, 0.55);
    models.heart = groundNormalize(models.heart, 0.7);
    models.daisy = groundNormalize(models.daisy, 1.15);
    models.badge = groundNormalize(models.badge, 1.0);
    models.skate = groundNormalize(models.skate, 0.35);
    models.barrel = groundNormalize(models.barrel, 1.35);
    models.tomb = groundNormalize(models.tomb, 1.6);
    models.checker = groundNormalize(models.checker, 1.8);
    models.pipes = groundNormalize(models.pipes, 2.4);
    models.mohawk = groundNormalize(models.mohawk, 1.4);

    models.agent.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    mountRaygun();
    decorateMapProps();
    for (const [, mesh] of remoteMeshes) scene.remove(mesh);
    remoteMeshes.clear();
    if (offlineMatch) syncRemotes(offlineMatch.roster);
    else if (players.size) syncRemotes([...players.values()]);
    if (bootStatus) bootStatus.textContent = 'ASSETS LOCKED — READY';
  } catch (err) {
    console.warn('Asset load failed', err);
    fallbackGun();
    gunGroup.add(muzzleFlash);
    if (bootStatus) bootStatus.textContent = 'ASSET FALLBACK — STILL PLAYABLE';
  }
}

function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose?.();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.dispose?.();
        m.dispose?.();
      }
    }
  });
}

function clearWorld() {
  while (world.children.length) {
    const child = world.children[0];
    world.remove(child);
    disposeObject(child);
  }
  WALLS.length = 0;
  PILLARS.length = 0;
  animatedProps.length = 0;
}

function loadSelectedMap(mapId = selectedMapId) {
  bindThree(THREE);
  selectedMapId = mapId;
  clearWorld();
  const map = buildMapById(mapId, {
    scene,
    world,
    WALLS,
    THREE,
    setSpawns(next) {
      SPAWNS = next;
    },
    setBounds(size) {
      MAP = size;
      HALF = size / 2;
    },
  });
  if (els.mapTag) els.mapTag.textContent = map.name;
  if (models.crate || models.token) decorateMapProps();
  return map;
}

function drawRadar() {
  const c = els.radar;
  if (!c || !myId || hud.classList.contains('hidden')) return;
  const g = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  const cx = w / 2;
  const cy = h / 2;
  const scale = (w * 0.42) / Math.max(HALF, 1);

  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(8, 14, 10, 0.92)';
  g.fillRect(0, 0, w, h);

  g.fillStyle = 'rgba(107, 175, 110, 0.35)';
  for (const wall of WALLS) {
    const x = cx + ((wall.minX + wall.maxX) / 2) * scale;
    const z = cy + ((wall.minZ + wall.maxZ) / 2) * scale;
    const ww = Math.max(2, (wall.maxX - wall.minX) * scale);
    const hh = Math.max(2, (wall.maxZ - wall.minZ) * scale);
    g.fillRect(x - ww / 2, z - hh / 2, ww, hh);
  }

  g.strokeStyle = 'rgba(255, 242, 179, 0.35)';
  g.lineWidth = 1;
  g.strokeRect(cx - HALF * scale, cy - HALF * scale, MAP * scale, MAP * scale);

  const list =
    offlineMode && offlineMatch ? offlineMatch.roster : [...players.values()];

  for (const p of list) {
    if (!p.alive && p.id !== myId) continue;
    const px = cx + p.x * scale;
    const pz = cy + p.z * scale;
    if (p.id === myId) {
      g.save();
      g.translate(px, pz);
      g.rotate(-yaw);
      g.fillStyle = '#fff2b3';
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5, 6);
      g.lineTo(0, 3);
      g.lineTo(-5, 6);
      g.closePath();
      g.fill();
      g.restore();
    } else {
      g.fillStyle = p.color || '#e5392d';
      g.beginPath();
      g.arc(px, pz, 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  g.strokeStyle = '#6baf6e';
  g.lineWidth = 2;
  g.strokeRect(1, 1, w - 2, h - 2);
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

function makeAgentMesh(agentOrColor) {
  const agent =
    typeof agentOrColor === 'string' || typeof agentOrColor === 'number'
      ? { color: agentOrColor, tint: agentOrColor, scale: 1, hover: false, id: 'skullpepe' }
      : agentOrColor || getAgent('skullpepe');
  const color = agent.color || agent.tint || '#6BAF6E';

  if (models.agent) {
    const clone = models.agent.clone(true);
    clone.scale.multiplyScalar(agent.scale || 1);
    tintClone(clone, color);
    if (agent.id === 'daisy') {
      for (let i = 0; i < 5; i++) {
        const petal = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 6, 6),
          new THREE.MeshStandardMaterial({
            color: i % 2 ? 0xfff2b3 : 0xe5392d,
            emissive: 0xfff2b3,
            emissiveIntensity: 0.2,
          })
        );
        const a = (i / 5) * Math.PI * 2;
        petal.position.set(Math.cos(a) * 0.28, 1.72, Math.sin(a) * 0.28);
        clone.add(petal);
      }
    }
    if (agent.id === 'hazard') {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.18, 0.7),
        new THREE.MeshStandardMaterial({
          color: 0xfff2b3,
          emissive: 0xaa8800,
          emissiveIntensity: 0.5,
        })
      );
      stripe.position.y = 0.55;
      clone.add(stripe);
    }
    if (agent.hover) clone.userData.hoverBob = true;
    return clone;
  }

  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.45), bodyMat);
  torso.position.y = 0.95;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: PALETTE.cream })
  );
  head.position.y = 1.65;
  g.add(torso, head);
  g.scale.setScalar(agent.scale || 1);
  return g;
}

function placeProp(src, x, z, opts = {}) {
  if (!src) return null;
  const prop = src.clone(true);
  prop.position.set(x, opts.y ?? 0, z);
  prop.rotation.y = opts.ry ?? 0;
  if (opts.scale) prop.scale.multiplyScalar(opts.scale);
  prop.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  if (opts.spin || opts.hoverBob) {
    prop.userData.spin = !!opts.spin;
    prop.userData.hoverBob = !!opts.hoverBob;
    prop.userData.baseY = prop.position.y;
    animatedProps.push(prop);
  }
  world.add(prop);
  if (opts.collide) {
    const r = opts.collide;
    WALLS.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
  }
  return prop;
}

function decorateMapProps() {
  const r = Math.max(20, HALF - 10);
  const crateSpots = [
    [-r * 0.55, -r * 0.7],
    [r * 0.5, -r * 0.65],
    [-r * 0.45, r * 0.6],
    [r * 0.55, r * 0.55],
    [0, -r * 0.4],
    [0, r * 0.35],
    [-r * 0.3, 0],
    [r * 0.3, 0],
  ];
  crateSpots.forEach(([x, z], i) => {
    const useServer = i % 3 === 0;
    placeProp(useServer ? models.server : models.crate, x, z, {
      ry: i * 0.7,
      collide: useServer ? 1.2 : 0.8,
    });
  });

  for (const spawn of SPAWNS) {
    placeProp(models.heart, spawn.x + 2.5, spawn.z - 2, { y: 1.4, spin: true, hoverBob: true });
  }

  if (models.token) {
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const rad = r * (0.25 + (i % 4) * 0.12);
      placeProp(models.token, Math.cos(a) * rad, Math.sin(a) * rad, {
        y: 1.15,
        spin: true,
        hoverBob: true,
        scale: 0.9,
      });
    }
  }

  if (selectedMapId === 'facility') {
    for (const [x, z] of [
      [-36, 36],
      [-30, 30],
      [36, -36],
      [36, 36],
    ]) {
      placeProp(models.hazard, x, z, { collide: 0.55 });
    }
  }
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
      const agent = getAgent(p.agentId || 'skullpepe');
      mesh = makeAgentMesh({ ...agent, color: p.color || agent.color });
      remoteMeshes.set(p.id, mesh);
      scene.add(mesh);
    }
    mesh.visible = !!p.alive;
    const bob = mesh.userData.hoverBob ? Math.sin(performance.now() * 0.004) * 0.12 : 0;
    mesh.position.set(p.x, (p.y || EYE) - EYE + bob, p.z);
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

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx?.state === 'suspended') audioCtx.resume();
}

function playZap() {
  ensureAudio();
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(880, t0);
  o.frequency.exponentialRampToValueAtTime(180, t0 + 0.09);
  g.gain.setValueAtTime(0.12, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(t0);
  o.stop(t0 + 0.11);
}

function flashMuzzle() {
  muzzleFlash.intensity = 8;
  gunGroup.position.z = 0.1;
  gunGroup.rotation.x = 0.12;
  setTimeout(() => {
    muzzleFlash.intensity = 0;
    gunGroup.position.z = 0;
    gunGroup.rotation.x = 0;
  }, 70);
}

function spawnImpact(x, y, z, hitSomeone) {
  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(hitSomeone ? 0.4 : 0.25, 8, 8),
    new THREE.MeshBasicMaterial({ color: hitSomeone ? PALETTE.red : PALETTE.cream })
  );
  spark.position.set(x, y, z);
  scene.add(spark);
  setTimeout(() => {
    scene.remove(spark);
    spark.geometry.dispose();
    spark.material.dispose();
  }, 120);
}

const _aimOrigin = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _aimEnd = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

/** Sync look angles onto the camera and return true aim ray (where you look). */
function getAimRay() {
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  camera.rotation.z = 0;
  camera.updateMatrixWorld(true);
  _aimOrigin.copy(camera.position);
  camera.getWorldDirection(_aimDir); // camera forward (-Z) in world space
  if (_aimDir.lengthSq() < 1e-6) _aimDir.set(0, 0, -1);
  else _aimDir.normalize();
  return { origin: _aimOrigin, dir: _aimDir };
}

function spawnTracer(origin, dir, dist = 48) {
  const len = Math.max(0.5, dist);
  _aimEnd.copy(origin).addScaledVector(dir, len);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.015, len, 6),
    new THREE.MeshBasicMaterial({ color: 0x9dff9a })
  );
  beam.position.copy(origin).addScaledVector(dir, len * 0.5);
  beam.quaternion.setFromUnitVectors(_yAxis, dir);
  scene.add(beam);
  setTimeout(() => {
    scene.remove(beam);
    beam.geometry.dispose();
    beam.material.dispose();
  }, 60);
}

function spawnBolt(origin, dir, fromId) {
  while (bolts.length >= MAX_BOLTS) {
    const old = bolts.shift();
    scene.remove(old.mesh);
    old.mesh.geometry.dispose();
    old.mesh.material.dispose();
  }
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x6baf6e })
  );
  mesh.position.copy(origin).addScaledVector(dir, 1.2);
  scene.add(mesh);
  bolts.push({
    mesh,
    vx: dir.x * BOLT_SPEED,
    vy: dir.y * BOLT_SPEED,
    vz: dir.z * BOLT_SPEED,
    life: BOLT_LIFE,
    fromId,
  });
}

function updateBolts(dt) {
  // Visual only — damage is hitscan in applyShot
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.life -= dt;
    b.mesh.position.x += b.vx * dt;
    b.mesh.position.y += b.vy * dt;
    b.mesh.position.z += b.vz * dt;
    const out =
      b.life <= 0 ||
      Math.abs(b.mesh.position.x) > HALF ||
      Math.abs(b.mesh.position.z) > HALF ||
      b.mesh.position.y < 0 ||
      b.mesh.position.y > 12;
    if (out) {
      scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      bolts.splice(i, 1);
    }
  }
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

  const maxHp = me.maxHp || 100;
  const hearts = Math.ceil((me.hp / maxHp) * 3);
  els.hearts.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const h = document.createElement('div');
    h.className = 'heart' + (i < hearts ? ' full' : '');
    els.hearts.appendChild(h);
  }
  els.energy.style.width = `${Math.max(15, Math.min(100, (me.hp / maxHp) * 100))}%`;

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
  selectScreen?.classList.add('hidden');
  hud.classList.remove('hidden');
  overlay.classList.add('hidden');
  showCenter(title + ' · CLICK TO LOCK MOUSE', 2400);
  canvas.focus();
  // May fail outside direct gesture — LMB handler will lock + fire anyway
  tryPointerLock();
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

function makeEntity(id, name, agentId, spawnIndex, bot = false) {
  const agent = getAgent(agentId);
  const s = SPAWNS[spawnIndex % SPAWNS.length];
  const maxHp = Math.round(100 * agent.hpMul);
  return {
    id,
    name: name || agent.name,
    agentId: agent.id,
    color: agent.color,
    speedMul: agent.speedMul,
    maxHp,
    x: s.x,
    y: s.y,
    z: s.z,
    yaw: s.yaw,
    pitch: 0,
    vy: 0,
    grounded: true,
    hp: maxHp,
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
      hp: p.maxHp || 100,
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
  const mine = getAgent(selectedAgentId);
  const me = makeEntity('local', (name || mine.name).slice(0, 16).toUpperCase(), mine.id, 0, false);
  const botAgents = AGENTS.filter((a) => a.id !== mine.id).slice(0, 3);
  const bots = botAgents.map((a, i) => makeEntity(`bot${i}`, a.name, a.id, i + 1, true));
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
  lastHp = me.maxHp;
  if (agentTag) agentTag.textContent = `#${String(mine.slot).padStart(2, '0')} ${mine.name}`;
  beginMission(`${mine.name} — ${getMap(selectedMapId).name}`);
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

function dirFromYawPitch(yaw0, pitch0, out = new THREE.Vector3()) {
  // Match Three.js camera forward for YXZ euler (look down -Z at 0,0)
  const cp = Math.cos(pitch0);
  out.set(Math.sin(yaw0) * cp, -Math.sin(pitch0), -Math.cos(yaw0) * cp);
  return out.normalize();
}

function applyShot(shooter, now) {
  if (!shooter.alive || now - shooter.lastShot < FIRE_MS) return false;
  shooter.lastShot = now;

  let origin;
  let dir;
  if (shooter.id === myId) {
    // Local player: ALWAYS shoot where the camera looks (fixes "laser goes right")
    const aim = getAimRay();
    origin = aim.origin;
    dir = aim.dir.clone();
    shooter.yaw = yaw;
    shooter.pitch = pitch;
  } else {
    origin = new THREE.Vector3(shooter.x, shooter.y, shooter.z);
    dir = dirFromYawPitch(shooter.yaw, shooter.pitch);
  }

  spawnTracer(origin, dir, 48);
  spawnBolt(origin, dir, shooter.id);

  // Instant hitscan (bolt is VFX only — avoid double damage)
  if (offlineMatch) {
    let best = null;
    let bestT = 55;
    const tgt = new THREE.Vector3();
    const closest = new THREE.Vector3();
    for (const target of offlineMatch.roster) {
      if (target.id === shooter.id || !target.alive) continue;
      tgt.set(target.x, target.y, target.z);
      const t = closest.copy(tgt).sub(origin).dot(dir);
      if (t < 0.5 || t > bestT) continue;
      closest.copy(origin).addScaledVector(dir, t);
      if (closest.distanceTo(tgt) < 1.2) {
        bestT = t;
        best = target;
      }
    }
    if (best) {
      best.hp -= DMG;
      spawnImpact(origin.x + dir.x * bestT, origin.y + dir.y * bestT, origin.z + dir.z * bestT, true);
      if (shooter.id === myId) {
        els.hitMarker.classList.add('show');
        setTimeout(() => els.hitMarker.classList.remove('show'), 140);
      }
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
    }
  }

  if (shooter.id === myId) {
    flashMuzzle();
    playZap();
  }
  return true;
}

function moveEntity(p, forward, strafe, sprint, wantJump, dt) {
  const mul = p.speedMul || 1;
  const speed = (sprint ? 10.5 : 7.2) * mul;
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
    if (dist < 28 && Math.random() < 0.012) applyShot(bot, now);
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

    // Hold-to-auto-fire via cooldown inside firePrimary/applyShot
    if (keys.shootHeld) firePrimary();
  } else {
    keys.shootHeld = false;
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
      p.hp = p.maxHp || 100;
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
    statusMsg(selectStatus || bootStatus, 'NO GAME SERVER ON VERCEL — STARTING SOLO…');
    setTimeout(() => {
      loadSelectedMap(selectedMapId);
      startOffline(name);
    }, 300);
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
    statusMsg(selectStatus || bootStatus, `${why} — SOLO OPS`);
    setTimeout(() => {
      loadSelectedMap(selectedMapId);
      startOffline(name);
    }, 350);
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
    ws.send(JSON.stringify({ type: 'join', name, agentId: selectedAgentId, mapId: selectedMapId }));
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
      if (msg.mapId) loadSelectedMap(msg.mapId);
      else loadSelectedMap(selectedMapId);
      const mine = getAgent(selectedAgentId);
      if (agentTag) agentTag.textContent = `#${String(mine.slot).padStart(2, '0')} ${mine.name}`;
      beginMission(`${mine.name} — ${getMap(selectedMapId).name}`);
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

function statusMsg(el, text) {
  if (el) el.textContent = text;
}

function armJoin(mode) {
  const mine = getAgent(selectedAgentId);
  const name = (nameInput.value || localStorage.getItem('skullbond-name') || mine.name).trim();
  localStorage.setItem('skullbond-name', name);
  localStorage.setItem('skullbond-agent', selectedAgentId);
  joinBtn.disabled = true;
  soloBtn.disabled = true;
  localStorage.setItem('skullbond-map', selectedMapId);
  if (mode === 'solo') {
    statusMsg(selectStatus, 'LOADING ARENA…');
    loadSelectedMap(selectedMapId);
    startOffline(name);
    return;
  }
  statusMsg(selectStatus, 'ESTABLISHING UPLINK…');
  connect(name);
}

function renderDossier(agent) {
  const art = document.getElementById('dossierArt');
  document.getElementById('dossierSlot').textContent = `#${String(agent.slot).padStart(2, '0')}`;
  document.getElementById('dossierName').textContent = agent.name;
  document.getElementById('dossierCode').textContent = agent.codename;
  document.getElementById('dossierBio').textContent = agent.bio;
  document.getElementById('dossierLore').textContent = agent.lore;
  document.getElementById('dossierTip').textContent = `TIP — ${agent.tip}`;
  document.getElementById('dossierStats').innerHTML = [
    `SPD ${statBar(agent.stats.speed, 5, '⚡')}`,
    `HP  ${statBar(agent.stats.health, 5, '♥')}`,
    `RAD ${statBar(agent.stats.radness, 5, '☠')}`,
    `KIT ${agent.kit}`,
  ].join('<br>');
  if (art) {
    art.style.backgroundImage = `url('${agent.portrait}')`;
    art.style.backgroundPosition = agent.portraitPos || 'center';
  }
}

function buildMapSelect() {
  const grid = document.getElementById('mapGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const m of MAPS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'map-card' + (m.id === selectedMapId ? ' selected' : '');
    btn.innerHTML = `<div class="mn">${m.name}</div><div class="mb">${m.blurb}</div>`;
    btn.addEventListener('click', () => {
      selectedMapId = m.id;
      localStorage.setItem('skullbond-map', m.id);
      grid.querySelectorAll('.map-card').forEach((c) => c.classList.remove('selected'));
      btn.classList.add('selected');
    });
    grid.appendChild(btn);
  }
}

function buildAgentSelect() {
  agentGrid.innerHTML = '';
  for (const agent of AGENTS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'agent-card' + (agent.id === selectedAgentId ? ' selected' : '');
    btn.innerHTML = `
      <div class="thumb" style="background-image:url('${agent.portrait}');background-position:${agent.portraitPos || 'center'}"></div>
      <div class="meta">
        <div class="slot">#${String(agent.slot).padStart(2, '0')}</div>
        <div class="name">${agent.name}</div>
        <div class="code">${agent.codename}</div>
      </div>`;
    btn.addEventListener('click', () => {
      selectedAgentId = agent.id;
      localStorage.setItem('skullbond-agent', agent.id);
      agentGrid.querySelectorAll('.agent-card').forEach((c) => c.classList.remove('selected'));
      btn.classList.add('selected');
      renderDossier(agent);
    });
    agentGrid.appendChild(btn);
  }
  renderDossier(getAgent(selectedAgentId));
}

toSelectBtn?.addEventListener('click', () => {
  boot.classList.add('hidden');
  selectScreen.classList.remove('hidden');
  buildMapSelect();
  buildAgentSelect();
});

backBoot?.addEventListener('click', () => {
  selectScreen.classList.add('hidden');
  boot.classList.remove('hidden');
});

joinBtn.addEventListener('click', () => armJoin('net'));
soloBtn.addEventListener('click', () => armJoin('solo'));
nameInput.value = localStorage.getItem('skullbond-name') || '';
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    boot.classList.add('hidden');
    selectScreen.classList.remove('hidden');
    buildMapSelect();
    buildAgentSelect();
  }
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
  if (e.code === 'KeyF' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
    keys.shootHeld = true;
    firePrimary();
  }
  if (e.code === 'KeyR' && inMatch()) tryPointerLock();
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

function inMatch() {
  return !!myId && !hud.classList.contains('hidden');
}

function tryPointerLock() {
  if (document.pointerLockElement === canvas) return;
  const req = canvas.requestPointerLock?.();
  if (req && typeof req.catch === 'function') req.catch(() => {});
}

function firePrimary() {
  if (!inMatch() || !localAlive) return false;
  const now = Date.now();
  if (now - lastLocalShot < FIRE_MS) return false;
  lastLocalShot = now;

  if (offlineMode && offlineMatch) {
    const me = offlineMatch.roster.find((p) => p.id === myId);
    if (me?.alive) applyShot(me, now);
  } else {
    const { origin, dir } = getAimRay();
    spawnTracer(origin, dir, 48);
    spawnBolt(origin, dir.clone(), myId || 'local');
    flashMuzzle();
    playZap();
  }
  return true;
}

function onPrimaryDown(e) {
  if (!inMatch()) return;
  if (e.button !== 0 && e.pointerType !== 'touch') return;
  if (e.cancelable) e.preventDefault();
  ensureAudio();
  tryPointerLock();
  canvas.focus();
  keys.shootHeld = true;
  firePrimary();
}

function onPrimaryUp(e) {
  if (e.button === 0 || e.pointerType === 'touch') keys.shootHeld = false;
}

// One listener only — stacking pointerdown+mousedown+click was multi-firing
window.addEventListener('pointerdown', onPrimaryDown);
window.addEventListener('pointerup', onPrimaryUp);

document.addEventListener('contextmenu', (e) => {
  if (inMatch()) e.preventDefault();
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});

addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) {
    pointerLocked = false;
    return;
  }
  pointerLocked = true;
  yaw -= e.movementX * 0.0024;
  pitch -= e.movementY * 0.0024;
  pitch = Math.max(-1.4, Math.min(1.4, pitch));
  // DO NOT fire here — that was the glitch storm
  if (e.buttons & 1) keys.shootHeld = true;
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

loadSelectedMap(selectedMapId);
fallbackGun();
gunGroup.add(muzzleFlash);
loadGameAssets();

const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;

  for (const o of animatedProps) {
    if (o.userData.baseY == null) o.userData.baseY = o.position.y;
    if (o.userData.spin) o.rotation.y = t * 1.6;
    if (o.userData.hoverBob || o.userData.spin) {
      o.position.y = o.userData.baseY + Math.sin(t * 2.5 + o.position.x) * 0.1;
    }
  }

  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  // Don't fight muzzle recoil every frame
  if (muzzleFlash.intensity < 0.1) {
    gunGroup.position.x = Math.sin(t * 2.2) * 0.008;
    gunGroup.position.y = Math.cos(t * 3.1) * 0.006;
    gunGroup.position.z = 0;
    gunGroup.rotation.x = 0;
  }

  if (offlineMode) offlineTick(dt);
  else sendInput();
  updateBolts(dt);
  drawRadar();

  renderer.render(scene, camera);
}
tick();
setInterval(sendInput, 50);
