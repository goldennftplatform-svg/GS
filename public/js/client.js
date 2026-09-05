import * as THREE from 'three';
import { applyAgentSurfaces } from './agent-surfaces.js?v=20260904d';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Build-stamped imports — bump these versions so browsers drop stale modules
import { AGENTS, getAgent, statBar } from './roster.js?v=20260904f';
import { EYE_HEIGHT, MODEL_HEIGHT, HITBOX_VERSION, getBodyBox, getHeadBox, intersectBody, hitRegion, shotDamage } from './body-geometry.mjs?v=20260904f';
import { MAPS, getMap, buildMapById, bindThree, PAD_SPOTS, GOLD_SPOTS } from './maps.js?v=20260904d';
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
const EYE = EYE_HEIGHT;
const BOLT_SPEED = 70;
const BOLT_LIFE = 0.7;
const MAX_BOLTS = 10;
const PAD_RADIUS = 1.5;
const PAD_RESPAWN_MS = 22000;
const GOLD_LIVE_MS = 12000;
const GOLD_RESPAWN_MS = 30000;
const ARMOR_ABSORB = 0.55;
const GRENADE_SPEED = 28;
const GRENADE_GRAVITY = 22;
const GRENADE_FUSE_MS = 2400;
const GRENADE_RADIUS = 5;
const GRENADE_MAX = 4;
const GRENADE_PICKUP_AMT = 2;
const GRENADE_RESPAWN_MS = 18000;
const STREAK_TEXT = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'KILLING SPREE' };
/** @type {{ mesh: THREE.Mesh, vx:number, vy:number, vz:number, life:number, fromId:string }[]} */
const bolts = [];
const tracers = []; // fading ray beams — every shot paints a ray, RAY-gun identity
const goos = [];
const dmgNums = [];
/** @type {{ x:number, y:number, z:number, vx:number, vy:number, vz:number, fuseAt:number, ownerId:string, mesh:THREE.Object3D, bounced:boolean }[]} */
const liveGrenades = [];
let critBeatAt = 0;
let botsFrozen = false; // diagnostic freeze — bots stand still and take it
let matchSkipCountdown = false;
/** @type {THREE.Object3D[]} */
const animatedProps = [];
let audioCtx = null;
let lastLocalShot = 0;
let triggerFresh = false;
let adsBlend = 0;
let matchStartedAt = 0;
let remoteShotsSeen = 0;

/** Viewmodel mounting per weapon — guns authored muzzle-forward (-Z after glTF). */
const VIEWMODEL = {
  raygun: { model: 'raygun', pos: [0.22, -0.18, -0.38], scale: 0.42 },
  klobber: { model: 'klobber', pos: [0.24, -0.26, -0.44], scale: 1.05 },
  dd: { model: 'ddskull', pos: [0.22, -0.24, -0.42], scale: 1.2 },
  kf7: { model: 'kf7', pos: [0.2, -0.28, -0.48], scale: 1.25 },
  gold: { model: 'golden', pos: [0.22, -0.22, -0.4], scale: 1.25 },
};

let netWeapon = 'raygun';
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
const spectateBtn = document.getElementById('spectateBtn');
const sessionControls = document.getElementById('sessionControls');
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
  nadeCount: document.getElementById('nadeCount'),
  nadeNum: document.getElementById('nadeNum'),
  radar: document.getElementById('radar'),
  mapTag: document.getElementById('mapTag'),
  interactPrompt: document.getElementById('interactPrompt'),
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
let spectatorMode = false;
let sessionId = 0;
let cancelConnect = null;
let endMatchTimer = 0;
const countdownTimers = [];

/** Solid XZ boxes for collision (axis-aligned). */
const WALLS = [];
const PILLARS = [];
const MAP_OBJECTS = { hazards: [], teleporters: [], switches: [] };
const mapRuntime = { disabledUntil: 0, netState: null };

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
let modelRevision = 0;
let lastStateAt = 0;
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
    return me ? me.weapon : 'raygun';
  }
  return netWeapon;
}

function mountViewmodel(weaponId = 'raygun') {
  while (gunGroup.children.length) gunGroup.remove(gunGroup.children[0]);
  const cfg = VIEWMODEL[weaponId] || VIEWMODEL.raygun;
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
  // Frontmost authored muzzle mesh, measured in gunGroup space before ADS/recoil.
  gunGroup.updateWorldMatrix(true, true);
  const localBounds = new THREE.Box3();
  const vertices = [];
  gunGroup.traverse(o => {
    if (!o.isMesh) return;
    const matrix = new THREE.Matrix4().copy(gunGroup.matrixWorld).invert().multiply(o.matrixWorld);
    const positions = o.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix);
      vertices.push(v);
      localBounds.expandByPoint(v);
    }
  });
  const front = new THREE.Box3();
  for (const v of vertices) if (v.z <= localBounds.min.z + 1e-5) front.expandByPoint(v);
  front.getCenter(muzzleFlash.position);
  muzzleFlash.color = new THREE.Color(weaponId === 'gold' ? 0xffd700 : PALETTE.green);
  gunGroup.add(muzzleFlash);
}

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
    const heights = { agent: MODEL_HEIGHT, crate: 1.1, server: 3.4, hazard: 2.2,
      bag: 1, heart: 0.7, daisy: 1.15, badge: 1, skate: 0.35, barrel: 1.35,
      tomb: 1.6, checker: 1.8, pipes: 2.4, mohawk: 1.4 };
    const results = await Promise.allSettled(Object.entries(urls).map(async ([key, url]) => {
      const root = await loadModel(url);
      if (heights[key]) groundNormalize(root, heights[key]);
      if (key === 'agent') root.traverse(o => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      if (['agent', 'badge', 'mohawk'].includes(key)) {
        models[key] = root;
        modelRevision++;
        syncRemotes(offlineMatch ? offlineMatch.roster : [...players.values()]);
      }
      return [key, root];
    }));
    // Publish props together: decorating with a partial set changes subsequent
    // collision-based placement and can give two clients different cover.
    results.forEach(r => {
      if (r.status === 'fulfilled') models[r.value[0]] = r.value[1];
      else console.warn('Asset load failed', r.reason);
    });
    mountViewmodel(currentWeaponId());
    decorateMapProps();
    refreshPadMeshes();
    if (bootStatus) bootStatus.textContent = results.some(r => r.status === 'rejected')
      ? 'PARTIAL ASSETS - STILL PLAYABLE' : 'ASSETS LOCKED - READY';
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
  MAP_OBJECTS.hazards.length = 0;
  MAP_OBJECTS.teleporters.length = 0;
  MAP_OBJECTS.switches.length = 0;
  mapRuntime.disabledUntil = 0;
  mapRuntime.netState = null;
}

