import './style.css';
import { applyAction, createGame, premiumAt, publicState, TILE_VALUES, type Action, type GameState, type Placement, type PublicState, type RulesMode } from './scrabble';
import { makeRoomInvite, ScrabbleRoom, type RoomMember, type RoomSettings } from './network';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root is missing.');

let room: ScrabbleRoom | null = null;
let engine: GameState | null = null;
let view: PublicState | null = null;
let pending: Placement[] = [];
let pendingRackIndexes: number[] = [];
let selectedRackIndex: number | null = null;
let exchangeSelection = new Set<number>();
let notice = '';
let noticeKind: 'info' | 'error' | 'success' = 'info';
let inviteBootstrapped = false;

const esc = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] || character);
const setNotice = (message: string, kind: 'info' | 'error' | 'success' = 'info') => { notice = message; noticeKind = kind; render(); };
const currentViewPlayer = () => view?.players.find(player => player.token === room?.token);
const isMyTurn = () => !!view && !!room && !view.finished && view.players[view.turnIndex]?.token === room.token;
const saveSession = () => { if (room) { sessionStorage.setItem('scrabble-session', JSON.stringify({ code: room.code, role: room.role, token: room.token, name: room.name })); localStorage.setItem('scrabble-player-name', room.name); } };
const inviteCode = () => new URLSearchParams(location.hash.slice(1)).get('room')?.trim().toUpperCase() || '';

function roomCallbacks() {
  return {
    status: (_status: string, message: string) => { notice = message; noticeKind = 'info'; render(); },
    error: (message: string) => setNotice(message, 'error'),
    members: (members: RoomMember[], started: boolean, settings: RoomSettings) => {
      if (!room) return;
      if (!started) { notice = `${members.filter(member => member.connected).length} player${members.length === 1 ? '' : 's'} connected.`; renderLobby(members, false, settings); }
    },
    action: (token: string, action: Action) => {
      if (!room || room.role !== 'host' || !engine) return;
      const result = applyAction(engine, token, action);
      if (!result.ok) { setNotice(result.error, 'error'); return; }
      engine = result.state;
      view = publicState(engine, room.token);
      pending = []; pendingRackIndexes = []; selectedRackIndex = null; exchangeSelection.clear();
      notice = result.move.type === 'place' ? `${result.move.playerName} scored ${result.move.score} point${result.move.score === 1 ? '' : 's'}.` : `${result.move.playerName} ${result.move.type === 'pass' ? 'passed.' : 'exchanged letters.'}`;
      noticeKind = 'success';
      renderGame();
      room.broadcastState(tokenFor => publicState(engine as GameState, tokenFor));
    },
    state: (state: unknown) => {
      if (room?.role !== 'guest') return;
      view = state as PublicState;
      pending = []; pendingRackIndexes = []; selectedRackIndex = null; exchangeSelection.clear();
      notice = view.finished ? 'Game over — final scores are shown below.' : 'The board was updated.';
      noticeKind = 'success';
      renderGame();
    },
  };
}

function render() {
  if (!room) {
    const code = inviteCode();
    if (!inviteBootstrapped && code) {
      inviteBootstrapped = true;
      const rememberedName = localStorage.getItem('scrabble-player-name') || window.prompt('Enter your name to join this Scrabble room:', '')?.trim() || '';
      if (rememberedName) { openGuest(rememberedName, code); return; }
    }
    renderHome();
  }
  else if (view) renderGame();
  else renderLobby(room.members, room.isStarted, { rules: room.rules });
}

