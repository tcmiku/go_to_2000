import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../listening-room.js',import.meta.url),'utf8')).replace(/^import .*\n/gm,'');
const html=await readFile(new URL('../listening-room.html',import.meta.url),'utf8');

async function player(){
  const nodes=new Map(),saved=new Map(),timers=new Map(),windowEvents={};let timerId=0;
  class Element{
    constructor(){this.attributes={};this.listeners={};this.textContent='';this.dataset={};this.hidden=false;this.disabled=false;this.style={setProperty(){}};this.value='';this.options=[];this.tagName='DIV';const classes=new Set();this.classList={add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,on)=>{on??=!classes.has(x);on?classes.add(x):classes.delete(x);}};}
    setAttribute(key,value){this.attributes[key]=String(value);}
    getAttribute(key){return this.attributes[key];}
    addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
    emit(name,event={}){for(const fn of this.listeners[name]||[])fn({preventDefault(){},target:this,...event});}
    focus(){document.activeElement=this;}
    click(){return this.disabled?undefined:this.onclick?.();}
    setPointerCapture(){}
    querySelector(selector){if(selector==='[data-close]')return this.closeButton??=new Element();if(selector==='input, select')return this.id==='discover-dialog'?$('#music-query'):$('#source-select');return null;}
  }
  for(const tag of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const element=new Element();element.id=tag[3];element.tagName=tag[1].toUpperCase();element.hidden=/\bhidden\b/.test(tag[2]);
    for(const attribute of tag[2].matchAll(/([\w-]+)="([^"]*)"/g))element.setAttribute(attribute[1],attribute[2]);
    for(const cls of (element.getAttribute('class')||'').split(' '))element.classList.add(cls);nodes.set('#'+element.id,element);
  }
  for(const name of ['machine-display','status-dot']){const element=new Element();element.classList.add(name);nodes.set('.'+name,element);}
  const $=selector=>nodes.get(selector)||[...nodes.values()].find(node=>selector.startsWith('.')&&node.classList.contains(selector.slice(1)))||null;
  const document={activeElement:null,body:new Element(),documentElement:new Element(),querySelector:$,querySelectorAll:selector=>selector==='.machine-drawer'?[$('#discover-dialog'),$('#source-dialog')]:[],addEventListener(){}};
  $('#source-select').options=[{value:'huibq'}];$('#source-select').value='huibq';$('#quality-select').options=[{value:'128k'}];$('#quality-select').value='128k';
  const audio=$('#audio');Object.assign(audio,{paused:true,ended:false,currentTime:0,duration:0,readyState:0,src:'',volume:.65,muted:false});
  audio.load=()=>{audio.readyState=audio.src?1:0;audio.duration=audio.src?240:NaN;audio.currentTime=0;audio.emit('emptied');};
  audio.play=async()=>{audio.paused=false;audio.emit('play');audio.emit('playing');};audio.pause=()=>{audio.paused=true;audio.emit('pause');};audio.removeAttribute=()=>{audio.src='';};const getAttribute=audio.getAttribute.bind(audio);audio.getAttribute=name=>name==='src'?audio.src:getAttribute(name);
  let hash='';const location={get hash(){return hash;},set hash(value){hash=value?(value.startsWith('#')?value:'#'+value):'';}};
  const context=vm.createContext({document,location,innerWidth:1280,innerHeight:900,URL,AbortSignal,AbortController,HTMLImageElement:class{},CSS:{escape:value=>value},matchMedia:()=>({matches:true}),requestAnimationFrame:fn=>fn(),cancelAnimationFrame(){},
    window:{addEventListener:(name,fn)=>{windowEvents[name]=fn;}},
    readStorage:(_key,fallback)=>fallback,saveStorage:(key,value)=>{saved.set(key,structuredClone(value));return true;},e:String,
    setTimeout:(fn)=>{const id=++timerId;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    fetch:async()=>({ok:true,json:async()=>({tracks:['One','Two','Three'].map(name=>({name,src:`/data/mp3/${name}.mp3`}))})}),
    LXClient:class{dispose(){}async load(){this.sources={wy:{actions:['musicUrl']}};return{sources:this.sources};}}
  });
  vm.runInContext(source,context);
  const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
  const settle=async()=>{for(let i=0;i<12;i++){await flush();const queued=[...timers];timers.clear();for(const [,fn]of queued)fn();}};
  await flush();return{$,audio,saved,location,windowEvents,flush,settle,document};
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
