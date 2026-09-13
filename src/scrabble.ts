import twl from 'scrabble-dictionary/en/twl.txt?raw';

export type Tile = string;
export type RulesMode = 'official' | 'friendly';
export type Cell = { letter: string; blank: boolean } | null;
export type Placement = { row: number; col: number; letter: string; blank?: boolean };
export type Action =
  | { type: 'place'; placements: Placement[] }
  | { type: 'exchange'; indexes: number[] }
  | { type: 'pass' };
export type Player = { token: string; name: string; rack: Tile[]; score: number };
export type PlayerView = { token: string; name: string; rack?: Tile[]; rackCount: number; score: number };
export type MoveRecord = {
  playerToken: string; playerName: string; type: Action['type']; score: number; words: Array<{ word: string; score: number }>;
  placements?: Placement[]; letters?: string[]; bagCount: number; turn: number;
};
export type GameState = {
  version: 1; code: string; rules: RulesMode; started: true; finished: boolean; turnIndex: number; turn: number; passes: number;
  board: Cell[][]; bag: Tile[]; players: Player[]; history: MoveRecord[];
};
export type PublicState = Omit<GameState, 'bag' | 'players'> & { bagCount: number; players: PlayerView[] };

const distribution: Record<string, { amount: number; points: number }> = {
  A: { amount: 9, points: 1 }, B: { amount: 2, points: 3 }, C: { amount: 2, points: 3 }, D: { amount: 4, points: 2 }, E: { amount: 12, points: 1 },
  F: { amount: 2, points: 4 }, G: { amount: 3, points: 2 }, H: { amount: 2, points: 4 }, I: { amount: 9, points: 1 }, J: { amount: 1, points: 8 },
  K: { amount: 1, points: 5 }, L: { amount: 4, points: 1 }, M: { amount: 2, points: 3 }, N: { amount: 6, points: 1 }, O: { amount: 8, points: 1 },
  P: { amount: 2, points: 3 }, Q: { amount: 1, points: 10 }, R: { amount: 6, points: 1 }, S: { amount: 4, points: 1 }, T: { amount: 6, points: 1 },
  U: { amount: 4, points: 1 }, V: { amount: 2, points: 4 }, W: { amount: 2, points: 4 }, X: { amount: 1, points: 8 }, Y: { amount: 2, points: 4 }, Z: { amount: 1, points: 10 },
  _: { amount: 2, points: 0 },
};
export const TILE_VALUES = Object.fromEntries(Object.entries(distribution).map(([letter, value]) => [letter, value.points])) as Record<string, number>;
export const TILE_TOTAL = Object.values(distribution).reduce((sum, item) => sum + item.amount, 0);
const words = new Set(twl.split(/\r?\n/).map(word => word.trim().toUpperCase()).filter(Boolean));

const premium = new Map<string, string>();
const addPremium = (kind: string, coords: Array<[number, number]>) => coords.forEach(([row, col]) => premium.set(`${row},${col}`, kind));
addPremium('TW', [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]]);
addPremium('DW', [[1,1],[2,2],[3,3],[4,4],[10,10],[11,11],[12,12],[13,13],[1,13],[2,12],[3,11],[4,10],[10,4],[11,3],[12,2],[13,1],[7,7]]);
addPremium('TL', [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]]);
addPremium('DL', [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]]);
export const premiumAt = (row: number, col: number) => premium.get(`${row},${col}`) || '';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const shuffle = <T>(items: T[], random: () => number) => { for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } return items; };
const inBounds = (row: number, col: number) => row >= 0 && row < 15 && col >= 0 && col < 15;
const key = (row: number, col: number) => `${row},${col}`;
const directions = [[0, 1], [1, 0]] as const;
const cellLetter = (cell: Cell) => cell?.letter || '';
const rackValue = (rack: Tile[]) => rack.reduce((sum, tile) => sum + (TILE_VALUES[tile] || 0), 0);

