import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { escapeHTML } from '../ui.js';
import { flattenCategories, validateNavigation, normalizeUrl } from '../navigation-data.js';

const source=(await readFile(new URL('../cd-wall.js',import.meta.url),'utf8')).replace(/^import .*;\r?$/gm,'');
async function wall(){
  const elements=new Map(),timers=new Map();let timerId=0,calls=0,fail=false;
  const data={revision:1,navigation:{version:1,source:{name:'Test',url:'https://example.com'},categories:[{id:'tools',name:'工具',sites:[{id:'one',name:'Test 工具',url:'https://example.com',description:'测试'}],children:[]}]}};
  const element=()=>({value:'',writes:0,events:{},style:{setProperty(){}},setAttribute(){},insertBefore(){},addEventListener(name,fn){this.events[name]=fn;},set innerHTML(value){this.html=value;this.writes++;},get innerHTML(){return this.html;}});
  const find=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
  const context=vm.createContext({
    e:escapeHTML,flattenCategories,validateNavigation,normalizeUrl,
    isMuted:()=>false,setMuted(){},playSound(){},
    document:{querySelector:find,createElement:element,hidden:false},window:{addEventListener(){}},
    ResizeObserver:class{observe(){}},matchMedia:()=>({matches:false}),AbortSignal,
    setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    async fetch(){calls++;if(fail)throw new Error('offline');return{ok:true,json:async()=>structuredClone(data)};}
  });
  vm.runInContext(source+'\nglobalThis.wallTest={load,render,filtered};',context);
  await new Promise(setImmediate);
  return{find,data,timers,api:context.wallTest,get calls(){return calls;},set fail(value){fail=value;},flush(){for(const [id,fn] of [...timers]){timers.delete(id);fn();}}};
}

test('unchanged and concurrent refreshes reuse the CD shelf, but new revisions redraw it',async()=>{
  const app=await wall(),cabinet=app.find('#cabinet'),writes=cabinet.writes;
  assert.match(cabinet.innerHTML,/Test 工具/);
  await Promise.all([app.api.load(),app.api.load(),app.api.load()]);
  assert.equal(app.calls,2);assert.equal(cabinet.writes,writes);
  app.data.revision++;app.data.navigation.categories[0].sites[0].name='Updated';
  await app.api.load();assert.equal(cabinet.writes,writes+1);assert.match(cabinet.innerHTML,/Updated/);
  app.fail=true;await app.api.load();assert.equal(cabinet.writes,writes+1);
});

test('rapid search and Chinese composition are coalesced; identical queries reuse filter results',async()=>{
  const app=await wall(),search=app.find('#cd-search'),cabinet=app.find('#cabinet'),writes=cabinet.writes;
  for(const value of ['t','te','tes','test']){search.value=value;search.events.input();}
  assert.equal(app.timers.size,1);assert.equal(cabinet.writes,writes);
  app.flush();assert.equal(cabinet.writes,writes+1);
  const matches=app.api.filtered();assert.equal(matches.length,1);
  search.value=' TEST ';search.events.input();app.flush();
  assert.equal(app.api.filtered(),matches);assert.equal(cabinet.writes,writes+1);
  search.events.compositionstart();search.value='gong';search.events.input();
  assert.equal(app.timers.size,0);assert.equal(cabinet.writes,writes+1);
  search.value='工具';search.events.compositionend();app.flush();
  assert.equal(app.api.filtered().length,1);assert.equal(cabinet.writes,writes+2);
});
