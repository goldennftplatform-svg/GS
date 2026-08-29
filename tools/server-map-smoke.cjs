const WebSocket = require('ws');

const ws = new WebSocket(process.env.SKULLBOND_WS || 'ws://localhost:3000/ws');
let lastPosition = null;
let routeStage = -1;
let moveTimer = null;
const timeout = setTimeout(() => {
  console.error('FAIL - authoritative Facility panel interaction', lastPosition);
  process.exit(1);
}, 15000);

function move(yaw) {
  clearInterval(moveTimer);
  const send = () => ws.send(JSON.stringify({ type: 'input', f: true, yaw, pitch: 0 }));
  send();
  moveTimer = setInterval(send, 40);
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
    if (me) {
      lastPosition = { x: me.x, z: me.z };
      if (routeStage === 0 && me.z <= -43) {
        routeStage = 1;
        move(-Math.PI / 2);
      } else if (routeStage === 1 && me.x >= -1) {
        routeStage = 2;
        move(Math.PI);
      } else if (routeStage === 2 && me.z >= -29) {
        routeStage = 3;
        clearInterval(moveTimer);
        ws.send(JSON.stringify({ type: 'input', yaw: Math.PI, pitch: 0 }));
        ws.send(JSON.stringify({ type: 'use' }));
      }
    }
  }
  if (message.type === 'welcome') {
    // Route around the south control-room cover from the southwest spawn.
    routeStage = 0;
    move(0);
  }
  if (message.type === 'mapEvent' && message.event === 'reactorSuppressed') {
    clearTimeout(timeout);
    clearInterval(moveTimer);
    console.log('PASS - authoritative Facility panel interaction');
    ws.close();
    setTimeout(() => process.exit(0), 50);
  }
});
