import test from 'node:test';
import assert from 'node:assert/strict';
import { createSharedListeningPlayer } from '../public/listening-shared.js';
const track={id:'local:one',name:'One',source:'local',src:'/data/mp3/One.mp3',duration:180};
function fixture({delayed=false}={}){
  let now=1000,finish;const commands=[],selections=[],loads=[];
  const audio={paused:true,currentTime:0,duration:180,readyState:1,playbackRate:1,addEventListener(){},pause(){this.paused=true;},async play(){this.paused=false;}};
  const player=createSharedListeningPlayer({audio,now:()=>now,load:async value=>{loads.push(value);audio.pause();if(delayed)await new Promise(resolve=>{finish=resolve;});},clear:()=>audio.pause(),resolveTrack:async value=>value,refresh(){}});
  player.connect({control:(...args)=>commands.push(args),select:value=>selections.push(value)});
  return {player,audio,commands,selections,loads,tick:ms=>now+=ms,finish:()=>finish(),state:(revision,extra={})=>({revision,track,position:10,playing:true,...extra})};
}
test('remote state loads the shared deck once and does not echo transport commands',async()=>{
  const f=fixture();await f.player.setState(f.state(1));assert.equal(f.loads.length,1);assert.equal(f.audio.currentTime,10);assert.equal(f.audio.paused,false);assert.equal(f.commands.length,0);
  f.tick(2000);f.player.sync();assert.equal(f.audio.currentTime,12);
  await f.player.setState(f.state(2,{playing:false,position:12.3}));assert.equal(f.audio.currentTime,12.3);assert.equal(f.audio.paused,true);assert.equal(f.loads.length,1);
  f.player.toggle();assert.deepEqual(f.commands,[['play',{}]]);
});
test('record transfer animation catches up to the latest room position after completion',async()=>{
  const f=fixture({delayed:true});const pending=f.player.setState(f.state(1));f.tick(6000);await f.player.setState(f.state(1,{position:16}));assert.equal(f.audio.paused,true);f.finish();await pending;assert.equal(f.audio.currentTime,16);assert.equal(f.audio.paused,false);assert.equal(f.loads.length,1);
});
test('pause received during record transfer prevents autoplay and leaving cancels pending playback',async()=>{
  const f=fixture({delayed:true});const pending=f.player.setState(f.state(1));await f.player.setState(f.state(2,{position:0,playing:false}));f.finish();await pending;assert.equal(f.audio.paused,true);assert.equal(f.audio.currentTime,0);
  const next=f.player.setState(f.state(3,{track:{...track,id:'local:two'}}));f.player.reset();f.finish();await next;assert.equal(f.audio.paused,true);assert.equal(f.player.track,null);
});
test('blocked audio can be enabled locally without pausing the room',async()=>{
  const f=fixture();f.audio.play=async()=>{throw Object.assign(new Error('gesture required'),{name:'NotAllowedError'});};await f.player.setState(f.state(1));await Promise.resolve();
  f.audio.play=async()=>{f.audio.paused=false;};f.player.toggle();await Promise.resolve();assert.equal(f.audio.paused,false);assert.equal(f.commands.length,0);
});
test('disconnection prevents selection and playback; reconnection resumes latest position',async()=>{
  const f=fixture();f.player.select(track);assert.equal(f.selections.length,0);await f.player.setState(f.state(1));f.player.setConnected(false);f.tick(5000);f.player.sync();assert.equal(f.audio.paused,true);f.player.select(track);assert.equal(f.selections.length,0);
  await f.player.setState(f.state(1,{position:15}));assert.equal(f.audio.currentTime,15);assert.equal(f.audio.paused,false);f.player.select(track);assert.equal(f.selections.length,1);
});
