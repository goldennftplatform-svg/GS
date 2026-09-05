/** Five deathmatch arenas for SKULLBOND */
export const MAPS = [
  {
    id: 'stadium',
    name: 'SKULL STADIUM',
    blurb: 'Floodlit pitch. Bleachers. Nowhere to hide on the green.',
    accent: '#6BAF6E',
  },
  {
    id: 'lunch',
    name: 'LUNCH HALL',
    blurb: 'Tray lines, folding tables, and milk-carton cover.',
    accent: '#B56A4D',
  },
  {
    id: 'starbucks',
    name: 'MALL STARBUCKS',
    blurb: 'Pastry cases, soft seating, and a very lethal latte bar.',
    accent: '#FFF2B3',
  },
  {
    id: 'megacorp',
    name: 'MEGACORP LOBBY',
    blurb: 'Glass, marble, security desks — shoot the dress code.',
    accent: '#8E8E8E',
  },
  {
    id: 'facility',
    name: 'NSES FACILITY',
    blurb: 'The classic blacksite. Labs, servers, and bad decisions.',
    accent: '#2E6E3E',
  },
];

export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}

/** Weapon/armor pad spots per arena — hand-placed on verified open floor. */
export const PAD_SPOTS = {
  stadium: [
    { x: -27, z: -27, w: 'kf7' },
    { x: 27, z: -27, w: 'dd' },
    { x: -27, z: 27, w: 'klobb' },
    { x: 27, z: 27, w: 'armor' },
    { x: -21, z: -42, w: 'armor' },
    { x: 21, z: 42, w: 'kf7' },
    { x: 0, z: 0, w: 'dd' },
    { x: -14, z: 0, w: 'nade' },
    { x: 14, z: 0, w: 'nade' },
  ],
  lunch: [
    { x: -22, z: -22, w: 'kf7' },
    { x: 22, z: -22, w: 'dd' },
    { x: -22, z: 22, w: 'klobb' },
    { x: 22, z: 22, w: 'armor' },
    { x: -17, z: -40, w: 'armor' },
    { x: 17, z: 40, w: 'kf7' },
    { x: 0, z: -18, w: 'dd' },
    { x: -10, z: 10, w: 'nade' },
    { x: 10, z: 28, w: 'nade' },
  ],
  starbucks: [
    { x: -20, z: -20, w: 'kf7' },
    { x: 26, z: -13, w: 'dd' },
    { x: -20, z: 20, w: 'klobb' },
    { x: 20, z: 20, w: 'armor' },
    { x: -14, z: -31, w: 'armor' },
    { x: 14, z: 31, w: 'kf7' },
    { x: 0, z: 0, w: 'dd' },
    { x: -10, z: 8, w: 'nade' },
    { x: 12, z: -6, w: 'nade' },
  ],
  megacorp: [
    { x: -25, z: -25, w: 'kf7' },
    { x: 25, z: -25, w: 'dd' },
    { x: -25, z: 25, w: 'klobb' },
    { x: 25, z: 25, w: 'armor' },
    { x: -13, z: -41, w: 'armor' },
    { x: 13, z: 41, w: 'kf7' },
    { x: 0, z: 26, w: 'dd' },
    { x: -12, z: 0, w: 'nade' },
    { x: 12, z: 12, w: 'nade' },
  ],
  facility: [
    { x: -42, z: -30, w: 'kf7' },
    { x: 42, z: 30, w: 'dd' },
    { x: -42, z: 30, w: 'klobb' },
    { x: 42, z: -30, w: 'armor' },
    { x: 0, z: -42, w: 'armor' },
    { x: 0, z: 42, w: 'kf7' },
    { x: -26, z: 0, w: 'dd' },
    { x: 26, z: 0, w: 'nade' },
    { x: 0, z: 22, w: 'nade' },
  ],
};

/** Golden Skullgun drop point — open ground, away from center props. */
export const GOLD_SPOTS = {
  stadium: [0, 0],
  lunch: [0, 0],
  starbucks: [0, 12],
  megacorp: [0, 10],
  facility: [0, 0],
};

let THREE;

export function bindThree(T) {
  THREE = T;
}