function loadSelectedMap(mapId = selectedMapId) {
  bindThree(THREE);
  selectedMapId = mapId;
  clearWorld();
  const map = buildMapById(mapId, {
    scene,
    world,
    WALLS,
    mapObjects: MAP_OBJECTS,
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

function facilityMode(now) {
  if (selectedMapId !== 'facility') return 0;
  if (!offlineMode && mapRuntime.netState) return mapRuntime.netState.mode || 0;
  if (now < mapRuntime.disabledUntil) return 0;
  const phase = Math.max(0, now - matchStartedAt) % 12000;
  if (phase >= 8000) return 2;
  if (phase >= 6000) return 1;
  return 0;
}

function eliminateByReactor(p, now) {
  p.hp = 0;
  p.alive = false;
  p.deaths += 1;
  p.lives = Math.max(0, p.lives - 1);
  if (offlineMatch.mode !== 'l2t' || p.lives > 0) p.respawnAt = now + 3000;
  pushFeed(`REACTOR COOKED ${p.name}`, '#6baf6e');
  if (p.id === myId) {
    playSting('death');
    showCenter('REACTOR CRITICAL', 1200, true);
  }
}

function nearestMapSwitch() {
  const me = offlineMode && offlineMatch
    ? offlineMatch.roster.find((p) => p.id === myId)
    : players.get(myId);
  if (!me?.alive || selectedMapId !== 'facility') return null;
  let nearest = null;
  let distance = 3.2;
  for (const panel of MAP_OBJECTS.switches) {
    const d = Math.hypot(me.x - panel.x, me.z - panel.z);
    if (d < distance) {
      nearest = panel;
      distance = d;
    }
  }
  return nearest;
}

function updateMapGameplay(dt, now) {
  const pulse = 0.65 + Math.sin(now * 0.012) * 0.35;
  for (const shortcut of MAP_OBJECTS.teleporters) {
    shortcut.mesh.rotation.z += dt * 1.7;
    shortcut.material.emissiveIntensity = 1.1 + pulse * 0.8;
  }
  if (offlineMode && offlineMatch) {
    for (const p of offlineMatch.roster) {
      if (!p.alive) continue;
      for (const shortcut of MAP_OBJECTS.teleporters) {
        if (now < (p.mapTeleportReadyAt || 0)) continue;
        if (Math.hypot(p.x - shortcut.x, p.z - shortcut.z) > 1.55) continue;
        p.x = shortcut.toX;
        p.z = shortcut.toZ;
        p.mapTeleportReadyAt = now + 1400;
        if (p.id === myId) showCenter('SHORTCUT LINK', 650);
        break;
      }
    }
  }
  if (selectedMapId !== 'facility') {
    els.interactPrompt?.classList.remove('show');
    return;
  }
  const mode = facilityMode(now);

  for (const hazard of MAP_OBJECTS.hazards) {
    hazard.material.color.setHex(mode === 2 ? 0xe5392d : mode === 1 ? 0xb56a4d : 0x294529);
    hazard.material.emissive.setHex(mode === 2 ? 0xe5392d : mode === 1 ? 0xffa43a : 0x2e6e3e);
    hazard.material.emissiveIntensity = mode === 2 ? 1.4 + pulse : mode === 1 ? 0.8 + pulse * 0.4 : 0.3;
    hazard.mesh.rotation.y += dt * (mode === 2 ? 1.8 : 0.35);
  }
  const disabled = mode === 0 && (
    (offlineMode && now < mapRuntime.disabledUntil) ||
    (!offlineMode && (mapRuntime.netState?.disabledFor || 0) > 0)
  );
  for (const panel of MAP_OBJECTS.switches) {
    panel.material.emissive.setHex(disabled ? 0xffa43a : 0x6baf6e);
    panel.material.emissiveIntensity = disabled ? 1.2 : 0.35 + pulse * 0.2;
  }

  const nearbyPanel = nearestMapSwitch();
  if (els.interactPrompt) {
    els.interactPrompt.textContent = nearbyPanel ? '[E] SUPPRESS REACTOR' : '';
    els.interactPrompt.classList.toggle('show', !!nearbyPanel);
  }

  if (!offlineMode || !offlineMatch) return;
  for (const p of offlineMatch.roster) {
    if (!p.alive) continue;
    if (mode !== 2 || now < (p.mapHazardTickAt || 0)) continue;
    const hazard = MAP_OBJECTS.hazards[0];
    if (!hazard || Math.hypot(p.x - hazard.x, p.z - hazard.z) > hazard.radius) continue;
    if ((p.spawnShieldUntil || 0) > now) continue;
    p.mapHazardTickAt = now + 500;
    p.hp -= 14;
    if (p.id === myId) showCenter('REACTOR BURN', 350);
    if (p.hp <= 0) eliminateByReactor(p, now);
  }
}

function useMapControl() {
  const panel = nearestMapSwitch();
  if (!panel) return false;
  if (offlineMode) {
    mapRuntime.disabledUntil = Math.max(mapRuntime.disabledUntil, Date.now() + 12000);
    showCenter('REACTOR SUPPRESSED - 12 SEC', 1300);
    playPickup();
  } else if (ws?.readyState === 1) {
    ws.send(JSON.stringify({ type: 'use' }));
  }
  return true;
}

function drawRadar() {
  const c = els.radar;
  if (!c || !inMatch()) return;
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

function makeAgentMesh(agentOrColor, useModels = true) {
  const agent =
    typeof agentOrColor === 'string' || typeof agentOrColor === 'number'
      ? { color: agentOrColor, tint: agentOrColor, scale: 1, hover: false, id: 'skullpepe' }
      : agentOrColor || getAgent('skullpepe');
  const color = agent.color || agent.tint || '#6BAF6E';

  if (useModels && (agent.id === 'drone' ? models.badge : models.agent)) {
    // Real-sample skins — unique bodies built from the NSES asset kit
    if (agent.id === 'drone' && models.badge) {
      // Keep the approved hovering badge chassis.
      const g = new THREE.Group();
      const disk = new THREE.Group();
      disk.add(applyAgentSurfaces(standAndSize(models.badge, 1.05), agent.id));
      disk.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      disk.position.y = 0.92;
      g.add(disk);
      g.scale.setScalar(agent.scale || 1);
      return g;
    }

    // Gameplay placement/scaling must not overwrite the normalized asset root.
    const clone = new THREE.Group();
    clone.add(models.agent.clone(true));
    clone.userData.fullBody = true;
    clone.scale.setScalar(agent.scale || 1);
    if (agent.id === 'mini' && models.mohawk) {
      // The prop contains an entire second head. Keep only its authored spikes,
      // and fit them to the normalized scalp before applying gameplay scale.
      const spikes = new THREE.Group();
      const source = models.mohawk.clone(true);
      const remove = [];
      source.traverse(o => { if (o.isMesh && !/^SB_Spike/.test(o.name)) remove.push(o); });
      remove.forEach(o => o.removeFromParent());
      spikes.add(source);
      // The exported spike row runs along X, while the scalp faces along Z.
      spikes.rotation.y = Math.PI / 2;
      models.agent.updateMatrixWorld(true);
      const scalp = models.agent.getObjectByName('PepeScalp');
      if (scalp) {
        const headBox = new THREE.Box3().setFromObject(scalp);
        const spikeBox = new THREE.Box3().setFromObject(spikes);
        const headSize = headBox.getSize(new THREE.Vector3());
        const spikeSize = spikeBox.getSize(new THREE.Vector3());
        spikes.scale.setScalar(Math.min(
          headSize.z * 0.8 / Math.max(spikeSize.z, 0.001),
          headSize.y * 0.5 / Math.max(spikeSize.y, 0.001)
        ));
        spikeBox.setFromObject(spikes);
        const headCenter = headBox.getCenter(new THREE.Vector3());
        const spikeCenter = spikeBox.getCenter(new THREE.Vector3());
        spikes.position.set(headCenter.x - spikeCenter.x, headBox.max.y - spikeBox.min.y - 0.02, headCenter.z - spikeCenter.z);
        clone.add(spikes);
      }
    }
    // Flowers and delivery bag already exist in the approved body asset.
    applyAgentSurfaces(clone, agent.id);
    return clone;
  }

  const g = new THREE.Group();
  g.userData.fullBody = true;
  g.userData.fallback = true;
  const body = getBodyBox(agent.id);
  const headBox = getHeadBox(agent.id);
  const width = body.max[0] - body.min[0];
  const height = headBox.min[1] - body.min[1];
  const depth = body.max[2] - body.min[2];
  const cx = (body.min[0] + body.max[0]) / 2;
  const cz = (body.min[2] + body.max[2]) / 2;
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(width * 0.8, height, depth * 0.8), bodyMat);
  torso.position.set(cx, body.min[1] + height / 2, cz);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(...headBox.max.map((v, i) => v - headBox.min[i])),
    new THREE.MeshStandardMaterial({ color: PALETTE.cream })
  );
  head.position.fromArray(headBox.min.map((v, i) => (v + headBox.max[i]) / 2));
  g.add(torso, head);
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
  // Props must never bury a pickup, a spawn, or each other — and anything
  // with collision needs serious distance from spawns so players never eat
  // their own bullets on invisible cover at the arena exits.
  const spotClear = (x, z, pad = 3.0, spawnDist = 0) => {
    for (const p of pads) {
      if (Math.hypot(p.x - x, p.z - z) < pad) return false;
    }
    if (goldPad && Math.hypot(goldPad.x - x, goldPad.z - z) < pad + 1.5) return false;
    for (const s of SPAWNS) {
      if (Math.hypot(s.x - x, s.z - z) < Math.max(pad + 1.5, spawnDist)) return false;
    }
    for (const w of WALLS) {
      if (x > w.minX - 0.9 && x < w.maxX + 0.9 && z > w.minZ - 0.9 && z < w.maxZ + 0.9) return false;
    }
    return true;
  };
  const takeClear = (candidates, count, pad, spawnDist) => {
    const out = [];
    for (const [x, z] of candidates) {
      if (out.length >= count) break;
      if (spotClear(x, z, pad, spawnDist)) out.push([x, z]);
    }
    return out;
  };
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
    if (!spotClear(x, z, 2.8, 11)) return;
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
    const cands = [];
    for (let i = 0; i < 10; i++) {
      const a = ((i * 36 + 12) * Math.PI) / 180;
      const rr = r * (0.38 + (i % 3) * 0.09);
      cands.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    for (const [x, z] of takeClear(cands, 4, 2.6, 10)) {
      placeProp(models.barrel, x, z, { collide: 1.0 });
    }
  }
  if (models.checker) {
    const cands = [];
    for (let i = 0; i < 6; i++) {
      const a = ((i * 60 + 90) * Math.PI) / 180;
      const rr = r * (0.32 + (i % 2) * 0.16);
      cands.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    for (const [x, z] of takeClear(cands, 2, 3.2, 11)) {
      placeProp(models.checker, x, z, {
        ry: Math.atan2(-z, -x),
        collide: 1.8,
      });
    }
  }
  if (models.pipes && (selectedMapId === 'facility' || selectedMapId === 'megacorp')) {
    [
      [-r * 0.72, 0, 0],
      [r * 0.72, 0, Math.PI],
      [0, -r * 0.78, Math.PI / 2],
    ].forEach(([x, z, ry]) => {
      if (spotClear(x, z, 3.4, 9)) placeProp(models.pipes, x, z, { ry, collide: 2.2 });
    });
  }
  if (models.skate && (selectedMapId === 'lunch' || selectedMapId === 'starbucks')) {
    [
      [-r * 0.25, r * 0.18, 0.6],
      [r * 0.3, -r * 0.12, 2.4],
      [r * 0.05, r * 0.42, 4.1],
    ].forEach(([x, z, ry]) => {
      if (spotClear(x, z, 2.2)) placeProp(models.skate, x, z, { ry, scale: 1.6 });
    });
  }
  if (models.tomb && selectedMapId === 'stadium') {
    for (let i = 0; i < 8; i++) {
      const gx = -r * 0.82 + (i % 4) * 3.4;
      const gz = -r * 0.82 + Math.floor(i / 4) * 3.8;
      if (!spotClear(gx, gz, 2.4, 8)) continue;
      placeProp(models.tomb, gx, gz, { ry: (((i * 37) % 20) - 10) * (Math.PI / 180), collide: 0.5 });
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
      if (spotClear(x, z, 3.4, 9)) placeProp(models.hazard, x, z, { collide: 0.55 });
    }
  }
}

const MODEL_FOR_GUN = { raygun: 'raygun', klobber: 'klobber', dd: 'ddskull', kf7: 'kf7', gold: 'golden' };

function buildPads() {
  pads = (PAD_SPOTS[selectedMapId] || []).map((s, i) => ({
    id: `${selectedMapId}-pad${i}`,
    x: s.x,
    z: s.z,
    w: s.w,
    kind: s.w === 'armor' ? 'armor' : s.w === 'nade' ? 'nade' : 'gun',
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
    } else if (kind === 'nade') {
      src = makeGrenadeMesh();
      if (src) src.scale.setScalar(2.2);
      return src;
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
    const beaconColor = pad.kind === 'nade' ? 0xff4444 : pad.kind === 'armor' ? 0x7fa8ff : 0xfff2b3;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.13, 3.4, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: beaconColor,
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
  } else if (kind === 'nade') {
    if ((e.grenades || 0) >= GRENADE_MAX) return false;
    e.grenades = Math.min(GRENADE_MAX, (e.grenades || 0) + GRENADE_PICKUP_AMT);
  } else {
    if (w !== 'gold' && (GUN_RANK[w] ?? 0) <= (GUN_RANK[e.weapon] ?? 0)) return false;
    e.weapon = w;
    e.ammo = w === 'gold' ? GOLD_SHOTS : getWeapon(w).mag;
    e.reloadingUntil = 0;
    if (w === 'gold') showCenter(`${e.name} HAS THE GOLDEN SKULLGUN`, 1500);
  }
  if (e.id === myId) {
    if (kind === 'nade') showCenter(`+${GRENADE_PICKUP_AMT} HE GRENADES`, 800);
    else if (kind !== 'armor') mountViewmodel(e.weapon);
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
        pad.respawnAt = now + (pad.kind === 'nade' ? GRENADE_RESPAWN_MS : PAD_RESPAWN_MS);
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
    let near = 0, far = best;
    const origin = [ox, oy, oz], dir = [dx, dy, dz];
    const min = [w.minX, w.base ?? 0, w.minZ], max = [w.maxX, w.top ?? 99, w.maxZ];
    for (let axis = 0; axis < 3; axis++) {
      if (Math.abs(dir[axis]) < 1e-12) {
        if (origin[axis] < min[axis] || origin[axis] > max[axis]) { far = -1; break; }
      } else {
        let a = (min[axis] - origin[axis]) / dir[axis];
        let b = (max[axis] - origin[axis]) / dir[axis];
        if (a > b) [a, b] = [b, a];
        near = Math.max(near, a);
        far = Math.min(far, b);
        if (near > far) break;
      }
    }
    if (near <= far && near < best) best = near;
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

// ---- HE GRENADE SYSTEM ----
function makeGrenadeMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.14, 0.36, 10),
    new THREE.MeshStandardMaterial({ color: 0x3a5a32, roughness: 0.6, metalness: 0.3 })
  );
  g.add(body);
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 0.08, 10),
    new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.3, metalness: 0.7 })
  );
  top.position.y = 0.22;
  g.add(top);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.05, 0.012, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 })
  );
  ring.position.set(0.08, 0.22, 0);
  ring.rotation.z = -0.4;
  g.add(ring);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function throwGrenade(e) {
  if (!e.alive || (e.grenades || 0) <= 0) return;
  e.grenades--;
  const dir = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
  const mesh = makeGrenadeMesh();
  mesh.position.set(e.x, e.y + 1.4, e.z);
  scene.add(mesh);
  liveGrenades.push({
    x: e.x, y: e.y + 1.4, z: e.z,
    vx: dir.x * GRENADE_SPEED,
    vy: GRENADE_SPEED * 0.45,
    vz: dir.z * GRENADE_SPEED,
    fuseAt: Date.now() + GRENADE_FUSE_MS,
    ownerId: e.id,
    mesh,
    bounced: false,
  });
  if (e.id === myId) {
    ensureAudio();
    gunVoice('square', 1800, 800, 0.15, 0.12);
    showCenter('FRAG OUT', 600);
  }
}

