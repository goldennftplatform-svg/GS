const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;
const TICK_MS = 50;
const MATCH_SECONDS = 180;
const PLAYER_HP = 100;
const WEAPON_DAMAGE = 34;
const FIRE_COOLDOWN_MS = 220;
const RESPAWN_MS = 2500;
const HIT_RADIUS = 0.85;
const PLAYER_HEIGHT = 1.6;

const SPAWNS = [
  { x: -18, y: PLAYER_HEIGHT, z: -18, yaw: Math.PI / 4 },
  { x: 18, y: PLAYER_HEIGHT, z: -18, yaw: (3 * Math.PI) / 4 },
  { x: -18, y: PLAYER_HEIGHT, z: 18, yaw: -Math.PI / 4 },
  { x: 18, y: PLAYER_HEIGHT, z: 18, yaw: (-3 * Math.PI) / 4 },
];

const COLORS = ['#6BAF6E', '#E5392D', '#B56A4D', '#8E8E8E'];
const NAMES = ['AGENT ZERO', 'AGENT PEPE', 'AGENT DAISY', 'AGENT BONES'];

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Map<string, any>} */
const players = new Map();
let match = {
  started: false,
  endsAt: 0,
  killFeed: [],
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function freeSpawnIndex() {
  const used = new Set([...players.values()].map((p) => p.spawnIndex));
  for (let i = 0; i < SPAWNS.length; i++) {
    if (!used.has(i)) return i;
  }
  return Math.floor(Math.random() * SPAWNS.length);
}

function spawnPlayer(id, name) {
  const spawnIndex = freeSpawnIndex();
  const s = SPAWNS[spawnIndex];
  const slot = [...players.keys()].length;
  return {
    id,
    name: (name || NAMES[slot % NAMES.length]).slice(0, 16).toUpperCase(),
    color: COLORS[slot % COLORS.length],
    x: s.x,
    y: s.y,
    z: s.z,
    yaw: s.yaw,
    pitch: 0,
    vx: 0,
    vz: 0,
    hp: PLAYER_HP,
    kills: 0,
    deaths: 0,
    tokens: 0,
    lives: 3,
    alive: true,
    shooting: false,
    lastShot: 0,
    respawnAt: 0,
    spawnIndex,
    connected: true,
  };
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    pitch: p.pitch,
    hp: p.hp,
    kills: p.kills,
    deaths: p.deaths,
    tokens: p.tokens,
    lives: p.lives,
    alive: p.alive,
    shooting: p.shooting,
  };
}

function snapshot(forId) {
  return {
    type: 'state',
    you: forId,
    timeLeft: match.started ? Math.max(0, Math.ceil((match.endsAt - Date.now()) / 1000)) : MATCH_SECONDS,
    started: match.started,
    players: [...players.values()].map(publicPlayer),
    killFeed: match.killFeed.slice(-6),
    maxPlayers: MAX_PLAYERS,
  };
}

