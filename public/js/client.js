import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Build-stamped imports — bump these versions so browsers drop stale modules
import { AGENTS, getAgent, statBar } from './roster.js?v=20260825c';
import { MAPS, getMap, buildMapById, bindThree, PAD_SPOTS, GOLD_SPOTS } from './maps.js?v=20260825c';
import { WEAPONS, GOLD_SHOTS, GUN_RANK, getWeapon } from './weapons.js?v=20260825c';
import { BRAND } from './brand.js?v=20260825c';

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
const BOLT_SPEED = 70;
const BOLT_LIFE = 0.7;
const MAX_BOLTS = 10;
const PAD_RADIUS = 1.5;
const PAD_RESPAWN_MS = 22000;
const GOLD_LIVE_MS = 12000;
const GOLD_RESPAWN_MS = 30000;
const ARMOR_ABSORB = 0.55;
const STREAK_TEXT = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'KILLING SPREE' };
/** @type {{ mesh: THREE.Mesh, vx:number, vy:number, vz:number, life:number, fromId:string }[]} */
const bolts = [];
const tracers = []; // fading ray beams — every shot paints a ray, RAY-gun identity
/** @type {THREE.Object3D[]} */
const animatedProps = [];
let audioCtx = null;
let lastLocalShot = 0;
let triggerFresh = false;
let adsBlend = 0;
let matchStartedAt = 0;

/** Viewmodel mounting per weapon — guns authored muzzle-forward (-Z after glTF). */
const VIEWMODEL = {
  pp7: { model: 'pp7', pos: [0.22, -0.24, -0.4], scale: 1.15 },
  klobber: { model: 'klobber', pos: [0.24, -0.26, -0.44], scale: 1.05 },
  dd: { model: 'ddskull', pos: [0.22, -0.24, -0.42], scale: 1.2 },
  kf7: { model: 'kf7', pos: [0.2, -0.28, -0.48], scale: 1.25 },
  gold: { model: 'golden', pos: [0.22, -0.22, -0.4], scale: 1.25 },
};

let netWeapon = 'pp7';
let netAmmo = -1;
let netPickups = [];

/** Floating floor pads (offline sim). @type {{id:string,x:number,z:number,w:string,kind:string,active:boolean,respawnAt:number,mesh:?THREE.Object3D}[]} */
let pads = [];
let goldPad = null;

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
const crosshairEl = document.getElementById('crosshair');

const els = {
  score: document.getElementById('hudScore'),
  time: document.getElementById('hudTime'),
  count: document.getElementById('hudCount'),
  hearts: document.getElementById('hearts'),
  energy: document.getElementById('energyBar'),
  armor: document.getElementById('armorBar'),
  weapon: document.getElementById('weaponName'),
  tokens: document.getElementById('hudTokens'),
  lives: document.getElementById('hudLives'),
  kills: document.getElementById('hudKills'),
  deaths: document.getElementById('hudDeaths'),
  killFeed: document.getElementById('killFeed'),
  scoreboard: document.getElementById('scoreboard'),
  hitMarker: document.getElementById('hitMarker'),
  damage: document.getElementById('damageVignette'),
  centerMsg: document.getElementById('centerMsg'),
  skullPop: document.getElementById('skullPop'),
  dmgDir: document.getElementById('dmgDir'),
  standings: document.getElementById('standings'),
  overlayTitle: document.getElementById('overlayTitle'),
  overlayHint: document.querySelector('#overlay .hint'),
  radar: document.getElementById('radar'),
  mapTag: document.getElementById('mapTag'),
};

let selectedAgentId = localStorage.getItem('skullbond-agent') || 'skullpepe';
let selectedMapId = localStorage.getItem('skullbond-map') || 'stadium';
let selectedMode = localStorage.getItem('skullbond-mode') || 'dm';

const keys = {
  f: false,
  b: false,
  l: false,
  r: false,
  sprint: false,
  jump: false,
  shootHeld: false,
  ads: false,
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
// Supersample — 4x the pixels so it reads like a real game, not Minecraft
renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * 2, 3));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
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

// Dusk sky dome — no more void-black cheapness
const skyCv = document.createElement('canvas');
skyCv.width = 16;
skyCv.height = 256;
{
  const sg = skyCv.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#04060a');
  grad.addColorStop(0.52, '#0a1410');
  grad.addColorStop(0.72, '#1c2f20');
  grad.addColorStop(0.8, '#2c4227');
  grad.addColorStop(1, '#141d12');
  sg.fillStyle = grad;
  sg.fillRect(0, 0, 16, 256);
}
const skyTex = new THREE.CanvasTexture(skyCv);
skyTex.colorSpace = THREE.SRGBColorSpace;
const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(230, 24, 16),
  new THREE.MeshBasicMaterial({
    map: skyTex,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  })
);
skyDome.renderOrder = -10;
scene.add(skyDome);

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
  const team = new THREE.Color(color);
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const wasArray = Array.isArray(o.material);
    const src = wasArray ? o.material : [o.material];
    const cloned = src.map((m) => {
      const c = m.clone();
      // Team outfit slot — the punk jacket carries the agent color
      if (/punkred|toonred/i.test(c.name || '') && c.color) {
        c.color.copy(team);
        c.emissive = team.clone().multiplyScalar(0.35);
        return c;
      }
      // Gold trim stays gold
      if (/gold/i.test(c.name || '')) return c;
      const emLum = c.emissive ? c.emissive.r + c.emissive.g + c.emissive.b : 0;
      if (emLum > 0.05) {
        // Toon-shaded surfaces: the glow IS the visible color — team it hard
        c.emissive.lerp(team, 0.78);
        if (c.color) c.color.lerp(team, 0.3);
        return c;
      }
      const lum = c.color ? c.color.r * 0.3 + c.color.g * 0.6 + c.color.b * 0.1 : 0;
      if (lum > 0.55) {
        // Whites/bones become the team uniform — GE outfit rule
        c.color.lerp(team, 0.82);
        return c;
      }
      // Dark/detail surfaces: keep identity, whisper of team
      if (c.color) c.color.lerp(team, 0.18);
      return c;
    });
    o.material = wasArray ? cloned : cloned[0];
  });
  return root;
}

/**
 * Measure real bounds, stand the model upright (thinnest axis = facing),
 * normalize its largest footprint, center and ground it. No more guessing.
 */
function standAndSize(src, target) {
  const obj = src.clone(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y <= size.x && size.y <= size.z) obj.rotation.x = -Math.PI / 2;
  else if (size.x <= size.y && size.x <= size.z) obj.rotation.y = Math.PI / 2;
  const box2 = new THREE.Box3().setFromObject(obj);
  const size2 = new THREE.Vector3();
  box2.getSize(size2);
  const s = target / Math.max(size2.x, size2.y, 0.001);
  obj.scale.multiplyScalar(s);
  const box3 = new THREE.Box3().setFromObject(obj);
  const center = new THREE.Vector3();
  box3.getCenter(center);
  obj.position.x -= center.x;
  obj.position.z -= center.z;
  obj.position.y -= box3.min.y;
  return obj;
}

/** Self-glow floor so prop-built agents never vanish on dark maps. */
function popMats(root, strength = 0.3) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m.emissive) continue;
      const lum = m.emissive.r + m.emissive.g + m.emissive.b;
      if (lum < 0.05 && m.color) {
        m.emissive = m.color.clone().multiplyScalar(strength);
      }
    }
  });
  return root;
}

/** Overhead codename tag — big, high-contrast, draws through walls. */
function makeNameSprite(text, cssColor) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.font = '36px "Press Start 2P", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = '#10140f';
  g.strokeText(text, 256, 64);
  g.fillStyle = cssColor;
  g.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    })
  );
  spr.scale.set(3.0, 0.75, 1);
  spr.renderOrder = 999;
  return spr;
}