function explodeGrenade(g, now) {
  const ex = g.x, ey = g.y, ez = g.z;
  if (g.mesh) scene.remove(g.mesh);

  // Explosion VFX — flash + debris ring
  const flash = new THREE.PointLight(0xff6622, 6, GRENADE_RADIUS * 2.5);
  flash.position.set(ex, ey, ez);
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 180);

  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2;
    const spd = 3 + Math.random() * 5;
    const debris = new THREE.Mesh(
      new THREE.BoxGeometry(0.08 + Math.random() * 0.12, 0.06 + Math.random() * 0.1, 0.06 + Math.random() * 0.1),
      new THREE.MeshStandardMaterial({ color: Math.random() > 0.5 ? 0xff6622 : 0xcc4400, emissive: 0xff4400, emissiveIntensity: 0.8 })
    );
    debris.position.set(ex, ey, ez);
    scene.add(debris);
    goos.push({
      mesh: debris,
      vx: Math.cos(angle) * spd,
      vy: 2 + Math.random() * 4,
      vz: Math.sin(angle) * spd,
      life: 0.4 + Math.random() * 0.3,
    });
  }

  // Screen shake for the player
  if (offlineMode && offlineMatch) {
    const me = offlineMatch.roster.find((p) => p.id === myId);
    if (me) {
      const dist = Math.hypot(me.x - ex, me.z - ez);
      if (dist < GRENADE_RADIUS * 2) {
        yaw += (Math.random() - 0.5) * 0.15 * Math.max(0, 1 - dist / GRENADE_RADIUS);
        pitch += (Math.random() - 0.5) * 0.08 * Math.max(0, 1 - dist / GRENADE_RADIUS);
      }
    }
  }

  // AOE damage
  if (offlineMode && offlineMatch) {
    for (const p of offlineMatch.roster) {
      if (!p.alive) continue;
      const dist = Math.hypot(p.x - ex, p.z - ez);
      if (dist > GRENADE_RADIUS) continue;
      const falloff = 1 - (dist / GRENADE_RADIUS);
      const dmg = Math.round(80 * falloff + 20);
      applyShot(p, dmg, g.ownerId, now);
      if (g.ownerId === myId) spawnDmgNum(p.x, p.y + 2, p.z, dmg);
    }
  }

  ensureAudio();
  gunVoice('sawtooth', 80, 25, 0.5, 0.4);
  setTimeout(() => gunVoice('square', 45, 20, 0.35, 0.35), 50);
}