function broadcast(msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    if (exceptId && client.playerId === exceptId) continue;
    client.send(data);
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function pushFeed(text) {
  match.killFeed.push({ t: Date.now(), text });
  if (match.killFeed.length > 12) match.killFeed.shift();
}

function maybeStartMatch() {
  if (!match.started && players.size >= 1) {
    match.started = true;
    match.endsAt = Date.now() + MATCH_SECONDS * 1000;
    broadcast({ type: 'match', started: true, endsAt: match.endsAt, seconds: MATCH_SECONDS });
  }
}

function resetMatch() {
  match.started = false;
  match.endsAt = 0;
  match.killFeed = [];
  for (const p of players.values()) {
    const s = SPAWNS[p.spawnIndex % SPAWNS.length];
    p.x = s.x;
    p.y = s.y;
    p.z = s.z;
    p.yaw = s.yaw;
    p.pitch = 0;
    p.hp = PLAYER_HP;
    p.kills = 0;
    p.deaths = 0;
    p.tokens = 0;
    p.lives = 3;
    p.alive = true;
    p.respawnAt = 0;
  }
  maybeStartMatch();
}

function clampArena(p) {
  const lim = 22;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
  // Simple wall blocks (Facility-style pillars)
  const blocks = [
    { x: 0, z: 0, r: 2.2 },
    { x: -10, z: 0, r: 1.6 },
    { x: 10, z: 0, r: 1.6 },
    { x: 0, z: -10, r: 1.6 },
    { x: 0, z: 10, r: 1.6 },
  ];
  for (const b of blocks) {
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const d = Math.hypot(dx, dz);
    if (d < b.r + 0.45) {
      const push = (b.r + 0.45 - d) / (d || 1);
      p.x += dx * push;
      p.z += dz * push;
    }
  }
}

function tryShoot(shooter) {
  const now = Date.now();
  if (!shooter.alive) return;
  if (now - shooter.lastShot < FIRE_COOLDOWN_MS) return;
  shooter.lastShot = now;
  shooter.shooting = true;

  const dirX = Math.sin(shooter.yaw) * Math.cos(shooter.pitch);
  const dirY = Math.sin(shooter.pitch);
  const dirZ = -Math.cos(shooter.yaw) * Math.cos(shooter.pitch);

  let best = null;
  let bestT = 48;

  for (const target of players.values()) {
    if (target.id === shooter.id || !target.alive) continue;
    // Ray vs sphere at chest
    const ox = shooter.x;
    const oy = shooter.y;
    const oz = shooter.z;
    const cx = target.x;
    const cy = target.y - 0.2;
    const cz = target.z;
    const fx = ox - cx;
    const fy = oy - cy;
    const fz = oz - cz;
    const b = fx * dirX + fy * dirY + fz * dirZ;
    const c = fx * fx + fy * fy + fz * fz - HIT_RADIUS * HIT_RADIUS;
    const disc = b * b - c;
    if (disc < 0) continue;
    const t = -b - Math.sqrt(disc);
    if (t > 0.2 && t < bestT) {
      bestT = t;
      best = target;
    }
  }

  const impact = {
    x: shooter.x + dirX * Math.min(bestT, 40),
    y: shooter.y + dirY * Math.min(bestT, 40),
    z: shooter.z + dirZ * Math.min(bestT, 40),
  };

  broadcast({
    type: 'shot',
    from: shooter.id,
    origin: { x: shooter.x, y: shooter.y, z: shooter.z },
    impact,
    hit: best ? best.id : null,
  });

  if (best) {
    best.hp -= WEAPON_DAMAGE;
    best.tokens = Math.max(0, best.tokens);
    if (best.hp <= 0) {
      best.hp = 0;
      best.alive = false;
      best.deaths += 1;
      best.lives = Math.max(0, best.lives - 1);
      best.respawnAt = now + RESPAWN_MS;
      shooter.kills += 1;
      shooter.tokens += 5;
      pushFeed(`${shooter.name} ⚡ ${best.name}`);
      broadcast({
        type: 'kill',
        killer: shooter.id,
        victim: best.id,
        text: `${shooter.name} ⚡ ${best.name}`,
      });
    } else {
      broadcast({ type: 'hit', target: best.id, hp: best.hp, by: shooter.id });
    }
  }
}

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) {
    send(ws, { type: 'error', message: 'SERVER FULL — 4 AGENTS MAX' });
    ws.close();
    return;
  }

  let playerId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (msg.type === 'join') {
      if (playerId) return;
      playerId = uid();
      ws.playerId = playerId;
      const p = spawnPlayer(playerId, msg.name);
      players.set(playerId, p);
      maybeStartMatch();
      send(ws, { type: 'welcome', id: playerId, player: publicPlayer(p), maxPlayers: MAX_PLAYERS });
      broadcast({ type: 'join', player: publicPlayer(p) }, playerId);
      send(ws, snapshot(playerId));
      return;
    }

    const p = playerId ? players.get(playerId) : null;
    if (!p) return;

    if (msg.type === 'input') {
      if (!p.alive) return;
      const yaw = Number(msg.yaw) || 0;
      const pitch = Math.max(-1.4, Math.min(1.4, Number(msg.pitch) || 0));
      p.yaw = yaw;
      p.pitch = pitch;

      const speed = msg.sprint ? 9.5 : 6.2;
      let mx = 0;
      let mz = 0;
      if (msg.f) mz -= 1;
      if (msg.b) mz += 1;
      if (msg.l) mx -= 1;
      if (msg.r) mx += 1;
      if (mx || mz) {
        const len = Math.hypot(mx, mz);
        mx /= len;
        mz /= len;
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        const dx = mx * cos + mz * sin;
        const dz = -mx * sin + mz * cos;
        p.x += dx * speed * (TICK_MS / 1000);
        p.z += dz * speed * (TICK_MS / 1000);
        clampArena(p);
      }
      if (msg.shoot) tryShoot(p);
      else p.shooting = false;
      return;
    }

    if (msg.type === 'ping') {
      send(ws, { type: 'pong', t: msg.t });
    }
  });

  ws.on('close', () => {
    if (!playerId) return;
    const p = players.get(playerId);
    players.delete(playerId);
    if (p) {
      pushFeed(`${p.name} LEFT THE FACILITY`);
      broadcast({ type: 'leave', id: playerId, name: p.name });
    }
    if (players.size === 0) {
      match.started = false;
      match.endsAt = 0;
      match.killFeed = [];
    }
  });
});

setInterval(() => {
  const now = Date.now();

  for (const p of players.values()) {
    if (!p.alive && p.respawnAt && now >= p.respawnAt) {
      if (p.lives <= 0) {
        p.lives = 3;
      }
      const s = SPAWNS[p.spawnIndex % SPAWNS.length];
      p.x = s.x + (Math.random() - 0.5) * 2;
      p.y = s.y;
      p.z = s.z + (Math.random() - 0.5) * 2;
      p.yaw = s.yaw;
      p.pitch = 0;
      p.hp = PLAYER_HP;
      p.alive = true;
      p.respawnAt = 0;
      broadcast({ type: 'respawn', id: p.id, player: publicPlayer(p) });
    }
    p.shooting = false;
  }

  if (match.started && now >= match.endsAt) {
    const ranked = [...players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    broadcast({
      type: 'matchEnd',
      standings: ranked.map((p) => ({
        id: p.id,
        name: p.name,
        kills: p.kills,
        deaths: p.deaths,
        tokens: p.tokens,
      })),
    });
    setTimeout(resetMatch, 8000);
    match.started = false;
    match.endsAt = now + 999999;
  }

  for (const client of wss.clients) {
    if (client.readyState !== 1 || !client.playerId) continue;
    send(client, snapshot(client.playerId));
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`SKULLBOND online → http://localhost:${PORT}`);
  console.log(`WebSocket → ws://localhost:${PORT}/ws  (max ${MAX_PLAYERS})`);
});
