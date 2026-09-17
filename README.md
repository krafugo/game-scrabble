# Scrabble Room

Scrabble Room is a TypeScript/Vite implementation of the classic English Scrabble board game for 2–4 players. It is a static site that uses WebRTC data channels for a small, host-coordinated room, so there is no game database or application backend to run.

## Play

1. Open the deployed site and choose **Create room**.
2. Share the six-character code or invite link with 1–3 friends.
3. Start once everyone is in the lobby.
4. Click a rack tile, then an empty board square. Use the centre star for the first word.
5. Press **Play word**, **Pass**, or hold **Shift** while selecting rack tiles and choose **Exchange**.

The table shows the 15×15 board, premium squares, current turn, recent play, every score, each opponent’s rack count, and the exact number of tiles left in the bag. The host validates every move and broadcasts each player’s redacted board state; a player sees their own rack but never another player’s letters.

The lobby presents both a large six-character room code and a copyable invite link. The current room and game state are saved in the tab, so refreshing restores the lobby or board and reconnects the same player seat instead of returning to the home page.

The engine includes the standard 100-tile English distribution, TWL dictionary checks, centre-star opening, connected/continuous words, cross-word scoring, premium squares, the 50-point seven-tile bonus, exchanges, passes, and end-of-game leftover-tile scoring. Rooms default to **Friendly** rules (a word may be used once and the centre is neutral), with **Official** rules available in the lobby. Official Scrabble treats the centre star as a double-word square and permits a valid word to be formed again elsewhere.

## Local development

```bash
npm install
npm run dev
```

Run the deterministic engine tests and production build:

```bash
npm test
npm run build
```

The optional browser smoke test expects a local preview on port 5198:

```bash
npm run build
npm run preview
npm run test:browser
```

The browser smoke test verifies the lobby, prominent code and invite link, lobby refresh, in-progress and finished-game restoration, score/history persistence, and fixed board-cell sizing. When the local browser runner permits ICE/WebRTC negotiation, it also verifies the first shared game state. Some sandboxed runners cannot establish two local WebRTC peers; in that case it reports the limitation and exercises the same restored UI with deterministic saved state. Set `REQUIRE_WEBRTC=1` to make unavailable WebRTC negotiation fail the smoke test.

## Connection and deployment

GitHub Pages serves the static assets. Rooms come from **[peer-room](https://github.com/krafugo/peer-room)**: the host coordinates the table over a WebRTC data channel when a direct path exists (PeerJS signalling, free STUN, optional probed TURN relays) and over an encrypted store-and-forward relay on public MQTT brokers when it does not. Each guest's redacted state is sealed for that guest alone, so one player cannot read another's rack even on the relay. Seats live in the browser's storage: a refresh, a killed tab or the invite link rejoins the same seat, the host's game state is restored, and an action replayed after a host reload is ignored. The host must still be online for a move to be validated; a guest's action made while the host is away is delivered when the host returns.

`public/connection-config.js` documents the STUN, TURN, broker and PeerServer options. The defaults are shared public services suitable for casual play, with no uptime guarantee from this project.

The `main` branch is published by `.github/workflows/pages.yml`. The `develop` branch is the integration branch; feature commits are merged into a release commit on `main` following a Git-flow-style history.
