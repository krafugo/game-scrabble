import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, createGame, makeBag, publicState, TILE_TOTAL } from '../src/scrabble';

const fixedRandom = () => 0.25;
const players = [{ token: 'a', name: 'Ariel' }, { token: 'b', name: 'Bea' }];

test('uses the standard 100-tile bag and deals seven tiles per player', () => {
  const bag = makeBag();
  assert.equal(bag.length, TILE_TOTAL);
  const game = createGame('ABC123', players, fixedRandom);
  assert.equal(game.players[0].rack.length, 7);
  assert.equal(game.players[1].rack.length, 7);
  assert.equal(game.bag.length, 86);
});

test('first word must cover the star and dictionary words score premiums', () => {
  const game = createGame('ABC123', players, fixedRandom);
  game.players[0].rack = ['C', 'A', 'T', 'X', 'X', 'X', 'X'];
  const bad = applyAction(game, 'a', { type: 'place', placements: [{ row: 7, col: 6, letter: 'C' }, { row: 7, col: 7, letter: 'A' }, { row: 7, col: 8, letter: 'T' }] }, fixedRandom);
  assert.equal(bad.ok, true);
  if (bad.ok) assert.equal(bad.move.score, 10, 'CAT uses the centre double-word score');
  const offCenter = createGame('ABC123', players, fixedRandom);
  offCenter.players[0].rack = ['C', 'A', 'T', 'X', 'X', 'X', 'X'];
  const rejected = applyAction(offCenter, 'a', { type: 'place', placements: [{ row: 6, col: 5, letter: 'C' }, { row: 6, col: 6, letter: 'A' }, { row: 6, col: 7, letter: 'T' }] }, fixedRandom);
  assert.equal(rejected.ok, false);
});

test('official rules allow a legal repeated word, while friendly rooms reject it and neutralize the star', () => {
  const official = createGame('ABC123', players, fixedRandom, 'official');
  official.players[0].rack = ['Z', 'O', 'O', 'X', 'X', 'X', 'X'];
  const first = applyAction(official, 'a', { type: 'place', placements: [{ row: 7, col: 6, letter: 'Z' }, { row: 7, col: 7, letter: 'O' }, { row: 7, col: 8, letter: 'O' }] }, fixedRandom);
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.move.score, 24, 'official centre star is a double-word square');
    first.state.players[1].rack = ['O', 'O', 'X', 'X', 'X', 'X', 'X'];
    const repeated = applyAction(first.state, 'b', { type: 'place', placements: [{ row: 8, col: 6, letter: 'O' }, { row: 9, col: 6, letter: 'O' }] }, fixedRandom);
    assert.equal(repeated.ok, true);
    if (repeated.ok) assert.equal(repeated.move.words[0].word, 'ZOO');
  }

  const friendly = createGame('ABC123', players, fixedRandom, 'friendly');
  friendly.players[0].rack = ['Z', 'O', 'O', 'X', 'X', 'X', 'X'];
  const houseFirst = applyAction(friendly, 'a', { type: 'place', placements: [{ row: 7, col: 6, letter: 'Z' }, { row: 7, col: 7, letter: 'O' }, { row: 7, col: 8, letter: 'O' }] }, fixedRandom);
  assert.equal(houseFirst.ok, true);
  if (houseFirst.ok) {
    assert.equal(houseFirst.move.score, 12, 'friendly centre is neutral');
    houseFirst.state.players[1].rack = ['O', 'O', 'X', 'X', 'X', 'X', 'X'];
    const rejected = applyAction(houseFirst.state, 'b', { type: 'place', placements: [{ row: 8, col: 6, letter: 'O' }, { row: 9, col: 6, letter: 'O' }] }, fixedRandom);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.error, /already played/i);
  }
});

