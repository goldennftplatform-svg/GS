/**
 * Bakes map collider boxes out of public/js/maps.js into server/colliders.json
 * so the authoritative netplay server can block movement and shots with the
 * same geometry the client renders. Re-run after editing any arena:
 *   npm run build:colliders
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

// --- 2D context stub: every method is a no-op, props assignable ---
function makeCtx2d() {
  return new Proxy({}, {
    get(t, prop) {
      if (prop === 'canvas') return { width: 256, height: 256 };
      return () => {};
    },
    set() { return true; },
  });
}

globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return { width: 0, height: 0, getContext: makeCtx2d };
    return {};
  },
};

// --- THREE stub: self-returning proxy absorbs meshes/materials/textures ---
const T = new Proxy(function () {}, {
  get(t, prop) {
    if (prop === Symbol.toPrimitive) return () => 0;
    if (prop === 'then') return undefined;
    return T;
  },
  apply() { return T; },
  construct() { return T; },
});

const maps = await import(
  pathToFileURL(path.join(root, 'public', 'js', 'maps.js')).href
);
maps.bindThree(T);

const out = {};
for (const m of maps.MAPS) {
  const WALLS = [];
  const ctx = {
    scene: {},
    world: { add() {} },
    WALLS,
    setSpawns() {},
    setBounds() {},
    THREE: T,
  };
  maps.buildMapById(m.id, ctx);
  const r2 = (n) => Math.round(n * 100) / 100;
  out[m.id] = WALLS.map((w) => ({
    minX: r2(w.minX),
    maxX: r2(w.maxX),
    minZ: r2(w.minZ),
    maxZ: r2(w.maxZ),
    base: r2(w.base ?? 0),
    top: r2(w.top ?? 99),
  }));
  console.log(`${m.id}: ${WALLS.length} colliders`);
}

fs.writeFileSync(
  path.join(root, 'server', 'colliders.json'),
  JSON.stringify(out)
);
console.log('wrote server/colliders.json');
