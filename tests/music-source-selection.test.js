import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {selectMusicSource,probeAudio,loadProbeTracks} from '../music-source-selection.js';

const tracks=[{source:'wy',songmid:1,name:'First'},{source:'wy',songmid:2,name:'Second'}];
const supported={wy:{actions:['musicUrl'],qualitys:['128k']}};
function clientFixture(){return {calls:[],disposed:0,async load(id){this.id=id;this.calls.push(id);return {sources:supported};},async resolve(track){return `https://example.com/${this.id}/${track.songmid}.mp3`;},dispose(){this.disposed++;}};}
function options(client,extra={}){return {client,ids:['a','b','c'],preferred:'b',tracks,signal:new AbortController().signal,probe:async()=>{},...extra};}

test('initialization and valid URLs alone do not pass; a playable candidate wins',async()=>{
  const client=clientFixture(),probes=[];
  const selected=await selectMusicSource(options(client,{probe:async url=>{probes.push(url);if(url.includes('/b/'))throw new Error('HTTP error page');}}));
  assert.equal(selected,'a');assert.deepEqual(client.calls,['b','a']);assert.equal(probes.length,3);assert.equal(client.disposed,1);
});

test('an unavailable individual song does not disqualify an otherwise usable source',async()=>{
  const client=clientFixture();client.resolve=async track=>{if(track.songmid===1)throw new Error('not available');return 'https://example.com/audio.mp3';};
  assert.equal(await selectMusicSource(options(client)),'b');assert.deepEqual(client.calls,['b']);
});

test('unsupported platforms and empty qualities are skipped',async()=>{
  const client=clientFixture();client.load=async id=>{client.calls.push(id);return {sources:id==='b'?{kg:{actions:['musicUrl'],qualitys:['128k']}}:id==='a'?{wy:{actions:['musicUrl'],qualitys:[]}}:supported};};
  assert.equal(await selectMusicSource(options(client)),'c');assert.deepEqual(client.calls,['b','a','c']);
});

test('a hanging initialization times out and falls through to the next source',async()=>{
  const client=clientFixture();client.load=async id=>{client.calls.push(id);if(id==='b')await new Promise(()=>{});return {sources:supported};};
  const selection=selectMusicSource(options(client,{candidateTimeout:15}));
  // Keep the event loop alive because AbortSignal.timeout timers are unref'ed.
  const [selected]=await Promise.all([selection,sleep(40)]);
  assert.equal(selected,'a');assert.equal(client.disposed,1);
});

test('cancelling detection does not dispose a replacement client or start another candidate',async()=>{
  const client=clientFixture(),controller=new AbortController();let entered;
  const probing=new Promise(resolve=>entered=resolve);
  const selection=selectMusicSource(options(client,{signal:controller.signal,probe:async()=>{entered();await new Promise(()=>{});}}));
  await probing;controller.abort(new Error('manual choice'));
  await assert.rejects(selection,/manual choice/);assert.deepEqual(client.calls,['b']);assert.equal(client.disposed,0);
});

test('all failures report failure instead of selecting a merely initialized source',async()=>{
  const client=clientFixture();await assert.rejects(selectMusicSource(options(client,{probe:async()=>{throw new Error('unplayable');}})),/所有音源暂时不可用/);
  assert.deepEqual(client.calls,['b','a','c']);assert.equal(client.disposed,3);
});

class AudioFixture extends EventTarget{
  constructor(){super();this.src='';this.playCalls=0;this.loadCalls=0;}
  load(){this.loadCalls++;}
  pause(){}
  play(){this.playCalls++;}
  removeAttribute(){this.src='';}
}
test('silent probe waits for canplay and releases its audio resource',async()=>{
  const media=new AudioFixture();let ready=false;
  const probe=probeAudio('https://example.com/audio.mp3',{createAudio:()=>media}).then(()=>ready=true);
  media.dispatchEvent(new Event('loadedmetadata'));await Promise.resolve();assert.equal(ready,false);
  media.dispatchEvent(new Event('canplay'));await probe;
  assert.equal(media.muted,true);assert.equal(media.playCalls,0);assert.equal(media.src,'');assert.equal(media.loadCalls,2);
});

test('aborted and failed probes clean up without playing audio',async()=>{
  for(const type of ['abort','error']){
    const media=new AudioFixture(),controller=new AbortController();
    const probe=probeAudio('https://example.com/audio.mp3',{signal:controller.signal,createAudio:()=>media});
    if(type==='abort')controller.abort(new Error('cancelled'));else media.dispatchEvent(new Event('error'));
    await assert.rejects(probe);assert.equal(media.src,'');assert.equal(media.playCalls,0);
  }
});

test('probe tracks come from saved network records or the existing search service',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async(url,{signal})=>{calls++;assert.match(url,/^\/api\/listening\/search\?q=/);assert.equal(signal.aborted,false);return {ok:true,json:async()=>({tracks})};});
  const signal=new AbortController().signal;
  assert.deepEqual(await loadProbeTracks([{source:'local'},tracks[1]],signal),[tracks[1]]);assert.equal(calls,0);
  assert.deepEqual(await loadProbeTracks([],signal),tracks);assert.equal(calls,1);
});

const clientSource=(await readFile(new URL('../lx-client.js',import.meta.url),'utf8')).replace('export class LXClient','class LXClient');
function realClient(fetch){
  const timers=new Map();let timerId=0;
  const context=vm.createContext({window:{addEventListener(){}},setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),AbortController,AbortSignal,URL,fetch});
  vm.runInContext(clientSource+'\nglobalThis.client = new LXClient();',context);return {client:context.client,timers};
}
test('cancelled URL probes remove their timeout and do not later dispose the selected source',async()=>{
  const {client,timers}=realClient();client.sources=supported;const controller=new AbortController();
  const pending=client.resolve(tracks[0],'128k',controller.signal);assert.equal(client.pending.size,1);
  controller.abort(new Error('probe timed out'));await assert.rejects(pending,/probe timed out/);
  assert.equal(client.pending.size,0);assert.equal(timers.size,0);assert.equal(client.sources,supported);
});

test('disposing an initialization aborts both script and runtime downloads',async()=>{
  const signals=[];const {client}=realClient((_url,{signal})=>new Promise((_resolve,reject)=>{signals.push(signal);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});}));
  const pending=client.load('huibq');client.dispose();await assert.rejects(pending);
  assert.equal(signals.length,2);assert.equal(signals.every(signal=>signal.aborted),true);
});