function canvasTex(draw, w = 1024, h = 1024, repeat = 8) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function texGrass() {
  return canvasTex((g, w, h) => {
    g.fillStyle = '#2d5a32';
    g.fillRect(0, 0, w, h);
    // Mowing stripes — instant stadium identity
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
      g.fillRect((i * w) / 8, 0, w / 8, h);
    }
    const n = (w * h) / 220;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 3 ? 'rgba(58,112,64,0.8)' : 'rgba(36,80,40,0.8)';
      g.fillRect(Math.random() * w, Math.random() * h, w / 340, h / 220);
    }
    g.strokeStyle = 'rgba(255,255,255,0.3)';
    g.lineWidth = w / 64;
    g.strokeRect(w * 0.08, h * 0.08, w * 0.84, h * 0.84);
    g.beginPath();
    g.arc(w / 2, h / 2, w / 6.4, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(w / 2, h * 0.08);
    g.lineTo(w / 2, h * 0.92);
    g.stroke();
  }, 1024, 1024, 6);
}

function texTile(a = '#d8d2c4', b = '#c4bdb0') {
  return canvasTex((g, w, h) => {
    const s = w / 8;
    for (let y = 0; y < h; y += s) {
      for (let x = 0; x < w; x += s) {
        g.fillStyle = (x / s + y / s) % 2 ? a : b;
        g.fillRect(x, y, s, s);
        const j = (Math.random() - 0.5) * 0.06;
        g.fillStyle = `rgba(255,255,255,${Math.max(0, j)})`;
        g.fillRect(x, y, s, s);
        g.fillStyle = `rgba(0,0,0,${Math.max(0, -j)})`;
        g.fillRect(x, y, s, s);
        g.strokeStyle = 'rgba(0,0,0,0.22)';
        g.lineWidth = Math.max(2, w / 340);
        g.strokeRect(x + 1, y + 1, s - 2, s - 2);
        g.fillStyle = 'rgba(255,255,255,0.05)';
        g.fillRect(x + s * 0.12, y + s * 0.1, s * 0.76, s * 0.16);
      }
    }
  }, 1024, 1024, 10);
}

function texWood() {
  return canvasTex((g, w, h) => {
    g.fillStyle = '#8b5a3c';
    g.fillRect(0, 0, w, h);
    const plank = h / 6;
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i % 2 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
      g.fillRect(0, i * plank, w, plank);
      g.strokeStyle = 'rgba(40,20,10,0.6)';
      g.lineWidth = Math.max(2, w / 256);
      g.beginPath();
      g.moveTo(0, i * plank);
      g.lineTo(w, i * plank);
      g.stroke();
    }
    for (let i = 0; i < w / 5; i++) {
      g.strokeStyle = `rgba(60,30,15,${0.1 + Math.random() * 0.18})`;
      g.lineWidth = Math.max(1, w / 512);
      g.beginPath();
      const y0 = Math.random() * h;
      g.moveTo(0, y0);
      g.bezierCurveTo(
        w * 0.3, y0 + (Math.random() - 0.5) * 30,
        w * 0.7, y0 + (Math.random() - 0.5) * 30,
        w, y0 + (Math.random() - 0.5) * 12
      );
      g.stroke();
    }
  }, 1024, 1024, 4);
}

function texBrick() {
  return canvasTex((g, w, h) => {
    g.fillStyle = '#4a352c';
    g.fillRect(0, 0, w, h); // mortar base
    const bw = w / 5.33;
    const bh = bw / 2;
    for (let y = 0, row = 0; y < h; y += bh, row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < w; x += bw) {
        const r = 110 + Math.random() * 30;
        const gg = 70 + Math.random() * 20;
        g.fillStyle = `rgb(${r | 0},${gg | 0},55)`;
        g.fillRect(x + off + w / 170, y + w / 170, bw - w / 85, bh - w / 85);
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.fillRect(x + off + w / 170, y + w / 170, bw - w / 85, (bh - w / 85) * 0.18);
      }
    }
  }, 1024, 1024, 5);
}

function texConcrete() {
  return canvasTex((g, w, h) => {
    g.fillStyle = '#6a6e68';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 24; i++) {
      const v = Math.random() > 0.5 ? 255 : 0;
      g.fillStyle = `rgba(${v},${v},${v},0.03)`;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, w * (0.05 + Math.random() * 0.12), 0, Math.PI * 2);
      g.fill();
    }
    const n = (w * h) / 160;
    for (let i = 0; i < n; i++) {
      const v = 90 + Math.random() * 50;
      g.fillStyle = `rgba(${v | 0},${v | 0},${(v - 5) | 0},0.7)`;
      g.fillRect(Math.random() * w, Math.random() * h, w / 340, w / 340);
    }
  }, 1024, 1024, 8);
}

