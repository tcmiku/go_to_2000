import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {selectMusicSource} from '../public/music-source-selection.js';
const source=(await readFile(new URL('../public/listening-room.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'');
const html=await readFile(new URL('../public/listening-room.html',import.meta.url),'utf8');

async function player({reducedMotion=true,sourceIds=['huibq'],preferred='huibq',sourceLoad,sourceProbe,savedRecords}={}){
  const nodes=new Map(),saved=new Map(),timers=new Map(),windowEvents={},documentEvents={},animations=[],overlays=new Set(),sourceCalls=[];let timerId=0;
  class Element{
    constructor(){this.attributes={};this.listeners={};this.textContent='';this.dataset={};this.hidden=false;this.disabled=false;this.style={setProperty(){}};this.value='';this.options=[];this.tagName='DIV';const classes=new Set();this.classList={add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,on)=>{on??=!classes.has(x);on?classes.add(x):classes.delete(x);}};}
    setAttribute(key,value){this.attributes[key]=String(value);}
    set innerHTML(value){this.markup=value;this.htmlWrites=(this.htmlWrites||0)+1;}
    get innerHTML(){return this.markup||'';}
    set textContent(value){this.text=value;this.textWrites=(this.textWrites||0)+1;}
    get textContent(){return this.text;}
    getAttribute(key){return this.attributes[key];}
    addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
    emit(name,event={}){for(const fn of this.listeners[name]||[])fn({preventDefault(){},target:this,...event});}
    focus(){document.activeElement=this;}
    click(){return this.disabled?undefined:this.onclick?.();}
    setPointerCapture(){}
    getBoundingClientRect(){return this.id==='platter-target'?{x:630,y:540,width:12,height:6}:this.id==='now-cover'?{x:460,y:460,width:342,height:166}:{x:220,y:80,width:800,height:260};}
    append(node){overlays.add(node);}
    remove(){overlays.delete(this);}
    animate(frames,options){
      let resolve,reject;const finished=new Promise((yes,no)=>{resolve=yes;reject=no;});
      const animation={frames,options,pending:true,finished,finish(){if(this.pending){this.pending=false;resolve();}},cancel(){if(this.pending){this.pending=false;reject(new Error('cancelled'));}}};
      animations.push(animation);return animation;
    }
    querySelector(selector){if(selector==='[data-close]')return this.closeButton??=new Element();if(selector==='input, select')return this.id==='discover-dialog'?$('#music-query'):$('#source-select');if(selector.startsWith('.transfer-'))return(this.parts??={})[selector]??=new Element();return null;}
  }
  for(const tag of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const element=new Element();element.id=tag[3];element.tagName=tag[1].toUpperCase();element.hidden=/\bhidden\b/.test(tag[2]);
    for(const attribute of tag[2].matchAll(/([\w-]+)="([^"]*)"/g))element.setAttribute(attribute[1],attribute[2]);
    for(const cls of (element.getAttribute('class')||'').split(' '))element.classList.add(cls);nodes.set('#'+element.id,element);
  }
  for(const name of ['machine-display','status-dot']){const element=new Element();element.classList.add(name);nodes.set('.'+name,element);}
  const $=selector=>nodes.get(selector)||[...nodes.values()].find(node=>selector.startsWith('.')&&node.classList.contains(selector.slice(1)))||null;
  const document={activeElement:null,hidden:false,body:new Element(),documentElement:new Element(),querySelector:$,querySelectorAll:selector=>selector==='.machine-drawer'?[$('#discover-dialog'),$('#source-dialog')]:[],createElement:()=>new Element(),addEventListener:(name,fn)=>{documentEvents[name]=fn;}};
  $('#source-select').options=sourceIds.map(value=>({value}));$('#source-select').value='huibq';$('#quality-select').options=[{value:'128k'}];$('#quality-select').value='128k';
  const audio=$('#audio');Object.assign(audio,{paused:true,ended:false,currentTime:0,duration:0,readyState:0,src:'',volume:.65,muted:false});
  audio.load=()=>{audio.readyState=audio.src?1:0;audio.duration=audio.src?240:NaN;audio.currentTime=0;audio.emit('emptied');};
  audio.play=async()=>{audio.paused=false;audio.emit('play');audio.emit('playing');};audio.pause=()=>{audio.paused=true;audio.emit('pause');};audio.removeAttribute=()=>{audio.src='';};const getAttribute=audio.getAttribute.bind(audio);audio.getAttribute=name=>name==='src'?audio.src:getAttribute(name);
  let hash='';const location={get hash(){return hash;},set hash(value){hash=value?(value.startsWith('#')?value:'#'+value):'';}};
  const context=vm.createContext({document,location,innerWidth:1280,innerHeight:900,URL,AbortSignal,AbortController,HTMLImageElement:class{},CSS:{escape:value=>value},matchMedia:()=>({matches:reducedMotion}),requestAnimationFrame:fn=>fn(),cancelAnimationFrame(){},
    window:{addEventListener:(name,fn)=>{windowEvents[name]=fn;}},
    readStorage:(key,fallback)=>key.endsWith('preferences.v1')?{source:preferred}:savedRecords||fallback,saveStorage:(key,value)=>{saved.set(key,structuredClone(value));return true;},e:String,
    loadProbeTracks:async()=>[{source:'wy',songmid:1,name:'Probe'}],selectMusicSource:options=>selectMusicSource({...options,probe:sourceProbe||(async()=>{})}),
    setTimeout:(fn)=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    fetch:async()=>({ok:true,json:async()=>({tracks:['One','Two','Three'].map(name=>({name,src:`/data/mp3/${name}.mp3`}))})}),
    LXClient:class{dispose(){this.sources=null;}async load(id){sourceCalls.push(id);if(sourceLoad)await sourceLoad(id);this.id=id;this.sources={wy:{actions:['musicUrl'],qualitys:['128k']}};return{sources:this.sources};}async resolve(){return `https://example.com/${this.id}.mp3`;}}
  });
  vm.runInContext(source,context);
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  const advance=async()=>{await flush();const queued=[...timers];timers.clear();for(const [,fn]of queued)fn();for(const animation of animations)animation.finish();await flush();};
  const settle=async()=>{for(let i=0;i<20;i++)await advance();};
  await flush();return{$,audio,saved,location,windowEvents,documentEvents,flush,advance,settle,document,animations,overlays,sourceCalls};
}

test('physical play, pause and stop keys control media and tonearm state',async()=>{
  const p=await player();assert.equal(p.$('#now-title').textContent,'One');
  await p.$('#play-toggle').click();await p.settle();
  assert.equal(p.audio.paused,false);assert.equal(p.$('#turntable').classList.contains('playing'),true);assert.equal(p.$('#play-toggle').getAttribute('aria-pressed'),'true');
  p.audio.currentTime=10;await p.$('#play-toggle').click();assert.equal(p.audio.paused,true);assert.equal(p.$('#turntable').classList.contains('paused'),true);
  p.$('#stop-button').click();assert.equal(p.audio.currentTime,0);assert.equal(p.$('#turntable').classList.contains('paused'),false);assert.equal(p.$('#machine-status').textContent,'■');
});

test('rapid hardware track changes followed by stop cannot restart playback',async()=>{
  const p=await player();p.$('#next-track').click();p.$('#next-track').click();p.$('#stop-button').click();await p.settle();
  assert.equal(p.$('#now-title').textContent,'Three');assert.equal(p.audio.paused,true);assert.equal(p.$('#turntable-stage').getAttribute('aria-busy'),'false');assert.equal(p.$('#lid-toggle').disabled,false);
});

test('volume knob supports drag, keyboard limits and remembered mute',async()=>{
  const p=await player(),knob=p.$('#volume');
  knob.emit('pointerdown',{button:0,pointerId:1,clientX:100,clientY:100});knob.emit('pointermove',{pointerId:1,clientX:100,clientY:60});knob.emit('pointerup');
  assert.equal(p.audio.volume,.9);assert.equal(knob.getAttribute('aria-valuenow'),'90');
  knob.emit('keydown',{key:'End'});assert.equal(p.audio.volume,1);knob.emit('keydown',{key:'ArrowRight'});assert.equal(p.audio.volume,1);
  p.$('#mute-toggle').click();assert.equal(p.audio.muted,true);assert.equal(p.saved.get('slow-records.preferences.v1').muted,true);
  knob.emit('keydown',{key:'ArrowDown'});assert.equal(p.audio.muted,false);assert.equal(p.audio.volume,.95);
});

test('machine drawers are mutually exclusive and wall navigation preserves playback',async()=>{
  const p=await player();p.$('#play-toggle').click();await p.settle();
  p.$('#discover-button').click();assert.equal(p.$('#discover-dialog').hidden,false);assert.equal(p.document.activeElement,p.$('#music-query'));
  p.$('#source-open').click();assert.equal(p.$('#discover-dialog').hidden,true);assert.equal(p.$('#source-dialog').hidden,false);assert.equal(p.audio.paused,false);
  p.$('#wall-toggle').click();p.windowEvents.hashchange();assert.equal(p.$('#source-dialog').hidden,true);assert.equal(p.$('#wall-view').hidden,false);assert.equal(p.audio.paused,false);
  p.$('#wall-toggle').click();p.windowEvents.hashchange();assert.equal(p.$('#wall-view').hidden,true);assert.equal(p.audio.paused,false);
});

test('interrupting record extraction cancels child animations and leaves the platter empty',async()=>{
  const p=await player({reducedMotion:false});p.$('#play-toggle').click();await p.flush();
  assert.equal(p.overlays.size,1);assert.equal(p.animations.filter(a=>a.pending).length,2);
  await p.advance();assert.equal(p.animations.filter(a=>a.pending).length,1);
  p.$('#stop-button').click();await p.settle();
  assert.equal(p.overlays.size,0);assert.equal(p.animations.some(a=>a.pending),false);
  assert.equal(p.audio.paused,true);assert.equal(p.$('#turntable').classList.contains('no-record'),true);
  p.$('#play-toggle').click();await p.settle();assert.equal(p.audio.paused,false);
});

test('animated record changes return the old disc and seat the new one before playback',async()=>{
  const p=await player({reducedMotion:false});p.$('#play-toggle').click();await p.settle();
  assert.equal(p.audio.paused,false);assert.equal(p.$('#disc-title').textContent,'One');
  p.$('#next-track').click();await p.flush();
  assert.equal(p.audio.paused,true);assert.equal(p.$('#disc-title').textContent,'One');
  assert.equal(p.$('#turntable').classList.contains('arm-raised'),true);
  await p.settle();assert.equal(p.$('#disc-title').textContent,'Two');
  assert.equal(p.audio.src,'/data/mp3/Two.mp3');assert.equal(p.audio.paused,false);
  assert.equal(p.overlays.size,0);assert.equal(p.$('#turntable').classList.contains('arm-raised'),false);
});

test('media failure during cueing cancels delayed playback and resets the motor',async()=>{
  const p=await player();p.$('#play-toggle').click();await p.flush();
  assert.equal(p.$('#turntable').classList.contains('motor-starting'),true);
  p.audio.emit('error');await p.settle();
  assert.equal(p.audio.paused,true);assert.equal(p.$('#turntable').classList.contains('motor-starting'),false);
  assert.equal(p.$('#turntable').classList.contains('arm-over-record'),false);
  assert.equal(p.$('#turntable-stage').getAttribute('aria-busy'),'false');
});

test('entry checks the remembered source and selects a fallback without starting playback',async()=>{
  const p=await player({sourceIds:['huibq','sixyin','flower'],preferred:'sixyin',sourceProbe:async url=>{if(url.includes('sixyin'))throw new Error('unplayable');}});await p.settle();
  assert.deepEqual(p.sourceCalls,['sixyin','huibq']);assert.equal(p.$('#source-select').value,'huibq');
  assert.equal(p.saved.get('slow-records.preferences.v1').source,'huibq');assert.equal(p.audio.paused,true);assert.equal(p.audio.src,'');
  assert.equal(p.$('.status-dot').classList.contains('connected'),true);assert.equal(p.$('.status-dot').classList.contains('testing'),false);
});

test('manual source choice takes over an in-progress automatic check',async()=>{
  let release;const blocked=new Promise(resolve=>release=resolve);
  const p=await player({sourceIds:['huibq','sixyin'],sourceProbe:async url=>{if(url.includes('huibq'))await blocked;}});
  await p.flush();p.$('#source-select').value='sixyin';p.$('#source-select').onchange();await p.settle();
  release();await p.settle();
  assert.equal(p.$('#source-select').value,'sixyin');assert.equal(p.$('.status-dot').classList.contains('connected'),true);
  assert.equal(p.saved.get('slow-records.preferences.v1').source,'sixyin');
});

test('source failure leaves local records playable and the retry button enabled',async()=>{
  const p=await player({sourceLoad:async()=>{throw new Error('offline');}});await p.settle();
  assert.equal(p.$('#source-connect').disabled,false);assert.equal(p.$('.status-dot').classList.contains('failed'),true);
  p.$('#play-toggle').click();await p.settle();assert.equal(p.audio.src,'/data/mp3/One.mp3');assert.equal(p.audio.paused,false);
});

test('500 saved records create only ten background sleeves until the wall is opened',async()=>{
  const savedRecords=Array.from({length:500},(_,i)=>({id:`wy:${i}`,source:'wy',songmid:i+1,name:`Record ${i}`}));
  const p=await player({savedRecords});await p.settle();
  assert.equal((p.$('#background-records').innerHTML.match(/data-sleeve=/g)||[]).length,10);
  assert.equal(p.$('#record-collection').innerHTML,'');
  p.$('#wall-toggle').click();p.windowEvents.hashchange();
  assert.equal((p.$('#record-collection').innerHTML.match(/data-record=/g)||[]).length,500);
  const writes=p.$('#record-collection').htmlWrites,backgroundWrites=p.$('#background-records').htmlWrites;
  for(let i=0;i<20;i++)p.windowEvents.resize();await p.settle();
  p.$('#wall-toggle').click();p.windowEvents.hashchange();p.$('#wall-toggle').click();p.windowEvents.hashchange();
  assert.equal(p.$('#record-collection').htmlWrites,writes);assert.equal(p.$('#background-records').htmlWrites,backgroundWrites);
});

test('clock writes are deduplicated and background tabs catch up without pausing audio',async()=>{
  const p=await player();p.$('#play-toggle').click();await p.settle();
  p.audio.currentTime=10;p.audio.emit('timeupdate');const writes=p.$('#lcd-time').textWrites;
  for(let i=0;i<10;i++)p.audio.emit('timeupdate');assert.equal(p.$('#lcd-time').textWrites,writes);
  p.document.hidden=true;p.documentEvents.visibilitychange();
  p.audio.currentTime=27;p.audio.emit('timeupdate');assert.equal(p.$('#lcd-time').textContent,'00:10');
  assert.equal(p.document.body.classList.contains('is-backgrounded'),true);assert.equal(p.audio.paused,false);
  p.document.hidden=false;p.documentEvents.visibilitychange();
  assert.equal(p.$('#lcd-time').textContent,'00:27');assert.equal(p.document.body.classList.contains('is-backgrounded'),false);
});