export function makeBag(): Tile[] {
  return Object.entries(distribution).flatMap(([letter, item]) => Array.from({ length: item.amount }, () => letter));
}
export function drawTiles(state: GameState, player: Player, count: number, random = Math.random) {
  const take = Math.min(count, state.bag.length);
  for (let i = 0; i < take; i++) player.rack.push(state.bag.pop() as Tile);
}
export function createGame(code: string, members: Array<{ token: string; name: string }>, random = Math.random, rules: RulesMode = 'official'): GameState {
  const bag = shuffle(makeBag(), random);
  const state: GameState = { version: 1, code, rules, started: true, finished: false, turnIndex: 0, turn: 1, passes: 0, board: Array.from({ length: 15 }, () => Array<Cell>(15).fill(null)), bag, players: members.slice(0, 4).map(member => ({ token: member.token, name: member.name.slice(0, 20), rack: [], score: 0 })), history: [] };
  state.players.forEach(player => drawTiles(state, player, 7, random));
  return state;
}
export function publicState(state: GameState, token: string): PublicState {
  const { bag, players, ...rest } = copy(state);
  return { ...rest, bagCount: bag.length, players: players.map(player => ({ token: player.token, name: player.name, rack: player.token === token ? player.rack : undefined, rackCount: player.rack.length, score: player.score })) };
}
export function isValidWord(word: string) { return words.has(word.toUpperCase()); }
export function currentPlayer(state: GameState) { return state.players[state.turnIndex]; }

function collectWord(board: Cell[][], row: number, col: number, dr: number, dc: number) {
  let r = row, c = col;
  while (inBounds(r - dr, c - dc) && board[r - dr][c - dc]) { r -= dr; c -= dc; }
  const cells: Array<[number, number]> = [];
  while (inBounds(r, c) && board[r][c]) { cells.push([r, c]); r += dr; c += dc; }
  return cells;
}
function wordString(board: Cell[][], cells: Array<[number, number]>) { return cells.map(([row, col]) => cellLetter(board[row][col])).join(''); }
function adjacentToExisting(board: Cell[][], placements: Placement[]) {
  const placed = new Set(placements.map(item => key(item.row, item.col)));
  return placements.some(item => [[item.row - 1, item.col], [item.row + 1, item.col], [item.row, item.col - 1], [item.row, item.col + 1]].some(([row, col]) => inBounds(row, col) && board[row][col] && !placed.has(key(row, col))));
}

function scoreWord(board: Cell[][], cells: Array<[number, number]>, placed: Set<string>, rules: RulesMode) {
  let points = 0, multiplier = 1;
  for (const [row, col] of cells) {
    const cell = board[row][col] as { letter: string; blank: boolean };
    let letterPoints = cell.blank ? 0 : TILE_VALUES[cell.letter] || 0;
    if (placed.has(key(row, col))) {
      const kind = rules === 'friendly' && row === 7 && col === 7 ? '' : premiumAt(row, col);
      if (kind === 'DL') letterPoints *= 2;
      if (kind === 'TL') letterPoints *= 3;
      if (kind === 'DW') multiplier *= 2;
      if (kind === 'TW') multiplier *= 3;
    }
    points += letterPoints;
  }
  return points * multiplier;
}

