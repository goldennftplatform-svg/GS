const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000/ws');
let lastPosition = null;
const timeout = setTimeout(() => {
  console.error('FAIL - authoritative Facility panel interaction', lastPosition);
  process.exit(1);
}, 5000);

function move(yaw, count) {
  for (let i = 0; i < count; i++) {
    ws.send(JSON.stringify({ type: 'input', f: true, yaw, pitch: 0 }));
  }
}

ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'join',
    name: 'MAPTEST',
    agentId: 'skullpepe',
    mapId: 'facility',
  }));
});

ws.on('message', (raw) => {
  const message = JSON.parse(String(raw));
  if (message.type === 'state') {
    const me = message.players.find((player) => player.name === 'MAPTEST');
    if (me) lastPosition = { x: me.x, z: me.z };
  }
  if (message.type === 'welcome') {
    // Route around the south control-room cover from the southwest spawn.
    move(0, 18);
    move(-Math.PI / 2, 69);
    move(Math.PI, 34);
    setTimeout(() => ws.send(JSON.stringify({ type: 'use' })), 150);
  }
  if (message.type === 'mapEvent' && message.event === 'reactorSuppressed') {
    clearTimeout(timeout);
    console.log('PASS - authoritative Facility panel interaction');
    ws.close();
    setTimeout(() => process.exit(0), 50);
  }
});
