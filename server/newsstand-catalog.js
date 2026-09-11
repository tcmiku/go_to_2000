import { readFile } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const unzip=promisify(gunzip);
const passive=new Set(['lastUpdateTime','respondTime','customOrder','weight','bookSourceComment','bookSourceGroup','enabled','enabledExplore']);
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
export function sourceFingerprint(source){return createHash('sha256').update(JSON.stringify(canonical(Object.fromEntries(Object.entries(source).filter(([key])=>!passive.has(key)))))).digest('hex').slice(0,24);}
function sourceBase(source){try{const url=new URL(String(source.bookSourceUrl).trim());if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return url.href;}catch{}return '';}
export function buildSourceCatalog(snapshot,legacy=[]){
 if(!Array.isArray(snapshot.sources)||!snapshot.sources.length)throw new Error('全量书源快照无效，请运行 npm run sync:newsstand');
 const sources=new Map(),records=new Map();
 for(const {source,meta}of legacy){const fingerprint=sourceFingerprint(source);records.set(fingerprint,{...meta,current:false});sources.set(meta.id,source);}
 let duplicates=0;
 for(const source of snapshot.sources){
  if(!source||typeof source!=='object'||Array.isArray(source))continue;
  const fingerprint=sourceFingerprint(source),existing=records.get(fingerprint);
  if(existing){if(existing.current)duplicates++;existing.current=true;continue;}
  const id=`lg-${fingerprint}`,name=String(source.bookSourceName||'未命名书源');
  const meta={id,title:name,name,url:sourceBase(source),category:'novel',theme:'cream',layout:'bold',current:true};
  records.set(fingerprint,meta);sources.set(id,source);
 }
 const metadata=[...records.values()].map(meta=>{
  const source=sources.get(meta.id),type=source.bookSourceType??0;
  const reason=type!==0?'非文字书源':!sourceBase(source)?'书源地址无效':!source.searchUrl||!source.ruleSearch?.bookList?'没有搜索规则':'';
  return {...meta,type,searchable:!reason,skipReason:reason,discoverable:!!source.exploreUrl&&!!(source.ruleExplore?.bookList||source.ruleSearch?.bookList)};
 });
 return {sources,metadata,info:{repository:snapshot.repository,bundle:snapshot.bundle,syncedAt:snapshot.syncedAt,upstreamCount:snapshot.sources.length,uniqueCount:metadata.filter(meta=>meta.current).length,duplicates,searchableCount:metadata.filter(meta=>meta.current&&meta.searchable).length}};
}
let loaded;
export function loadSourceCatalog(){
 return loaded??=(async()=>{
  const curated=JSON.parse(await readFile(new URL('../public/newsstand-catalog.json',import.meta.url),'utf8'));
  const legacy=await Promise.all(curated.sources.map(async meta=>({meta,source:JSON.parse(await readFile(new URL(`../public/newsstand-sources/${meta.id}.json`,import.meta.url),'utf8'))[0]})));
  const snapshot=JSON.parse(await unzip(await readFile(new URL('../data/newsstand-sources.json.gz',import.meta.url))));
  return buildSourceCatalog(snapshot,legacy);
 })();
}
