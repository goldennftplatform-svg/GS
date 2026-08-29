const WebSocket = require('ws');

const url = process.env.SKULLBOND_WS || 'ws://localhost:3000/ws';
const clients = [
  { name: 'PROBE ALPHA', agentId: 'skullpepe' },
  { name: 'PROBE BRAVO', agentId: 'daisy' },
];
let passed = false;

const timeout = setTimeout(() => {
  console.error('FAIL - two clients did not share authoritative state');
  for (const client of clients) client.ws?.close();
  process.exit(1);
}, 70000);

function finish() {
  if (passed || !clients.every((client) => client.sawBoth)) return;
  passed = true;
  clearTimeout(timeout);
  console.log('PASS - two production clients share authoritative state');
  for (const client of clients) client.ws.close();
  setTimeout(() => process.exit(0), 50);
}

for (const client of clients) {
  const ws = new WebSocket(url);
  client.ws = ws;
  ws.on('open', () => {
    ws.send(JSON.stringify({
      type: 'join',
      name: client.name,
      agentId: client.agentId,
      mapId: 'facility',
    }));
  });
  ws.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type !== 'state') return;
    const names = new Set(message.players.map((player) => player.name));
    client.sawBoth = clients.every((other) => names.has(other.name));
    finish();
  });
  ws.on('error', (error) => {
    console.error(`${client.name}: ${error.message}`);
  });
}
