// Checks the deployed geometry artifact, never a local server or local module.
// Usage: node tools/live-hitbox.mjs https://your-live-server.example
import assert from 'node:assert/strict';

const base = new URL(process.argv[2] || 'https://skullbond-gs-4p-2026.onrender.com');
assert(base.protocol === 'https:' && !/^(localhost|127\.|\[|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(base.hostname), 'Live HTTPS host required');
async function fetchLive(path) {
  const res = await fetch(new URL(path, base), { cache: 'no-store', signal: AbortSignal.timeout(90000) });
  assert(res.ok, `${path}: HTTP ${res.status}; deploy the fix before verification`);
  return res;
}
const version = await (await fetchLive('/version')).json();
assert.equal(version.hitboxVersion, '20260904-body-box-1');
const source = await (await fetchLive('/js/body-geometry.mjs')).text();
const { HITBOX_VERSION, EYE_HEIGHT, AGENT_SCALES, getBodyBox, intersectBody } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
assert.equal(HITBOX_VERSION, version.hitboxVersion);
assert.deepEqual(AGENT_SCALES, { skullpepe: 1, daisy: 1, mini: 0.78, boss: 1.22, drone: 0.92, hazard: 1.05 });
let cases = 0;
for (const agentId of Object.keys(AGENT_SCALES)) {
  const { min, max } = getBodyBox(agentId);
  for (const yaw of [0, Math.PI / 2, -0.7]) {
    for (const lift of [0, 2]) {
      const target = { agentId, x: 3, y: EYE_HEIGHT + lift, z: -4, yaw };
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
      function cast(x, y, z, dx, dy, dz, range = 20) {
        return intersectBody(target.x + c*x + s*z, lift + y, target.z - s*x + c*z,
          c*dx + s*dz, dy, -s*dx + c*dz, target, range);
      }
      for (const y of [min[1] + 0.001, cy, max[1] - 0.001]) {
        assert(Math.abs(cast(cx, y, 10, 0, 0, -1) - (10 - max[2])) < 1e-8);
        cases++;
      }
      assert.equal(cast(cx, max[1] + 0.001, 10, 0, 0, -1), Infinity);
      assert.equal(cast(cx, min[1] - 0.001, 10, 0, 0, -1), Infinity);
      assert.equal(cast(max[0] + 0.001, cy, 10, 0, 0, -1), Infinity);
      assert.equal(cast(min[0] - 0.001, cy, 10, 0, 0, -1), Infinity);
      assert.equal(cast(cx, cy, 10, 0, 0, -1, 10 - max[2] - 0.001), Infinity);
      assert.equal(cast(cx, cy, 10, 0, 0, 1), Infinity);
      assert.equal(cast(cx, cy, (min[2] + max[2]) / 2, 0, 1, 0), 0);
      for (const sign of [-1, 1]) {
        const dy = sign * 0.05, dz = -Math.sqrt(1 - dy*dy);
        assert(Number.isFinite(cast(cx, cy - dy * 10, 10, 0, dy, dz)));
      }
      cases += 9;
    }
  }
}
console.log(`PASS: ${cases} deployed geometry checks`, version);
console.log('Artifact checks only. Live multiplayer shots and visual alignment still require gameplay verification.');