function texMarble() {
  return canvasTex((g, w, h) => {
    g.fillStyle = '#e8e4dc';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(160,158,150,${0.05 + Math.random() * 0.05})`;
      g.fillRect(0, Math.random() * h, w, h * (0.06 + Math.random() * 0.1));
    }
    for (let i = 0; i < w / 20; i++) {
      g.strokeStyle = `rgba(120,120,120,${0.12 + Math.random() * 0.2})`;
      g.lineWidth = Math.max(1, w / (300 + Math.random() * 300));
      g.beginPath();
      let x = Math.random() * w;
      let y = Math.random() * h;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        const nx = x + (Math.random() - 0.5) * w * 0.4;
        const ny = y + (Math.random() - 0.5) * h * 0.4;
        g.quadraticCurveTo(x + (Math.random() - 0.5) * 80, y + (Math.random() - 0.5) * 80, nx, ny);
        x = nx;
        y = ny;
      }
      g.stroke();
    }
    for (let i = 0; i < 10; i++) {
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(Math.random() * w, Math.random() * h, w * 0.2, w / 200);
    }
  }, 1024, 1024, 6);
}

function texCafe() {
  return canvasTex((g, w, h) => {
    g.fillStyle = '#3d2a22';
    g.fillRect(0, 0, w, h);
    const row = w / 8;
    for (let y = 0; y < h; y += row) {
      g.fillStyle = (y / row) % 2 ? '#4a342c' : '#35241d';
      g.fillRect(0, y, w, row);
      for (let i = 0; i < 6; i++) {
        g.strokeStyle = 'rgba(20,10,5,0.25)';
        g.lineWidth = Math.max(1, w / 512);
        const gy = y + Math.random() * row;
        g.beginPath();
        g.moveTo(0, gy);
        g.bezierCurveTo(w * 0.3, gy + 6, w * 0.7, gy - 6, w, gy);
        g.stroke();
      }
    }
  }, 512, 512, 12);
}

/**
 * @param {object} ctx
 * @param {import('three').Scene} ctx.scene
 * @param {import('three').Group} ctx.world
 * @param {Array} ctx.WALLS
 * @param {Function} ctx.setSpawns
 * @param {Function} ctx.setBounds
 */
export function buildMapById(id, ctx) {
  const map = getMap(id);
  const builders = {
    stadium: buildStadium,
    lunch: buildLunch,
    starbucks: buildStarbucks,
    megacorp: buildMegacorp,
    facility: buildFacility,
  };
  (builders[map.id] || buildFacility)(ctx);
  return map;
}

function api(ctx) {
  const { world, WALLS, THREE: T } = ctx;
  const mapObjects = ctx.mapObjects || {};
  const eye = 1.65;

  function solidBox(w, h, d, color, x, y, z, opts = {}) {
    const mat = opts.map
      ? new T.MeshStandardMaterial({
          map: opts.map,
          roughness: opts.roughness ?? 0.75,
          metalness: opts.metalness ?? 0.05,
          color: color ?? 0xffffff,
          emissive: opts.emissive ?? 0x000000,
          emissiveIntensity: opts.emissiveIntensity ?? 0,
        })
      : new T.MeshStandardMaterial({
          color,
          roughness: opts.roughness ?? 0.8,
          metalness: opts.metalness ?? 0.05,
          emissive: opts.emissive ?? 0x000000,
          emissiveIntensity: opts.emissiveIntensity ?? 0,
        });
    const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    world.add(m);
    if (opts.collide !== false) {
      WALLS.push({
        minX: x - w / 2,
        maxX: x + w / 2,
        minZ: z - d / 2,
        maxZ: z + d / 2,
        base: y - h / 2,
        top: y + h / 2,
      });
    }
    return m;
  }

  function floorPlane(size, map, y = 0) {
    const m = new T.Mesh(
      new T.PlaneGeometry(size, size),
      new T.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0.02 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    world.add(m);
    return m;
  }

  function shell(size, wallH, wallMat, wallColor) {
    const half = size / 2;
    solidBox(size, wallH, 1.4, wallColor, 0, wallH / 2, -half + 0.7, { map: wallMat });
    solidBox(size, wallH, 1.4, wallColor, 0, wallH / 2, half - 0.7, { map: wallMat });
    solidBox(1.4, wallH, size, wallColor, -half + 0.7, wallH / 2, 0, { map: wallMat });
    solidBox(1.4, wallH, size, wallColor, half - 0.7, wallH / 2, 0, { map: wallMat });
  }

  function cornerSpawns(r) {
    r = Math.round(r * 0.7);
    ctx.setSpawns([
      { x: -r, y: eye, z: -r, yaw: (-3 * Math.PI) / 4 },
      { x: r, y: eye, z: -r, yaw: (3 * Math.PI) / 4 },
      { x: -r, y: eye, z: r, yaw: -Math.PI / 4 },
      { x: r, y: eye, z: r, yaw: Math.PI / 4 },
    ]);
  }

  function lights(color, fogColor, fogNear, fogFar, points = []) {
    ctx.scene.background = new T.Color(fogColor);
    ctx.scene.fog = new T.Fog(fogColor, fogNear, fogFar);
    // Neutral fill keeps cream/green/ink legible in shadow; local lights retain map color.
    const amb = new T.AmbientLight(0xffffff, 0.7);
    world.add(amb);
    const sun = new T.DirectionalLight(0xffffff, 1.05);
    sun.position.set(40, 55, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    world.add(sun);
    for (const [x, y, z, c, i, dist] of points) {
      const p = new T.PointLight(c, i, dist);
      p.position.set(x, y, z);
      world.add(p);
    }
  }

  function doorFrame(x, z, width, rotation = 0, color = 0x353c36) {
    const horizontal = Math.abs(Math.sin(rotation)) < 0.5;
    const jamb = 1.1;
    if (horizontal) {
      solidBox(jamb, 4.8, 1.1, color, x - width / 2, 2.4, z);
      solidBox(jamb, 4.8, 1.1, color, x + width / 2, 2.4, z);
      solidBox(width + jamb, 0.8, 1.1, color, x, 4.4, z);
    } else {
      solidBox(1.1, 4.8, jamb, color, x, 2.4, z - width / 2);
      solidBox(1.1, 4.8, jamb, color, x, 2.4, z + width / 2);
      solidBox(1.1, 0.8, width + jamb, color, x, 4.4, z);
    }
  }

  function hazardZone(id, x, z, radius) {
    const mat = new T.MeshStandardMaterial({
      color: 0x294529,
      emissive: 0x2e6e3e,
      emissiveIntensity: 0.45,
      roughness: 0.42,
      metalness: 0.2,
      transparent: true,
      opacity: 0.82,
    });
    const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, 0.12, 32), mat);
    mesh.position.set(x, 0.07, z);
    mesh.receiveShadow = true;
    world.add(mesh);
    mapObjects.hazards?.push({ id, x, z, radius, mesh, material: mat });
    return mesh;
  }

  function teleporter(id, x, z, toX, toZ) {
    const mat = new T.MeshStandardMaterial({
      color: 0x6baf6e,
      emissive: 0x6baf6e,
      emissiveIntensity: 1.4,
      roughness: 0.3,
    });
    const mesh = new T.Mesh(new T.TorusGeometry(1.35, 0.18, 8, 24), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.18, z);
    world.add(mesh);
    mapObjects.teleporters?.push({ id, x, z, toX, toZ, mesh, material: mat });
    return mesh;
  }

  function switchPanel(id, x, z, rotation = 0) {
    const mat = new T.MeshStandardMaterial({
      color: 0xb56a4d,
      emissive: 0x6baf6e,
      emissiveIntensity: 0.35,
      roughness: 0.5,
    });
    const mesh = new T.Mesh(new T.BoxGeometry(1.4, 2.1, 0.45), mat);
    mesh.position.set(x, 1.2, z);
    mesh.rotation.y = rotation;
    world.add(mesh);
    mapObjects.switches?.push({ id, x, z, mesh, material: mat });
    return mesh;
  }

  return {
    solidBox,
    floorPlane,
    shell,
    cornerSpawns,
    lights,
    doorFrame,
    hazardZone,
    teleporter,
    switchPanel,
    eye,
  };
}

function buildStadium(ctx) {
  const size = 120;
  ctx.setBounds(size);
  const { solidBox, floorPlane, shell, cornerSpawns, lights, teleporter } = api(ctx);
  const grass = texGrass();
  const concrete = texConcrete();
  lights(0x88aa88, 0x0c1810, 50, 130, [
    [0, 18, 0, 0xfff2b3, 1.4, 60],
    [-35, 14, -35, 0x6baf6e, 0.9, 40],
    [35, 14, 35, 0x6baf6e, 0.9, 40],
    [-35, 14, 35, 0xfff2b3, 0.7, 35],
    [35, 14, -35, 0xfff2b3, 0.7, 35],
  ]);
  floorPlane(size, grass);
  shell(size, 8, concrete, 0x888888);
  // pitch markings / goals
  solidBox(50, 0.05, 0.4, 0xffffff, 0, 0.03, 0, { collide: false });
  solidBox(0.4, 0.05, 70, 0xffffff, 0, 0.03, 0, { collide: false });
  // goals
  solidBox(12, 4, 0.5, 0xffffff, 0, 2, -48, { collide: false });
  solidBox(0.4, 4, 0.4, 0xffffff, -6, 2, -48);
  solidBox(0.4, 4, 0.4, 0xffffff, 6, 2, -48);
  solidBox(12, 4, 0.5, 0xffffff, 0, 2, 48, { collide: false });
  solidBox(0.4, 4, 0.4, 0xffffff, -6, 2, 48);
  solidBox(0.4, 4, 0.4, 0xffffff, 6, 2, 48);
  // bleachers
  for (let i = 0; i < 5; i++) {
    solidBox(70, 1.2, 3, 0x4a4a4a, 0, 0.6 + i * 1.1, -52 - i * 1.2, { map: concrete });
    solidBox(70, 1.2, 3, 0x4a4a4a, 0, 0.6 + i * 1.1, 52 + i * 1.2, { map: concrete });
  }
  // cover pillars
  for (const [x, z] of [
    [-20, -20], [20, -20], [-20, 20], [20, 20], [-30, 0], [30, 0],
  ]) {
    solidBox(2.4, 3.5, 2.4, 0x666666, x, 1.75, z, { map: concrete });
  }
  solidBox(18, 2.2, 1.4, 0x4a4a4a, -15, 1.1, -12, { map: concrete });
  solidBox(18, 2.2, 1.4, 0x4a4a4a, 15, 1.1, 12, { map: concrete });
  solidBox(1.4, 2.2, 14, 0x4a4a4a, -12, 1.1, 15, { map: concrete });
  solidBox(1.4, 2.2, 14, 0x4a4a4a, 12, 1.1, -15, { map: concrete });
  teleporter('north-goal-link', 0, -47, 0, 42);
  teleporter('south-goal-link', 0, 47, 0, -42);
  cornerSpawns(48);
}

function buildLunch(ctx) {
  const size = 100;
  ctx.setBounds(size);
  const { solidBox, floorPlane, shell, cornerSpawns, lights, teleporter, doorFrame } = api(ctx);
  const tile = texTile('#c9b896', '#b5a07e');
  const brick = texBrick();
  lights(0xffe0c0, 0x1a1410, 40, 110, [
    [0, 7, 0, 0xfff2b3, 1.2, 45],
    [-25, 6, -20, 0xffcc88, 0.8, 30],
    [25, 6, 20, 0xffcc88, 0.8, 30],
  ]);
  floorPlane(size, tile);
  shell(size, 6, brick, 0xffffff);
  // serving line
  solidBox(40, 1.2, 4, 0xb56a4d, 0, 0.6, -30, { map: texWood() });
  solidBox(40, 2.5, 0.4, 0x8e8e8e, 0, 2.2, -32);
  // Four table islands leave broad diagonal routes instead of a prop maze.
  for (const [x, z, vertical] of [[-22, -10, 0], [22, -10, 0], [-18, 18, 1], [18, 18, 1]]) {
    solidBox(vertical ? 4 : 12, 1.1, vertical ? 12 : 4, 0x6baf6e, x, 0.55, z);
  }
  solidBox(10, 2.4, 3, 0xb56a4d, 0, 1.2, 8, { map: texWood() });
  solidBox(3, 3.5, 2, 0xe5392d, -40, 1.75, -12, { emissive: 0x441111, emissiveIntensity: 0.2 });
  solidBox(3, 3.5, 2, 0x6baf6e, 40, 1.75, 12, { emissive: 0x113311, emissiveIntensity: 0.2 });
  teleporter('west-service', -42, 0, 38, 0);
  teleporter('east-service', 42, 0, -38, 0);
  doorFrame(-42, 0, 6, Math.PI / 2, 0x6d4633);
  doorFrame(42, 0, 6, Math.PI / 2, 0x6d4633);
  solidBox(8, 4, 1, 0xfff2b3, 0, 3, 45, { collide: false, emissive: 0x665522, emissiveIntensity: 0.15 });
  cornerSpawns(40);
}

function buildStarbucks(ctx) {
  const size = 90;
  ctx.setBounds(size);
  const { solidBox, floorPlane, shell, cornerSpawns, lights, teleporter, doorFrame } = api(ctx);
  const wood = texWood();
  const cafe = texCafe();
  lights(0xffe8d0, 0x1c120e, 35, 100, [
    [0, 5, 0, 0xfff2b3, 1.0, 35],
    [-15, 4, -10, 0xffcc99, 0.7, 25],
    [15, 4, 10, 0xffcc99, 0.7, 25],
    [0, 4, -25, 0x6baf6e, 0.5, 20],
  ]);
  floorPlane(size, wood);
  shell(size, 5.5, cafe, 0xffffff);
  // counter bar
  solidBox(28, 1.4, 4, 0x3d2a22, 0, 0.7, -22, { map: wood });
  solidBox(28, 1.8, 0.5, 0x2a1c16, 0, 2.2, -24);
  // pastry case
  solidBox(10, 1.6, 2.2, 0xdddddd, -12, 1.6, -18, { metalness: 0.4, roughness: 0.3 });
  // couches / soft seating blocks
  for (const [x, z] of [
    [-25, 5], [-25, 18], [25, 5], [25, 18], [-10, 25], [10, 25],
  ]) {
    solidBox(6, 1.0, 3, 0x6baf6e, x, 0.5, z);
    solidBox(6, 1.6, 0.6, 0x2e6e3e, x, 1.4, z - 1.2);
  }
  // pillars + menu boards
  solidBox(2, 4.5, 2, 0xb56a4d, -8, 2.25, 0, { map: wood });
  solidBox(2, 4.5, 2, 0xb56a4d, 8, 2.25, 0, { map: wood });
  solidBox(6, 3, 0.3, 0xfff2b3, 0, 3, 40, { emissive: 0x443300, emissiveIntensity: 0.25, collide: false });
  // pickup shelf
  solidBox(8, 1.2, 2, 0x8e8e8e, 18, 0.6, -20);
  teleporter('stockroom-west', -37, -26, 34, 26);
  teleporter('stockroom-east', 37, 26, -34, -26);
  doorFrame(-37, -26, 6, Math.PI / 2, 0x2c211c);
  doorFrame(37, 26, 6, Math.PI / 2, 0x2c211c);
  cornerSpawns(35);
}

function buildMegacorp(ctx) {
  const size = 110;
  ctx.setBounds(size);
  const { solidBox, floorPlane, shell, cornerSpawns, lights, teleporter } = api(ctx);
  const marble = texMarble();
  const concrete = texConcrete();
  lights(0xcce0ff, 0x0a1020, 45, 120, [
    [0, 10, 0, 0xaaccff, 1.3, 50],
    [-30, 8, -30, 0x6baf6e, 0.6, 30],
    [30, 8, 30, 0xe5392d, 0.5, 30],
    [0, 8, -40, 0xffffff, 0.8, 35],
  ]);
  floorPlane(size, marble);
  shell(size, 9, concrete, 0xffffff);
  // atrium fountain / logo plinth
  solidBox(8, 1, 8, 0x8e8e8e, 0, 0.5, 0, { metalness: 0.5, roughness: 0.3 });
  solidBox(3, 4, 3, 0x111111, 0, 3, 0, { emissive: 0x6baf6e, emissiveIntensity: 0.35 });
  // reception desks
  solidBox(16, 1.3, 3, 0x222222, 0, 0.65, -35, { metalness: 0.4 });
  solidBox(16, 1.3, 3, 0x222222, 0, 0.65, 35, { metalness: 0.4 });
  // Three office wings frame the center cross while preserving flank loops.
  for (const [x, z] of [[-28, -15], [0, -15], [28, -15], [-28, 15], [0, 15], [28, 15]]) {
    solidBox(0.6, 5, 10, 0x88aacc, x, 2.5, z, { metalness: 0.6, roughness: 0.2 });
  }
  // elevator banks
  solidBox(10, 7, 2, 0x333333, -45, 3.5, 0, { emissive: 0x224422, emissiveIntensity: 0.2 });
  solidBox(10, 7, 2, 0x333333, 45, 3.5, 0, { emissive: 0x224422, emissiveIntensity: 0.2 });
  teleporter('west-elevator', -45, 5, 41, -5);
  teleporter('east-elevator', 45, -5, -41, 5);
  cornerSpawns(44);
}

function buildFacility(ctx) {
  const size = 128;
  ctx.setBounds(size);
  const {
    solidBox,
    floorPlane,
    shell,
    cornerSpawns,
    lights,
    doorFrame,
    hazardZone,
    teleporter,
    switchPanel,
  } = api(ctx);
  const concrete = texConcrete();
  const tile = texTile('#3a4a38', '#2f3c2e');
  lights(0x88aa88, 0x0e1510, 50, 140, [
    [0, 8, 0, 0x6baf6e, 1.6, 42],
    [-40, 6, -40, 0xfff2b3, 0.8, 32],
    [40, 6, 40, 0xfff2b3, 0.8, 32],
    [-40, 6, 40, 0x6baf6e, 0.7, 30],
    [40, 6, -40, 0x6baf6e, 0.7, 30],
    [0, 6, -40, 0xfff2b3, 0.6, 28],
    [0, 6, 40, 0xfff2b3, 0.6, 28],
  ]);
  floorPlane(size, tile);
  shell(size, 6.5, concrete, 0xffffff);

  // Reactor chamber: four wide entrances, enough cover to contest the gold,
  // and no forest of identical pillars obscuring the map's main landmark.
  hazardZone('reactor', 0, 0, 9);
  solidBox(4.5, 6.2, 4.5, 0x172019, 0, 3.1, 0, {
    emissive: 0x2e6e3e,
    emissiveIntensity: 0.75,
  });
  for (const x of [-14, 14]) {
    solidBox(12, 4.6, 1.2, 0x465047, x, 2.3, -16, { map: concrete });
    solidBox(12, 4.6, 1.2, 0x465047, x, 2.3, 16, { map: concrete });
  }
  for (const z of [-14, 14]) {
    solidBox(1.2, 4.6, 12, 0x465047, -16, 2.3, z, { map: concrete });
    solidBox(1.2, 4.6, 12, 0x465047, 16, 2.3, z, { map: concrete });
  }
  doorFrame(0, -16, 7);
  doorFrame(0, 16, 7);
  doorFrame(-16, 0, 7, Math.PI / 2);
  doorFrame(16, 0, 7, Math.PI / 2);

  // North/south control approaches provide cover and a reason to leave the
  // outer loop: either panel suppresses the reactor long enough to take gold.
  switchPanel('north-control', 0, -28);
  switchPanel('south-control', 0, 28, Math.PI);
  solidBox(18, 2.4, 2.2, 0x59625a, -20, 1.2, -34, { map: concrete });
  solidBox(18, 2.4, 2.2, 0x59625a, 20, 1.2, -34, { map: concrete });
  solidBox(18, 2.4, 2.2, 0x59625a, -20, 1.2, 34, { map: concrete });
  solidBox(18, 2.4, 2.2, 0x59625a, 20, 1.2, 34, { map: concrete });

  // Flanking corridors break long spawn-to-spawn sightlines. Paired vents
  // connect them, creating escapes, ambushes and fast rotations.
  solidBox(2, 4.5, 28, 0x3e4840, -30, 2.25, -27, { map: concrete });
  solidBox(2, 4.5, 28, 0x3e4840, -30, 2.25, 27, { map: concrete });
  solidBox(2, 4.5, 28, 0x3e4840, 30, 2.25, -27, { map: concrete });
  solidBox(2, 4.5, 28, 0x3e4840, 30, 2.25, 27, { map: concrete });
  teleporter('west-vent', -50, 0, 46, 0);
  teleporter('east-vent', 50, 0, -46, 0);
  doorFrame(-50, 0, 6, Math.PI / 2, 0x263028);
  doorFrame(50, 0, 6, Math.PI / 2, 0x263028);

  // Distinctive cover clusters make each quadrant readable at a glance.
  for (const [x, z] of [[-44, -22], [44, 22], [-44, 22], [44, -22]]) {
    solidBox(5, 2.8, 5, 0x59625a, x, 1.4, z, { map: concrete });
  }
  cornerSpawns(52);
}


