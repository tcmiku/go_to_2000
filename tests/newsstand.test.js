import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const catalog=JSON.parse(await readFile(new URL('../public/newsstand-catalog.json',import.meta.url),'utf8'));
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