/**
 * Identity kit: glowing floor ring + team-color beacon + overhead codename.
 * Every agent reads instantly against any arena.
 */
function addIdentityKit(group, agent, tagY) {
  const cssColor = agent.color || '#' + new THREE.Color(agent.tint ?? 0x6baf6e).getHexString();
  const hex = agent.tint ?? 0x6baf6e;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.08, 8, 26),
    new THREE.MeshStandardMaterial({
      color: hex,
      emissive: hex,
      emissiveIntensity: 1.6,
      roughness: 0.4,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.09;
  group.add(ring);

  // Vertical beacon column so agents pop across the arena
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.16, 2.4, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: hex,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  beam.position.y = 1.25;
  group.add(beam);

  if (agent.codename) {
    const tag = makeNameSprite(agent.codename, cssColor);
    tag.position.y = tagY;
    group.add(tag);
  }
  return group;
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

function currentWeaponId() {
  if (offlineMode && offlineMatch) {
    const me = offlineMatch.roster.find((p) => p.id === myId);
    return me ? me.weapon : 'pp7';
  }
  return netWeapon;
}

function mountViewmodel(weaponId = 'pp7') {
  while (gunGroup.children.length) gunGroup.remove(gunGroup.children[0]);
  const cfg = VIEWMODEL[weaponId] || VIEWMODEL.pp7;
  const src = models[cfg.model] || models.raygun;
  if (!src) {
    fallbackGun();
  } else {
    const gun = src.clone(true);
    gun.scale.setScalar(cfg.scale);
    // Authored muzzle-forward (-Z) — no yaw correction needed
    gun.rotation.set(0, 0, 0);
    gun.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
    gun.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });
    gunGroup.add(gun);
  }
  muzzleFlash.position.set(0.06, -0.2, -0.85);
  muzzleFlash.color = new THREE.Color(weaponId === 'gold' ? 0xffd700 : PALETTE.green);
  gunGroup.add(muzzleFlash);
}

// Legacy alias — raygun viewmodel is just the pp7 slot now
function mountRaygun() {
  mountViewmodel(currentWeaponId());
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
    pp7: '/assets/models/raygun.glb',
    klobber: '/assets/models/klobber.glb',
    ddskull: '/assets/models/ddskull.glb',
    kf7: '/assets/models/kf7.glb',
    golden: '/assets/models/golden.glb',
    armorvest: '/assets/models/armorvest.glb',
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
    mountViewmodel(currentWeaponId());
    decorateMapProps();
    refreshPadMeshes();
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
  buildPads();
  if (models.crate) decorateMapProps();
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

  // Floor pads: cream = weapon, blue = armor, blinking gold = Golden Skullgun
  if (offlineMode) {
    const t = Date.now();
    for (const pad of pads) {
      if (!pad.active) continue;
      g.fillStyle = pad.kind === 'armor' ? '#7fa8ff' : '#fff2b3';
      g.fillRect(cx + pad.x * scale - 3, cy + pad.z * scale - 3, 6, 6);
      // spawn ping — expanding ring for a beat after a pad appears
      const age = t - (pad.pingAt || 0);
      if (age >= 0 && age < 1600) {
        g.strokeStyle = `rgba(255, 242, 179, ${1 - age / 1600})`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(cx + pad.x * scale, cy + pad.z * scale, 4 + (age / 1600) * 14, 0, Math.PI * 2);
        g.stroke();
      }
    }
    if (goldPad && goldPad.spawned) {
      if (Math.floor(performance.now() / 280) % 2 === 0) {
        g.fillStyle = '#ffd700';
        g.fillRect(cx + goldPad.x * scale - 4, cy + goldPad.z * scale - 4, 8, 8);
      }
      const gage = t - (goldPad.pingAt || 0);
      if (gage >= 0 && gage < 2400) {
        g.strokeStyle = `rgba(255, 215, 0, ${1 - gage / 2400})`;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(cx + goldPad.x * scale, cy + goldPad.z * scale, 5 + (gage / 2400) * 20, 0, Math.PI * 2);
        g.stroke();
      }
    }
  } else {
    for (const p of netPickups) {
      if (!p.a) continue;
      g.fillStyle = p.w === 'gold' ? (Math.floor(performance.now() / 280) % 2 ? '#ffd700' : 'transparent') : p.w === 'armor' ? '#7fa8ff' : '#fff2b3';
      g.fillRect(cx + p.x * scale - 3, cy + p.z * scale - 3, 6, 6);
    }
  }

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
      g.fillStyle = BRAND.cream;
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5, 6);
      g.lineTo(0, 3);
      g.lineTo(-5, 6);
      g.closePath();
      g.fill();
      g.restore();
    } else {
      g.fillStyle = p.color || BRAND.red;
      g.beginPath();
      g.arc(px, pz, 3.5, 0, Math.PI * 2);
      g.fill();
    }
  }

  g.strokeStyle = BRAND.green;
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
    // Real-sample skins — unique bodies built from the NSES asset kit
    if (agent.id === 'mini' && models.mohawk) {
      // MINI MOHAWK: the mohawk gremlin head IS the agent
      const g = new THREE.Group();
      const head = popMats(standAndSize(models.mohawk, 1.35), 0.35);
      head.rotation.y = Math.PI; // face the same direction as the other agents
      head.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      g.add(head);
      g.scale.setScalar(agent.scale || 1);
      addIdentityKit(g, agent, 1.55 * (agent.scale || 1));
      g.userData.hoverBob = true;
      return g;
    }
    if (agent.id === 'drone' && models.badge) {
      // RAY DRONE: upright badge chassis hovering over its ring
      const g = new THREE.Group();
      const disk = popMats(standAndSize(models.badge, 1.05), 0.3);
      disk.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      disk.position.y = 0.92;
      g.add(disk);
      addIdentityKit(g, agent, 1.85 * (agent.scale || 1));
      g.scale.setScalar(agent.scale || 1);
      g.userData.hoverBob = true;
      return g;
    }

    const clone = models.agent.clone(true);
    clone.scale.multiplyScalar(agent.scale || 1);
    tintClone(clone, color);

    if (agent.id === 'daisy' && models.daisy) {
      // DAISY SKULL: real daisy crown, popped so it reads on any body color
      const crown = popMats(models.daisy.clone(true), 0.35);
      crown.scale.multiplyScalar(0.5);
      crown.position.set(0, 1.76, 0);
      crown.rotation.z = 0.12;
      clone.add(crown);
    }
    if (agent.id === 'boss' && models.bag) {
      // BOSS MARKER: daily delivery bag strapped to the back
      const bag = popMats(standAndSize(models.bag, 0.62), 0.22);
      bag.position.set(-0.12, 1.02, -0.46);
      bag.rotation.y = Math.PI;
      clone.add(bag);
    }
    if (agent.id === 'hazard' && models.hazard) {
      // AGENT HAZARD: warning-sign plate, wider than the body so it peeks out
      const plate = popMats(standAndSize(models.hazard, 1.15), 0.28);
      plate.position.set(0, 1.18, -0.5);
      plate.rotation.y = Math.PI;
      clone.add(plate);
    }
    addIdentityKit(clone, agent, 2.3 * (agent.scale || 1));
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
  addIdentityKit(g, agent, 2.3 * (agent.scale || 1));
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

  // --- The rest of the sample kit earns its keep: barrels as mid-ring cover,
  // checker walls as sightline breakers, pipes on industrial maps,
  // skateboards where the crew would leave them, tombstones where rival
  // agents got buried.
  if (models.barrel) {
    [
      [0.42, 30],
      [0.55, 120],
      [0.38, 250],
      [0.6, 315],
    ].forEach(([rr, deg]) => {
      const a = (deg * Math.PI) / 180;
      placeProp(models.barrel, Math.cos(a) * r * rr, Math.sin(a) * r * rr, { collide: 1.0 });
    });
  }
  if (models.checker) {
    [
      [0.32, 90],
      [0.5, 270],
    ].forEach(([rr, deg]) => {
      const a = (deg * Math.PI) / 180;
      placeProp(models.checker, Math.cos(a) * r * rr, Math.sin(a) * r * rr, {
        ry: deg * (Math.PI / 180),
        collide: 1.8,
      });
    });
  }
  if (models.pipes && (selectedMapId === 'facility' || selectedMapId === 'megacorp')) {
    [
      [-r * 0.72, 0, 0],
      [r * 0.72, 0, Math.PI],
      [0, -r * 0.78, Math.PI / 2],
    ].forEach(([x, z, ry]) => {
      placeProp(models.pipes, x, z, { ry, collide: 2.2 });
    });
  }
  if (models.skate && (selectedMapId === 'lunch' || selectedMapId === 'starbucks')) {
    [
      [-r * 0.25, r * 0.18, 0.6],
      [r * 0.3, -r * 0.12, 2.4],
      [r * 0.05, r * 0.42, 4.1],
    ].forEach(([x, z, ry]) => {
      placeProp(models.skate, x, z, { ry, scale: 1.6 });
    });
  }
  if (models.tomb && selectedMapId === 'stadium') {
    for (let i = 0; i < 6; i++) {
      const gx = -r * 0.78 + (i % 3) * 3.2;
      const gz = -r * 0.78 + Math.floor(i / 3) * 3.6;
      placeProp(models.tomb, gx, gz, { ry: ((i * 37) % 20 - 10) * (Math.PI / 180), collide: 0.5 });
    }
  }

  if (selectedMapId === 'stadium' && models.crate) {
    // Floodlight towers on the horizon — silhouette + glowing heads
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1f1a, roughness: 0.9 });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff2b3,
      emissive: 0xfff2b3,
      emissiveIntensity: 1.5,
    });
    for (const [x, z] of [[-52, -52], [52, -52], [-52, 52], [52, 52]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, 18, 6), poleMat);
      pole.position.set(x, 9, z);
      world.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.9, 0.9), lampMat);
      head.position.set(x, 18.6, z);
      head.lookAt(0, 12, 0);
      world.add(head);
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