function updateGrenades(dt, now) {
  for (let i = liveGrenades.length - 1; i >= 0; i--) {
    const g = liveGrenades[i];
    // Fuse expired
    if (now >= g.fuseAt) {
      explodeGrenade(g, now);
      liveGrenades.splice(i, 1);
      continue;
    }
    // Gravity
    g.vy -= GRENADE_GRAVITY * dt;
    const nx = g.x + g.vx * dt;
    const ny = g.y + g.vy * dt;
    const nz = g.z + g.vz * dt;

    // Wall bounce via castWalls
    const dx = nx - g.x, dy = ny - g.y, dz = nz - g.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 0.01) {
      const tWall = castWalls(g.x, g.y, g.z, dx / dist, dy / dist, dz / dist, dist + 0.1);
      if (tWall < dist + 0.05) {
        // Bounce — reflect velocity off wall normal (approximate)
        const hitX = g.x + (dx / dist) * tWall;
        const hitZ = g.z + (dz / dist) * tWall;
        let nx2 = 0, nz2 = 0;
        let bestDot = -1;
        for (const w of WALLS) {
          const cx = Math.max(w.minX, Math.min(hitX, w.maxX));
          const cz = Math.max(w.minZ, Math.min(hitZ, w.maxZ));
          const ddx = hitX - cx, ddz = hitZ - cz;
          const d = Math.hypot(ddx, ddz);
          if (d < 0.5) {
            if (d < 0.01) { nx2 = 1; break; }
            const dot = (dx * ddx + dz * ddz) / (dist * d);
            if (dot < bestDot) { bestDot = dot; nx2 = ddx / d; nz2 = ddz / d; }
          }
        }
        if (nx2 !== 0 || nz2 !== 0) {
          const dotVN = g.vx * nx2 + g.vz * nz2;
          g.vx -= 2 * dotVN * nx2 * 0.6;
          g.vz -= 2 * dotVN * nz2 * 0.6;
        }
        g.x = hitX; g.z = hitZ;
        g.vy = Math.abs(g.vy) * 0.5;
        g.bounced = true;
      } else {
        g.x = nx; g.z = nz;
      }
    }

    // Ground bounce
    if (ny <= 0) {
      g.y = 0;
      g.vy = Math.abs(g.vy) * 0.4;
      g.vx *= 0.75;
      g.vz *= 0.75;
      g.bounced = true;
    } else {
      g.y = ny;
    }

    // Sync mesh
    if (g.mesh) {
      g.mesh.position.set(g.x, g.y, g.z);
      g.mesh.rotation.x += dt * 4;
      g.mesh.rotation.z += dt * 3;
    }
  }
}


function flashEntityById(id) {
  const mesh = remoteMeshes.get(id);
  // Repeated hits must not hold the entire character in an emissive silhouette.
  if (!mesh || mesh.userData._flashT) return;
  const originals = new Map();
  mesh.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m.emissive && !originals.has(m)) {
        originals.set(m, { color: m.emissive.clone(), intensity: m.emissiveIntensity });
        m.emissive.setHex(0xff3020);
        m.emissiveIntensity = 0.35;
      }
    }
  });
  mesh.userData._flashT = setTimeout(() => {
    for (const [material, original] of originals) {
      material.emissive.copy(original.color);
      material.emissiveIntensity = original.intensity;
    }
    mesh.userData._flashT = null;
  }, 90);
}

function spendGolden(e) {
  e.weapon = 'raygun';
  e.ammo = -1;
  e.reloadingUntil = 0;
  if (e.id === myId) {
    mountViewmodel('raygun');
    showCenter('GOLDEN SKULLGUN SPENT', 1300);
  } else {
    pushFeed(`${e.name} BURNED THE GOLD`, '#ffd700');
  }
}

function rankTitle(kills) {
  if (kills >= 10) return '00 AGENT';
  if (kills >= 6) return 'SECRET AGENT';
  if (kills >= 3) return 'FIELD AGENT';
  return 'TRAINEE';
}

function makePlayerTag(name, color) {
  const tag = document.createElement('canvas');
  tag.width = 512;
  tag.height = 96;
  const ctx = tag.getContext('2d');
  ctx.fillStyle = 'rgba(5, 10, 6, 0.82)';
  ctx.fillRect(0, 8, tag.width, 80);
  ctx.strokeStyle = color || '#6baf6e';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 12, tag.width - 8, 72);
  ctx.fillStyle = '#fff2b3';
  ctx.font = 'bold 38px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(name || 'AGENT').slice(0, 16), tag.width / 2, tag.height / 2);
  const texture = new THREE.CanvasTexture(tag);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  }));
  sprite.scale.set(1.6, 0.3, 1);
  return sprite;
}