function renderHome() {
  const hashCode = new URLSearchParams(location.hash.slice(1)).get('room') || '';
  app!.innerHTML = `<main class="shell home-shell">
    <section class="hero"><div class="eyebrow">SCRABBLE · PEER-TO-PEER</div><h1>Make words.<br><em>Make room.</em></h1><p class="lede">A friendly, private Scrabble table for 2–4 people. No account, no central game server — your browser carries the room.</p></section>
    <section class="home-grid">
      <form id="create-form" class="panel action-panel"><div class="panel-kicker">HOST A ROOM</div><h2>Start a new game</h2><label>Your name<input name="name" maxlength="20" required placeholder="e.g. Ariel" /></label><button class="primary" type="submit">Create room <span>↗</span></button><small>Share the invite link with up to three friends.</small></form>
      <form id="join-form" class="panel action-panel"><div class="panel-kicker">JOIN A ROOM</div><h2>Pull up a chair</h2><label>Your name<input name="name" maxlength="20" required placeholder="e.g. Sam" /></label><label>Room code<input name="code" maxlength="6" minlength="6" required value="${esc(hashCode.toUpperCase())}" placeholder="ABC123" autocapitalize="characters" /></label><button class="secondary" type="submit">Join room <span>→</span></button><small>Ask the host for their six-letter room code.</small></form>
    </section>
    <p class="privacy-note">Letters are drawn from the standard 100-tile English bag. The room host coordinates turns through WebRTC; nothing is stored on a game server.</p>
  </main>`;
  document.querySelector<HTMLFormElement>('#create-form')?.addEventListener('submit', event => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); openHost(String(form.get('name') || 'Player')); });
  document.querySelector<HTMLFormElement>('#join-form')?.addEventListener('submit', event => { event.preventDefault(); const form = new FormData(event.currentTarget as HTMLFormElement); openGuest(String(form.get('name') || 'Player'), String(form.get('code') || '')); });
}

function openHost(name: string) {
  room?.close(); engine = null; view = null;
  history.replaceState(null, '', location.pathname);
  room = ScrabbleRoom.createHost(name, undefined, roomCallbacks()); saveSession(); renderLobby(room.members, false, { rules: room.rules });
}

function openGuest(name: string, code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(normalized)) { setNotice('Enter the six-character room code.', 'error'); return; }
  room?.close(); engine = null; view = null;
  history.replaceState(null, '', `${location.pathname}#room=${encodeURIComponent(normalized)}`);
  room = ScrabbleRoom.join(normalized, name, undefined, roomCallbacks()); saveSession(); renderLobby(room.members, false, { rules: room.rules });
}

function memberRows(members: RoomMember[]) {
  return members.map((member, index) => `<li class="member-row"><span class="member-number">${index + 1}</span><span class="member-name">${esc(member.name)}${member.isHost ? ' <span class="host-tag">HOST</span>' : ''}</span><span class="connection-dot ${member.connected ? 'online' : ''}"></span><span class="member-state">${member.connected ? 'ready' : 'offline'}</span></li>`).join('');
}

