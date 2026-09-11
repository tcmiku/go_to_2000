import { publicRequest } from './listening-service.js';
import { LegadoRules, ruleError, htmlText } from './legado-rules.js';
import iconv from 'iconv-lite';
import { loadSourceCatalog } from './newsstand-catalog.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=(value,max=4000)=>typeof value==='string'?value.slice(0,max):'';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};

export function createNewsstandService({request=publicRequest,sources,metadata=[],searchTimeout=12000}={}) {
 let active=0,sourceInfo;
 async function run(action,data={}) {
  if(!sources){const catalog=await loadSourceCatalog();sources=catalog.sources;metadata=catalog.metadata;sourceInfo=catalog.info;}
  if(action==='sources')return {catalog:sourceInfo,sources:metadata.map(meta=>{const source=sources.get(meta.id);return {...meta,searchable:meta.searchable??!!(source.searchUrl&&source.ruleSearch?.bookList),discoverable:!!source.exploreUrl&&!!(source.ruleExplore?.bookList||source.ruleSearch?.bookList),type:source.bookSourceType??0};})};
  const source=sources.get(data.sourceId);if(!source)throw fail(404,'请选择有效的书源');
  if(!['search','explore','book','toc','content'].includes(action))throw fail(404,'接口不存在');
  if((source.bookSourceType??0)!==0)throw ruleError('当前阅读器支持文字书源，此漫画或有声源暂不支持');
  const meta=metadata.find(item=>item.id===data.sourceId)||{id:data.sourceId,title:source.bookSourceName,category:'novel',theme:'cream',layout:'bold',art:0};
  const book=object(data.book);
  const engine=new LegadoRules({baseUrl:source.bookSourceUrl,key:text(data.query,120).trim(),page:Math.max(1,Math.min(1000,Math.trunc(Number(data.page))||1)),book,variables:object(data.variables)});
  let requests=0;
  async function fetchPage(rule,previous='') {
   if(++requests>40)throw ruleError('书源分页过多，请分批继续加载');
   const config=engine.request(rule,previous);
   let headers=source.header?engine.js(`(${source.header})`,''):{};
   const response=await request(config.url,{...config.options,headers:{'User-Agent':'Mozilla/5.0','Accept':'text/html,application/json',...headers,...config.options.headers},raw:true,maxBytes:4*1024*1024,timeout:action==='search'?searchTimeout:12000});
   if(response.statusCode<200||response.statusCode>=300)throw fail(502,`书源请求失败（HTTP ${response.statusCode}），请稍后重试或换源`);
   engine.baseUrl=response.url||config.url;engine.deadline=Date.now()+8000;
   if(response.bytes){const hint=response.bytes.subarray(0,4096).toString('ascii');const charset=config.charset||String(response.headers['content-type']||'').match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1]||hint.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]||'utf-8';
    if(!iconv.encodingExists(charset))throw ruleError(`书源编码暂不支持：${charset}`);
    return iconv.decode(response.bytes,charset);
   }
   return typeof response.body==='string'?response.body:JSON.stringify(response.body);
  }
  function address(input,rule,fallback='') {const value=engine.text(input,rule);if(!value)return fallback;const config=engine.request(value,input);return config.url+(Object.values(config.options).some(v=>v!==undefined&&v!=='GET'&&!(typeof v==='object'&&Object.keys(v).length===0))?','+JSON.stringify(config.options):'');}
  function fields(input,rules) {
   const result={};for(const name of ['name','author','intro','kind','lastChapter','wordCount'])if(rules[name])result[name]=htmlText(engine.text(input,rules[name]));
   if(rules.coverUrl)result.coverUrl=address(input,rules.coverUrl);return result;
  }
  function bookRow(input,rules) {
   return {...fields(input,rules),bookUrl:address(input,rules.bookUrl),sourceId:meta.id,sourceName:meta.title,category:meta.category,theme:meta.theme,layout:meta.layout,art:meta.art,variables:{...engine.variables}};
  }
  if(action==='search'||action==='explore') {
   const explore=action==='explore',rules=explore?{...source.ruleSearch,...Object.fromEntries(Object.entries(source.ruleExplore||{}).filter(([,value])=>value))}:source.ruleSearch;
   if(!rules?.bookList)throw ruleError(explore?'此书源没有发现规则，请用书籍网址添加':'此书源没有搜索规则，请使用发现或书籍网址添加');
   let target=source.searchUrl,channels=[];
   if(explore) {
    if(!source.exploreUrl)throw ruleError('此书源没有发现入口');
    let entries=source.exploreUrl;
    if(/<js>|@js:/.test(entries))entries=engine.values('',entries).flat();
    if(typeof entries==='string') {try{entries=JSON.parse(entries);}catch{entries=entries.split(/\n|&&/).filter(Boolean).map(line=>{const [title,url]=line.split('::');return{title,url};});}}
    channels=entries.filter(entry=>entry.url).map(({title,url})=>({title,url}));
    target=channels[Number(data.channel)||0]?.url;if(!target)throw ruleError('书源没有可用的发现栏目');
   } else if(!engine.key)throw fail(400,'请输入书名或作者');
   if(!target)throw ruleError('书源没有搜索地址');
   const input=await fetchPage(target);
   const rows=engine.values(input,rules.bookList,{elements:true}).slice(0,100);
   const books=rows.map(row=>bookRow(row,rules)).filter(row=>row.name&&row.bookUrl);
   return {books,channels:channels.map(({title})=>({title})),page:engine.page,hasMore:books.length>0};
  }
  const bookUrl=text(book.bookUrl||data.bookUrl);if(!bookUrl)throw fail(400,'缺少书籍网址');
  if(action==='book') {
   let input=await fetchPage(bookUrl),rules=source.ruleBookInfo||{};
   if(rules.init)input=engine.values(input,rules.init,{elements:true})[0]??input;
   const details={...book,...fields(input,rules),bookUrl,sourceId:meta.id,sourceName:meta.title,category:meta.category,theme:meta.theme,layout:meta.layout,art:meta.art};
   if(!details.name)throw ruleError('未解析到书名，请检查是否为书籍详情网址，或从搜索结果添加');
   engine.book=details;details.tocUrl=address(input,rules.tocUrl,bookUrl);details.variables=engine.variables;
   return {book:details};
  }
  if(action==='toc') {
   const rules=source.ruleToc;if(!rules?.chapterList)throw ruleError('此书源没有目录规则');
   let target=text(data.nextUrl)||text(book.tocUrl)||bookUrl,chapters=[],seen=new Set();
   const loaded=new Set((Array.isArray(data.visited)?data.visited:[]).filter(v=>typeof v==='string').slice(0,1000));
   // One bounded batch; the UI can request remaining pages without losing chapters.
   for(let page=0;target&&page<8;page++) {
    if(loaded.has(target)){target='';break;}loaded.add(target);
    const input=await fetchPage(target),reverse=rules.chapterList.startsWith('-');
    const rows=engine.values(input,reverse?rules.chapterList.slice(1):rules.chapterList,{elements:true});if(reverse)rows.reverse();
    for(const row of rows.slice(0,20000)) {
     const name=engine.text(row,rules.chapterName),url=address(row,rules.chapterUrl);
     if(name&&url&&!seen.has(url)){seen.add(url);chapters.push({name,url,variables:{...engine.variables}});}
    }
    target=address(input,rules.nextTocUrl);if(loaded.has(target))target='';
   }
   if(!chapters.length)throw ruleError('未解析到目录，书源可能已失效或需要登录');
   return {chapters,nextUrl:target,visited:[...loaded],variables:engine.variables};
  }
  const rules=source.ruleContent;if(!rules?.content)throw ruleError('此书源没有正文规则');
  if(rules.webJs||rules.sourceRegex)throw ruleError('此正文依赖 App 的 WebView 或资源嗅探，暂不支持');
  let target=text(data.chapterUrl);if(!target)throw fail(400,'缺少章节网址');
  const visited=new Set(),parts=[];
  const pending=[target];
  while(pending.length&&visited.size<20) {
   target=pending.shift();if(visited.has(target))continue;visited.add(target);
   const input=await fetchPage(target);
   let content=engine.text(input,rules.content);
   if(rules.replaceRegex){const [pattern,repl='']=rules.replaceRegex.replace(/^##/,'').split('##');content=content.replace(new RegExp(pattern,'g'),repl);}
   content=htmlText(content);if(!content)throw ruleError('未解析到正文，书源可能已失效或需要登录');parts.push(content);
   for(const next of engine.values(input,rules.nextContentUrl)){if(next){const config=engine.request(String(next),input);if(!visited.has(config.url))pending.push(config.url);}}
  }
  if(pending.length)throw ruleError('本章分页超过 20 页，暂不能完整加载');
  return {content:parts.join('\n\n'),variables:engine.variables};
 }
 return async(action,data)=> {
  if(data!==undefined&&(!data||typeof data!=='object'||Array.isArray(data)))throw fail(400,'请求数据必须是 JSON 对象');
  if(active>=4)throw fail(429,'正在解析其他书源，请稍后再试');active++;
  try{return await run(action,data);}catch(error){if(error.status)throw Object.assign(error,{message:error.message.replaceAll('音源','书源')});throw ruleError(`书源规则无法解析：${String(error.message).slice(0,160)}`);}finally{active--;}
 };
}
