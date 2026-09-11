import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {buildSourceCatalog,sourceFingerprint,loadSourceCatalog} from '../server/newsstand-catalog.js';
import {createAllSourceSearch,createSearchWorker,matchesBook} from '../server/newsstand-search.js';
import {mergeBookMatches,rankBookMatches,readSearchStream} from '../public/newsstand-data.js';

const definition={bookSourceName:'测试源',bookSourceUrl:'https://source.example',bookSourceType:0,searchUrl:'/search?q={{key}}',ruleSearch:{bookList:'.book',name:'a@text',bookUrl:'a@href'}};
const meta=(id,host=id)=>({id,title:id,url:`https://${host}.example`,current:true,searchable:true});
const fixture=records=>({sources:new Map(records.map(record=>[record.id,definition])),metadata:records,info:{uniqueCount:records.length,upstreamCount:records.length}});
const book=(sourceId,name='山海记',author='林舟',bookUrl=`https://${sourceId}.example/book`)=>({sourceId,sourceName:sourceId,name,author,bookUrl});

test('full snapshot imports every record, deduplicates rules and preserves old bookshelf source IDs',async()=>{
 const full=await loadSourceCatalog();assert.equal(full.info.upstreamCount,3907);assert.equal(full.info.uniqueCount+full.info.duplicates,3907);assert.ok(full.info.searchableCount>2000);assert.ok(full.sources.has('hongxiu'));
 const changed={...definition,ruleSearch:{...definition.ruleSearch,bookList:'.new-book'}};
 const result=buildSourceCatalog({sources:[definition,{...definition,weight:20,lastUpdateTime:100},changed]},[{source:definition,meta:meta('existing')}]);
 assert.equal(result.info.uniqueCount,2);assert.equal(result.info.duplicates,1);assert.equal(result.metadata.find(source=>source.id==='existing').current,true);
 assert.equal(sourceFingerprint({...definition,ruleSearch:{bookUrl:'a@href',name:'a@text',bookList:'.book'}}),sourceFingerprint(definition));
 assert.notEqual(sourceFingerprint(changed),sourceFingerprint(definition));
});
test('all eligible sources are searched with bounded concurrency; one failure does not lose other results',async()=>{
 const records=[meta('slow','same'),meta('second','same'),meta('fast'),meta('bad'),{...meta('no-search'),searchable:false}];
 let active=0,max=0;const hosts=new Set(),calls=[],events=[];
 const run=createAllSourceSearch({getCatalog:async()=>fixture(records),concurrency:3,createRunner:()=>({async search({source}){
  const host=new URL(source.url).hostname;assert.ok(!hosts.has(host));hosts.add(host);active++;max=Math.max(max,active);calls.push(source.id);
  try{await delay(source.id==='slow'?30:3);if(source.id==='bad')throw Error('timeout');return{books:[book(source.id),book(source.id,'不相关的书')],hasMore:true};}finally{hosts.delete(host);active--;}
 },async close(){}})});
 await run({query:'山海'},{onEvent:event=>events.push(event)});
 assert.deepEqual(calls.sort(),['bad','fast','second','slow']);assert.ok(max<=3);assert.ok(max>1);
 assert.equal(events[0].total,4);assert.equal(events[0].skipped,1);assert.equal(events[1].sourceId,'fast');
 assert.equal(events.at(-1).completed,4);assert.equal(events.at(-1).failed,1);assert.equal(events.at(-1).matchedBooks,3);assert.equal(events.filter(event=>event.type==='source').length,4);
 assert.equal(events.find(event=>event.sourceId==='fast').books.length,1);
});
test('cancelled searches stop scheduling remaining sources and never report completion',async()=>{
 const controller=new AbortController(),calls=[],events=[];
 const run=createAllSourceSearch({getCatalog:async()=>fixture([meta('a'),meta('b'),meta('c')]),concurrency:1,createRunner:()=>({async search({source}){calls.push(source.id);controller.abort();return{books:[],hasMore:false};},async close(){}})});
 await run({query:'书'},{signal:controller.signal,onEvent:event=>events.push(event)});assert.deepEqual(calls,['a']);assert.ok(!events.some(event=>event.type==='done'));
});
test('next-page search targets matching sources and invalid queries do not start workers',async()=>{
 const calls=[];const run=createAllSourceSearch({getCatalog:async()=>fixture([meta('a'),meta('b')]),createRunner:()=>({async search({source,page}){calls.push([source.id,page]);return{books:[],hasMore:false};},async close(){}})});
 await run({query:'书',page:2,sourceIds:['b']});assert.deepEqual(calls,[['b',2]]);await assert.rejects(run({query:'  '}),/请输入/);await assert.rejects(run({query:'书',page:2}),/下一页/);
});
test('worker timeout terminates an unresponsive rule without blocking the server',async()=>{
 const runner=createSearchWorker({timeout:80,workerUrl:new URL(`data:text/javascript,${encodeURIComponent("import {parentPort} from 'node:worker_threads';parentPort.on('message',()=>{while(true){}});")}`)});
 try{await assert.rejects(runner.search({}),error=>error.status===504);}finally{await runner.close();}
});
test('results match title/author, merge copies across sources and rank exact titles first',()=>{
 assert.equal(matchesBook(book('a'),'山海 林舟'),true);assert.equal(matchesBook(book('a'),'三国'),false);
 const groups=mergeBookMatches(new Map(),[book('a'),book('b'),book('a'),book('c','山海记续集'),book('d','山海记','另一个作者')]);
 assert.equal(groups.size,3);const ranked=rankBookMatches(groups,'山海记');assert.equal(ranked[0].name,'山海记');assert.equal([...groups.values()].find(group=>group.author==='林舟'&&group.name==='山海记').books.length,2);
});
test('streaming parser handles split Chinese characters and rejects a truncated completion',async()=>{
 const events=[{type:'start',total:2},{type:'source',books:[book('a')]},{type:'done'}];
 const bytes=new TextEncoder().encode(events.map(event=>JSON.stringify(event)).join('\n')+'\n');
 const response=new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}}));
 const received=[];await readSearchStream(response,event=>received.push(event));assert.deepEqual(received,events);
 await assert.rejects(readSearchStream(new Response('{"type":"start"}\n'),()=>{}),/连接已中断/);
});