function reject(message: string): { ok: false; error: string } { return { ok: false, error: message }; }
export function applyAction(input: GameState, token: string, action: Action, random = Math.random): { ok: true; state: GameState; move: MoveRecord } | { ok: false; error: string } {
  const state = copy(input);
  if (state.finished) return reject('This game is already finished.');
  const playerIndex = state.players.findIndex(player => player.token === token);
  if (playerIndex < 0) return reject('You are not in this room.');
  if (playerIndex !== state.turnIndex) return reject(`It is ${state.players[state.turnIndex].name}’s turn.`);
  const player = state.players[playerIndex];
  let move: MoveRecord = { playerToken: token, playerName: player.name, type: action.type, score: 0, words: [], bagCount: state.bag.length, turn: state.turn };
  if (action.type === 'pass') {
    state.passes++;
    move.bagCount = state.bag.length;
  } else if (action.type === 'exchange') {
    const indexes = [...new Set(action.indexes)].filter(index => Number.isInteger(index)).sort((a, b) => b - a);
    if (!indexes.length || indexes.some(index => index < 0 || index >= player.rack.length)) return reject('Choose one or more letters to exchange.');
    if (state.bag.length < 7) return reject('You can exchange only while at least seven letters remain in the bag.');
    const letters = indexes.map(index => player.rack[index]);
    indexes.forEach(index => player.rack.splice(index, 1));
    state.bag.push(...letters); shuffle(state.bag, random); drawTiles(state, player, letters.length, random);
    move.letters = letters; move.bagCount = state.bag.length;
    state.passes = 0;
  } else if (action.type === 'place') {
    const placements = action.placements.map(item => ({ row: item.row, col: item.col, letter: String(item.letter || '').toUpperCase(), blank: !!item.blank }));
    if (!placements.length || placements.length > 7) return reject('Place between one and seven letters.');
    if (placements.some(item => !inBounds(item.row, item.col) || !/^[A-Z]$/.test(item.letter) || state.board[item.row][item.col])) return reject('Every new letter must be on an empty board square.');
    if (new Set(placements.map(item => key(item.row, item.col))).size !== placements.length) return reject('A square can contain only one new letter.');
    const used = new Set<number>();
    for (const item of placements) {
      const expected = item.blank ? '_' : item.letter;
      const index = player.rack.findIndex((tile, candidate) => tile === expected && !used.has(candidate));
      if (index < 0) return reject(`You do not have the ${item.blank ? 'blank' : item.letter} tile you placed.`);
      used.add(index);
    }
    const sameRow = placements.every(item => item.row === placements[0].row);
    const sameCol = placements.every(item => item.col === placements[0].col);
    if (placements.length > 1 && !sameRow && !sameCol) return reject('Letters must be in one row or one column.');
    const firstMove = !state.board.some(row => row.some(Boolean));
    if (firstMove && !placements.some(item => item.row === 7 && item.col === 7)) return reject('The first word must cover the center star.');
    if (!firstMove && !adjacentToExisting(state.board, placements)) return reject('Your word must connect to the existing board.');
    const board = state.board;
    placements.forEach(item => { board[item.row][item.col] = { letter: item.letter, blank: !!item.blank }; });
    if (placements.length > 1) {
      const dr = sameRow ? 0 : 1, dc = sameRow ? 1 : 0;
      const sorted = [...placements].sort((a, b) => (a.row * dr + a.col * dc) - (b.row * dr + b.col * dc));
      for (let i = 1; i < sorted.length; i++) {
        const distance = Math.abs(sorted[i].row - sorted[i - 1].row) + Math.abs(sorted[i].col - sorted[i - 1].col);
        if (distance !== 1) { placements.forEach(item => { board[item.row][item.col] = null; }); return reject('Letters must touch in one continuous line.'); }
      }
    }
    const placed = new Set(placements.map(item => key(item.row, item.col)));
    const wordsSeen = new Set<string>(); const formed: Array<{ cells: Array<[number, number]>; word: string; score: number }> = [];
    for (const item of placements) for (const [dr, dc] of directions) {
      const cells = collectWord(board, item.row, item.col, dr, dc); const word = wordString(board, cells); const signature = `${cells[0]?.join(',')}:${cells.at(-1)?.join(',')}`;
      if (cells.length > 1 && !wordsSeen.has(signature)) { wordsSeen.add(signature); formed.push({ cells, word, score: 0 }); }
    }
    if (!formed.length || formed.some(entry => !isValidWord(entry.word))) { placements.forEach(item => { board[item.row][item.col] = null; }); const bad = formed.find(entry => !isValidWord(entry.word)); return reject(bad ? `“${bad.word}” is not in the Scrabble dictionary.` : 'Your play must form at least one word.'); }
    if (state.rules === 'friendly') {
      const playedWords = new Set(state.history.flatMap(record => record.words.map(word => word.word.toUpperCase())));
      const wordsThisTurn = new Set<string>();
      const repeated = formed.find(entry => {
        const normalized = entry.word.toUpperCase();
        if (playedWords.has(normalized) || wordsThisTurn.has(normalized)) return true;
        wordsThisTurn.add(normalized);
        return false;
      });
      if (repeated) { placements.forEach(item => { board[item.row][item.col] = null; }); return reject(`“${repeated.word}” was already played in this room.`); }
    }
    formed.forEach(entry => { entry.score = scoreWord(board, entry.cells, placed, state.rules); });
    let total = formed.reduce((sum, entry) => sum + entry.score, 0); if (placements.length === 7) total += 50;
    const indexes = [...used].sort((a, b) => b - a); indexes.forEach(index => player.rack.splice(index, 1));
    drawTiles(state, player, placements.length, random); player.score += total; state.passes = 0;
    move.placements = placements; move.words = formed.map(entry => ({ word: entry.word, score: entry.score })); move.score = total; move.bagCount = state.bag.length;
  }
  state.history.push(move); state.turn = state.turn + 1; state.turnIndex = (state.turnIndex + 1) % state.players.length;
  if (state.bag.length === 0 && state.players.some(item => item.rack.length === 0)) state.finished = true;
  if (state.passes >= state.players.length * 2) state.finished = true;
  if (state.finished) {
    for (const item of state.players) {
      const leftover = rackValue(item.rack);
      if (item.token === token && item.rack.length === 0) continue;
      item.score -= leftover;
    }
    if (player.rack.length === 0 && state.bag.length === 0) player.score += state.players.filter(item => item.token !== token).reduce((sum, item) => sum + rackValue(item.rack), 0);
  }
  return { ok: true, state, move };
}