test('a premium square is consumed after the turn on which it is covered', () => {
  const game = createGame('ABC123', players, fixedRandom, 'official');
  game.players[0].rack = ['A', 'T', 'X', 'X', 'X', 'X', 'X'];
  const opening = applyAction(game, 'a', { type: 'place', placements: [{ row: 7, col: 7, letter: 'A' }, { row: 7, col: 8, letter: 'T' }] }, fixedRandom);
  assert.equal(opening.ok, true);
  if (opening.ok) {
    assert.equal(opening.move.score, 4);
    opening.state.players[1].rack = ['E', 'X', 'X', 'X', 'X', 'X', 'X'];
    const extension = applyAction(opening.state, 'b', { type: 'place', placements: [{ row: 7, col: 9, letter: 'E' }] }, fixedRandom);
    assert.equal(extension.ok, true);
    if (extension.ok) assert.equal(extension.move.score, 3, 'the occupied centre contributes face value on later turns');
  }
});

test('turns rotate, racks refill, and invalid words do not mutate the game', () => {
  const game = createGame('ABC123', players, fixedRandom);
  game.players[0].rack = ['H', 'E', 'L', 'L', 'O', 'X', 'X'];
  const before = JSON.stringify(game);
  const invalid = applyAction(game, 'a', { type: 'place', placements: [{ row: 7, col: 7, letter: 'Q' }, { row: 7, col: 8, letter: 'Z' }] }, fixedRandom);
  assert.equal(invalid.ok, false);
  assert.equal(JSON.stringify(game), before);
  const valid = applyAction(game, 'a', { type: 'place', placements: [{ row: 7, col: 7, letter: 'H' }, { row: 7, col: 8, letter: 'E' }, { row: 7, col: 9, letter: 'L' }, { row: 7, col: 10, letter: 'L' }, { row: 7, col: 11, letter: 'O' }] }, fixedRandom);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.state.turnIndex, 1);
    assert.equal(valid.state.players[0].rack.length, 7);
    assert.equal(valid.state.history.length, 1);
  }
});

test('exchanging tiles returns them to the bag and keeps bag count constant', () => {
  const game = createGame('ABC123', players, fixedRandom);
  const original = [...game.players[0].rack];
  const bagBefore = game.bag.length;
  const result = applyAction(game, 'a', { type: 'exchange', indexes: [0, 1] }, fixedRandom);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.state.bag.length, bagBefore);
    assert.equal(result.state.players[0].rack.length, 7);
    assert.equal(result.move.letters?.length, 2);
    assert.equal(result.state.players[1].rack.length, 7);
    assert.ok(original.some(letter => result.state.bag.includes(letter)) || result.state.players[0].rack.some(letter => original.includes(letter)));
  }
});

test('public state reveals only the requesting player rack and always exposes bag count', () => {
  const game = createGame('ABC123', players, fixedRandom);
  const state = publicState(game, 'a');
  assert.equal(state.bagCount, 86);
  assert.equal(state.players[0].rack?.length, 7);
  assert.equal(state.players[1].rack, undefined);
  assert.equal(state.players[1].rackCount, 7);
});

test('two passes per player finish a quiet game', () => {
  let game = createGame('ABC123', players, fixedRandom);
  for (let i = 0; i < 4; i++) {
    const result = applyAction(game, players[i % 2].token, { type: 'pass' }, fixedRandom);
    assert.equal(result.ok, true);
    if (result.ok) game = result.state;
  }
  assert.equal(game.finished, true);
});

test('finishing with an empty bag applies the out-player bonus and subtracts leftovers', () => {
  const game = createGame('ABC123', players, fixedRandom, 'friendly');
  game.bag = [];
  game.board[7][6] = { letter: 'A', blank: false };
  game.players[0].rack = ['T'];
  game.players[1].rack = ['Z'];
  const result = applyAction(game, 'a', { type: 'place', placements: [{ row: 7, col: 7, letter: 'T' }] }, fixedRandom);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.state.finished, true);
    assert.equal(result.state.players[0].rack.length, 0);
    assert.equal(result.state.players[0].score, 12, 'AT scores two points and receives the opponent leftover bonus');
    assert.equal(result.state.players[1].score, -10, 'the Z left on the rack is deducted');
  }
});
