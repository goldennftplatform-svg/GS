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
`?solo=1` always bypasses the server.

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
