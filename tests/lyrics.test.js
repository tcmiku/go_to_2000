import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLRC, lyricIndex, createLyricsProjection } from '../public/lyrics.js';
import { createListeningService } from '../server/listening-service.js';

const fixture='[ar:Test]\n[00:02.50]窗边落下一束光\n[00:06]唱片慢慢转一圈\n[00:09]';
test('LRC parses timestamps, repeated verses, offsets, blank gaps and literal text',()=>{
  const lines=parseLRC('[offset:500]\r\n[00:02.50][01:02.500]窗边\r\n[00:01.1]<b>光</b>\n[00:02.50]窗边\n[00:02.50]翻译\n[00:04]\n[00:99]invalid');
  assert.deepEqual(lines,[{time:.6,text:'<b>光</b>'},{time:2,text:'窗边\n翻译'},{time:3.5,text:''},{time:62,text:'窗边'}]);
  assert.equal(lyricIndex(lines,.1),-1);assert.equal(lyricIndex(lines,2),1);assert.equal(lyricIndex(lines,100),3);
  assert.deepEqual(parseLRC('untimed text'),[]);assert.deepEqual(parseLRC(null),[]);assert.deepEqual(parseLRC('x'.repeat(256001)),[]);
});

function projection(fetchLyrics){
  const parts=new Map();let hidden=false;
  const node=()=>({dataset:{},writes:0,text:'',set textContent(value){this.text=value;this.writes++;},get textContent(){return this.text;},animate(){throw Error('Reduced motion must not animate');}});
  const root={hidden:true,dataset:{},querySelector(selector){if(!parts.has(selector))parts.set(selector,node());return parts.get(selector);}};
  const caption=node(),audio=new EventTarget();Object.assign(audio,{readyState:1,currentTime:0,paused:false,duration:120});
  const player=createLyricsProjection({audio,root,caption,fetchLyrics,isHidden:()=>hidden,reduced:()=>true});
  return {player,audio,root,caption,line:root.querySelector('[data-lyric="current"]'),set hidden(value){hidden=value;}};
}
const flush=()=>new Promise(setImmediate);
test('projection follows seek and gaps, coalesces unchanged time events, and freezes while hidden',async()=>{
  let calls=0;
  const p=projection(async()=>{calls++;return{ok:true,json:async()=>({lyric:fixture,translation:'[00:02.50]A light by the window'})};});
  p.player.setTrack({id:'wy:1',source:'wy',songmid:1});await flush();assert.equal(p.root.hidden,true);
  p.audio.currentTime=3;p.audio.dispatchEvent(new Event('timeupdate'));
  assert.equal(p.line.textContent,'窗边落下一束光');assert.equal(p.root.hidden,false);assert.match(p.caption.textContent,/A light by the window/);
  const writes=p.line.writes;p.audio.currentTime=3.5;p.audio.dispatchEvent(new Event('timeupdate'));assert.equal(p.line.writes,writes);
  p.audio.currentTime=7;p.audio.dispatchEvent(new Event('seeked'));assert.equal(p.line.textContent,'唱片慢慢转一圈');
  p.audio.currentTime=1;p.audio.dispatchEvent(new Event('seeked'));assert.equal(p.root.hidden,true);
  p.hidden=true;p.audio.currentTime=7;p.player.sync();assert.equal(p.root.hidden,true);
  p.hidden=false;p.player.sync();assert.equal(p.root.hidden,false);
  p.audio.currentTime=10;p.player.sync();assert.equal(p.root.hidden,true);
  p.player.setTrack({id:'wy:1',source:'wy',songmid:1});assert.equal(calls,1);
  p.audio.dispatchEvent(new Event('ended'));assert.equal(p.line.textContent,'');p.player.dispose();
});
test('late lyrics cannot leak into another track and failures never change playback',async()=>{
  const pending=[];const p=projection((url,options)=>new Promise(resolve=>pending.push({url,options,resolve})));
  p.player.setTrack({id:'wy:1',source:'wy',songmid:1});p.player.setTrack({id:'wy:2',source:'wy',songmid:2});
  assert.equal(pending[0].options.signal.aborted,true);
  pending[1].resolve({ok:true,json:async()=>({lyric:'[00:00]第二张唱片'})});await flush();
  pending[0].resolve({ok:true,json:async()=>({lyric:'[00:00]旧歌词'})});await flush();assert.equal(p.line.textContent,'第二张唱片');
  p.player.setTrack({id:'wy:3',source:'wy',songmid:3});pending[2].resolve({ok:false});await flush();
  assert.equal(p.root.hidden,true);assert.equal(p.root.dataset.state,'error');assert.equal(p.audio.paused,false);
  p.player.dispose();
});
test('local matching waits for audio metadata and sends duration, not audio content',async()=>{
  let url;const p=projection(async value=>{url=new URL(value,'http://localhost');return{ok:true,json:async()=>({lyric:''})};});
  p.audio.readyState=0;p.player.setTrack({id:'local:1',source:'local',src:'/data/mp3/test.mp3',name:'窗边',singer:'测试歌手'});
  assert.equal(url,undefined);p.audio.readyState=1;p.audio.dispatchEvent(new Event('loadedmetadata'));await flush();
  assert.equal(url.searchParams.get('duration'),'120');assert.equal(url.searchParams.get('src'),'/data/mp3/test.mp3');p.player.dispose();
});

test('lyrics endpoint validates IDs and caches original and translated timed lyrics',async()=>{
  let calls=0;const service=createListeningService({request:async url=>{calls++;assert.match(url,/^https:\/\/music\.163\.com\/api\/song\/lyric\?id=77&/);return{statusCode:200,body:{code:200,lrc:{lyric:fixture},tlyric:{lyric:'[00:02.50]Light'}}};}});
  const url=new URL('http://localhost/api/listening/lyrics?source=wy&id=77');
  assert.equal((await service(url.pathname,url)).lyric,fixture);assert.equal((await service(url.pathname,url)).translation,'[00:02.50]Light');assert.equal(calls,1);
  for(const query of ['source=wy&id=../private','source=wy&id=1%26id=2','source=other&id=77'])await assert.rejects(service(url.pathname,new URL(`http://localhost${url.pathname}?${query}`)),{status:400});
  const failed=createListeningService({request:async()=>({statusCode:403,body:{code:403}})});await assert.rejects(failed(url.pathname,url),{status:502});
});
test('local lyrics prefer sidecars and only match exact title, artist and close duration',async()=>{
  let calls=0;
  const request=async url=>{calls++;return url.includes('/eapi/')?{statusCode:200,body:{code:200,result:{songs:[{id:77,name:'窗边',artists:[{name:'测试歌手'}],duration:120000}]}}}:{statusCode:200,body:{code:200,lrc:{lyric:fixture}}};};
  const url=new URL('http://localhost/api/listening/lyrics?source=local&src=/data/mp3/test.mp3&name=窗边&singer=测试歌手&duration=121');
  const sidecar=createListeningService({request,readLocalLyrics:async()=>fixture});assert.equal((await sidecar(url.pathname,url)).lyric,fixture);assert.equal(calls,0);
  const service=createListeningService({request});assert.equal((await service(url.pathname,url)).lyric,fixture);assert.equal(calls,2);
  url.searchParams.set('duration','180');assert.equal((await service(url.pathname,url)).lyric,'');assert.equal(calls,2);
  url.searchParams.set('singer','其他歌手');assert.equal((await service(url.pathname,url)).lyric,'');
  url.searchParams.set('singer','');const previous=calls;assert.equal((await service(url.pathname,url)).lyric,'');assert.equal(calls,previous);
});
