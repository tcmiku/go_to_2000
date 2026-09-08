import test from 'node:test';
import assert from 'node:assert/strict';
import {CassetteSound} from '../public/cassette-sound.js';

function fixture(){
  const nodes=[],buffers=[];let contexts=0,volume=.7,hidden=false;
  const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
  const node=()=>({gain:param(),frequency:param(),Q:param(),connect(other){return other;},disconnect(){this.disconnected=true;}});
  const context={state:'running',currentTime:0,sampleRate:8000,destination:{},createGain:node,createBiquadFilter:node,
    createBuffer(_channels,size){const buffer={getChannelData:()=>new Float32Array(size)};buffers.push(buffer);return buffer;},
    createBufferSource(){const source={...node(),start(){this.started=true;},stop(){this.stopped=true;}};nodes.push(source);return source;},
    async close(){this.closed=true;},async resume(){this.state='running';}};
  const sound=new CassetteSound({level:()=>volume,hidden:()=>hidden,createContext:()=>{contexts++;return context;}});
  return {sound,context,nodes,buffers,get contexts(){return contexts;},set volume(value){volume=value;},set hidden(value){hidden=value;}};
}

test('entry is silent and user interaction lazily creates one reusable audio context',async()=>{
  const f=fixture();await f.sound.play('open');assert.equal(f.contexts,0);
  f.sound.unlock();await f.sound.play('key');await f.sound.play('close');
  assert.equal(f.contexts,1);assert.equal(f.buffers.length,1);assert.equal(f.nodes.length,4);
  assert.equal(f.nodes.every(node=>node.started&&node.stopped),true);
});
test('disabled effects, zero volume and background pages create no voices',async()=>{
  const f=fixture();f.sound.unlock();f.sound.setEnabled(false);await f.sound.play();
  f.sound.setEnabled(true);f.volume=0;await f.sound.play();f.volume=.7;f.hidden=true;await f.sound.play();assert.equal(f.contexts,0);
});
test('switching effects off cancels active sounds and queued resume work',async()=>{
  const f=fixture();f.sound.unlock();await f.sound.play('slide');f.sound.setEnabled(false);assert.equal(f.sound.sources.size,0);
  f.sound.setEnabled(true);f.context.state='suspended';let resume;f.context.resume=()=>new Promise(resolve=>resume=resolve);
  const pending=f.sound.play('key'),count=f.nodes.length;f.sound.setEnabled(false);resume();await pending;assert.equal(f.nodes.length,count);
});
test('ended sounds disconnect their nodes and page exit releases the context',async()=>{
  const f=fixture();f.sound.unlock();await f.sound.play('key');for(const node of f.nodes)node.onended();
  assert.equal(f.sound.sources.size,0);assert.equal(f.nodes.every(node=>node.disconnected),true);
  f.sound.dispose();assert.equal(f.context.closed,true);assert.equal(f.sound.unlocked,false);assert.equal(f.sound.context,null);
});
test('rapid mechanical input keeps a bounded voice count',async()=>{
  const f=fixture();f.sound.unlock();for(let i=0;i<50;i++)await f.sound.play('wind');assert.ok(f.sound.sources.size<=8);
});
test('unavailable audio support does not reject player actions',async()=>{
  const sound=new CassetteSound({createContext:()=>null,hidden:()=>false});sound.unlock();await sound.play();
  const blocked=new CassetteSound({createContext:()=>{throw new Error('blocked');},hidden:()=>false});blocked.unlock();await blocked.play();
});
