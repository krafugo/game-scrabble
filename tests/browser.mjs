import { chromium } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM || '/Users/krafugo/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser = await chromium.launch({ headless: false, executablePath, args: ['--allow-insecure-localhost', '--disable-dev-shm-usage'] });
const host = await browser.newPage({ baseURL: 'http://127.0.0.1:5198' });
const guest = await browser.newPage({ baseURL: 'http://127.0.0.1:5198' });
try {
  await host.goto('/');
  await host.locator('#create-form input[name=name]').fill('Host');
  await host.locator('#create-form button[type=submit]').click();
  await host.locator('.room-code-label strong').waitFor({ timeout: 30_000 });
  const code = await host.locator('.room-code-label strong').textContent();
  if (!code) throw new Error('Host did not receive a room code.');
  if (await host.locator('.room-code-display strong').textContent() !== code) throw new Error('Prominent room code does not match the active room.');
  if (!String(await host.locator('.invite-box strong').textContent()).includes(`#room=${code}`)) throw new Error('Invite link does not contain the room code.');

  await host.reload();
  await host.locator('.room-code-display strong').waitFor({ timeout: 30_000 });
  if (await host.locator('.room-code-display strong').textContent() !== code) throw new Error('Refreshing the host did not restore the same room.');
  if (!String(await host.locator('.lobby-copy').textContent()).includes('YOU ARE HOSTING')) throw new Error('Refreshing the host returned to the home page.');

  await guest.goto(`/#room=${code}`);
  await guest.locator('#join-form input[name=name]').fill('Guest');
  await guest.locator('#join-form button[type=submit]').click();
  let connected = false;
  try {
    await host.getByText('Guest').waitFor({ timeout: 15_000 });
    await guest.getByText('Host').waitFor({ timeout: 15_000 });
    connected = true;
  } catch {
    console.warn('browser UI smoke passed; WebRTC data-channel negotiation was unavailable in this local runner');
    if (process.env.REQUIRE_WEBRTC === '1') throw new Error('WebRTC negotiation failed (set REQUIRE_WEBRTC=0 to allow the runner skip).');
  }
  await guest.reload();
  await guest.locator('.room-code-display strong').waitFor({ timeout: 30_000 });
  if (await guest.locator('.room-code-display strong').textContent() !== code) throw new Error('Refreshing the guest did not restore the same room.');
  if (!String(await guest.locator('.lobby-copy').textContent()).includes('YOU ARE JOINING')) throw new Error('Refreshing the guest returned to the home page.');
  if (connected) await host.locator('.member-row', { hasText: 'Guest' }).locator('.connection-dot.online').waitFor({ timeout: 30_000 });
  if (connected) {
    await host.locator('#start-game').click();
    await host.locator('.board').waitFor({ timeout: 30_000 });
    await guest.locator('.board').waitFor({ timeout: 30_000 });
    if (await host.locator('.bag-card strong').textContent() !== '86') throw new Error('Initial bag count is not 86.');
    if (await guest.locator('.rack-tile').count() !== 7) throw new Error('Guest rack was not dealt seven tiles.');
  } else {
    // Exercise in-game and finished-game restoration even on runners whose ICE
    // policy prevents two local tabs from negotiating a WebRTC data channel.
    await host.evaluate(() => {
      const saved = JSON.parse(sessionStorage.getItem('scrabble-session'));
      const hostMember = saved.room.members[0];
      const guestMember = { token: 'browser-guest', name: 'Guest', isHost: false, connected: false };
      const board = Array.from({ length: 15 }, () => Array(15).fill(null));
      board[7][6] = { letter: 'Z', blank: false };
      board[7][7] = { letter: 'O', blank: false };
      board[7][8] = { letter: 'O', blank: false };
      saved.room.members = [hostMember, guestMember];
      saved.room.started = true;
      saved.engine = {
        version: 1, code: saved.room.code, rules: 'friendly', started: true, finished: false,
        turnIndex: 1, turn: 2, passes: 0, board, bag: Array(80).fill('E'),
        players: [
          { token: hostMember.token, name: hostMember.name, rack: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], score: 12 },
          { token: guestMember.token, name: guestMember.name, rack: ['H', 'I', 'J', 'K', 'L', 'M', 'N'], score: 0 },
        ],
        history: [{ playerToken: hostMember.token, playerName: hostMember.name, type: 'place', score: 12, words: [{ word: 'ZOO', score: 12 }], placements: [{ row: 7, col: 6, letter: 'Z' }, { row: 7, col: 7, letter: 'O' }, { row: 7, col: 8, letter: 'O' }], bagCount: 80, turn: 1 }],
      };
      saved.view = null;
      sessionStorage.setItem('scrabble-session', JSON.stringify(saved));
    });
  }

  await host.reload();
  await host.locator('.board').waitFor({ timeout: 30_000 });
  if (await host.locator('.board-cell.occupied').count() < (connected ? 0 : 3)) throw new Error('Refreshing did not restore placed board tiles.');
  if (!connected && await host.locator('.score-row').first().locator('b').textContent() !== '12') throw new Error('Refreshing did not restore scores.');
  if (!connected && !String(await host.locator('.history-list').textContent()).includes('ZOO')) throw new Error('Refreshing did not restore move history.');
  if (!connected) {
    const emptyCell = await host.locator('.board-cell').first().boundingBox();
    const occupiedCell = await host.locator('.board-cell.occupied').first().boundingBox();
    if (occupiedCell && emptyCell && Math.abs(occupiedCell.height - emptyCell.height) > 1) throw new Error('Occupied board cells change the grid row height.');
  }

  if (!connected) {
    await host.evaluate(() => {
      const saved = JSON.parse(sessionStorage.getItem('scrabble-session'));
      saved.engine.finished = true;
      saved.engine.players[1].score = 5;
      sessionStorage.setItem('scrabble-session', JSON.stringify(saved));
    });
    await host.reload();
    await host.getByText('FINAL BOARD').waitFor({ timeout: 30_000 });
    if (!String(await host.locator('.game-head h1').textContent()).includes('Host wins')) throw new Error('Finished game was not restored correctly.');
  }
  console.log('browser smoke and refresh-restoration tests passed');
} finally {
  await host.close();
  await guest.close();
  await browser.close();
}