function renderLobby(members: RoomMember[], started: boolean, settings: RoomSettings = { rules: room?.rules || 'friendly' }) {
  if (!room) return renderHome();
  const activeCount = members.filter(member => member.connected).length;
  const rulesControl = room.role === 'host'
    ? `<label class="rules-control">Room rules<select id="rules-mode" ${started ? 'disabled' : ''}><option value="friendly" ${settings.rules === 'friendly' ? 'selected' : ''}>Friendly · unique words, neutral centre</option><option value="official" ${settings.rules === 'official' ? 'selected' : ''}>Official · repeated words, centre double-word</option></select></label>`
    : `<div class="rules-summary"><span class="muted-label">ROOM RULES</span><strong>${settings.rules === 'friendly' ? 'Friendly room' : 'Official Scrabble'}</strong><small>${settings.rules === 'friendly' ? 'A word can be used once; the centre is neutral.' : 'Repeating a legal word is allowed; the centre doubles the opening word.'}</small></div>`;
  app!.innerHTML = `<main class="shell lobby-shell"><header class="topbar"><button id="leave-room" class="text-button">← Leave room</button><div class="brand">SCRABBLE<span>ROOM</span></div><div class="room-code-label">ROOM <strong>${esc(room.code)}</strong></div></header>
    <section class="lobby-layout"><div class="lobby-copy"><div class="eyebrow">${room.role === 'host' ? 'YOU ARE HOSTING' : 'YOU ARE JOINING'}</div><h1>${room.role === 'host' ? 'Set the table.' : 'You’re almost in.'}</h1><p>${room.role === 'host' ? 'Invite your friends, then start when everyone has joined.' : 'Keep this tab open while the host gathers the table.'}</p><div class="invite-box"><div><span class="muted-label">INVITE LINK</span><strong>${esc(makeRoomInvite(room.code))}</strong></div><button id="copy-invite" class="icon-button" title="Copy invite link">⧉</button></div><div id="lobby-notice" class="notice ${noticeKind}">${esc(notice || (started ? 'Starting game…' : 'Waiting for players…'))}</div></div>
    <div class="panel roster-panel"><div class="panel-kicker">TABLE · ${activeCount}/4 PLAYERS</div><h2>Who’s playing?</h2><ul class="member-list">${memberRows(members)}</ul>${rulesControl}${room.role === 'host' ? `<button id="start-game" class="primary" ${activeCount < 2 || started ? 'disabled' : ''}>${started ? 'Starting…' : activeCount < 2 ? 'Waiting for one more player' : 'Start game'} <span>→</span></button>` : '<div class="waiting-pulse"><span></span> Waiting for the host to start</div>'}${room.role === 'guest' && noticeKind === 'error' ? '<button id="retry-connection" class="ghost retry-button">Try connection again</button>' : ''}<p class="roster-help">${activeCount < 2 ? 'Scrabble needs at least two players.' : 'Up to four players can share this room.'}</p></div></section></main>`;
  document.querySelector<HTMLButtonElement>('#leave-room')?.addEventListener('click', leaveRoom);
  document.querySelector<HTMLButtonElement>('#copy-invite')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(makeRoomInvite(room!.code)); setNotice('Invite link copied.', 'success'); } catch { setNotice(makeRoomInvite(room!.code), 'info'); } });
  document.querySelector<HTMLButtonElement>('#start-game')?.addEventListener('click', startGame);
  document.querySelector<HTMLButtonElement>('#retry-connection')?.addEventListener('click', retryConnection);
  document.querySelector<HTMLSelectElement>('#rules-mode')?.addEventListener('change', event => room?.setRules((event.currentTarget as HTMLSelectElement).value as RulesMode));
}

function startGame() {
  if (!room || room.role !== 'host') return;
  const members = room.members.filter(member => member.connected).slice(0, 4).map(member => ({ token: member.token, name: member.name }));
  if (members.length < 2) return setNotice('At least two connected players are required.', 'error');
  engine = createGame(room.code, members, Math.random, room.rules); view = publicState(engine, room.token); room.start();
  notice = room.rules === 'friendly' ? 'Game started — the centre star is neutral and each word may be used once.' : 'Game started — the opening word uses the centre double-word square.'; noticeKind = 'success'; renderGame();
  room.broadcastState(token => publicState(engine as GameState, token));
}

function boardCell(row: number, col: number) {
  const committed = view?.board[row][col];
  const pendingIndex = pending.findIndex(item => item.row === row && item.col === col);
  const provisional = pending[pendingIndex];
  const label = provisional?.letter || committed?.letter || '';
  const center = row === 7 && col === 7;
  const centerNeutral = center && view?.rules === 'friendly';
  const premium = centerNeutral ? '' : premiumAt(row, col);
  const premiumLabel = center ? '★' : premium;
  return `<button class="board-cell ${committed ? 'occupied' : ''} ${provisional ? 'provisional' : ''} ${centerNeutral ? 'center-neutral' : ''} ${premium ? `premium-${premium.toLowerCase()}` : ''}" data-row="${row}" data-col="${col}" ${!isMyTurn() || (committed && !provisional) ? 'disabled' : ''}><span>${esc(label)}</span>${!label && premiumLabel ? `<small>${premiumLabel}</small>` : ''}</button>`;
}

function rackHtml() {
  const rack = currentViewPlayer()?.rack || [];
  return rack.map((tile, index) => {
    const value = TILE_VALUES[tile] ?? 0;
    return `<button class="rack-tile ${selectedRackIndex === index ? 'selected' : ''} ${exchangeSelection.has(index) ? 'exchange-selected' : ''} ${pendingRackIndexes.includes(index) ? 'used' : ''}" data-rack-index="${index}" ${pendingRackIndexes.includes(index) ? 'disabled' : ''}><strong>${tile === '_' ? '·' : esc(tile)}</strong><small>${tile === '_' ? 'blank' : value}</small></button>`;
  }).join('');
}

