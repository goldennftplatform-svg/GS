// Original SKULLbond cue: "Cipher After Midnight". No samples or borrowed melodies.
(() => {
  const controls = document.getElementById('musicControls');
  const button = document.getElementById('musicButton');
  const panel = document.getElementById('musicPanel');
  const slider = document.getElementById('musicVolume');
  const output = document.getElementById('musicValue');
  const mute = document.getElementById('musicMute');
  const status = document.getElementById('musicStatus');
  const storageKey = 'skullbond.music.v1';
  let volume = 25, muted = false;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (Number.isFinite(saved?.volume)) volume = Math.max(0, Math.min(100, saved.volume));
    if (typeof saved?.muted === 'boolean') muted = saved.muted;
  } catch { /* Storage can be unavailable in private browsing. */ }

  let context, bus, noise, timer, pending = false, unlocked = false, away = false;
  let step = 0, next = 0;
  const voices = new Set();
  const beat = 60 / 116 / 4;
  // Eight composed bars: E minor, C major, A minor, B dominant and return.
  const roots = [40, 40, 36, 36, 45, 45, 35, 35];
  const riff = [
    [76, -1, 71, 74, -1, 67, 69, -1, 71, -1, 78, 76, -1, 74, 71, -1],
    [67, -1, 71, -1, 74, 76, -1, 78, 79, -1, 78, 74, 71, -1, 69, -1],
    [76, -1, 79, 74, -1, 72, 71, -1, 67, -1, 69, 71, 74, -1, 72, -1],
    [72, -1, 67, -1, 76, 74, -1, 71, 69, -1, 67, 64, -1, 67, 71, -1],
    [81, -1, 76, 79, -1, 72, 74, -1, 76, -1, 74, 72, 71, -1, 69, -1],
    [72, -1, 76, -1, 79, 81, -1, 76, 74, -1, 72, 71, -1, 69, 72, -1],
    [75, -1, 78, 81, -1, 78, 75, -1, 71, -1, 69, 66, 63, -1, 66, -1],
    [71, -1, 75, -1, 78, 75, -1, 69, 66, -1, 63, 66, 71, -1, -1, -1],
  ];
  const hz = note => 440 * 2 ** ((note - 69) / 12);
  function voice(type, frequency, time, duration, level, endFrequency) {
    const source = type === 'noise' ? context.createBufferSource() : context.createOscillator();
    const envelope = context.createGain();
    if (type === 'noise') source.buffer = noise;
    else {
      source.type = type;
      source.frequency.setValueAtTime(frequency, time);
      if (endFrequency) source.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
    }
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(level, time + 0.003);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(envelope);
    envelope.connect(bus);
    voices.add(source);
    source.onended = () => { source.disconnect(); envelope.disconnect(); voices.delete(source); };
    source.start(time);
    source.stop(time + duration + 0.01);
  }
  function stop() {
    clearTimeout(timer);
    timer = null;
    for (const source of voices) { try { source.stop(); } catch {} }
    next = 0;
  }
  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!context || context.state !== 'running' || document.hidden || away || muted || !volume) return;
    // Never catch up missed beats after throttling; at most two ticks per lookahead.
    if (next < context.currentTime) next = context.currentTime + 0.025;
    while (next < context.currentTime + 0.15) {
      const bar = Math.floor(step / 16), tick = step % 16, root = roots[bar];
      const major = bar === 2 || bar === 3 || bar >= 6;
      if (riff[bar][tick] >= 0) voice('square', hz(riff[bar][tick]), next, 0.095, 0.055);
      if (tick % 4 === 0) {
        const walk = [0, 7, 12, bar >= 6 ? 11 : 10];
        voice('triangle', hz(root + walk[tick / 4]), next, 0.32, 0.18);
      }
      if (tick === 2 || tick === 7 || tick === 10 || tick === 14) {
        for (const interval of [0, major ? 4 : 3, 7]) {
          voice('square', hz(root + 12 + interval), next, 0.065, 0.022);
        }
      }
      if (tick === 0 || tick === 8) voice('sine', 130, next, 0.12, 0.22, 38);
      if (tick === 4 || tick === 12) voice('noise', 0, next, 0.09, 0.1);
      if (tick % 2 === 0) voice('noise', 0, next, 0.025, tick % 4 ? 0.035 : 0.02);
      step = (step + 1) % 128;
      next += beat;
    }
    timer = setTimeout(schedule, 50);
  }
  function render() {
    slider.value = volume;
    output.value = `${volume}%`;
    mute.setAttribute('aria-pressed', String(muted));
    mute.textContent = muted ? 'UNMUTE' : 'MUTE';
    button.textContent = muted || !volume ? '[MUSIC OFF]' : '[MUSIC]';
    status.textContent = muted || !volume ? 'Music off' : context?.state === 'running' ? 'Cipher After Midnight' : 'Ready on next interaction';
  }
  async function sync() {
    if (!context) return;
    bus.gain.setTargetAtTime(muted ? 0 : volume / 100, context.currentTime, 0.015);
    const active = () => unlocked && !document.hidden && !away && !muted && volume > 0;
    if (!active()) {
      stop();
      await context.suspend().catch(() => {});
      render();
      return;
    }
    if (pending) return;
    pending = true;
    try {
      await context.resume();
      if (active() && context.state === 'running') schedule();
      else { stop(); await context.suspend(); }
    } catch { /* A subsequent real gesture can retry blocked/interrupted audio. */ }
    finally { pending = false; render(); }
  }
  function gesture(event) {
    if (!event.isTrusted || document.hidden || away) return;
    unlocked = true;
    if (!context) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { status.textContent = 'Music unavailable'; return; }
      try {
        context = new AC();
        bus = context.createGain();
        bus.gain.value = muted ? 0 : volume / 100;
        bus.connect(context.destination);
        noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.12), context.sampleRate);
        const data = noise.getChannelData(0);
        let seed = 0x534b554c, previous = 0;
        for (let i = 0; i < data.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const sample = seed / 2147483648 - 1;
          data[i] = (sample - previous) * 0.5;
          previous = sample;
        }
        context.onstatechange = () => {
          if (context.state !== 'running') stop();
          else if (muted) { void context.suspend().catch(() => {}); }
          else if (!document.hidden && !away && !muted && volume) schedule();
          render();
        };
      } catch { status.textContent = 'Music unavailable'; return; }
    }
    void sync();
  }
  function preference() {
    try { localStorage.setItem(storageKey, JSON.stringify({ volume, muted })); } catch {}
    render();
    void sync();
  }
  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
  });
  controls.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.focus();
    }
  });
  slider.addEventListener('input', () => { volume = Number(slider.value); preference(); });
  mute.addEventListener('click', () => { muted = !muted; preference(); });
  // Observe gestures without cancelling or consuming game/menu input.
  window.addEventListener('pointerdown', gesture, { capture: true, passive: true });
  window.addEventListener('keydown', gesture, { capture: true });
  document.addEventListener('visibilitychange', () => { void sync(); });
  window.addEventListener('pagehide', () => { away = true; stop(); void sync(); });
  window.addEventListener('pageshow', () => { away = false; void sync(); });
  render();
})();