const MODEL_FOR_GUN = { pp7: 'pp7', klobber: 'klobber', dd: 'ddskull', kf7: 'kf7', gold: 'golden' };

function buildPads() {
  pads = (PAD_SPOTS[selectedMapId] || []).map((s, i) => ({
    id: `${selectedMapId}-pad${i}`,
    x: s.x,
    z: s.z,
    w: s.w,
    kind: s.w === 'armor' ? 'armor' : 'gun',
    active: true,
    respawnAt: 0,
    mesh: null,
  }));
  const g = GOLD_SPOTS[selectedMapId] || [0, 0];
  goldPad = { x: g[0], z: g[1], spawned: false, active: false, respawnAt: 0, mesh: null };
  refreshPadMeshes();
}

function refreshPadMeshes() {
  const make = (kind, w) => {
    let src = null;
    let scale = 1;
    if (kind === 'armor') {
      src = models.armorvest;
      scale = 1.9;
    } else {
      src = models[MODEL_FOR_GUN[w]] || models.raygun;
      scale = 2.4;
    }
    if (!src) return null;
    const m = src.clone(true);
    m.scale.setScalar(scale);
    m.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    return m;
  };
  for (const pad of pads) {
    if (pad.mesh || !pad.active) continue;
    const mesh = make(pad.kind, pad.w);
    if (!mesh) continue;
    mesh.position.set(pad.x, 0.9, pad.z);
    mesh.userData.spin = true;
    mesh.userData.hoverBob = true;
    mesh.userData.baseY = 0.9;
    world.add(mesh);
    animatedProps.push(mesh);
    pad.mesh = mesh;
    // Tall beacon so pads are findable across the arena
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.13, 3.4, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: pad.kind === 'armor' ? 0x7fa8ff : 0xfff2b3,
        transparent: true,
        opacity: 0.38,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    beam.position.set(pad.x, 1.9, pad.z);
    world.add(beam);
    pad.beam = beam;
  }
  if (goldPad && !goldPad.mesh) {
    const mesh = make('gun', 'gold');
    if (mesh) {
      mesh.position.set(goldPad.x, 1.15, goldPad.z);
      mesh.userData.spin = true;
      mesh.userData.hoverBob = true;
      mesh.userData.baseY = 1.15;
      world.add(mesh);
      animatedProps.push(mesh);
      goldPad.mesh = mesh;
      mesh.visible = false;
    }
    const gbeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.16, 4.2, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd700,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    gbeam.position.set(goldPad.x, 2.3, goldPad.z);
    gbeam.visible = false;
    world.add(gbeam);
    goldPad.beam = gbeam;
  }
}

function resetPads(now = Date.now()) {
  matchStartedAt = now;
  for (const pad of pads) {
    pad.active = true;
    pad.respawnAt = 0;
    pad.pingAt = now;
    if (pad.mesh) pad.mesh.visible = true;
    if (pad.beam) pad.beam.visible = true;
  }
  if (goldPad) {
    goldPad.spawned = false;
    goldPad.active = false;
    goldPad.respawnAt = 0;
    if (goldPad.mesh) goldPad.mesh.visible = false;
    if (goldPad.beam) goldPad.beam.visible = false;
  }
}

function grantPickup(e, kind, w, now) {
  if (kind === 'armor') {
    if ((e.armor || 0) >= 95) return false;
    e.armor = 100;
  } else {
    if (w !== 'gold' && (GUN_RANK[w] ?? 0) <= (GUN_RANK[e.weapon] ?? 0)) return false;
    e.weapon = w;
    e.ammo = w === 'gold' ? GOLD_SHOTS : getWeapon(w).mag;
    e.reloadingUntil = 0;
    if (w === 'gold') showCenter(`${e.name} HAS THE GOLDEN SKULLGUN`, 1500);
  }
  if (e.id === myId) {
    if (kind !== 'armor') mountViewmodel(e.weapon);
    playPickup();
  }
  return true;
}

/** Offline pad sim: respawn timers, golden gun schedule, proximity grabs (bots included). */
function tickPads(now) {
  if (!offlineMode || !offlineMatch) return;
  for (const pad of pads) {
    if (!pad.active && now >= pad.respawnAt) {
      pad.active = true;
      pad.pingAt = now;
      if (pad.mesh) pad.mesh.visible = true;
      if (pad.beam) pad.beam.visible = true;
    }
  }
  if (goldPad) {
    if (!goldPad.spawned && now - matchStartedAt >= GOLD_LIVE_MS) {
      goldPad.spawned = true;
      goldPad.active = true;
      goldPad.pingAt = now;
      if (goldPad.mesh) goldPad.mesh.visible = true;
      if (goldPad.beam) goldPad.beam.visible = true;
      showCenter('THE GOLDEN SKULLGUN IS LIVE', 2000);
      playGoldSting();
    } else if (goldPad.spawned && !goldPad.active && now >= goldPad.respawnAt) {
      goldPad.active = true;
      goldPad.pingAt = now;
      if (goldPad.mesh) goldPad.mesh.visible = true;
      if (goldPad.beam) goldPad.beam.visible = true;
      showCenter('THE GOLDEN SKULLGUN RETURNS', 1600);
      playGoldSting();
    }
  }

  for (const e of offlineMatch.roster) {
    if (!e.alive) continue;
    for (const pad of pads) {
      if (!pad.active) continue;
      if (Math.hypot(e.x - pad.x, e.z - pad.z) > PAD_RADIUS) continue;
      if (grantPickup(e, pad.kind, pad.w, now)) {
        pad.active = false;
        pad.respawnAt = now + PAD_RESPAWN_MS;
        if (pad.mesh) pad.mesh.visible = false;
        if (pad.beam) pad.beam.visible = false;
      }
    }
    if (goldPad && goldPad.active && Math.hypot(e.x - goldPad.x, e.z - goldPad.z) <= PAD_RADIUS) {
      if (grantPickup(e, 'gun', 'gold', now)) {
        goldPad.active = false;
        goldPad.respawnAt = now + GOLD_RESPAWN_MS;
        if (goldPad.mesh) goldPad.mesh.visible = false;
        if (goldPad.beam) goldPad.beam.visible = false;
      }
    }
  }
}

