import * as THREE from 'three';

const textures = new Map();
const palette = {
  Bone: '#f3edcf', Cream: '#f3edcf', White: '#f3edcf', Ink: '#141715', Black: '#141715',
  Green: '#57935b', PepeGreen: '#57935b', DarkG: '#284833', Brown: '#79513a',
  Gold: '#e9bd32', Yellow: '#e9bd32', Orange: '#e9bd32', Steel: '#777d78',
  Grey: '#777d78', Red: '#cc3028', PunkRed: '#cc3028',
};

// The authored boxes use Blender's cube cross: 1/4-square faces, offset U=1/8.
// Paint each face separately, not a poster across the primitive's entire unwrap.
function surfaceTexture(kind, base, cube = true) {
  const key = `${kind}:${base}:${cube}`;
  if (textures.has(key)) return textures.get(key);
  const shoe = kind.startsWith('shoe-');
  if (shoe) kind = kind.slice(5);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const g = canvas.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  // UV +U is model +Y on all four upright box faces (not image right).
  // Cylinder caps occupy two circles below V=.5; the top half is only the rim.
  const tiles = cube
    ? [[192, 0, 128, Math.PI / 2], [192, 128, 128, Math.PI / 2],
      [192, 256, 128, Math.PI / 2], [192, 384, 128, Math.PI / 2],
      [64, 128, 128, 0], [320, 128, 128, Math.PI]]
    : [[5.12, 261.12, 245.76, 0], [261.12, 261.12, 245.76, 0, true]];
  for (const [x, y, size, rotation, mirror] of tiles) {
    g.save();
    g.translate(x, y);
    g.scale(size / 128, size / 128);
    g.beginPath(); g.rect(0, 0, 128, 128); g.clip();
    g.translate(64, 64);
    g.rotate(rotation);
    if (mirror) g.scale(-1, 1);
    g.translate(-64, -64);
    // Deterministic fine scuffs; no per-spawn random appearance or asset downloads.
    for (let i = 0; i < 160; i++) {
      g.fillStyle = i % 2 ? '#ffffff12' : '#00000020';
      g.fillRect((i * 47) % 128, (i * 71) % 128, 1 + i % 4, 0.7);
    }
    g.strokeStyle = '#d3b989'; g.lineWidth = 1;
    g.setLineDash([3, 3]); g.strokeRect(5, 5, 118, 118); g.setLineDash([]);
    const skull = (cx, cy, r, color = '#f3edcf') => {
      g.fillStyle = color;
      g.beginPath(); g.ellipse(cx, cy, r, r * 0.85, 0, 0, Math.PI * 2); g.fill();
      g.fillRect(cx - r * 0.55, cy, r * 1.1, r * 1.1);
      g.fillStyle = '#141715';
      for (const dx of [-0.4, 0.4]) {
        g.beginPath(); g.arc(cx + r * dx, cy, r * 0.24, 0, Math.PI * 2); g.fill();
      }
      g.fillRect(cx - 1, cy + r * 0.65, 2, r * 0.45);
    };
    if (kind === 'vest') {
      // Open black vest: retain the cream chest between the two leather panels.
      g.fillStyle = '#202321'; g.fillRect(0, 0, 34, 128); g.fillRect(94, 0, 34, 128);
      g.strokeStyle = '#a79c80'; g.setLineDash([3, 3]);
      g.strokeRect(4, 5, 25, 116); g.strokeRect(99, 5, 25, 116); g.setLineDash([]);
      skull(111, 45, 10);
      g.fillStyle = '#cc3028'; g.fillRect(8, 30, 16, 7);
      for (let i = 0; i < 4; i++) { g.fillStyle = '#a7aaa0'; g.fillRect(9 + i * 3, 10 + i * 3, 3, 3); }
    } else if (kind === 'daisy') {
      for (const [cx, cy] of [[35, 35], [93, 82]]) {
        g.strokeStyle = '#141715'; g.lineWidth = 2; g.fillStyle = '#f3edcf';
        for (let p = 0; p < 8; p++) {
          const a = p * Math.PI / 4;
          g.beginPath(); g.ellipse(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13, 10, 5, a, 0, Math.PI * 2); g.fill(); g.stroke();
        }
        g.fillStyle = '#e9bd32'; g.beginPath(); g.arc(cx, cy, 7, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    } else if (kind === 'tape') {
      // Narrow straps cannot carry a square label without crushing its letters.
      g.fillStyle = '#e9bd32'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#141715';
      for (let i = -128; i < 256; i += 32) {
        g.beginPath(); g.moveTo(0, i); g.lineTo(128, i + 32);
        g.lineTo(128, i + 48); g.lineTo(0, i + 16); g.fill();
      }
    } else if (kind === 'hazard') {
      g.fillStyle = '#e9bd32'; g.fillRect(0, 8, 128, 28); g.fillRect(0, 94, 128, 26);
      g.fillStyle = '#141715';
      for (let i = -32; i < 150; i += 26) {
        g.beginPath(); g.moveTo(i, 94); g.lineTo(i + 13, 94); g.lineTo(i + 39, 120); g.lineTo(i + 26, 120); g.fill();
      }
      g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillText('CAUTION', 64, 30);
      skull(64, 62, 19, '#e9bd32');
    } else if (kind === 'news' || kind === 'courier') {
      g.fillStyle = '#eee3b9'; g.fillRect(16, 18, 96, 88);
      g.fillStyle = '#141715'; g.textAlign = 'center'; g.font = 'bold 15px serif';
      (kind === 'news' ? ['DAILY', 'NEWS'] : ['DELIVER.', 'DESTROY.', 'REPEAT.']).forEach((s, i) => g.fillText(s, 64, 36 + i * 17));
      if (kind === 'news') {
        for (let i = 0; i < 7; i++) { g.fillRect(22, 65 + i * 5, 38, 1); g.fillRect(68, 65 + i * 5, 38, 1); }
      } else skull(64, 88, 10, '#57935b');
    } else if (kind === 'tech') {
      g.strokeStyle = '#57935b'; g.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        g.beginPath(); g.moveTo(12, 18 + i * 25); g.lineTo(35, 18 + i * 25); g.lineTo(48, 8 + i * 25); g.lineTo(113, 8 + i * 25); g.stroke();
      }
      g.fillStyle = '#141715'; g.fillRect(24, 35, 80, 55);
      g.strokeStyle = '#75b86b'; g.beginPath();
      [[28, 64], [40, 64], [47, 50], [55, 78], [65, 44], [75, 69], [83, 58], [100, 58]].forEach(([a, b], i) => i ? g.lineTo(a, b) : g.moveTo(a, b)); g.stroke();
      for (const [i, color] of ['#57935b', '#cc3028', '#e9bd32'].entries()) { g.fillStyle = color; g.beginPath(); g.arc(40 + i * 24, 102, 4, 0, Math.PI * 2); g.fill(); }
    } else if (kind === 'punk' || kind === 'og') {
      g.fillStyle = kind === 'punk' ? '#342e2b' : '#284833'; g.fillRect(28, 23, 72, 79);
      g.strokeStyle = kind === 'punk' ? '#cc3028' : '#d3b989'; g.strokeRect(28, 23, 72, 79);
      skull(64, 59, 23);
      if (kind === 'punk') {
        g.strokeStyle = '#d3b989';
        for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(9 + i * 5, 107); g.lineTo(22 + i * 5, 119); g.stroke(); }
      }
    }
    if (shoe) {
      g.fillStyle = '#f3edcf'; g.fillRect(0, 111, 128, 17);
      g.fillStyle = '#141715'; g.fillRect(0, 117, 128, 2);
      g.strokeStyle = '#f3edcf'; g.lineWidth = 3;
      for (let i = 0; i < 4; i++) {
        g.beginPath(); g.moveTo(9, 23 + i * 18); g.lineTo(22, 32 + i * 18); g.stroke();
      }
    }
    g.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `skin:${key}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.anisotropy = 4;
  textures.set(key, texture);
  return texture;
}

export function applyAgentSurfaces(root, agentId) {
  const style = { skullpepe: 'og', daisy: 'daisy', mini: 'punk', boss: 'courier', drone: 'tech', hazard: 'hazard' }[agentId] || 'og';
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const array = Array.isArray(o.material);
    o.material = (array ? o.material : [o.material]).map(source => {
      const role = source.name.replace(/^(Toon|SP_)/, '');
      const m = source.clone();
      // Even unknown slots must be entity-local so hit flashes cannot leak.
      if (!palette[role]) return m;
      m.color.set(palette[role]);
      m.emissive?.set(0);
      m.emissiveIntensity = 0;
      m.metalness = /Steel|Grey|Gold/.test(role) ? 0.35 : 0;
      m.roughness = /Steel|Grey|Gold/.test(role) ? 0.48 : 0.82;
      let kind;
      let base = palette[role];
      if (/^(Strap[HV]|DeliveryBag|SB_BagBody)$/.test(o.name)) {
        kind = /Strap/.test(o.name) ? (style === 'hazard' ? 'tape' : 'leather') : style;
        base = style === 'punk' || style === 'hazard' ? '#242522' : '#79513a';
      }
      if (/^(Foot[LR]|DeckTop)$/.test(o.name)) {
        // Delivery labels belong on bags, not enlarged across sneaker/deck faces.
        const print = style === 'courier' ? 'og' : style;
        kind = o.name === 'DeckTop' ? print : `shoe-${print}`; base = '#202924';
      }
      if (agentId === 'mini' && o.name === 'Torso') { kind = 'vest'; base = '#f3edcf'; }
      if ((agentId === 'mini' || agentId === 'hazard') && o.name === 'Pelvis') { kind = style; base = '#242522'; }
      if (/^(Paper[12]|PaperStripe|SB_BagPaper)$/.test(o.name)) { kind = 'news'; base = '#eee3b9'; }
      if (o.name === 'RayScreen' || o.name === 'SB_BadgeDisk') { kind = 'tech'; base = '#424a43'; m.metalness = 0.25; }
      if (o.name === 'SB_BadgeDisk') { base = '#777d78'; m.metalness = 0; }
      if (o.name === 'SB_HazPole') { kind = 'tape'; base = '#242522'; }
      if (/^SB_MohEye/.test(o.name)) m.color.set('#141715');
      if (kind && o.geometry.attributes.uv) {
        m.map = surfaceTexture(kind, base, o.name !== 'SB_BadgeDisk');
        m.color.set('#ffffff');
      }
      return m;
    });
    if (!array) o.material = o.material[0];
  });
  return root;
}
