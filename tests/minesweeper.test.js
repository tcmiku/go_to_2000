import test from 'node:test';
import assert from 'node:assert/strict';
import {createGame,reveal,toggleFlag,neighbors} from '../public/minesweeper.js';

test('every first move has a safe neighborhood and exactly ten mines',()=>{
  for(let first=0;first<81;first++){
    const game=createGame();reveal(game,first,()=>.37);
    assert.equal(game.cells.filter(c=>c.mine).length,10);
    for(const i of [first,...neighbors(game,first)])assert.equal(game.cells[i].mine,false);
    assert.equal(game.cells[first].open,true);
    game.cells.forEach((c,i)=>assert.equal(c.count,neighbors(game,i).filter(n=>game.cells[n].mine).length));
  }
});
test('flagged cells cannot open until unflagged; opened cells cannot be flagged',()=>{
  const game=createGame();toggleFlag(game,40);reveal(game,40);
  assert.equal(game.status,'ready');assert.equal(game.cells[40].open,false);
  toggleFlag(game,40);reveal(game,40,()=>.5);toggleFlag(game,40);
  assert.equal(game.cells[40].flag,false);assert.ok(game.cells.filter(c=>c.open).length>1);
});
test('revealing all safe cells wins and freezes the board',()=>{
  const game=createGame();reveal(game,0,()=>.5);
  game.cells.forEach((c,i)=>{if(!c.mine)reveal(game,i);});
  assert.equal(game.status,'won');assert.equal(game.cells.filter(c=>c.flag).length,10);
  const before=structuredClone(game);toggleFlag(game,game.cells.findIndex(c=>c.mine));reveal(game,1);assert.deepEqual(game,before);
});
test('a mine ends the game and subsequent actions cannot change it',()=>{
  const game=createGame();reveal(game,40,()=>.5);const mine=game.cells.findIndex(c=>c.mine);reveal(game,mine);
  assert.equal(game.status,'lost');assert.equal(game.exploded,mine);
  const before=structuredClone(game);reveal(game,0);toggleFlag(game,0);assert.deepEqual(game,before);
});