/** Ray vs wall footprints (with height bands) — returns travel distance to first blocker. */
function castWalls(ox, oy, oz, dx, dy, dz, maxT) {
  let best = maxT;
  for (const w of WALLS) {
    let tmin = 0;
    let tmax = best;
    if (Math.abs(dx) < 1e-8) {
      if (ox < w.minX || ox > w.maxX) continue;
    } else {
      let t1 = (w.minX - ox) / dx;
      let t2 = (w.maxX - ox) / dx;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dz) < 1e-8) {
      if (oz < w.minZ || oz > w.maxZ) continue;
    } else {
      let t1 = (w.minZ - oz) / dz;
      let t2 = (w.maxZ - oz) / dz;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    const base = w.base != null ? w.base : 0;
    const top = w.top != null ? w.top : 99;
    const hy = oy + dy * Math.max(tmin, 0);
    if (hy >= base - 0.05 && hy <= top + 0.05 && tmin < best) {
      best = Math.max(tmin, 0);
    }
  }
  return best;
}

function startReload(e, now) {
  const W = getWeapon(e.weapon);
  if (W.mag < 0 || e.reloadingUntil || e.ammo === W.mag) return false;
  e.reloadingUntil = now + W.reloadMs;
  if (e.id === myId) playClick();
  return true;
}

function finishReloadIfDue(e, now) {
  if (e.reloadingUntil && now >= e.reloadingUntil) {
    e.reloadingUntil = 0;
    e.ammo = getWeapon(e.weapon).mag;
  }
}

function flashEntityById(id) {
  const mesh = remoteMeshes.get(id);
  if (!mesh) return;
  mesh.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.userData._origEm == null) {
        m.userData._origEm = m.emissive ? m.emissive.getHex() : 0;
        m.userData._origIn = m.emissiveIntensity != null ? m.emissiveIntensity : 1;
      }
      if (m.emissive) {
        m.emissive.setHex(0xff3020);
        m.emissiveIntensity = 0.9;
      }
    }
  });
  clearTimeout(mesh.userData._flashT);
  mesh.userData._flashT = setTimeout(() => {
    mesh.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.emissive && m.userData._origEm != null) {
          m.emissive.setHex(m.userData._origEm);
          m.emissiveIntensity = m.userData._origIn;
        }
      }
    });
  }, 90);
}

function spendGolden(e) {
  e.weapon = 'pp7';
  e.ammo = -1;
  e.reloadingUntil = 0;
  if (e.id === myId) {
    mountViewmodel('pp7');
    showCenter('GOLDEN SKULLGUN SPENT', 1300);
  } else {
    pushFeed(`${e.name} BURNED THE GOLD`);
  }
}

function rankTitle(kills) {
  if (kills >= 10) return '00 AGENT';
  if (kills >= 6) return 'SECRET AGENT';
  if (kills >= 3) return 'FIELD AGENT';
  return 'TRAINEE';
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

function showCenter(text, ms = 1600, big = false) {
  els.centerMsg.textContent = text;
  els.centerMsg.classList.toggle('big', !!big);
  els.centerMsg.classList.add('show');
  clearTimeout(showCenter._t);
  showCenter._t = setTimeout(() => els.centerMsg.classList.remove('show'), ms);
}

function showSkullPop(name) {
  if (!els.skullPop) return;
  els.skullPop.textContent = `☠ ${name}`;
  els.skullPop.classList.remove('show');
  void els.skullPop.offsetWidth; // restart animation
  els.skullPop.classList.add('show');
}

/** Red wedge around the crosshair pointing at whoever shot you. */
function showDmgDir(fromX, fromZ) {
  if (!els.dmgDir) return;
  const me = offlineMode && offlineMatch
    ? offlineMatch.roster.find((p) => p.id === myId)
    : players.get(myId);
  if (!me) return;
  const bearing = Math.atan2(fromX - me.x, -(fromZ - me.z));
  const rel = bearing - yaw;
  els.dmgDir.style.transform = `translate(-50%, -50%) rotate(${rel}rad)`;
  els.dmgDir.classList.add('show');
  clearTimeout(showDmgDir._t);
  showDmgDir._t = setTimeout(() => els.dmgDir.classList.remove('show'), 650);
}

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx?.state === 'suspended') audioCtx.resume();
}

function gunVoice(type, f0, f1, dur, gain = 0.12, delay = 0) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + delay;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur + 0.01);
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function playGun(kind) {
  ensureAudio();
  if (!audioCtx) return;
  switch (kind) {
    case 'magnum':
      gunVoice('sawtooth', 300, 55, 0.2, 0.17);
      gunVoice('square', 150, 40, 0.12, 0.08);
      break;
    case 'klobber':
      gunVoice('square', 700, 260, 0.06, 0.07);
      break;
    case 'rifle':
      gunVoice('sawtooth', 520, 140, 0.09, 0.11);
      break;
    case 'gold':
      gunVoice('triangle', 1400, 380, 0.34, 0.16);
      gunVoice('triangle', 2100, 600, 0.22, 0.07, 0.04);
      break;
    default:
      gunVoice('square', 880, 180, 0.09, 0.12);
  }
}

function playClick() {
  ensureAudio();
  gunVoice('square', 220, 120, 0.05, 0.06);
}

function playPickup() {
  ensureAudio();
  gunVoice('sine', 500, 950, 0.11, 0.1);
  gunVoice('sine', 750, 1400, 0.1, 0.07, 0.07);
}

function playGoldSting() {
  ensureAudio();
  gunVoice('triangle', 660, 660, 0.14, 0.1);
  gunVoice('triangle', 880, 880, 0.16, 0.1, 0.13);
  gunVoice('triangle', 1320, 1320, 0.3, 0.12, 0.27);
}