function statusLine() {
  if (!view || !room) return '';
  if (view.finished) return 'Game over — see the final scores below.';
  const active = view.players[view.turnIndex];
  const last = view.history.at(-1);
  if (active.token === room.token) return 'It’s your turn — make a play.';
  if (last) return `${last.playerName} already played. Waiting for ${esc(active.name)}.`;
  return `Waiting for ${esc(active.name)} to play.`;
}

function renderGame() {
  if (!room || !view) return render();
  const own = currentViewPlayer();
  const active = view.players[view.turnIndex];
  const recent = view.history.slice(-5).reverse();
  const topScore = view.players.length ? Math.max(...view.players.map(player => player.score)) : 0;
  const winners = view.players.filter(player => player.score === topScore);
  const finishHeadline = winners.length > 1 ? 'A tied table.' : `${esc(winners[0]?.name || 'The winner')} wins.`;
  app!.innerHTML = `<main class="shell game-shell"><header class="topbar"><button id="leave-room" class="text-button">← Leave</button><div class="brand">SCRABBLE<span>ROOM</span></div><div class="room-code-label">ROOM <strong>${esc(room.code)}</strong></div></header>
  <section class="game-head"><div><div class="eyebrow">${view.finished ? 'FINAL BOARD' : `TURN ${view.turn}`}</div><h1>${view.finished ? finishHeadline : `Let’s play, ${esc(room.name)}.`}</h1><p class="turn-message"><span class="turn-dot"></span>${statusLine()}</p><div class="game-invite"><span>ROOM <strong>${esc(room.code)}</strong></span><button id="copy-game-invite" class="text-button">Copy invite link</button></div></div><div class="bag-card"><span class="bag-icon">▦</span><div><strong>${view.bagCount}</strong><small>letters left in bag</small></div></div></section>
  <section class="game-layout"><div class="board-wrap"><div class="board" aria-label="Scrabble board">${Array.from({ length: 15 }, (_, row) => Array.from({ length: 15 }, (_, col) => boardCell(row, col)).join('')).join('')}</div><div class="board-legend"><span><i class="legend-swatch tw"></i>Triple word</span><span><i class="legend-swatch dw"></i>Double word</span><span><i class="legend-swatch tl"></i>Triple letter</span><span><i class="legend-swatch dl"></i>Double letter</span></div></div>
  <aside class="side-column"><div class="panel scores-panel"><div class="panel-kicker">SCOREBOARD</div><div class="scores-list">${view.players.map(player => `<div class="score-row ${player.token === active.token ? 'active' : ''}"><div class="score-avatar">${esc(player.name.slice(0, 1).toUpperCase())}</div><div class="score-player"><strong>${esc(player.name)}${player.token === room!.token ? ' <small>(you)</small>' : ''}</strong><span>${player.token === active.token && !view!.finished ? 'playing now' : `${player.rackCount} tile${player.rackCount === 1 ? '' : 's'} left`}</span></div><b>${player.score}</b></div>`).join('')}</div></div><div class="panel history-panel"><div class="panel-kicker">RECENT PLAYS</div>${recent.length ? `<ul class="history-list">${recent.map(move => `<li><span>${esc(move.playerName)}</span><strong>${move.type === 'place' ? (move.words.map(word => word.word).join(' · ') || 'word') : move.type === 'exchange' ? 'exchanged' : 'passed'}</strong><b>${move.score ? `+${move.score}` : '—'}</b></li>`).join('')}</ul>` : '<p class="empty-history">The first word starts at the star.</p>'}</div></aside></section>
  <section class="play-panel"><div class="rack-header"><div><div class="panel-kicker">YOUR RACK</div><h2>${own?.rackCount || 0} tiles <span>· click a tile, then a square</span></h2></div><div class="notice ${noticeKind}">${esc(notice || statusLine())}</div></div><div class="rack">${rackHtml()}</div><div class="play-controls"><button id="play-word" class="primary" ${!isMyTurn() || !pending.length || view.finished ? 'disabled' : ''}>Play word <span>→</span></button><button id="clear-word" class="secondary" ${!pending.length ? 'disabled' : ''}>Clear</button><button id="pass-turn" class="ghost" ${!isMyTurn() || view.finished ? 'disabled' : ''}>Pass</button><button id="exchange-tiles" class="ghost" ${!isMyTurn() || !exchangeSelection.size || view.finished ? 'disabled' : ''}>Exchange ${exchangeSelection.size ? `(${exchangeSelection.size})` : ''}</button></div><p class="rack-hint">Hold <kbd>Shift</kbd> while clicking tiles to select letters to exchange. Blank tiles score zero.</p></section></main>`;
  bindGameEvents();
}

