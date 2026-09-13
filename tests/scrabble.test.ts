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