/** Kill/streak/death/win jingles — the fun layer. */
function playSting(kind) {
  ensureAudio();
  if (!audioCtx) return;
  if (kind === 'kill') {
    gunVoice('triangle', 520, 520, 0.09, 0.12);
    gunVoice('triangle', 780, 780, 0.15, 0.12, 0.09);
  } else if (kind === 'streak') {
    gunVoice('square', 523, 523, 0.08, 0.08);
    gunVoice('square', 659, 659, 0.08, 0.08, 0.08);
    gunVoice('square', 784, 784, 0.08, 0.08, 0.16);
    gunVoice('triangle', 1046, 1046, 0.24, 0.11, 0.24);
  } else if (kind === 'death') {
    gunVoice('sawtooth', 220, 40, 0.5, 0.13);
    gunVoice('square', 110, 30, 0.4, 0.07, 0.05);
  } else if (kind === 'win') {
    gunVoice('triangle', 523, 523, 0.12, 0.11);
    gunVoice('triangle', 659, 659, 0.12, 0.11, 0.12);
    gunVoice('triangle', 784, 784, 0.12, 0.11, 0.24);
    gunVoice('triangle', 1046, 1046, 0.4, 0.13, 0.36);
  }
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
    new THREE.MeshBasicMaterial({
      color: hitSomeone ? PALETTE.red : PALETTE.cream,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  spark.position.set(x, y, z);
  scene.add(spark);
  tracers.push({ mesh: spark, born: performance.now(), ttl: 130 });
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

function spawnTracer(origin, dir, dist = 48, color = 0x9dff9a) {
  const len = Math.max(0.5, dist);
  _aimEnd.copy(origin).addScaledVector(dir, len);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.018, len, 6),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  beam.position.copy(origin).addScaledVector(dir, len * 0.5);
  beam.quaternion.setFromUnitVectors(_yAxis, dir);
  scene.add(beam);
  tracers.push({ mesh: beam, born: performance.now(), ttl: 140 });
}

function updateTracers() {  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    const age = performance.now() - t.born;
    if (age >= t.ttl) {
      scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
      tracers.splice(i, 1);
    } else {
      t.mesh.material.opacity = 0.95 * (1 - age / t.ttl);
    }
  }
}

function spawnBolt(origin, dir, fromId, color = 0x6baf6e, size = 0.16) {
  while (bolts.length >= MAX_BOLTS) {
    const old = bolts.shift();
    scene.remove(old.mesh);
    old.mesh.geometry.dispose();
    old.mesh.material.dispose();
  }
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size, 8, 8),
    new THREE.MeshBasicMaterial({ color })
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
  if (els.armor) els.armor.style.width = `${Math.max(0, Math.min(100, me.armor || 0))}%`;

  const W = getWeapon(me.weapon);
  if (els.weapon) {
    const reloading =
      (me.rt != null && me.rt > 60) || (offlineMode && me.reloadingUntil > Date.now());
    els.weapon.textContent = reloading
      ? 'RELOADING…'
      : `${W.name} · ${W.mag < 0 ? '∞' : String(Math.max(0, me.ammo)).padStart(2, '0')}`;
    els.weapon.classList.toggle('gold', me.weapon === 'gold');
  }

  if (state.pickups) netPickups = state.pickups;

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
  const mine = standings.find((s) => s.id === myId);
  const rank = rankTitle(mine ? mine.kills : 0);
  els.standings.innerHTML =
    `<li class="rank">AGENT RATING — ${rank}</li>` +
    standings
      .map((s, i) => `<li>#${i + 1} ${s.name} — ${s.kills}K / ${s.deaths}D · ${s.tokens} TOK</li>`)
      .join('');
  if (els.overlayHint) {
    els.overlayHint.textContent =
      rank === '00 AGENT'
        ? 'RATING EARNED. M IS PLEASED.'
        : 'Next match arms in a few seconds…';
  }
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
    spawnShieldUntil: Date.now() + 1500,
    spawnIndex,
    bot,
    weapon: 'pp7',
    ammo: -1,
    reloadingUntil: 0,
    armor: 0,
    lastKillAt: 0,
    streak: 0,
  };
}

function pushFeed(text) {
  offlineMatch.killFeed.push({ t: Date.now(), text });
  if (offlineMatch.killFeed.length > 12) offlineMatch.killFeed.shift();
}

function resetOfflineMatch() {
  offlineMatch.endsAt = Date.now() + (offlineMatch.mode === 'l2t' ? 120000 : 180000);
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
      spawnShieldUntil: Date.now() + 1500,
      weapon: 'pp7',
      ammo: -1,
      reloadingUntil: 0,
      armor: 0,
      lastKillAt: 0,
      streak: 0,
    });
  }
  resetPads();
  if (offlineMode) mountViewmodel('pp7');
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
    // LIVE & LET DIE resolves fast — a long clock kills the tension
    endsAt: Date.now() + (selectedMode === 'l2t' ? 120000 : 180000),
    ended: false,
    mode: selectedMode,
  };
  if (selectedMode === 'l2t') {
    me.lives = 2;
    for (const b of bots) b.lives = 2;
  }
  matchStartedAt = Date.now();
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
  if (agentTag && offlineMatch.mode === 'l2t') {
    const me2 = offlineMatch.roster.find((p) => p.id === myId);
    if (me2) {
      const base = agentTag.textContent.replace(/(?: ☠)*$/, '');
      agentTag.textContent = base + ' ☠'.repeat(Math.max(0, me2.lives || 0));
    }
  }
  syncRemotes(offlineMatch.roster);
}

function dirFromYawPitch(yaw0, pitch0, out = new THREE.Vector3()) {
  // Match Three.js camera forward for YXZ euler (look down -Z at 0,0)
  const cp = Math.cos(pitch0);
  out.set(Math.sin(yaw0) * cp, -Math.sin(pitch0), -Math.cos(yaw0) * cp);
  return out.normalize();
}

function applyShot(shooter, now) {
  finishReloadIfDue(shooter, now);
  const W = getWeapon(shooter.weapon);
  if (!shooter.alive || shooter.reloadingUntil || now - shooter.lastShot < W.cd) return false;
  if (W.mag >= 0 && shooter.ammo <= 0) {
    startReload(shooter, now);
    return false;
  }
  shooter.lastShot = now;
  shooter.spawnShieldUntil = 0; // firing drops your spawn protection
  if (W.mag >= 0) shooter.ammo -= 1;

  let origin;
  let dir;
  if (shooter.id === myId) {
    // Local player: ALWAYS shoot where the camera looks
    const aim = getAimRay();
    origin = aim.origin;
    dir = aim.dir.clone();
    shooter.yaw = yaw;
    shooter.pitch = pitch;
  } else {
    origin = new THREE.Vector3(shooter.x, shooter.y, shooter.z);
    dir = dirFromYawPitch(shooter.yaw, shooter.pitch);
  }
  if (W.spread > 0) {
    // Bots lead with worse aim — cover should actually work
    const sp = W.spread * (shooter.bot ? 1.7 : 1);
    dir.x += (Math.random() - 0.5) * sp;
    dir.y += (Math.random() - 0.5) * sp * 0.6;
    dir.z += (Math.random() - 0.5) * sp;
    dir.normalize();
  }

  // Hip-fire magnetism — GE shipped with aim assist, mouse gets a soft cone
  if (shooter.id === myId) {
    const assist = adsBlend > 0.5 ? 0.18 : 0.5;
    let snap = null;
    let bestDot = Math.cos(0.085); // ~5 degree cone
    const to = new THREE.Vector3();
    for (const t of offlineMatch.roster) {
      if (t.id === myId || !t.alive) continue;
      if ((t.spawnShieldUntil || 0) > now) continue;
      to.set(t.x - origin.x, t.y - 0.25 - origin.y, t.z - origin.z);
      if (to.length() > W.range) continue;
      to.normalize();
      const d = to.dot(dir);
      if (d > bestDot) {
        bestDot = d;
        snap = to.clone();
      }
    }
    if (snap) dir.lerp(snap, assist).normalize();
  }

  const tWall = castWalls(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, W.range);
  spawnTracer(origin, dir, Math.min(tWall, W.range), W.tracer);
  spawnBolt(origin, dir, shooter.id, W.boltColor, W.boltSize);

  // Hitscan — walls clip the ray, bolt is VFX only
  let best = null;
  let bestT = Math.min(tWall, W.range);
  const tgt = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const hitR = adsBlend > 0.5 ? 1.15 : 1.45; // generous hips when not zoomed
  for (const target of offlineMatch.roster) {
    if (target.id === shooter.id || !target.alive) continue;
    // Spawn protection — freshly dropped agents can't be insta-plasted
    if ((target.spawnShieldUntil || 0) > now) continue;
    tgt.set(target.x, target.y, target.z);
    const t = closest.copy(tgt).sub(origin).dot(dir);
    if (t < 0.5 || t > bestT) continue;
    closest.copy(origin).addScaledVector(dir, t);
    if (closest.distanceTo(tgt) < hitR) {
      bestT = t;
      best = target;
    }
  }
  if (best) {
    // LIVE & LET DIE hits harder — fights have to bleed lives for the mode to resolve
    const dmgOut = W.dmg * (offlineMatch.mode === 'l2t' ? 1.3 : 1);
    const absorbed = W.oneShot ? 0 : Math.min(best.armor || 0, dmgOut * ARMOR_ABSORB);
    best.armor = Math.max(0, (best.armor || 0) - absorbed);
    best.hp -= dmgOut - absorbed;
    flashEntityById(best.id);
    spawnImpact(origin.x + dir.x * bestT, origin.y + dir.y * bestT, origin.z + dir.z * bestT, true);
    if (shooter.id === myId) {
      localHits++;
      els.hitMarker.classList.add('show');
      setTimeout(() => els.hitMarker.classList.remove('show'), 140);
    }
    if (best.hp <= 0) {
      best.hp = 0;
      best.alive = false;
      best.deaths += 1;
      best.lives = Math.max(0, best.lives - 1);
      // LIVE & LET DIE: no respawn once you're out of skulls
      if (offlineMatch.mode !== 'l2t' || best.lives > 0) {
        best.respawnAt = now + 3000;
      }
      shooter.kills += 1;
      shooter.tokens += 5;
      const combo = now - (shooter.lastKillAt || 0) < 4000 ? (shooter.streak || 1) + 1 : 1;
      shooter.lastKillAt = now;
      shooter.streak = combo;
      let text = `${shooter.name} ⚡ ${best.name}`;
      const tag = STREAK_TEXT[combo] || (combo >= 5 ? 'RAMPAGE' : '');
      if (tag) text += ` · ${tag}!`;
      pushFeed(text);
      if (shooter.id === myId) {
        playSting('kill');
        showSkullPop(best.name);
        if (tag) {
          showCenter(`${tag}!`, 1400, true);
          playSting('streak');
        } else {
          showCenter(text, 900);
        }
      } else {
        showCenter(text, 900);
      }
      if (best.id === myId) {
        playSting('death');
        if (els.damage) {
          els.damage.classList.add('show');
          setTimeout(() => els.damage.classList.remove('show'), 450);
        }
      }
    }
  } else if (tWall < W.range) {
    spawnImpact(
      origin.x + dir.x * tWall,
      origin.y + dir.y * tWall,
      origin.z + dir.z * tWall,
      false
    );
  }

  if (W.mag >= 0 && shooter.ammo <= 0) {
    if (shooter.weapon === 'gold') spendGolden(shooter);
    else startReload(shooter, now);
  }

  if (shooter.id === myId) {
    flashMuzzle();
    playGun(W.sound);
    pitch = THREE.MathUtils.clamp(pitch + W.recoil * (0.8 + Math.random() * 0.4), -1.4, 1.4);
    yaw += W.recoil * 0.35 * (Math.random() < 0.5 ? -1 : 1);
  }
  return true;
}

