// Static GLB accessor bounds only: no server, browser, or gameplay.
const fs = require('node:fs');
const path = require('node:path');
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
  return Array.from({ length: 16 }, (_, i) => {
    const row = i % 4, col = Math.floor(i / 4);
    return [0, 1, 2, 3].reduce((s, k) => s + a[k * 4 + row] * b[col * 4 + k], 0);
  });
}
function matrix(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2*y*y - 2*z*z)*sx, (2*x*y + 2*z*w)*sx, (2*x*z - 2*y*w)*sx, 0,
    (2*x*y - 2*z*w)*sy, (1 - 2*x*x - 2*z*z)*sy, (2*y*z + 2*x*w)*sy, 0,
    (2*x*z + 2*y*w)*sz, (2*y*z - 2*x*w)*sz, (1 - 2*x*x - 2*y*y)*sz, 0,
    tx, ty, tz, 1,
  ];
}
for (const name of (process.argv.length > 2 ? process.argv.slice(2) : ['skullpepe', 'crew_badge'])) {
  const bytes = fs.readFileSync(path.join(__dirname, '../public/assets/models', `${name}.glb`));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const totalMin = [Infinity, Infinity, Infinity], totalMax = [-Infinity, -Infinity, -Infinity];
  function visit(index, parent) {
    const n = gltf.nodes[index], m = multiply(parent, matrix(n));
    if (n.skin !== undefined) throw new Error('Skinned bounds require skin evaluation');
    if (n.mesh !== undefined) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const p of gltf.meshes[n.mesh].primitives) {
        const a = gltf.accessors[p.attributes.POSITION];
        for (let mask = 0; mask < 8; mask++) {
          const v = a.min.map((lo, axis) => mask & (1 << axis) ? a.max[axis] : lo);
          for (let axis = 0; axis < 3; axis++) {
            const value = m[axis]*v[0] + m[4+axis]*v[1] + m[8+axis]*v[2] + m[12+axis];
            min[axis] = Math.min(min[axis], value);
            max[axis] = Math.max(max[axis], value);
          }
        }
      }
      for (let a = 0; a < 3; a++) {
        totalMin[a] = Math.min(totalMin[a], min[a]);
        totalMax[a] = Math.max(totalMax[a], max[a]);
      }
      console.log(name, n.name, JSON.stringify({ min, max }));
    }
    for (const child of n.children || []) visit(child, m);
  }
  for (const n of gltf.scenes[gltf.scene || 0].nodes) visit(n, identity);
  console.log(name, 'TOTAL', JSON.stringify({ min: totalMin, max: totalMax, size: totalMax.map((v, i) => v - totalMin[i]) }));
}