function removeRemote(mesh) {
  mesh.removeFromParent();
  clearTimeout(mesh.userData._flashT);
  // Materials are entity-local; GLB geometry and skin textures are shared.
  mesh.traverse(o => {
    if (o.isSprite) o.material.map?.dispose();
    if (mesh.userData.fallback && o.isMesh) o.geometry.dispose();
    if (o.material) {
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) material.dispose();
    }
  });
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
    if (!mesh || mesh.userData.modelRevision !== modelRevision) {
      const agent = getAgent(p.agentId || 'skullpepe');
      const previous = mesh;
      try {
        mesh = makeAgentMesh({ ...agent, color: p.color || agent.color });
      } catch (error) {
        console.warn('Remote model failed', p.id, p.agentId, error);
        mesh = makeAgentMesh(agent, false);
      }
      mesh.userData.modelRevision = modelRevision;
      mesh.traverse(o => {
        if (o.isMesh) o.onAfterRender = (_renderer, _scene, view) => {
          if (view === camera) mesh.userData.renderedAt = performance.now();
        };
      });
      const tag = makePlayerTag(p.name, p.color || agent.color);
      const bounds = new THREE.Box3().setFromObject(mesh);
      tag.position.y = (bounds.max.y + 0.25) / mesh.scale.y;
      tag.scale.divide(mesh.scale);
      mesh.add(tag);
      remoteMeshes.set(p.id, mesh);
      scene.add(mesh);
      if (previous) removeRemote(previous);
    }
    mesh.visible = !!p.alive;
    // No extra render delay or cosmetic body displacement without server rewind.
    mesh.position.set(p.x, p.y - EYE, p.z);
    mesh.rotation.y = p.yaw;
  }
  for (const [id, mesh] of remoteMeshes) {
    if (!seen.has(id)) {
      removeRemote(mesh);
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
  gunVoice('triangle', 660, 440, 0.14, 0.12);
}

function playHitZap() {
  ensureAudio();
  gunVoice('square', 1200, 300, 0.07, 0.10);
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
let lastTracer = null;

/** Sync look angles onto the camera and return true aim ray (where you look). */
function getAimRay() {
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  camera.rotation.z = 0;
  camera.updateMatrixWorld(true);
  const me = players.get(myId);
  _aimOrigin.set(me?.x ?? camera.position.x, me?.y ?? camera.position.y, me?.z ?? camera.position.z);
  camera.getWorldDirection(_aimDir); // camera forward (-Z) in world space
  if (_aimDir.lengthSq() < 1e-6) _aimDir.set(0, 0, -1);
  else _aimDir.normalize();
  return { origin: _aimOrigin, dir: _aimDir };
}

function spawnTracer(origin, dir, dist, weapon, local = false, boltSize = weapon.boltSize) {
  _aimEnd.copy(origin).addScaledVector(dir, dist);
  const start = local ? muzzleFlash.getWorldPosition(new THREE.Vector3()) : origin.clone();
  const direction = _aimEnd.clone().sub(start).normalize();
  // Cosmetic muzzle-to-impact path must not pass through nearby cover either.
  const len = castWalls(start.x, start.y, start.z, direction.x, direction.y, direction.z, start.distanceTo(_aimEnd));
  if (len < 0.001) return;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.018, len, 6),
    new THREE.MeshBasicMaterial({
      color: weapon.tracer,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  beam.position.copy(start).addScaledVector(direction, len * 0.5);
  beam.quaternion.setFromUnitVectors(_yAxis, direction);
  if (local) {
    const evidence = lastTracer = { start: start.toArray(), impact: _aimEnd.toArray(),
      end: start.clone().addScaledVector(direction, len).toArray(), fov: camera.fov, rendered: false };
    beam.onAfterRender = (_renderer, _scene, view) => {
      if (view !== camera) return;
      evidence.rendered = true;
      evidence.startNdc = start.clone().project(camera).toArray();
      evidence.endNdc = start.clone().addScaledVector(direction, len).project(camera).toArray();
    };
  }
  scene.add(beam);
  tracers.push({ mesh: beam, born: null, ttl: 140 });
  spawnBolt(start, direction, local ? myId : 'remote', weapon.boltColor, boltSize, len);
}

function spawnNetworkTracer(originData, impactData, weaponId) {
  const origin = new THREE.Vector3(originData.x, originData.y, originData.z);
  const impact = new THREE.Vector3(impactData.x, impactData.y, impactData.z);
  const dir = impact.sub(origin);
  const dist = dir.length();
  if (dist < 0.01) return;
  remoteShotsSeen += 1;
  dir.multiplyScalar(1 / dist);
  spawnTracer(origin, dir, dist, getWeapon(weaponId || 'raygun'), false, 0.055);
}

function updateTracers() {  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    // Network arrivals can wait longer than the whole TTL for a slow frame.
    // Start the beam's fade on its first animation update, before its first draw.
    t.born ??= performance.now();
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

function spawnGoo(pos) {
  for (let i = 0; i < 6; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.11, 0.11),
      new THREE.MeshBasicMaterial({
        color: 0x6baf6e,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    mesh.position.copy(pos);
    scene.add(mesh);
    goos.push({
      mesh,
      vx: (Math.random() - 0.5) * 7,
      vy: Math.random() * 6 + 2,
      vz: (Math.random() - 0.5) * 7,
      life: 0.55,
    });
  }
}

function spawnDmgNum(pos, dmg) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = 'bold 40px "Press Start 2P", monospace';
  g.textAlign = 'center';
  g.fillStyle = '#fff2b3';
  g.strokeStyle = '#0a0a0a';
  g.lineWidth = 4;
  g.strokeText(`-${dmg}`, 64, 48);
  g.fillText(`-${dmg}`, 64, 48);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
  );
  sprite.position.copy(pos);
  sprite.scale.set(1.4, 0.7, 1);
  scene.add(sprite);
  dmgNums.push({ sprite, born: performance.now() });
}

function updateGoos(dt) {
  for (let i = goos.length - 1; i >= 0; i--) {
    const g = goos[i];
    g.life -= dt;
    g.vy -= 13 * dt;
    g.mesh.position.x += g.vx * dt;
    g.mesh.position.y += g.vy * dt;
    g.mesh.position.z += g.vz * dt;
    g.mesh.rotation.x += dt * 9;
    g.mesh.rotation.z += dt * 7;
    g.mesh.material.opacity = 0.9 * Math.max(0, g.life / 0.55);
    if (g.life <= 0 || g.mesh.position.y < -1) {
      scene.remove(g.mesh);
      g.mesh.geometry.dispose();
      g.mesh.material.dispose();
      goos.splice(i, 1);
    }
  }
  for (let i = dmgNums.length - 1; i >= 0; i--) {
    const d = dmgNums[i];
    const age = (performance.now() - d.born) / 1000;
    d.sprite.position.y += dt * 2;
    d.sprite.material.opacity = Math.max(0, 1 - age / 0.6);
    if (age >= 0.6) {
      scene.remove(d.sprite);
      d.sprite.material.map.dispose();
      d.sprite.material.dispose();
      dmgNums.splice(i, 1);
    }
  }
}

function spawnBolt(origin, dir, fromId, color = 0x6baf6e, size = 0.16, dist = BOLT_SPEED * BOLT_LIFE) {
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
  mesh.position.copy(origin);
  scene.add(mesh);
  bolts.push({
    mesh,
    vx: dir.x * BOLT_SPEED,
    vy: dir.y * BOLT_SPEED,
    vz: dir.z * BOLT_SPEED,
    life: Math.min(BOLT_LIFE, dist / BOLT_SPEED),
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
  if (spectatorMode) {
    els.time.textContent = state.started ? String(state.timeLeft) : 'WAIT';
    els.count.textContent = `${state.players.length}/${state.maxPlayers}`;
    netPickups = state.pickups || [];
    els.scoreboard.textContent = [...state.players].sort((a, b) => b.kills - a.kills)
      .map(p => `${p.name}  ${p.kills}-${p.deaths}`).join('\n');
    els.killFeed.textContent = state.killFeed.slice().reverse().map(k => k.text).join('\n');
    return;
  }
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
  if (updateHud.hearts !== hearts) {
    updateHud.hearts = hearts;
    els.hearts.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const h = document.createElement('div');
      h.className = 'heart' + (i < hearts ? ' full' : '');
      els.hearts.appendChild(h);
    }
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
  if (els.nadeCount) {
    const n = me.grenades || 0;
    els.nadeCount.style.display = n > 0 ? 'block' : 'none';
    els.nadeNum.textContent = n;
  }

  if (state.pickups) netPickups = state.pickups;

  if (me.hp < lastHp) {
    els.damage.classList.add('on');
    setTimeout(() => els.damage.classList.remove('on'), 180);
  }
  lastHp = me.hp;

  const feedHtml = state.killFeed
    .slice()
    .reverse()
    .map((k) => `<div style="border-right-color:${k.color || 'var(--green)'}">${k.text}</div>`)
    .join('');

  const board = [...state.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  if (updateHud.feedHtml !== feedHtml) {
    els.killFeed.innerHTML = feedHtml;
    updateHud.feedHtml = feedHtml;
  }
  const boardHtml = board
    .map((p, i) => {
      const you = p.id === myId ? ' ›' : '';
      return `<div style="color:${p.color};border-left-color:${p.color}${you ? ';background:rgba(107,175,110,0.08)' : ''}">${i + 1}. ${p.name}${you}  ${p.kills}-${p.deaths}</div>`;
    })
    .join('');

  if (updateHud.boardHtml !== boardHtml) {
    els.scoreboard.innerHTML = boardHtml;
    updateHud.boardHtml = boardHtml;
  }

  if (!me.alive) showCenter('ELIMINATED — RESPAWNING', 2200);
}

function beginMission(title) {
  sessionControls.classList.remove('hidden');
  hud.classList.toggle('spectating', spectatorMode);
  gunGroup.visible = !spectatorMode;
  document.getElementById('sessionLabel').textContent = spectatorMode ? 'SPECTATOR // FREE FLIGHT' : 'AGENT // ACTIVE';
  document.getElementById('sessionHint').textContent = spectatorMode
    ? 'WASD + MOUSE / SPACE UP / CTRL DOWN / SHIFT FAST / ESC UNLOCK'
    : 'ESC RELEASES MOUSE';
  boot.classList.add('hidden');
  selectScreen?.classList.add('hidden');
  hud.classList.remove('hidden');
  overlay.classList.add('hidden');
  showCenter(title + ' · CLICK TO LOCK MOUSE', 2400);
  canvas.focus();
  // May fail outside a direct gesture; the first canvas click only locks the mouse.
  tryPointerLock();
}

function endMatch(standings) {
  if (spectatorMode || !inMatch()) return;
  clearTimeout(endMatchTimer);
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
  endMatchTimer = setTimeout(() => {
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
    weapon: 'raygun',
    ammo: -1,
    reloadingUntil: 0,
    armor: 0,
    lastKillAt: 0,
    streak: 0,
    grenades: 0,
  };
}

function pushFeed(text, color) {
  offlineMatch.killFeed.push({ t: Date.now(), text, color: color || '#6baf6e' });
  if (offlineMatch.killFeed.length > 12) offlineMatch.killFeed.shift();
}

function resetOfflineMatch() {
  offlineMatch.endsAt = Date.now() + (offlineMatch.mode === 'l2t' ? 120000 : 180000);
  offlineMatch.killFeed = [];
  offlineMatch.ended = false;
  for (const g of liveGrenades) { if (g.mesh) scene.remove(g.mesh); }
  liveGrenades.length = 0;
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
      weapon: 'raygun',
      ammo: -1,
      reloadingUntil: 0,
      armor: 0,
      lastKillAt: 0,
      streak: 0,
      grenades: 0,
    });
  }
  resetPads();
  if (offlineMode) mountViewmodel('raygun');
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
  mountViewmodel('raygun');
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
  for (const b of bots) b.grenades = 2;
  matchStartedAt = Date.now() + 2800; // countdown freeze: nobody fires until GO
  yaw = me.yaw;
  pitch = 0;
  camera.position.set(me.x, me.y, me.z);
  localAlive = true;
  lastHp = me.maxHp;
  if (agentTag) agentTag.textContent = `#${String(mine.slot).padStart(2, '0')} ${mine.name}`;
  beginMission(`${mine.name} - ${getMap(selectedMapId).name}`);
  publishOfflineHud();
  for (let c = 0; c < 4; c++) {
    countdownTimers.push(setTimeout(() => {
      const text = c < 3 ? `${3 - c}` : 'GO';
      showCenter(text, 800, c === 3);
      ensureAudio();
      gunVoice('square', c < 3 ? 440 : 880, c < 3 ? 440 : 880, c < 3 ? 0.15 : 0.22, c < 3 ? 0.14 : 0.19);
    }, c * 800 + 200));
  }
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
  out.set(-Math.sin(yaw0) * cp, Math.sin(pitch0), -Math.cos(yaw0) * cp);
  return out.normalize();
}

function applyShot(shooter, now) {
  finishReloadIfDue(shooter, now);
  const W = getWeapon(shooter.weapon);
  if (!shooter.alive || shooter.reloadingUntil || now - shooter.lastShot < W.cd) return false;
  if (offlineMode && now < matchStartedAt && !matchSkipCountdown) return false;
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
  if (shooter.id === myId && adsBlend < 0.5) {
    const assist = 0.5;
    let snap = null;
    let bestDot = Math.cos(0.085); // ~5 degree cone
    const to = new THREE.Vector3();
    for (const t of offlineMatch.roster) {
      if (t.id === myId || !t.alive) continue;
      if ((t.spawnShieldUntil || 0) > now) continue;
      const body = getBodyBox(t.agentId);
      to.set(t.x - origin.x, t.y - EYE + (body.min[1] + body.max[1]) / 2 - origin.y, t.z - origin.z);
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

  // Hitscan — walls clip the ray, bolt is VFX only
  let best = null;
  let bestT = Math.min(tWall, W.range);
  for (const target of offlineMatch.roster) {
    if (target.id === shooter.id || !target.alive) continue;
    // Spawn protection — freshly dropped agents can't be insta-plasted
    if ((target.spawnShieldUntil || 0) > now) continue;
    const t = intersectBody(origin.x, origin.y, origin.z,
      dir.x, dir.y, dir.z, target, bestT);
    if (t < bestT) {
      bestT = t;
      best = target;
    }
  }
  spawnTracer(origin, dir, bestT, W, shooter.id === myId);
  if (best) {
    // LIVE & LET DIE hits harder — fights have to bleed lives for the mode to resolve
    const region = hitRegion(origin.x + dir.x * bestT, origin.y + dir.y * bestT, origin.z + dir.z * bestT, best);
    const dmgOut = shotDamage(W, region) * (offlineMatch.mode === 'l2t' ? 1.3 : 1);
    const absorbed = W.oneShot ? 0 : Math.min(best.armor || 0, dmgOut * ARMOR_ABSORB);
    best.armor = Math.max(0, (best.armor || 0) - absorbed);
    best.hp -= dmgOut - absorbed;
    flashEntityById(best.id);
    spawnImpact(origin.x + dir.x * bestT, origin.y + dir.y * bestT, origin.z + dir.z * bestT, true);
    spawnGoo(new THREE.Vector3(origin.x + dir.x * bestT, origin.y + dir.y * bestT + 0.5, origin.z + dir.z * bestT));
    playHitZap();
    if (shooter.id === myId) {
      localHits++;
      spawnDmgNum(new THREE.Vector3(origin.x + dir.x * bestT, origin.y + dir.y * bestT + 1.8, origin.z + dir.z * bestT), Math.round(dmgOut));
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
      pushFeed(text, shooter.color);
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
  if (botsFrozen) return;
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
    // Entity Y is eye height for every agent, not the center of its scaled body.
    // A horizontal eye-height ray passes entirely above Mini.
    const body = getBodyBox(target.agentId);
    const cx = (body.min[0] + body.max[0]) / 2, cz = (body.min[2] + body.max[2]) / 2;
    const c = Math.cos(target.yaw), s = Math.sin(target.yaw);
    const dx = target.x + c * cx + s * cz - bot.x;
    const dy = target.y - EYE + (body.min[1] + body.max[1]) / 2 - bot.y;
    const dz = target.z - s * cx + c * cz - bot.z;
    const aimDist = Math.hypot(dx, dy, dz) || 0.001;
    bot.yaw = Math.atan2(-dx, -dz) + Math.sin(now * 0.0015 + bot.spawnIndex) * 0.15;
    bot.pitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -1.4, 1.4);

    // Line-of-sight gate — no more shooting through walls
    const losT = castWalls(bot.x, bot.y, bot.z, dx / aimDist, dy / aimDist, dz / aimDist, aimDist);
    const visible = losT >= aimDist - 0.6 && Math.abs(target.y - bot.y) < 3;
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
    if ((bot.grenades || 0) > 0 && reacted && dist < 16 && dist > 4 && Math.random() < 0.15 * dt) {
      throwGrenade(bot);
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
      // GE rules: death strips specials back to the trusty RAY GUN
      p.weapon = 'raygun';
      p.ammo = -1;
      p.reloadingUntil = 0;
      p.armor = 0;
      p.grenades = 0;
      if (p.lives <= 0) p.lives = 3;
      if (p.id === myId) {
        mountViewmodel('raygun');
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
    (typeof window.SKULLBOND_WS === 'string' ? window.SKULLBOND_WS : '') ||
    (/\.vercel\.app$/i.test(location.hostname)
      ? 'https://skullbond-gs-4p-2026.onrender.com'
      : '');
  if (base) {
    if (base.startsWith('ws://') || base.startsWith('wss://')) {
      return base.endsWith('/ws') ? base : `${base.replace(/\/$/, '')}/ws`;
    }
    if (base.startsWith('http://') || base.startsWith('https://')) {
      const socketBase = base.replace(/^http/, 'ws');
      return socketBase.endsWith('/ws') ? socketBase : `${socketBase.replace(/\/$/, '')}/ws`;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${base.replace(/\/$/, '')}/ws`;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function connect(name, role = 'player') {
  const generation = sessionId;
  const url = resolveWsUrl();
  const wakingRender = /\.onrender\.com/i.test(url);
  let settled = false;
  let retryTimer = 0;
  let attempts = 0;
  const failJoin = (why) => {
    if (generation !== sessionId || settled || myId || offlineMode) return;
    settled = true;
    clearTimeout(retryTimer);
    backToMenu();
    localStorage.removeItem('skullbond-ws');
    statusMsg(selectStatus || bootStatus, `${why} — RETRY OR USE SOLO OPS`);
    joinBtn.disabled = false;
    soloBtn.disabled = false;
  };
  const timer = setTimeout(() => failJoin('UPLINK TIMEOUT'), wakingRender ? 75000 : 6000);
  cancelConnect = () => {
    settled = true;
    clearTimeout(timer);
    clearTimeout(retryTimer);
  };

  function retryOrFail(socket) {
    if (generation !== sessionId || settled || socket !== ws || retryTimer) return;
    if (!wakingRender) {
      clearTimeout(timer);
      failJoin('LINK FAILED');
      return;
    }
    statusMsg(selectStatus || bootStatus, `SERVER WAKING — RETRYING UPLINK ${attempts}…`);
    retryTimer = setTimeout(() => {
      retryTimer = 0;
      openSocket();
    }, 3000);
  }

  function openSocket() {
    if (generation !== sessionId || settled) return;
    ws?.close();
    attempts += 1;
    let socket;
    try {
      socket = new WebSocket(url);
      ws = socket;
    } catch {
      failJoin('LINK FAILED');
      return;
    }
    socket.onopen = () => {
      if (generation !== sessionId || socket !== ws || settled) return;
      statusMsg(selectStatus || bootStatus, 'LINKED — ARMING…');
      socket.send(JSON.stringify({ type: 'join', role, name, agentId: selectedAgentId, mapId: selectedMapId }));
    };
    socket.onerror = () => retryOrFail(socket);
    socket.onclose = () => {
      if (generation !== sessionId || socket !== ws) return;
      if (!settled) retryOrFail(socket);
      else {
        backToMenu();
        statusMsg(selectStatus, 'CONNECTION LOST - REJOIN WHEN READY');
      }
    };
    socket.onmessage = ev => {
      if (generation === sessionId && socket === ws) handleMessage(ev);
    };
  }

  function handleMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'error') {
      backToMenu();
      statusMsg(selectStatus || bootStatus, msg.message);
      joinBtn.disabled = false;
      soloBtn.disabled = false;
      return;
    }
    if (msg.type === 'welcome') {
      if (settled) return;
      if (role === 'spectator' && msg.role !== 'spectator') {
        failJoin('SERVER DOES NOT SUPPORT SPECTATORS YET');
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(retryTimer);
      offlineMode = false;
      spectatorMode = msg.role === 'spectator';
      myId = msg.id;
      localAlive = !spectatorMode;
      lastHp = msg.player?.hp || 100;
      matchStartedAt = Date.now();
      netPickups = [];
      netWeapon = 'raygun';
      netAmmo = -1;
      if (msg.mapId) loadSelectedMap(msg.mapId);
      else loadSelectedMap(selectedMapId);
      mountViewmodel('raygun');
      const mine = getAgent(selectedAgentId);
      const spawn = msg.player || SPAWNS[0];
      camera.position.set(spawn.x, spectatorMode ? 12 : spawn.y, spawn.z);
      yaw = spawn.yaw;
      pitch = spectatorMode ? -0.2 : 0;
      if (agentTag) agentTag.textContent = `#${String(mine.slot).padStart(2, '0')} ${mine.name}`;
      beginMission(`${spectatorMode ? 'SPECTATOR MODE' : mine.name} - ${getMap(selectedMapId).name}`);
      return;
    }
    if (msg.type === 'state') {
      if (!settled) return;
      lastStateAt = performance.now();
      if (msg.mapId && msg.mapId !== selectedMapId) loadSelectedMap(msg.mapId);
      mapRuntime.netState = msg.mapRuntime || null;
      syncRemotes(msg.players);
      const me = msg.players.find((p) => p.id === myId);
      if (me) {
        const wid = me.weapon || 'raygun';
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
      if (msg.from !== myId) spawnNetworkTracer(msg.origin, msg.impact, msg.weapon);
      else {
        const origin = new THREE.Vector3(msg.origin.x, msg.origin.y, msg.origin.z);
        const direction = new THREE.Vector3(msg.impact.x, msg.impact.y, msg.impact.z).sub(origin);
        const distance = direction.length();
        spawnTracer(origin, direction.normalize(), distance, getWeapon(msg.weapon), true);
        flashMuzzle();
        playGun(getWeapon(msg.weapon).sound);
      }
      spawnImpact(msg.impact.x, msg.impact.y, msg.impact.z, !!msg.hit);
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
    if (msg.type === 'mapEvent') {
      if (msg.event === 'reactorSuppressed') {
        showCenter(`${msg.name} SUPPRESSED REACTOR`, 1200);
        playPickup();
      }
      return;
    }
    if (msg.type === 'kill') {
      if (!spectatorMode && msg.killer === myId) {
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
  }

  if (wakingRender) statusMsg(selectStatus || bootStatus, 'WAKING FREE MULTIPLAYER SERVER…');
  openSocket();
}

function sendInput() {
  if (spectatorMode || offlineMode || !ws || ws.readyState !== 1 || !myId) return;
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
  backToMenu();
  const mine = getAgent(selectedAgentId);
  const typed = (nameInput.value || '').trim();
  // Only a typed name persists — agent defaults never pollute storage
  const name = (typed || localStorage.getItem('skullbond-name') || mine.name).trim();
  if (typed) localStorage.setItem('skullbond-name', typed);
  localStorage.setItem('skullbond-agent', selectedAgentId);
  joinBtn.disabled = true;
  soloBtn.disabled = true;
  spectateBtn.disabled = true;
  sessionControls.classList.remove('hidden');
  document.getElementById('sessionLabel').textContent = 'CONNECTING';
  localStorage.setItem('skullbond-map', selectedMapId);
  if (mode === 'solo' || (mode !== 'spectator' && new URLSearchParams(location.search).get('solo') === '1')) {
    statusMsg(selectStatus, 'LOADING ARENA…');
    loadSelectedMap(selectedMapId);
    startOffline(name);
    return;
  }
  statusMsg(selectStatus, 'ESTABLISHING UPLINK…');
  connect(name, mode === 'spectator' ? 'spectator' : 'player');
}

function clearInput() {
  for (const key of Object.keys(keys)) keys[key] = false;
  shootPulse = false;
  triggerFresh = false;
}

function backToMenu() {
  // Invalidate callbacks before closing: an old socket must never own a new session.
  sessionId++;
  cancelConnect?.();
  cancelConnect = null;
  const socket = ws;
  ws = null;
  socket?.close();
  clearTimeout(endMatchTimer);
  countdownTimers.splice(0).forEach(clearTimeout);
  clearTimeout(showCenter._t);
  clearTimeout(showDmgDir._t);
  clearInput();
  // Diagnostic state belongs to the old session, never the next solo match.
  botsFrozen = false;
  matchSkipCountdown = false;
  window.SKULL_DEBUG?.unPhoto();
  myId = null;
  spectatorMode = false;
  offlineMode = false;
  offlineMatch = null;
  localAlive = false;
  lastTracer = null;
  lastStateAt = 0;
  netPickups = [];
  mapRuntime.netState = null;
  syncRemotes([]);
  players.clear();
  updateHud.feedHtml = updateHud.boardHtml = null;
  els.killFeed.textContent = els.scoreboard.textContent = '';
  for (const list of [bolts, tracers, goos, liveGrenades, dmgNums]) {
    for (const item of list) {
      const object = item.mesh || item.sprite;
      if (object) { scene.remove(object); disposeObject(object); }
    }
    list.length = 0;
  }
  gunGroup.visible = false;
  muzzleFlash.intensity = 0;
  adsBlend = 0;
  lastHp = 100;
  netWeapon = 'raygun';
  netAmmo = -1;
  lastLocalShot = 0;
  matchStartedAt = 0;
  for (const el of [els.centerMsg, els.dmgDir, els.damage, els.hitMarker, els.skullPop]) {
    el?.classList.remove('show', 'on', 'crit');
  }
  hud.classList.add('hidden');
  hud.classList.remove('spectating');
  overlay.classList.add('hidden');
  sessionControls.classList.add('hidden');
  boot.classList.add('hidden');
  selectScreen.classList.remove('hidden');
  joinBtn.disabled = soloBtn.disabled = spectateBtn.disabled = false;
  statusMsg(selectStatus, '');
  document.exitPointerLock?.();
  pointerLocked = false;
  buildMapSelect();
  buildAgentSelect();
}

function renderDossier(agent) {
  const art = document.getElementById('dossierArt');
  const dossier = document.getElementById('dossier');
  if (dossier) dossier.style.setProperty('--agent-clr', agent.color);
  document.getElementById('dossierSlot').textContent = `#${String(agent.slot).padStart(2, '0')}`;
  document.getElementById('dossierName').textContent = agent.name;
  document.getElementById('dossierCode').textContent = agent.codename;
  document.getElementById('dossierBio').textContent = agent.bio;
  document.getElementById('dossierLore').textContent = agent.lore;
  document.getElementById('dossierTip').textContent = `TIP — ${agent.tip}`;
  const stats = [
    { label: 'SPD', val: agent.stats.speed },
    { label: 'HP', val: agent.stats.health },
    { label: 'RAD', val: agent.stats.radness },
  ];
  document.getElementById('dossierStats').innerHTML =
    stats.map((s) =>
      `<div class="stat-row"><span class="stat-label">${s.label}</span><div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${s.val * 20}%"></div></div></div>`
    ).join('') +
    `<div class="stat-row"><span class="stat-label">KIT</span><span style="font-size:10px;color:${agent.color}">${agent.kit}</span></div>`;
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
    btn.style.setProperty('--agent-clr', agent.color);
    btn.innerHTML = `
      <div class="thumb" style="background-image:url('${agent.portrait}');background-position:${agent.portraitPos || 'center'}"></div>
      <div class="meta">
        <div class="slot">#${String(agent.slot).padStart(2, '0')} — ${agent.kit}</div>
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
  backToMenu();
  selectScreen.classList.add('hidden');
  boot.classList.remove('hidden');
});

joinBtn.addEventListener('click', () => armJoin('net'));
spectateBtn.addEventListener('click', () => armJoin('spectator'));
document.getElementById('bootSpectateBtn').addEventListener('click', () => armJoin('spectator'));
document.getElementById('menuBtn').addEventListener('click', backToMenu);
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
  if (e.code === 'Escape') {
    clearInput();
    document.exitPointerLock?.();
    return;
  }
  if (!inMatch() || !pointerLocked || !overlay.classList.contains('hidden')) return;
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
  if (spectatorMode) {
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') { e.preventDefault(); keys.down = true; }
    return;
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
  if (e.code === 'KeyG' && inMatch()) {
    if (offlineMode && offlineMatch) {
      const me = offlineMatch.roster.find((p) => p.id === myId);
      if (me?.alive) throwGrenade(me);
    }
  }
  if (e.code === 'KeyE' && inMatch()) useMapControl();
});

addEventListener('keyup', (e) => {
  if (e.code === 'Space') keys.jump = false;
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') keys.down = false;
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
  return (!!myId || spectatorMode) && !hud.classList.contains('hidden');
}

function tryPointerLock() {
  if (document.pointerLockElement === canvas) return;
  const req = canvas.requestPointerLock?.();
  if (req && typeof req.catch === 'function') req.catch(() => {});
}

function firePrimary() {
  if (spectatorMode || !inMatch() || !localAlive || !overlay.classList.contains('hidden')) return false;
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

  // Send the pre-recoil aim immediately. Tracer/endpoints come from the server,
  // avoiding a second random spread ray that disagrees with authoritative hits.
  triggerFresh = false;
  lastLocalShot = now;
  localShots++;
  shootPulse = true;
  sendInput();
  flashMuzzle();
  pitch = THREE.MathUtils.clamp(pitch + W.recoil * (0.8 + Math.random() * 0.4), -1.4, 1.4);
  yaw += W.recoil * 0.35 * (Math.random() < 0.5 ? -1 : 1);
  return true;
}

function onPrimaryDown(e) {
  if (!inMatch() || e.target !== canvas || !overlay.classList.contains('hidden')) return;
  if (spectatorMode || !pointerLocked) {
    if (e.button === 0) { canvas.focus(); tryPointerLock(); }
    return;
  }
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
  shootPulse = true;
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
    clearInput();
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
  if (spectatorMode) return;
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
  clearInput();
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
  lookAtWorld(x, y, z) {
    yaw = Math.atan2(camera.position.x - x, camera.position.z - z);
    pitch = Math.atan2(y - camera.position.y, Math.hypot(x - camera.position.x, z - camera.position.z));
    getAimRay();
  },
  visibility(id) {
    const mesh = remoteMeshes.get(id);
    if (!mesh) return { missing: true };
    const gl = renderer.getContext();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const before = new Uint8Array(size.x * size.y * 4);
    const after = new Uint8Array(before.length);
    const visible = mesh.visible, shadows = renderer.shadowMap.autoUpdate;
    const tags = [];
    mesh.traverse(o => { if (o.isSprite) { tags.push([o, o.visible]); o.visible = false; } });
    let changedPixels = 0;
    try {
      // Freeze shadows so only directly visible pixels (not cast shadows) count.
      renderer.shadowMap.autoUpdate = false;
      renderer.render(scene, camera);
      gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, before);
      mesh.visible = false;
      renderer.render(scene, camera);
      gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, after);
      for (let i = 0; i < before.length; i += 4) {
        if ([0, 1, 2].some(c => Math.abs(before[i + c] - after[i + c]) > 4)) changedPixels++;
      }
    } finally {
      mesh.visible = visible;
      for (const [tag, wasVisible] of tags) tag.visible = wasVisible;
      renderer.shadowMap.autoUpdate = shadows;
      renderer.render(scene, camera);
    }
    const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    const direction = center.clone().sub(camera.position).normalize();
    return { changedPixels, visible, attached: mesh.parent === scene, fallback: !!mesh.userData.fallback,
      centerNdc: center.clone().project(camera).toArray(), distance: center.distanceTo(camera.position),
      wallDistance: castWalls(camera.position.x, camera.position.y, camera.position.z,
        direction.x, direction.y, direction.z, center.distanceTo(camera.position)) };
  },
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
      hitboxVersion: HITBOX_VERSION,
      myId,
      stateAgeMs: performance.now() - lastStateAt,
      modelRevision,
      loadedModels: Object.keys(models),
      lastTracer,
      spectator: spectatorMode,
      inMatch: inMatch(),
      socketState: ws?.readyState ?? null,
      mapId: selectedMapId,
      camera: { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw, pitch },
      shots: localShots,
      hits: localHits,
      shootHeld: keys.shootHeld,
      ads: keys.ads,
      locked: pointerLocked,
      fov: camera.fov,
      weapon: currentWeaponId(),
      offline: !!offlineMode,
      botsFrozen,
      photoCount: window.SKULL_DEBUG._photo?.length || 0,
      countdownMs: Math.max(0, matchStartedAt - Date.now()),
      alive: localAlive,
      onlinePlayers: players.size,
      remoteBodies: remoteMeshes.size,
      liveTracers: tracers.length,
      remoteShots: remoteShotsSeen,
      remoteAgents: [...remoteMeshes].map(([id, mesh]) => ({
        id,
        agentId: players.get(id)?.agentId,
        fullBody: !!mesh.userData.fullBody,
        fallback: !!mesh.userData.fallback,
        attached: mesh.parent === scene,
        renderAgeMs: performance.now() - (mesh.userData.renderedAt || 0),
        visible: mesh.visible,
        position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
        yaw: mesh.rotation.y,
        bodyBox: getBodyBox(players.get(id)?.agentId),
        headBox: getHeadBox(players.get(id)?.agentId),
      })),
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
        .map((b) => ({ n: b.name, k: b.kills, d: b.deaths, alive: b.alive, hp: Math.round(b.hp), x: b.x, z: b.z })),
      feed: offlineMatch.killFeed.slice(-6).map((f) => ({ text: f.text, color: f.color })),
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
  debugSpots() {
    return {
      spawns: SPAWNS.map((s) => ({ x: s.x, z: s.z })),
      pads: pads.map((p) => ({ x: p.x, z: p.z })),
      gold: goldPad ? { x: goldPad.x, z: goldPad.z } : null,
      walls: WALLS.length,
      hazards: MAP_OBJECTS.hazards.length,
      teleporters: MAP_OBJECTS.teleporters.length,
      switches: MAP_OBJECTS.switches.length,
    };
  },
  loadMap(id) {
    if (!MAPS.some((map) => map.id === id)) return false;
    loadSelectedMap(id);
    return true;
  },
  mapFun() {
    const me = offlineMatch?.roster.find((player) => player.id === myId);
    return {
      mode: facilityMode(Date.now()),
      disabledFor: Math.max(0, mapRuntime.disabledUntil - Date.now()),
      nearestSwitch: nearestMapSwitch()?.id || null,
      offline: offlineMode,
      teleportReadyIn: Math.max(0, (me?.mapTeleportReadyAt || 0) - Date.now()),
      teleporters: MAP_OBJECTS.teleporters.map((v) => ({ id: v.id, x: v.x, z: v.z, toX: v.toX, toZ: v.toZ })),
    };
  },
  setMapPhase(ms) {
    matchStartedAt = Date.now() - Math.max(0, Number(ms) || 0);
    mapRuntime.disabledUntil = 0;
    return facilityMode(Date.now());
  },
  useMapControl,
  debugBlocked(x, z, pad = 1.2) {
    const hits = [];
    for (const w of WALLS) {
      if (x > w.minX - pad && x < w.maxX + pad && z > w.minZ - pad && z < w.maxZ + pad) {
        hits.push([w.minX, w.maxX, w.minZ, w.maxZ]);
      }
    }
    return hits;
  },
  freezeBots(v) {
    botsFrozen = !!v;
    return botsFrozen;
  },
  skipCountdown(v) {
    matchSkipCountdown = !!v;
    return matchSkipCountdown;
  },
  throwNade() {
    const me = offlineMatch && offlineMatch.roster.find((p) => p.id === myId);
    if (!me || !me.alive) return false;
    throwGrenade(me);
    return true;
  },
  giveNade(n = 4) {
    const me = offlineMatch && offlineMatch.roster.find((p) => p.id === myId);
    if (!me) return false;
    me.grenades = Math.min(GRENADE_MAX, (me.grenades || 0) + n);
    return me.grenades;
  },
  debugShotInfo(tx, tz) {
    const me = offlineMatch && offlineMatch.roster.find((p) => p.id === myId);
    const bot = offlineMatch && offlineMatch.roster.filter((p) => p.bot)[0];
    if (!me || !bot) return null;
    const dx = tx - me.x;
    const dz = tz - me.z;
    const len = Math.hypot(dx, dz) || 1;
    const t = castWalls(me.x, me.y, me.z, dx / len, 0, dz / len, 80);
    return {
      meX: Math.round(me.x * 10) / 10,
      meZ: Math.round(me.z * 10) / 10,
      meY: Math.round(me.y * 10) / 10,
      yawNow: Math.round(yaw * 100) / 100,
      distToBot: Math.round(len * 10) / 10,
      tWall: Math.round(t * 10) / 10,
      botX: Math.round(bot.x * 10) / 10,
      botZ: Math.round(bot.z * 10) / 10,
      botAlive: bot.alive,
      botShieldMs: Math.max(0, (bot.spawnShieldUntil || 0) - Date.now()),
      myWeapon: me.weapon,
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
      value: canvas,
      configurable: true,
    });
    document.dispatchEvent(new Event('pointerlockchange'));
  },
  // Line up every agent in front of the camera for visual inspection
  async photoMode(mapId) {
    if (ws && ws.readyState < 2) throw new Error('Photo mode requires a disconnected client');
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
      for (const m of this._photo) removeRemote(m);
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
  const frameDt = clock.getDelta();
  const dt = Math.min(0.05, frameDt);
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
  if (spectatorMode && pointerLocked) {
    const forward = Number(keys.f) - Number(keys.b);
    const right = Number(keys.r) - Number(keys.l);
    const up = Number(keys.jump) - Number(!!keys.down);
    const direction = dirFromYawPitch(yaw, pitch).multiplyScalar(forward);
    direction.x += Math.cos(yaw) * right;
    direction.z -= Math.sin(yaw) * right;
    direction.y += up;
    if (direction.lengthSq()) camera.position.addScaledVector(direction.normalize(), dt * (keys.sprint ? 36 : 12));
  }
  updateMapGameplay(dt, Date.now());
  updateBolts(dt);
  updateTracers();
  updateGoos(dt);
  updateGrenades(dt, Date.now());

  // Low-HP heartbeat — skull agents have feelings too
  if (offlineMode && offlineMatch) {
    const me = offlineMatch.roster.find((p) => p.id === myId);
    if (me && me.alive && me.hp > 0 && me.hp <= 25) {
      const now = Date.now();
      if (now - critBeatAt > 850) {
        critBeatAt = now;
        ensureAudio();
        gunVoice('sine', 55, 38, 0.2, 0.22);
        if (els.damage) {
          els.damage.classList.add('crit');
          setTimeout(() => els.damage.classList.remove('crit'), 220);
        }
      }
    }
  }
  drawRadar();

  renderer.render(scene, camera);
}
tick();
setInterval(sendInput, 50);