let bobPhase = 0;
let bobPrevX = null;
let bobPrevZ = null;
let bobOffset = 0;

// GoldenEye-style head bob driven by actual ground covered
function updateViewBob(x, z) {
  if (bobPrevX === null) {
    bobPrevX = x;
    bobPrevZ = z;
    bobOffset = 0;
    return 0;
  }
  const d = Math.hypot(x - bobPrevX, z - bobPrevZ);
  bobPrevX = x;
  bobPrevZ = z;
  let scale = 0;
  if (d > 0.0004 && d < 1.2) {
    bobPhase += d * 1.7;
    scale = Math.min(1, d * 60);
  }
  bobOffset = Math.sin(bobPhase) * 0.045 * scale;
  return bobOffset;
}

function pointBlocked(x, z, r = 0.42) {
  for (const w of WALLS) {
    const nx = Math.max(w.minX, Math.min(x, w.maxX));
    const nz = Math.max(w.minZ, Math.min(z, w.maxZ));
    const dx = x - nx;
    const dz = z - nz;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

function moveEntity(p, forward, strafe, sprint, wantJump, dt) {
  const mul = p.speedMul || 1;
  // GE agents: fast, grounded, strafe-running advantage — no jumping
  const speed = (sprint ? 13.5 : 9.6) * mul;
  let mx = strafe * 1.12;
  let mz = forward;
  const len = Math.hypot(mx, mz);
  if (!len) return;
  mx /= len;
  mz /= len;
  const cos = Math.cos(p.yaw);
  const sin = Math.sin(p.yaw);
  const dx = (mx * cos + mz * sin) * speed * dt;
  const dz = (-mx * sin + mz * cos) * speed * dt;
  // Swept axis-separated movement: slide along walls, can never cross them
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / 0.2));
  for (let i = 0; i < steps; i++) {
    const tx = p.x + dx / steps;
    if (!pointBlocked(tx, p.z)) p.x = tx;
    else p.x = Math.max(-HALF + 1.5, Math.min(HALF - 1.5, p.x));
    const tz = p.z + dz / steps;
    if (!pointBlocked(p.x, tz)) p.z = tz;
    else p.z = Math.max(-HALF + 1.5, Math.min(HALF - 1.5, p.z));
  }
}

