// Static only: report authored material regions and UV ranges without a renderer.
import fs from 'node:fs';
const names = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
for (const name of (names.length ? names : ['skullpepe', 'daily_bag', 'crew_badge', 'mohawk_head', 'hazard_sign', 'daisy'])) {
  const b = fs.readFileSync(new URL(`../public/assets/models/${name}.glb`, import.meta.url));
  const length = b.readUInt32LE(12);
  const g = JSON.parse(b.toString('utf8', 20, 20 + length));
  const bin = 20 + length + 8;
  console.log(`\n${name}`);
  console.log(JSON.stringify(g.materials, null, 2));
  for (const mesh of g.meshes) {
    for (const p of mesh.primitives) {
      const uv = g.accessors[p.attributes.TEXCOORD_0];
      let range = null;
      if (uv) {
        if (uv.componentType !== 5126) throw new Error('Expected float UVs');
        const v = g.bufferViews[uv.bufferView];
        range = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i < uv.count; i++) {
          const offset = bin + (v.byteOffset || 0) + (uv.byteOffset || 0) + i * (v.byteStride || 8);
          for (let j = 0; j < 2; j++) {
            const value = b.readFloatLE(offset + j * 4);
            range[j] = Math.min(range[j], value);
            range[j + 2] = Math.max(range[j + 2], value);
          }
        }
      }
      console.log(JSON.stringify({ mesh: mesh.name, nodes: g.nodes.filter(n => n.mesh === g.meshes.indexOf(mesh)).map(n => n.name), material: g.materials[p.material]?.name,
        vertices: g.accessors[p.attributes.POSITION].count, uv: range }));
      if (process.argv.includes('--faces') && g.nodes.some(n => n.mesh === g.meshes.indexOf(mesh) && /^(DeliveryBag|SB_BagBody|SB_BadgeDisk)$/.test(n.name))) {
        const attributes = {};
        for (const semantic of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
          const a = g.accessors[p.attributes[semantic]];
          const view = g.bufferViews[a.bufferView];
          const size = semantic === 'TEXCOORD_0' ? 2 : 3;
          attributes[semantic] = Array.from({ length: a.count }, (_, i) => Array.from({ length: size }, (_, j) =>
            b.readFloatLE(bin + (view.byteOffset || 0) + (a.byteOffset || 0) + i * (view.byteStride || size * 4) + j * 4)));
        }
        console.log(JSON.stringify({ faces: attributes, nodes: g.nodes.filter(n => n.mesh === g.meshes.indexOf(mesh)) }));
      }
    }
  }
}
