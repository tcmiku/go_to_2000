import test from 'node:test';
import assert from 'node:assert/strict';
import { createTogetherService } from '../server/together-service.js';
import { targetPosition, playbackCorrection } from '../public/together-sync.js';
const track={id:'local:test',source:'local',name:'测试唱片',singer:'测试歌手',src:'/data/mp3/test.mp3',duration:180};
function fixture(){let time=100000;const service=createTogetherService({now:()=>time});const first=service('create',{name:'甲'});const second=service('join',{room:first.room,name:'乙'});return {service,first,second,tick:delta=>time+=delta,control:(command,extra={})=>service('control',{room:first.room,revision:service('state',{room:first.room},first.token).revision,command,...extra},first.token)};}
test('independent listeners share song, elapsed progress, pause, seek and resume',()=>{
  const f=fixture();f.control('track',{track});f.tick(12000);
  let state=f.service('state',{room:f.first.room},f.second.token);assert.equal(state.position,12);assert.equal(state.track.src,track.src);assert.equal(state.members.length,2);assert.equal(state.token,undefined);
  f.control('pause');f.tick(5000);state=f.service('state',{room:f.first.room},f.second.token);assert.equal(state.position,12);assert.equal(state.playing,false);
  f.control('seek',{position:65});f.control('play');f.tick(1000);assert.equal(f.service('state',{room:f.first.room},f.second.token).position,66);
  const late=f.service('join',{room:f.first.room,name:'后来的人'});assert.equal(late.position,66);assert.equal(late.members.length,3);
});
test('stale commands cannot overwrite newer selections and all listeners may control',()=>{
  const f=fixture();f.control('track',{track});assert.throws(()=>f.service('control',{room:f.first.room,revision:0,command:'pause'},f.second.token),{status:409});
  const updated=f.service('control',{room:f.first.room,revision:1,command:'pause'},f.second.token);assert.equal(updated.playing,false);
  assert.throws(()=>f.control('seek',{position:Infinity}),{status:400});assert.throws(()=>f.control('seek',{position:181}),{status:400});
});
test('rooms enforce membership, isolation, safe media and expiration',()=>{
  const f=fixture(),other=f.service('create');assert.throws(()=>f.service('state',{room:f.first.room},other.token),{status:401});
  for(const src of ['javascript:alert(1)','/data/mp3/../private.mp3','/data/mp3/%2fprivate.mp3'])assert.throws(()=>f.control('track',{track:{...track,src}}),{status:400});
  f.service('leave',{room:f.first.room},f.second.token);assert.equal(f.service('state',{room:f.first.room},f.first.token).members.length,1);
  f.tick(46000);assert.throws(()=>f.service('state',{room:f.first.room},f.first.token),{status:401});f.tick(3600000);assert.throws(()=>f.service('join',{room:f.first.room}),{status:404});
});
test('playback clamps at end and replay starts at zero',()=>{const f=fixture();f.control('track',{track});f.tick(20000);f.control('seek',{position:179});f.tick(2000);assert.equal(f.service('state',{room:f.first.room},f.second.token).position,180);assert.equal(f.control('play').position,0);});
test('clock compensation and drift correction respect paused and finished tracks',()=>{
  const state={track,position:40,playing:true};assert.equal(targetPosition(state,1200),41.2);assert.equal(targetPosition({...state,playing:false},1200),40);assert.equal(targetPosition(state,200000),180);
  assert.deepEqual(playbackCorrection(30,40),{seek:40,rate:1});assert.deepEqual(playbackCorrection(39.5,40),{seek:null,rate:1.03});assert.deepEqual(playbackCorrection(40.5,40),{seek:null,rate:.97});assert.deepEqual(playbackCorrection(40,40),{seek:null,rate:1});
});


test('mechanical stop is one atomic pause and rewind for every listener',()=>{const f=fixture();f.control('track',{track});f.tick(5000);const stopped=f.control('stop');assert.equal(stopped.position,0);assert.equal(stopped.playing,false);f.tick(1000);assert.equal(f.service('state',{room:f.first.room},f.second.token).position,0);});
