import { Worker } from 'node:worker_threads';
import { loadSourceCatalog } from './newsstand-catalog.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu,'');
export function matchesBook(book,query){const name=normalize(book.name),author=normalize(book.author);return String(query).trim().split(/\s+/).map(normalize).filter(Boolean).every(word=>name.includes(word)||author.includes(word));}

// Reuse a worker per lane. A stuck CSS/regex rule cannot block the HTTP server.
export function createSearchWorker({timeout=10000,workerUrl=new URL('./newsstand-search-worker.js',import.meta.url)}={}){
 let worker;
 return {
  async search(payload,signal){
   if(signal?.aborted)throw fail(499,'搜索已停止');
   worker??=new Worker(workerUrl,{resourceLimits:{maxOldGenerationSizeMb:96}});
   const current=worker;
   return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,value,terminate=false)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);current.off('message',message);current.off('error',crash);current.off('exit',exit);
     if(terminate){worker=null;current.terminate().catch(()=>{});}error?reject(error):resolve(value);
    };
    const abort=()=>finish(fail(499,'搜索已停止'),null,true);
    const crash=()=>finish(fail(422,'书源解析失败'),null,true);
    const exit=()=>finish(fail(422,'书源解析进程已退出'),null,true);
    const message=value=>value.error?finish(fail(value.error.status,value.error.message)):finish(null,value.result);
    const timer=setTimeout(()=>finish(fail(504,'书源搜索超时'),null,true),timeout);
    current.once('message',message);current.once('error',crash);current.once('exit',exit);signal?.addEventListener('abort',abort,{once:true});
    current.postMessage(payload);
   });
  },
  async close(){const current=worker;worker=null;if(current)await current.terminate();},
 };
}

export function createAllSourceSearch({getCatalog=loadSourceCatalog,createRunner=createSearchWorker,concurrency=8}={}){
 let active=0;
 return async(data,{signal,onEvent=()=>{}}={})=>{
  if(!data||typeof data.query!=='string'||!normalize(data.query)||data.query.length>120)throw fail(400,'请输入 1–120 字的书名或作者');
  if(active>=2)throw fail(429,'正在进行其他全源搜索，请稍后重试');
  const page=Number(data.page??1);if(!Number.isInteger(page)||page<1||page>1000)throw fail(400,'搜索页码无效');
  active++;
  try{
   const catalog=await getCatalog(),query=data.query.trim();
   const eligible=catalog.metadata.filter(source=>source.current&&source.searchable);
   let selected=eligible;
   if(page>1){if(!Array.isArray(data.sourceIds)||data.sourceIds.length>eligible.length)throw fail(400,'缺少下一页书源');const ids=new Set(data.sourceIds);selected=eligible.filter(source=>ids.has(source.id));}
   // Current curated aliases go first for quick feedback; every eligible source is queued.
   const pending=[...selected],busyHosts=new Set(),seen=new Set(),nextSourceIds=[];
   const total=pending.length;let completed=0,failed=0,matchedSources=0,matchedBooks=0;
   await onEvent({type:'start',...catalog.info,total,page,skipped:catalog.info.uniqueCount-eligible.length});
   async function lane(){
    const runner=createRunner();
    try{
     while(!signal?.aborted){
      const index=pending.findIndex(source=>!busyHosts.has(new URL(source.url).hostname));if(index<0)break;
      const [source]=pending.splice(index,1),host=new URL(source.url).hostname;busyHosts.add(host);
      let books=[],error='',hasMore=false;
      try{
       const result=await runner.search({source,definition:catalog.sources.get(source.id),query,page},signal);
       books=result.books.filter(book=>matchesBook(book,query)).filter(book=>{const id=`${book.sourceId}:${book.bookUrl}`;if(seen.has(id))return false;seen.add(id);return true;});
       hasMore=!!result.hasMore&&books.length>0;
      }catch(reason){error=String(reason.message||'书源搜索失败').slice(0,240);}
      finally{busyHosts.delete(host);}
      if(signal?.aborted)break;
      completed++;if(error)failed++;if(books.length)matchedSources++;matchedBooks+=books.length;if(hasMore)nextSourceIds.push(source.id);
      await onEvent({type:'source',sourceId:source.id,sourceName:source.title,status:error?'error':books.length?'matched':'empty',error,books,completed,total,failed,matchedSources,matchedBooks});
     }
    }finally{await runner.close();}
   }
   await Promise.all(Array.from({length:Math.min(concurrency,total)},lane));
   if(!signal?.aborted)await onEvent({type:'done',completed,total,failed,matchedSources,matchedBooks,nextSourceIds,page});
  }finally{active--;}
 };
}
