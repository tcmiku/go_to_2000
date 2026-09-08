import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinball,launchPinball,stepPinball,bumpers} from '../public/pinball.js';

test('launch uses the right channel and repeated launch cannot reset a live ball',()=>{
  const g=createPinball();launchPinball(g);
  assert.equal(g.status,'playing');assert.ok(g.ball.vy<0);
  stepPinball(g,1/120);const y=g.ball.y;launchPinball(g);assert.equal(g.ball.y,y);
});
test('bumper collision adds points and separates the ball',()=>{
  const g=createPinball(),p=bumpers[0];g.status='playing';
  g.ball={x:p.x,y:p.y-25,vx:0,vy:100};stepPinball(g,1/120);
  assert.equal(g.score,100);assert.ok(g.ball.vy<0);
});
test('three drains end the game and require a new game',()=>{
  const g=createPinball();
  for(let i=0;i<3;i++){launchPinball(g);g.ball.y=550;stepPinball(g,1/120);}
  assert.equal(g.lives,0);assert.equal(g.status,'over');
  launchPinball(g);assert.equal(g.status,'over');
});
test('raised flipper sends the ball up while rail collision remains bounded',()=>{
  const g=createPinball();g.status='playing';g.left=1;
  g.ball={x:123,y:442,vx:0,vy:150};stepPinball(g,1/120,{left:true});
  assert.ok(g.ball.vy<0);assert.equal(g.score,10);
});
test('simulation remains finite over repeated frames',()=>{
  const g=createPinball();launchPinball(g);
  for(let i=0;i<12000;i++){
    stepPinball(g,1/120,{left:i%80<40,right:i%100<50});
    assert.ok(Number.isFinite(g.ball.x)&&Number.isFinite(g.ball.y));
    if(g.status==='ready')launchPinball(g);
  }
});
