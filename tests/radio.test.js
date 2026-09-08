import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=(await readFile(new URL('../public/radio.js',import.meta.url),'utf8')).replace(/^import .*\n/,'');

async function player({reduced=false,effects=true}={}){
  const nodes=new Map(),timers=new Map(),sounds=[],media=[],saved=new Map();
  let timerId=0,now=0;
  class Element{
    constructor(){this.attributes={};this.listeners={};this.textContent='';this.dataset={};this.style={setProperty(){}};this.disabled=false;const classes=new Set();this.classList={add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)};this.parentNode={insertBefore(){}};}
    setAttribute(key,value){this.attributes[key]=String(value);}
    getAttribute(key){return this.attributes[key];}
    addEventListener(key,fn){(this.listeners[key]??=[]).push(fn);}
    append(...children){for(const child of children)if(child.id)nodes.set('#'+child.id,child);}
    click(){if(!this.disabled)for(const fn of this.listeners.click||[])fn({target:this});}
  }
  const $=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  const controls=['previous','play','stop','next','eject','mute'].map(id=>$('#radio-'+id));
  class Audio{
    constructor(src){this.src=new URL(src,'http://localhost').href;this.currentTime=0;this.duration=240;this.paused=true;this.listeners={};media.push(this);}
    addEventListener(name,fn){this.listeners[name]=fn;}
    async play(){this.paused=false;}
    pause(){this.paused=true;}
    removeAttribute(){this.src='';}
    load(){}
  }
  class AudioContext{
    constructor(){this.currentTime=0;this.sampleRate=8000;this.destination={};}
    async resume(){}
    createBuffer(channels,length){return{getChannelData:()=>new Float32Array(length)};}
    createBufferSource(){const node={connect:other=>other,disconnect(){},start(){sounds.push(node);},stop(){}};return node;}
    createBiquadFilter(){return{frequency:{},Q:{},connect:other=>other,disconnect(){}};}
    createGain(){return{gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect:other=>other,disconnect(){}};}
  }
  const sandbox={
    $,readStorage:(key,fallback)=>key==='web-surfer-deck-effects'?effects:fallback,
    saveStorage:(key,value)=>saved.set(key,value),showToast(){},URL,
    location:{href:'http://localhost/'},
    document:{hidden:false,createElement:()=>new Element(),querySelectorAll:()=>controls},
    window:{Audio,AudioContext,matchMedia:()=>({matches:reduced}),addEventListener(){}},
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{at:now+ms,fn});return id;},
    clearTimeout:id=>timers.delete(id),setInterval:()=>++timerId,clearInterval(){},
    fetch:async()=>({ok:true,json:async()=>({tracks:['one','two','three'].map(name=>({name,src:'/data/mp3/'+name+'.mp3'}))})}),
  };
  const context=vm.createContext(sandbox);
  vm.runInContext(source,context);
  const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  async function advance(ms){
    const end=now+ms;
    for(let i=0;i<100;i++){
      await flush();
      const upcoming=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];
      if(!upcoming||upcoming[1].at>end)break;
      now=upcoming[1].at;timers.delete(upcoming[0]);upcoming[1].fn();
    }
    now=end;await flush();
  }
  await flush();
  return{$,advance,flush,sounds,media,saved};
}

test('track changes open, remove and replace the tape, then resume only after closing',async()=>{
  const p=await player();
  p.$('#radio-play').click();await p.flush();
  assert.equal(p.media.at(-1).paused,false);
  p.$('#radio-next').click();
  assert.equal(p.media[0].paused,true);
  assert.equal(p.$('#deck-bay').classList.contains('is-open'),true);
  assert.equal(p.$('#seek').disabled,true);
  await p.advance(350);
  assert.equal(p.$('#deck-bay').classList.contains('tape-out'),true);
  await p.advance(300);
  assert.match(p.$('#track-name').textContent,/two/);
  assert.equal(p.media.at(-1).paused,true);
  await p.advance(810);
  assert.equal(p.$('#deck-bay').classList.contains('is-open'),false);
  assert.equal(p.$('#deck-bay').classList.contains('tape-out'),false);
  assert.equal(p.$('#seek').disabled,false);
  assert.equal(p.media.at(-1).paused,false);
});

test('rapid next presses settle on the requested track and stop prevents automatic resumption',async()=>{
  const p=await player();
  p.$('#radio-play').click();await p.flush();
  p.$('#radio-next').click();p.$('#radio-next').click();
  p.$('#radio-stop').click();
  await p.advance(1600);
  assert.match(p.$('#track-name').textContent,/three/);
  assert.equal(p.$('#tape-status').textContent,'STOP');
  assert.ok(p.media.every(audio=>audio.paused));
  assert.equal(p.$('#deck-bay').getAttribute('aria-busy'),'false');
});

test('changing again during insertion completes both transitions without overlapping playback',async()=>{
  const p=await player();
  p.$('#radio-next').click();await p.advance(800);
  p.$('#radio-next').click();await p.advance(2200);
  assert.match(p.$('#track-name').textContent,/three/);
  assert.ok(p.media.every(audio=>audio.paused));
  assert.equal(p.$('#deck-bay').getAttribute('aria-busy'),'false');
});

test('mechanical effects are opt-out, remembered independently, and suppressed by mute',async()=>{
  const p=await player();
  assert.equal(p.sounds.length,0);
  p.$('#radio-stop').click();await p.flush();
  assert.ok(p.sounds.length>0);
  p.$('#deck-effects').click();
  const count=p.sounds.length;
  p.$('#radio-stop').click();await p.flush();
  assert.equal(p.sounds.length,count);
  assert.equal(p.saved.get('web-surfer-deck-effects'),false);
  p.$('#radio-mute').click();p.$('#deck-effects').click();await p.flush();
  assert.equal(p.sounds.length,count);
});

test('reduced motion finishes a paused track change without an animation delay',async()=>{
  const p=await player({reduced:true,effects:false});
  p.$('#radio-next').click();await p.advance(0);
  assert.match(p.$('#track-name').textContent,/two/);
  assert.equal(p.$('#deck-bay').getAttribute('aria-busy'),'false');
  assert.ok(p.media.every(audio=>audio.paused));
  assert.equal(p.sounds.length,0);
});
