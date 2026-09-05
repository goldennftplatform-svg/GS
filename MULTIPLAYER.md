# SKULLBOND Multiplayer

The Vercel build serves the browser client. Multiplayer runs as a separate
Node.js WebSocket service because Vercel functions cannot hold game sockets.

## Deploy

1. Open [Deploy to Render](https://render.com/deploy?repo=https://github.com/goldennftplatform-svg/GS).
2. Connect the GitHub account that owns the repository.
3. Apply the included `render.yaml` Blueprint without changing the service name.
4. Wait for `https://skullbond-gs-4p-2026.onrender.com/health` to return JSON.

The Vercel client automatically connects to that hostname. Render's free tier
sleeps while idle, so the first player can see `WAKING FREE MULTIPLAYER SERVER`
for up to 75 seconds while the client retries the connection. A failed wake
returns to agent selection instead of silently starting a separate solo match.
`?solo=1` bypasses the server for player deployment. Spectator Mode always
connects to the actual multiplayer server, even with that query flag.

For a different host, open the game with `?ws=https://your-host.example`. The
client remembers that value in local storage until a failed connection clears
it.

## Live Hitbox Verification

`GET /version` on the multiplayer host reports `hitboxVersion` and the Render
commit (or `BUILD_REVISION`, otherwise null). The body-box fix identifies as
`20260904-body-box-1`; the browser reports the same value through
`SKULL_DEBUG.state().hitboxVersion`. Verify both hosts when deploying the client
and server separately.

Run `node tools/live-hitbox.mjs https://skullbond-gs-4p-2026.onrender.com`
to check the deployed geometry artifact for all six scales, rotated/elevated
targets, body edges, misses, range clipping, and signed vertical rays. It does
not launch a server or load local game modules. This is not a gameplay test.
Live gameplay still needs head/torso/feet shots, near misses, wall occlusion,
and moving-target visual checks. Remote poses now use the latest received
snapshot directly; 20 Hz stepping and network latency remain without rewind.

## Live Spectator Verification

Spectator Mode is available in agent selection, including when all four player
slots are occupied. Watchers have no player entity, collision, health, weapons,
or pickup interactions. WASD flies relative to the camera, mouse looks, Space
ascends, Ctrl descends, and Shift triples flight speed. Escape releases the mouse;
Back to Menu disconnects and clears the session. Click the arena to capture the
mouse again. Online matches continue while the mouse is released.

The join packet accepts `role: 'spectator'`; omitting the role joins as a player.
Spectator welcome packets carry `role: 'spectator'` and `id: null`. Snapshots
include `mapId`, and watchers receive the same states and broadcast events as
players. Roles cannot be changed on an existing socket; return to the menu and
join again. Watcher joins/leaves never start or reset a match.

Run `node tools/live-spectator.cjs` after deploying both client and server.
This tool only permits the approved Render HTTPS origin, never starts a local
server, and requires `/version` to report `spectatorVersion: 1` before opening
any gameplay sockets. It refuses occupied rooms and aborts if non-test players
join. It checks empty/full-room observer slots, ignored inputs, shot delivery,
disconnect/map reset behavior, and browser flight/menu/player rejoin. Browser
checks require `puppeteer-core` and installed Edge/Chrome (or `BROWSER_PATH`).
Headless pointer-lock failures are reported as failures, not silently skipped.
The tool does not wait through an entire three-minute match or simulate network
partitions; round-transition and intermittent-network soak checks remain manual.

## Local Verification

Start the server:

```sh
npm start
```

In a second terminal, run:

```sh
npm run test:game
npm run test:multiplayer
npm run test:two-player
```
