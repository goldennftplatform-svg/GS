export const HITBOX_VERSION = '20260904-body-box-1';
export const EYE_HEIGHT = 1.65;
export const MODEL_HEIGHT = 1.85;
export const AGENT_SCALES = Object.freeze({
  skullpepe: 1, daisy: 1, mini: 0.78, boss: 1.22, drone: 0.92, hazard: 1.05,
});

// tools/agent-bounds.cjs: skull/eyes, torso, shoulders and feet, not the
// outstretched weapon, skateboard, flowers, or identity effects. The asset's
// wheels ground at zero; its feet are slightly above that gameplay anchor.
const normalization = MODEL_HEIGHT / 3.8823629747580224;
const bodyMin = [-0.8823730130584055, -0.5110903571097055, -0.7345229691153057];
const bodyMax = [0.8451122850091412, 2.909064152314934, 0.951724886266118];
const ground = -0.9338316040206245;

export function getBodyBox(agentId) {
  const scale = AGENT_SCALES[agentId] ?? 1;
  // Existing badge chassis: standAndSize(1.05), centered XZ, mounted at .92.
  const min = agentId === 'drone' ? [-0.525, 0.92, -0.175] :
    bodyMin.map((v, i) => (v - (i === 1 ? ground : 0)) * normalization);
  const max = agentId === 'drone' ? [0.525, 1.97, 0.175] :
    bodyMax.map((v, i) => (v - (i === 1 ? ground : 0)) * normalization);
  return { min: min.map(v => v * scale), max: max.map(v => v * scale) };
}

// Ray into a feet-anchored, yaw-aligned box. Returns entry distance (zero
// when starting inside), or Infinity. Directions are normalized by callers.
export function intersectBody(ox, oy, oz, dx, dy, dz, target, maxDist) {
  const { min, max } = getBodyBox(target.agentId);
  const c = Math.cos(target.yaw || 0), s = Math.sin(target.yaw || 0);
  const x = ox - target.x, z = oz - target.z;
  const origin = [c * x - s * z, oy - (target.y - EYE_HEIGHT), s * x + c * z];
  const dir = [c * dx - s * dz, dy, s * dx + c * dz];
  let near = 0, far = maxDist;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(dir[axis]) < 1e-12) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return Infinity;
      continue;
    }
    let a = (min[axis] - origin[axis]) / dir[axis];
    let b = (max[axis] - origin[axis]) / dir[axis];
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return Infinity;
  }
  return near;
}