function updateBots(dt, now) {
  for (const bot of offlineMatch.roster.filter((p) => p.bot)) {
    if (!bot.alive) continue;
    finishReloadIfDue(bot, now);
    // Target the nearest living agent — bots brawl each other too
    let target = null;
    let dist = Infinity;
    for (const t of offlineMatch.roster) {
      if (t.id === bot.id || !t.alive) continue;
      const d = Math.hypot(t.x - bot.x, t.z - bot.z);
      if (d < dist) {
        dist = d;
        target = t;
      }
    }
    if (!target) continue;
    dist = dist || 0.001;
    const dx = (target.x - bot.x) / dist;
    const dz = (target.z - bot.z) / dist;
    bot.yaw = Math.atan2(dx, -dz) + Math.sin(now * 0.0015 + bot.spawnIndex) * 0.15;
    bot.pitch = THREE.MathUtils.clamp((target.y - bot.y) * 0.02, -0.4, 0.4);

    // Line-of-sight gate — no more shooting through walls
    const losT = castWalls(bot.x, bot.y, bot.z, dx, 0, dz, dist);
    const visible = losT >= dist - 0.6 && Math.abs(target.y - bot.y) < 3;
    // Reaction memory: bots need sustained sight before they open fire
    if (visible) {
      if (!bot.sawAt) bot.sawAt = now;
    } else {
      bot.sawAt = 0;
    }
    const reacted = bot.sawAt && now - bot.sawAt > 450;

    const lowHp = bot.hp < bot.maxHp * 0.35;
    // Lost sight? Drop to a cautious prowl instead of swarming the last spot
    let forward = !visible ? 0.25 : lowHp ? 1 : -1;
    let strafe = Math.sin(now * 0.0018 + bot.spawnIndex * 2.1) * (visible ? 1 : 0.2);
    if (dist > 24) strafe *= 0.35;
    moveEntity(bot, forward, strafe, dist > 18 && !lowHp, false, dt);

    const W = getWeapon(bot.weapon);
    if (reacted && dist < W.range * 0.45) {
      const closeBonus = Math.max(0, 1 - dist / (W.range * 0.45));
      const rate = W.auto ? 0.8 + closeBonus * 0.9 : 0.5 + closeBonus * 0.5;
      if (Math.random() < rate * dt) applyShot(bot, now);
    }
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
    camera.position.set(me.x, me.y + updateViewBob(me.x, me.z), me.z);

    // Hold-to-auto-fire via cooldown inside firePrimary/applyShot
    if (keys.shootHeld) firePrimary();
  } else {
    keys.shootHeld = false;
  }

  updateBots(dt, now);
  tickPads(now);
  for (const p of offlineMatch.roster) finishReloadIfDue(p, now);

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
      // Spawn protection — breathe, find cover, then fight
      p.spawnShieldUntil = now + 1500;
      // GE rules: death strips specials back to the trusty PP7
      p.weapon = 'pp7';
      p.ammo = -1;
      p.reloadingUntil = 0;
      p.armor = 0;
      if (p.lives <= 0) p.lives = 3;
      if (p.id === myId) {
        mountViewmodel('pp7');
        yaw = p.yaw;
        pitch = 0;
        camera.position.set(p.x, p.y, p.z);
      }
    }
  }

  localAlive = me.alive;
  if (offlineMatch.mode === 'l2t' && !offlineMatch.ended) {
    const aliveCount = offlineMatch.roster.filter((p) => p.alive).length;
    const meOut = !me.alive && (me.lives || 0) <= 0;
    if (aliveCount <= 1 || meOut) {
      offlineMatch.ended = true;
      const winner = meOut ? null : offlineMatch.roster.find((p) => p.alive);
      if (winner && winner.id === myId) playSting('win');
      endMatch([...offlineMatch.roster].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths));
      return;
    }
  }
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
      matchStartedAt = Date.now();
      netPickups = [];
      netWeapon = 'pp7';
      netAmmo = -1;
      if (msg.mapId) loadSelectedMap(msg.mapId);
      else loadSelectedMap(selectedMapId);
      mountViewmodel('pp7');
      const mine = getAgent(selectedAgentId);
      if (agentTag) agentTag.textContent = `#${String(mine.slot).padStart(2, '0')} ${mine.name}`;
      beginMission(`${mine.name} — ${getMap(selectedMapId).name}`);
      return;
    }
    if (msg.type === 'state') {
      syncRemotes(msg.players);
      const me = msg.players.find((p) => p.id === myId);
      if (me) {
        const wid = me.weapon || 'pp7';
        if (wid !== netWeapon) {
          netWeapon = wid;
          netAmmo = me.ammo != null ? me.ammo : -1;
          mountViewmodel(wid);
        } else {
          netAmmo = me.ammo != null ? me.ammo : -1;
        }
      }
      if (me?.alive) camera.position.set(me.x, me.y + updateViewBob(me.x, me.z), me.z);
      updateHud(msg);
      return;
    }
    if (msg.type === 'shot') {
      if (msg.from !== myId) spawnTracer(msg.origin, msg.impact);
      else flashMuzzle();
      if (msg.hit) {
        flashEntityById(msg.hit);
        if (msg.from === myId) {
          els.hitMarker.classList.add('show');
          setTimeout(() => els.hitMarker.classList.remove('show'), 100);
        }
      }
      return;
    }
    if (msg.type === 'hit') {
      flashEntityById(msg.target);
      if (msg.target === myId) {
        const from = players.get(msg.by);
        if (from) showDmgDir(from.x, from.z);
        if (els.damage) {
          els.damage.classList.add('show');
          setTimeout(() => els.damage.classList.remove('show'), 350);
        }
      }
      return;
    }
    if (msg.type === 'pickup') {
      if (msg.kind === 'gold') showCenter(`${msg.name} HAS THE GOLDEN SKULLGUN`, 1500);
      else if (msg.by === myId) playPickup();
      return;
    }
    if (msg.type === 'goldlive') {
      showCenter('THE GOLDEN SKULLGUN IS LIVE', 2000);
      playGoldSting();
      return;
    }
    if (msg.type === 'kill') {
      if (msg.killer === myId) {
        playSting('kill');
        const v = players.get(msg.victim);
        showSkullPop(v ? v.name : 'TARGET');
      } else if (msg.victim === myId) {
        playSting('death');
      }
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
      click: shootPulse,
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
  const typed = (nameInput.value || '').trim();
  // Only a typed name persists — agent defaults never pollute storage
  const name = (typed || localStorage.getItem('skullbond-name') || mine.name).trim();
  if (typed) localStorage.setItem('skullbond-name', typed);
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

// Art dock tabs — flip through the actual pitch bible
document.querySelectorAll('.art-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.art-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const img = document.getElementById('artImg');
    if (img) img.src = `/assets/${btn.dataset.art}.png`;
  });
});

backBoot?.addEventListener('click', () => {
  selectScreen.classList.add('hidden');
  boot.classList.remove('hidden');
});

joinBtn.addEventListener('click', () => armJoin('net'));
  soloBtn.addEventListener('click', () => armJoin('solo'));
  const modeBtn = document.getElementById('modeBtn');
  if (modeBtn) {
    const modeLabel = () =>
      selectedMode === 'l2t' ? 'MODE: LIVE & LET DIE' : 'MODE: DEATHMATCH';
    modeBtn.textContent = modeLabel();
    modeBtn.addEventListener('click', () => {
      selectedMode = selectedMode === 'dm' ? 'l2t' : 'dm';
      localStorage.setItem('skullbond-mode', selectedMode);
      modeBtn.textContent = modeLabel();
      playClick();
    });
  }
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
    triggerFresh = true;
    firePrimary();
  }
  if (e.code === 'KeyR' && inMatch()) {
    tryPointerLock();
    if (offlineMode && offlineMatch) {
      const me = offlineMatch.roster.find((p) => p.id === myId);
      if (me?.alive) startReload(me, Date.now());
    } else if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'reload' }));
    }
  }
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
  const wid = currentWeaponId();
  const W = getWeapon(wid);
  const now = Date.now();
  if (!W.auto && !triggerFresh) return false;
  if (now - lastLocalShot < W.cd) return false;

  if (offlineMode && offlineMatch) {
    const me = offlineMatch.roster.find((p) => p.id === myId);
    if (!me?.alive) return false;
    finishReloadIfDue(me, now);
    triggerFresh = false;
    const fired = applyShot(me, now);
    if (fired) localShots++;
    return fired;
  }

  // Netplay: optimistic local VFX — server stays authoritative on damage/ammo
  triggerFresh = false;
  lastLocalShot = now;
  localShots++;
  const aim = getAimRay();
  const origin = aim.origin;
  let dir = aim.dir.clone();
  if (W.spread > 0) {
    dir.x += (Math.random() - 0.5) * W.spread;
    dir.y += (Math.random() - 0.5) * W.spread * 0.6;
    dir.z += (Math.random() - 0.5) * W.spread;
    dir.normalize();
  }
  const tWall = castWalls(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, W.range);
  spawnTracer(origin, dir, Math.min(tWall, W.range), W.tracer);
  spawnBolt(origin, dir.clone(), myId || 'local', W.boltColor, W.boltSize);
  flashMuzzle();
  playGun(W.sound);
  pitch = THREE.MathUtils.clamp(pitch + W.recoil * (0.8 + Math.random() * 0.4), -1.4, 1.4);
  yaw += W.recoil * 0.35 * (Math.random() < 0.5 ? -1 : 1);
  return true;
}

function onPrimaryDown(e) {
  if (!inMatch()) return;
  if (e.button === 2) {
    keys.ads = true;
    if (e.cancelable) e.preventDefault();
    return;
  }
  if (e.button !== 0 && e.pointerType !== 'touch') return;
  if (e.cancelable) e.preventDefault();
  ensureAudio();
  tryPointerLock();
  canvas.focus();
  keys.shootHeld = true;
  triggerFresh = true;
  firePrimary();
}

function onPrimaryUp(e) {
  if (e.button === 2) {
    keys.ads = false;
    return;
  }
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
  if (!pointerLocked) {
    keys.shootHeld = false;
    triggerFresh = false;
  }
});

addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) {
    pointerLocked = false;
    return;
  }
  pointerLocked = true;
  const sens = keys.ads ? 0.0013 : 0.0024;
  yaw -= e.movementX * sens;
  pitch -= e.movementY * sens;
  pitch = Math.max(-1.4, Math.min(1.4, pitch));
  // Two-way button sync from the OS state — self-heals swallowed pointerups
  // (one-way asserts here were latching the trigger ON forever)
  const held = !!(e.buttons & 1);
  if (held !== keys.shootHeld) {
    keys.shootHeld = held;
    if (held) triggerFresh = true;
  }
});

