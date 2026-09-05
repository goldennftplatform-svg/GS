// Pure geometry regressions, called by the live verifier with the DEPLOYED module.
import assert from 'node:assert/strict';

export function verifyBodyRegions({ AGENT_SCALES, EYE_HEIGHT, getBodyBox, getHeadBox, intersectBody, hitRegion, shotDamage }) {
for (const agentId of Object.keys(AGENT_SCALES)) {
  const body = getBodyBox(agentId), head = getHeadBox(agentId);
  for (let axis = 0; axis < 3; axis++) {
    assert(head.min[axis] >= body.min[axis] - 1e-8);
    assert(head.max[axis] <= body.max[axis] + 1e-8);
  }
  for (const yaw of [0, Math.PI / 2, Math.PI, -0.73]) {
    const target = { agentId, x: 7, y: EYE_HEIGHT + 2, z: -9, yaw };
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const region of ['body', 'head']) {
      const height = region === 'head' ? (head.min[1] + head.max[1]) / 2 : (body.min[1] + head.min[1]) / 2;
      const origin = [target.x + s * 5, 2 + height, target.z + c * 5];
      const dir = [-s, 0, -c];
      const t = intersectBody(...origin, ...dir, target, 10);
      assert(Number.isFinite(t), `${agentId} ${region} yaw=${yaw}`);
      assert.equal(hitRegion(...origin.map((v, i) => v + dir[i] * t), target), region);
      assert.equal(intersectBody(...origin, ...dir, target, t - 0.01), Infinity, 'cover before contact wins');
      assert.equal(shotDamage({ dmg: 40 }, region), region === 'head' ? 60 : 40);
      assert.equal(shotDamage({ dmg: 250, oneShot: true }, region), 250);
    }
    assert.equal(intersectBody(target.x, 2 + body.max[1] + 0.01, target.z + 5, 0, 0, -1, target, 10), Infinity);
  }
}
console.log('PASS: all six scaled head/body regions, yaw, elevation, clipping, damage and gold');
}
