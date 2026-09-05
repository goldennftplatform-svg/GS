import * as THREE from 'three';

// Local camera controls only. Never owns a socket or writes combat input.
export function createMobileSpectator(canvas, getLook, setLook) {
  const panel = document.getElementById('mobileSpectator');
  const motionButton = document.getElementById('motionBtn');
  const status = document.getElementById('motionStatus');
  const recenter = document.getElementById('recenterBtn');
  const zoom = document.getElementById('zoomBtn');
  const coarse = matchMedia('(pointer: coarse)');
  const touchOnly = matchMedia('(hover: none) and (any-pointer: coarse)');
  const pointers = new Map();
  const held = new Map();
  const sensor = new THREE.Quaternion();
  const previous = new THREE.Quaternion();
  const delta = new THREE.Quaternion();
  const view = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const screenTurn = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const deviceTurn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  let session = false, active = false, motion = false, pending = false, baseline = false;
  let generation = 0, sensorTimer = 0, screenAngle = null, fov = 74;
  const capable = () => coarse.matches || (navigator.maxTouchPoints > 0 && touchOnly.matches);
  const ready = () => active && !document.hidden;
  function clearGestures() {
    for (const [id, point] of [...pointers, ...held]) {
      if (point.target.hasPointerCapture(id)) point.target.releasePointerCapture(id);
    }
    pointers.clear();
    held.clear();
    panel.querySelectorAll('[data-fly]').forEach(button => button.classList.remove('held'));
  }
  function stopMotion(message = 'Motion off. Drag to look.') {
    generation++;
    motion = pending = baseline = false;
    clearTimeout(sensorTimer);
    window.removeEventListener('deviceorientation', onMotion);
    status.textContent = message;
    motionButton.textContent = 'Enable Motion';
    motionButton.setAttribute('aria-pressed', 'false');
    recenter.disabled = true;
  }
  function suspend() {
    clearGestures();
    stopMotion();
  }
  function onMotion(event) {
    if (!ready() || !motion || ![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return;
    clearTimeout(sensorTimer);
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    euler.set(THREE.MathUtils.degToRad(event.beta), THREE.MathUtils.degToRad(event.alpha),
      -THREE.MathUtils.degToRad(event.gamma), 'YXZ');
    sensor.setFromEuler(euler).multiply(deviceTurn).multiply(
      screenTurn.setFromAxisAngle(zAxis, -THREE.MathUtils.degToRad(angle)));
    // First sample (also after rotation/recenter) anchors to the existing view.
    if (baseline && screenAngle === angle) {
      delta.copy(previous).invert().multiply(sensor);
      const look = getLook();
      view.setFromEuler(euler.set(look.pitch, look.yaw, 0, 'YXZ')).multiply(delta);
      euler.setFromQuaternion(view, 'YXZ');
      setLook(euler.y, THREE.MathUtils.clamp(euler.x, -1.4, 1.4));
    }
    previous.copy(sensor);
    screenAngle = angle;
    baseline = true;
    status.textContent = 'Motion on. Drag to adjust.';
    recenter.disabled = false;
  }
  motionButton.addEventListener('click', async () => {
    if (!ready()) return;
    if (motion || pending) { stopMotion(); return; }
    const Orientation = window.DeviceOrientationEvent;
    if (!window.isSecureContext || !Orientation) {
      stopMotion('Motion unavailable. Drag to look.');
      return;
    }
    const token = ++generation;
    pending = true;
    status.textContent = 'Requesting motion...';
    motionButton.textContent = 'Cancel Motion';
    try {
      // Must run directly inside this click for iOS permission prompts.
      const permission = typeof Orientation.requestPermission === 'function'
        ? await Orientation.requestPermission() : 'granted';
      if (token !== generation || !ready()) return;
      if (permission !== 'granted') { stopMotion('Motion denied. Drag to look.'); return; }
      pending = false;
      motion = true;
      baseline = false;
      motionButton.textContent = 'Disable Motion';
      motionButton.setAttribute('aria-pressed', 'true');
      status.textContent = 'Waiting for sensor...';
      window.addEventListener('deviceorientation', onMotion);
      sensorTimer = setTimeout(() => stopMotion('No sensor data. Drag to look.'), 4000);
    } catch {
      if (token === generation) stopMotion('Motion unavailable or denied. Drag to look.');
    }
  });
  recenter.addEventListener('click', () => {
    baseline = false;
    status.textContent = 'Recentered. Hold device comfortably.';
  });
  function setZoom(value) {
    fov = THREE.MathUtils.clamp(value, 35, 95);
    zoom.textContent = `Reset Zoom (${Math.round(fov)}\u00b0)`;
  }
  zoom.addEventListener('click', () => setZoom(74));
  canvas.addEventListener('pointerdown', event => {
    if (!ready() || event.pointerType !== 'touch') return;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, target: canvas });
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!ready() || !pointers.has(event.pointerId)) return;
    event.preventDefault();
    const point = pointers.get(event.pointerId);
    const pair = [...pointers.values()].slice(0, 2);
    const distance = () => Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
    const before = pair.length === 2 ? distance() : 0;
    if (pointers.size === 1) {
      const look = getLook();
      setLook(look.yaw - (event.clientX - point.x) * 0.004,
        THREE.MathUtils.clamp(look.pitch - (event.clientY - point.y) * 0.004, -1.4, 1.4));
    }
    point.x = event.clientX;
    point.y = event.clientY;
    if (before > 0 && distance() > 0) setZoom(fov * before / distance());
  });
  function release(event) {
    pointers.delete(event.pointerId);
    const point = held.get(event.pointerId);
    held.delete(event.pointerId);
    if (point && ![...held.values()].some(other => other.target === point.target)) point.target.classList.remove('held');
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    window.addEventListener(type, release);
  }
  panel.querySelectorAll('[data-fly]').forEach(button => {
    button.addEventListener('pointerdown', event => {
      if (!ready()) return;
      event.preventDefault();
      held.set(event.pointerId, { target: button, direction: button.dataset.fly });
      button.classList.add('held');
      button.setPointerCapture(event.pointerId);
    });
  });
  // Safari's native pinch must be suppressed only on the active game surface.
  for (const type of ['touchmove', 'gesturestart', 'gesturechange']) {
    canvas.addEventListener(type, event => { if (ready()) event.preventDefault(); }, { passive: false });
  }
  function refresh() {
    const next = session && capable();
    if (active !== next) suspend();
    active = next;
    document.body.classList.toggle('mobile-spectator', active);
    panel.hidden = !active;
    if (active) document.exitPointerLock?.();
  }
  coarse.addEventListener('change', refresh);
  touchOnly.addEventListener('change', refresh);
  window.addEventListener('blur', suspend);
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
  const rotate = () => { baseline = false; clearGestures(); };
  screen.orientation?.addEventListener('change', rotate);
  window.addEventListener('orientationchange', rotate);
  setZoom(74);
  return {
    get active() { return active; },
    get fov() { return fov; },
    start() { session = true; setZoom(74); refresh(); },
    stop() { session = false; suspend(); refresh(); setZoom(74); },
    movement() {
      const directions = ready() ? new Set([...held.values()].map(point => point.direction)) : new Set();
      return { forward: Number(directions.has('forward')) - Number(directions.has('back')),
        up: Number(directions.has('up')) - Number(directions.has('down')) };
    },
  };
}
