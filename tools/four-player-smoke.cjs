const WebSocket = require('ws');

const url = process.env.SKULLBOND_WS || 'ws://localhost:3000/ws';
const agents = ['skullpepe', 'daisy', 'mini', 'boss'];
const clients = agents.map((agentId, index) => ({
  name: `CARDINAL ${index + 1}`,
  agentId,
  state: null,
}));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitFor(test, timeout = 10000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const value = test();
      if (value) return resolve(value);
      if (Date.now() - started > timeout) return reject(new Error('Timed out waiting for four-player state'));
      setTimeout(poll, 25);
    };
    poll();
  });
}

function sendInput(client, values) {
  client.ws.send(JSON.stringify({
    type: 'input',
    f: false,
    b: false,
    l: false,
    r: false,
    sprint: false,
    jump: false,
    shoot: false,
    click: false,
    yaw: 0,
    pitch: 0,
    ...values,
  }));
}

async function shoot(shooterIndex, targetIndex, label) {
  const shooterClient = clients[shooterIndex];
  const state = shooterClient.state;
  const shooter = state.players.find((player) => player.name === shooterClient.name);
  const targetName = clients[targetIndex].name;
  const target = state.players.find((player) => player.name === targetName);
  const before = target.hp;
  const dx = target.x - shooter.x;
  const dy = target.y - 0.2 - shooter.y;
  const dz = target.z - shooter.z;
  const distance = Math.hypot(dx, dy, dz);
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.asin(dy / distance);

  sendInput(shooterClient, { yaw, pitch, shoot: true });
  await sleep(80);
  sendInput(shooterClient, { yaw, pitch });
  const after = await waitFor(() => {
    const latest = shooterClient.state?.players.find((player) => player.name === targetName);
    return latest && latest.hp < before ? latest.hp : 0;
  }, 3000);
  console.log(`PASS - ${label} hit registered (${before} -> ${after})`);
  await sleep(250);
}

async function main() {
  for (const client of clients) {
    client.ws = new WebSocket(url);
    client.ws.on('message', (raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'state') client.state = message;
    });
    await new Promise((resolve, reject) => {
      client.ws.once('open', resolve);
      client.ws.once('error', reject);
    });
    client.ws.send(JSON.stringify({
      type: 'join',
      name: client.name,
      agentId: client.agentId,
      mapId: 'stadium',
    }));
  }

  await waitFor(() => clients.every((client) => client.state?.players.length === 4), 15000);
  console.log('PASS - four agents share one authoritative match');
  await sleep(1800);
  await shoot(0, 1, 'eastbound shot');
  await shoot(1, 0, 'westbound shot');
  await shoot(0, 2, 'southbound shot');
  await shoot(2, 0, 'northbound shot');
}

main()
  .then(() => {
    for (const client of clients) client.ws.close();
    console.log('PASS - four-player cardinal combat verified');
  })
  .catch((error) => {
    for (const client of clients) client.ws?.close();
    console.error(`FAIL - ${error.message}`);
    process.exitCode = 1;
  });
