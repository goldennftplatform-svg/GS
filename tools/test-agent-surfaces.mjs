// Static material/UV contract test. No browser, server, or gameplay simulation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
class Color {
  constructor(value) { this.value = value; }
  set(value) { this.value = value; return this; }
}
globalThis.__skinThree = { CanvasTexture: class { constructor(canvas) { this.image = canvas; } }, SRGBColorSpace: 'srgb' };
globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }) };
const code = fs.readFileSync(new URL('../public/js/agent-surfaces.js', import.meta.url), 'utf8');
const { applyAgentSurfaces } = await import(`data:text/javascript;base64,${Buffer.from(code.replace("import * as THREE from 'three';", 'const THREE = globalThis.__skinThree;')).toString('base64')}`);
const b = fs.readFileSync(new URL('../public/assets/models/skullpepe.glb', import.meta.url));
const gltf = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
const maps = new Set();
for (const id of ['skullpepe', 'daisy', 'mini', 'boss', 'drone', 'hazard']) {
  const meshes = gltf.nodes.filter(n => n.mesh !== undefined).map(n => {
    const p = gltf.meshes[n.mesh].primitives[0];
    return { name: n.name, isMesh: true, geometry: { attributes: { uv: gltf.accessors[p.attributes.TEXCOORD_0] } },
      material: { name: gltf.materials[p.material].name, color: new Color('source'), emissive: new Color('source'),
        clone() { return { ...this, color: new Color('source'), emissive: new Color('source') }; } } };
  });
  const before = meshes.map(o => ({ geometry: o.geometry, material: o.material }));
  applyAgentSurfaces({ traverse: fn => meshes.forEach(fn) }, id);
  for (const [i, o] of meshes.entries()) {
    assert.equal(o.geometry, before[i].geometry);
    assert.equal(before[i].material.color.value, 'source');
    assert.notEqual(o.material, before[i].material);
    assert.equal(o.material.emissiveIntensity, 0);
  }
  const get = name => meshes.find(o => o.name === name).material;
  assert.equal(get('Skull').color.value, '#f3edcf');
  assert.equal(get('EyeL').color.value, '#141715');
  assert.equal(get('PepeScalp').color.value, '#57935b');
  assert.equal(get('ScreenHeartL').color.value, '#cc3028');
  assert.equal(get('Skull').map, undefined);
  assert.equal(get('FootL').map.flipY, false);
  assert.equal(get('FootL').map, get('FootR').map);
  if (id === 'boss') {
    assert(get('FootL').map.name.includes('shoe-og:'), 'Courier footwear uses skull patches, not shipping labels');
    assert(get('DeliveryBag').map.name.includes('courier:'));
  }
  if (id === 'hazard') {
    assert(get('StrapH').map.name.includes('tape:'), 'Narrow straps use stripes rather than crushed lettering');
    assert(get('StrapV').map.name.includes('tape:'));
  }
  maps.add(get('DeliveryBag').map.name);
}
assert.equal(maps.size, 6, 'Six distinct accessory surface treatments');
for (const [file, id, texturedNode, protectedNode] of [
  ['crew_badge', 'drone', 'SB_BadgeDisk', 'SB_BadgeSkull'],
  ['daily_bag', 'boss', 'SB_BagBody', 'SB_BagHandle'],
  ['hazard_sign', 'hazard', 'SB_HazPole', 'SB_HazSkull'],
]) {
  const bytes = fs.readFileSync(new URL(`../public/assets/models/${file}.glb`, import.meta.url));
  const asset = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const nodes = asset.nodes.filter(n => n.mesh !== undefined).map(n => {
    const primitive = asset.meshes[n.mesh].primitives[0];
    return { name: n.name, isMesh: true, geometry: { attributes: { uv: asset.accessors[primitive.attributes.TEXCOORD_0] } },
      material: { name: asset.materials[primitive.material].name,
        clone() { return { name: this.name, color: new Color(), emissive: new Color() }; } } };
  });
  applyAgentSurfaces({ traverse: fn => nodes.forEach(fn) }, id);
  assert(nodes.find(n => n.name === texturedNode).material.map);
  assert.equal(nodes.find(n => n.name === protectedNode).material.map, undefined);
}
console.log('PASS: source isolation, geometry identity, protected colors, UV texture reuse, six styles (static only)');
