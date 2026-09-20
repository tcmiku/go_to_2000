import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as data from '../public/newsstand-data.js';
const script=(await readFile(new URL('../public/newsstand.js',import.meta.url),'utf8')).replace(/^import .*\n/,'');
const html=await readFile(new URL('../public/newsstand.html',import.meta.url),'utf8');
const book={name:'山海记',author:'林舟',sourceId:'test',sourceName:'测试源',bookUrl:'https://example.com/book',category:'novel'};
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
async function app({books=[book],request}={}){
 const nodes=[],storage=new Map([['newsstand:books:v1',JSON.stringify(books)]]),calls=[];
 class Element{
  constructor(tag='div',attrs={}){this.tagName=tag.toUpperCase();this.attrs=attrs;this.dataset=Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5),v]));this.children=[];this.listeners={};this.style={setProperty(){}};this.hidden='hidden' in attrs;this.disabled='disabled' in attrs;this.value='';this.textContent='';this.open=false;this.scrollTop=0;this.scrollHeight=1000;this.clientHeight=200;const classes=new Set((attrs.class||'').split(' '));this.classList={toggle:(c,on)=>on?classes.add(c):classes.delete(c),contains:c=>classes.has(c)};}
  set className(s){this.attrs.class=s;}get className(){return this.attrs.class||'';}
  setAttribute(k,v){this.attrs[k]=String(v);}append(...els){this.children.push(...els);if(this.tagName==='SELECT'&&!this.value)this.value=els[0]?.value||'';}
  replaceChildren(...els){this.children=[];if(this.tagName==='SELECT')this.value='';this.append(...els);}
  addEventListener(n,fn){(this.listeners[n]??=[]).push(fn);}emit(n,event={}){for(const fn of this.listeners[n]||[])fn({target:this,preventDefault(){},...event});}
  showModal(){this.open=true;}close(){this.open=false;this.emit('close');}focus(){document.activeElement=this;}click(){return this.disabled?undefined:this.onclick?.();}
 }
 for(const tag of html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)){const attrs=Object.fromEntries([...tag[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m=>[m[1],m[2]||'']));nodes.push(new Element(tag[1],attrs));}
 const match=(el,s)=>s.startsWith('#')?el.attrs.id===s.slice(1):s.startsWith('.')?el.className.split(' ').includes(s.slice(1)):s.startsWith('[')?s.slice(1,-1) in el.attrs:false;
 const $=s=>nodes.find(el=>match(el,s));
 const document={querySelector:$,querySelectorAll:s=>nodes.filter(el=>match(el,s)),createElement:tag=>new Element(tag),body:new Element(),activeElement:null,addEventListener(){}};
 const standard=async(action,input)=>action==='sources'?{sources:[{id:'test',type:0,title:'测试源',searchable:true}],catalog:{searchableCount:1}}:action==='book'?{book:input.book}:action==='toc'?{chapters:[{url:'https://example.com/1',name:'第一章'},{url:'https://example.com/1',name:'重复'},{url:'https://example.com/2',name:'第二章'}],nextUrl:'',visited:[],variables:{}}:action==='content'?{content:'第一段\n第二段',variables:{}}:{books:[book],hasMore:false};
 const context=vm.createContext({...data,document,window:{addEventListener(){}},URL,Intl,Date,AbortController,Map,Set,Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},matchMedia:()=>({matches:false,addEventListener(){}}),requestAnimationFrame:fn=>fn(),setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer;},clearTimeout,fetch:async(url,options={})=>{const action=url.split('/').at(-1),input=options.body?JSON.parse(options.body):undefined;calls.push({action,input,signal:options.signal});const value=await(request?.(action,input,options)||standard(action,input));return{ok:true,json:async()=>value};}});
 vm.runInContext(script,context);await flush();return{$,storage,calls,context,standard};
}
test('empty shelf, filtering, remove and undo keep only explicitly added books',async()=>{
 const a=await app();assert.equal(a.$('#shelf-count').textContent,'1 本');
 a.$('#source-query').value='无此书';a.$('#source-query').oninput();assert.equal(a.$('#clear-filter').hidden,false);a.$('#clear-filter').click();assert.equal(a.$('#empty').hidden,true);
 await a.$('#racks').children[0].children[0].click();a.$('#save-book').click();assert.equal(JSON.parse(a.storage.get('newsstand:books:v1')).length,0);assert.equal(a.$('#shelf-count').textContent,'0 本');
 a.$('#undo-remove').click();assert.equal(JSON.parse(a.storage.get('newsstand:books:v1'))[0].name,book.name);assert.equal(a.$('#shelf-count').textContent,'1 本');
});
test('old detail responses cannot overwrite another book and TOC duplicates are removed',async()=>{
 const pending=[];const a=await app({request:(action,input,options)=>{if(action==='book')return new Promise(resolve=>pending.push({resolve,input,signal:options.signal}));}});
 const first=vm.runInContext('openBook(books[0])',a.context);await flush();
 const second=vm.runInContext('openBook({...books[0],name:"另一部书",bookUrl:"https://example.com/other"})',a.context);await flush();assert.equal(pending[0].signal.aborted,true);
 pending[1].resolve({book:pending[1].input.book});await second;pending[0].resolve({book:pending[0].input.book});await first;
 assert.equal(a.$('#publication-title').textContent,'另一部书');assert.equal(a.$('#chapters').children.length,2);
});
test('reading restores chapter scroll position and remembers font size',async()=>{
 const a=await app();await a.$('#racks').children[0].children[0].click();await a.$('#read-book').click();await flush();
 a.$('.reader-paper').scrollTop=400;a.$('#reader').close();assert.equal(JSON.parse(a.storage.get('newsstand:books:v1'))[0].progress.offset,.5);
 await a.$('#read-book').click();await flush();assert.equal(a.$('.reader-paper').scrollTop,400);
 a.$('#font-larger').click();assert.equal(a.storage.get('newsstand:font'),'22');assert.equal(a.$('#chapter-content').style.fontSize,'22px');
});
test('closing finder cancels a single-source search and drops its late results',async()=>{
 let resolve;const a=await app({request:action=>action==='search'?new Promise(r=>{resolve=r;}):undefined});
 a.$('#find-books').click();a.$('#book-query').value='山海记';const pending=a.$('#search-selected').click();await flush();
 a.$('#finder').close();assert.equal(a.calls.find(c=>c.action==='search').signal.aborted,true);resolve({books:[book],hasMore:true});await pending;
 assert.equal(a.$('#search-results').children.length,0);assert.equal(a.$('#search-books').disabled,false);
});