function bindGameEvents() {
  document.querySelector<HTMLButtonElement>('#leave-room')?.addEventListener('click', leaveRoom);
  document.querySelector<HTMLButtonElement>('#copy-game-invite')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(makeRoomInvite(room!.code)); setNotice('Invite link copied.', 'success'); } catch { setNotice(makeRoomInvite(room!.code), 'info'); } });
  document.querySelectorAll<HTMLButtonElement>('[data-rack-index]').forEach(button => button.addEventListener('click', event => {
    const index = Number((event.currentTarget as HTMLButtonElement).dataset.rackIndex); const mouse = event as MouseEvent;
    if (mouse.shiftKey || mouse.metaKey || mouse.ctrlKey) { exchangeSelection.has(index) ? exchangeSelection.delete(index) : exchangeSelection.add(index); selectedRackIndex = null; }
    else if (!pendingRackIndexes.includes(index)) selectedRackIndex = selectedRackIndex === index ? null : index;
    renderGame();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-row][data-col]').forEach(button => button.addEventListener('click', () => {
    const row = Number(button.dataset.row), col = Number(button.dataset.col); const existing = pending.findIndex(item => item.row === row && item.col === col);
    if (existing >= 0) { pending.splice(existing, 1); pendingRackIndexes.splice(existing, 1); selectedRackIndex = null; renderGame(); return; }
    if (selectedRackIndex === null || !isMyTurn()) return;
    const tile = currentViewPlayer()?.rack?.[selectedRackIndex]; if (!tile || pendingRackIndexes.includes(selectedRackIndex)) return;
    let letter = tile, blank = tile === '_';
    if (blank) { const chosen = window.prompt('Choose a letter for your blank tile (A–Z):', 'E')?.trim().toUpperCase() || ''; if (!/^[A-Z]$/.test(chosen)) return setNotice('A blank tile needs one letter.', 'error'); letter = chosen; }
    const usedRackIndex = selectedRackIndex; pending.push({ row, col, letter, blank }); pendingRackIndexes.push(usedRackIndex); selectedRackIndex = null; exchangeSelection.delete(usedRackIndex); renderGame();
  }));
  document.querySelector<HTMLButtonElement>('#clear-word')?.addEventListener('click', () => { pending = []; pendingRackIndexes = []; selectedRackIndex = null; renderGame(); });
  document.querySelector<HTMLButtonElement>('#play-word')?.addEventListener('click', () => sendAction({ type: 'place', placements: pending }));
  document.querySelector<HTMLButtonElement>('#pass-turn')?.addEventListener('click', () => sendAction({ type: 'pass' }));
  document.querySelector<HTMLButtonElement>('#exchange-tiles')?.addEventListener('click', () => sendAction({ type: 'exchange', indexes: [...exchangeSelection] }));
}

function sendAction(action: Action) {
  if (!room || !isMyTurn()) return;
  if (room.role === 'host') {
    roomCallbacks().action?.(room.token, action);
  } else {
    room.sendAction(action); notice = 'Play sent — waiting for the host to confirm it.'; noticeKind = 'info'; renderGame();
  }
}

function retryConnection() {
  if (!room || room.role !== 'guest') return;
  const { code, name } = room;
  room.close(); room = null; engine = null; view = null; notice = 'Retrying the room connection…'; noticeKind = 'info';
  openGuest(name, code);
}

function leaveRoom() {
  room?.close(); room = null; engine = null; view = null; pending = []; pendingRackIndexes = []; exchangeSelection.clear(); sessionStorage.removeItem('scrabble-session'); history.replaceState(null, '', location.pathname); renderHome();
}

render();