// Stuck-fire killswitches: losing focus or pointer lock always drops the trigger
addEventListener('blur', () => {
  keys.shootHeld = false;
  keys.ads = false;
  triggerFresh = false;
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

// ---- Headless smoke-test hooks (inert during normal play) ----
let localShots = 0;
let localHits = 0;
window.SKULL_DEBUG = {
  async startSolo(agentId, mapId) {
    if (agentId) selectedAgentId = agentId;
    if (mapId) selectedMapId = mapId;
    armJoin('solo');
    await new Promise((r) => setTimeout(r, 400));
    return true;
  },
  give(id) {
    const me =
      offlineMode && offlineMatch && offlineMatch.roster.find((p) => p.id === myId);
    if (!me) return false;
    me.weapon = id;
    const W = getWeapon(id);
    me.ammo = W.mag >= 0 ? W.mag : -1;
    me.reloadingUntil = 0;
    mountViewmodel(id);
    return true;
  },
  state() {
    return {
      shots: localShots,
      hits: localHits,
      shootHeld: keys.shootHeld,
      ads: keys.ads,
      locked: pointerLocked,
      fov: camera.fov,
      weapon: currentWeaponId(),
      offline: !!offlineMode,
      alive: localAlive,
    };
  },
  stats() {
    if (!offlineMode || !offlineMatch) return null;
    const me = offlineMatch.roster.find((p) => p.id === myId);
    return {
      mode: offlineMatch.mode || 'dm',
      ended: offlineMatch.ended,
      me: me
        ? {
            k: me.kills,
            d: me.deaths,
            hp: Math.round(me.hp),
            alive: me.alive,
            lives: me.lives,
            weapon: me.weapon,
            armor: me.armor || 0,
          }
        : null,
      bots: offlineMatch.roster
        .filter((p) => p.bot)
        .map((b) => ({ n: b.name, k: b.kills, d: b.deaths, alive: b.alive, x: b.x, z: b.z })),
      feed: offlineMatch.killFeed.slice(-6).map((f) => f.text),
    };
  },
  aimAt(x, z) {
    const me = offlineMode && offlineMatch && offlineMatch.roster.find((p) => p.id === myId);
    if (!me) return false;
    // Camera forward is (-sin yaw, -cos yaw) — solve for the bearing that
    // points it at (x, z)
    yaw = Math.atan2(-(x - me.x), -(z - me.z));
    pitch = 0;
    return true;
  },
  placeBot(i, x, z) {
    if (!offlineMode || !offlineMatch) return false;
    const bot = offlineMatch.roster.filter((p) => p.bot)[i];
    if (!bot) return false;
    bot.x = x;
    bot.z = z;
    bot.y = EYE;
    return true;
  },
  mePos() {
    const me = offlineMode && offlineMatch && offlineMatch.roster.find((p) => p.id === myId);
    return me ? { x: me.x, z: me.z, yaw } : null;
  },
  teleport(x, z) {
    const me = offlineMode && offlineMatch && offlineMatch.roster.find((p) => p.id === myId);
    if (!me) return false;
    me.x = x;
    me.z = z;
    return true;
  },
  debugPads() {
    if (!offlineMode || !offlineMatch) return null;
    return {
      startedAt: matchStartedAt,
      now: Date.now(),
      pads: pads.map((p) => ({ x: p.x, z: p.z, w: p.w, active: p.active, hasMesh: !!p.mesh })),
      gold: goldPad
        ? { x: goldPad.x, z: goldPad.z, spawned: goldPad.spawned, active: goldPad.active }
        : null,
    };
  },
  setMode(m) {
    selectedMode = m === 'l2t' ? 'l2t' : 'dm';
  },
  aim(dx, dy) {
    yaw -= dx * 0.0022;
    pitch = THREE.MathUtils.clamp(pitch - (dy || 0) * 0.0016, -1.2, 1.2);
  },
  resetShots() {
    localShots = 0;
    localHits = 0;
  },
  simulateUnlock() {
    Object.defineProperty(document, 'pointerLockElement', {
      value: null,
      configurable: true,
    });
    document.dispatchEvent(new Event('pointerlockchange'));
  },
  forceLock(v) {
    pointerLocked = v;
  },
  simulateLock() {
    Object.defineProperty(document, 'pointerLockElement', {
      value: document.querySelector('canvas'),
      configurable: true,
    });
    document.dispatchEvent(new Event('pointerlockchange'));
  },
  // Line up every agent in front of the camera for visual inspection
  async photoMode(mapId) {
    if (mapId && mapId !== selectedMapId) {
      selectedMapId = mapId;
      loadSelectedMap(mapId);
      await new Promise((r) => setTimeout(r, 300));
    }
    this.unPhoto();
    for (const [, m] of remoteMeshes) m.visible = false;
    this._photo = [];
    const ids = ['skullpepe', 'daisy', 'mini', 'boss', 'drone', 'hazard'];
    ids.forEach((id, i) => {
      const mesh = makeAgentMesh(getAgent(id));
      mesh.position.set((i - 2.5) * 2.4, 0, -5.5);
      scene.add(mesh);
      this._photo.push(mesh);
    });
    const me =
      offlineMode && offlineMatch && offlineMatch.roster.find((p) => p.id === myId);
    if (me) {
      me.x = 0;
      me.y = EYE;
      me.z = 0;
      me.yaw = 0;
      me.spawnShieldUntil = Number.MAX_SAFE_INTEGER;
      me.hp = me.maxHp;
      me.alive = true;
    }
    yaw = 0;
    pitch = 0;
    gunGroup.visible = false;
    camera.position.set(0, EYE + 0.1, 0);
    return true;
  },
  unPhoto() {
    if (this._photo) {
      for (const m of this._photo) scene.remove(m);
      this._photo = null;
    }
    for (const [, m] of remoteMeshes) m.visible = true;
    gunGroup.visible = true;
  },
  focusAgent(i) {
    if (!this._photo || !this._photo[i]) return false;
    const m = this._photo[i];
    const me =
      offlineMode && offlineMatch && offlineMatch.roster.find((p) => p.id === myId);
    if (me) {
      me.x = m.position.x;
      me.y = EYE;
      me.z = m.position.z + 2.1;
      me.yaw = 0;
    }
    yaw = 0;
    pitch = 0.06;
    const lookY = i === 2 ? 0.45 : 0.85;
    camera.position.set(m.position.x, 1.1, m.position.z + 2.1);
    camera.lookAt(m.position.x, lookY, m.position.z);
    return true;
  },
};

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

  // Right-click aim-down-sights: FOV zoom + gun centers up
  const adsTarget = keys.ads && pointerLocked ? 1 : 0;
  adsBlend += (adsTarget - adsBlend) * Math.min(1, dt * 10);
  const targetFov = 74 - adsBlend * 26;
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }
  if (crosshairEl) crosshairEl.classList.toggle('ads', adsBlend > 0.5);

  // Don't fight muzzle recoil every frame
  if (muzzleFlash.intensity < 0.1) {
    gunGroup.position.x =
      Math.sin(t * 2.2) * 0.008 * (1 - adsBlend) - 0.165 * adsBlend;
    gunGroup.position.y =
      Math.cos(t * 3.1) * 0.006 * (1 - adsBlend) +
      0.03 * adsBlend +
      bobOffset * 0.4;
    gunGroup.position.z = -0.07 * adsBlend;
    gunGroup.rotation.x = 0;
  }

  if (offlineMode) offlineTick(dt);
  else sendInput();
  updateBolts(dt);
  updateTracers();
  drawRadar();

  renderer.render(scene, camera);
}
tick();
setInterval(sendInput, 50);
