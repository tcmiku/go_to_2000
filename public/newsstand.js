import {categoryNames,readBooks,filterBooks,addBook,bookId,mergeBookMatches,rankBookMatches,readSearchStream} from './newsstand-data.js';
const $=selector=>document.querySelector(selector);
const racks=$('#racks'),dialog=$('#publication'),finder=$('#finder'),reader=$('#reader');
let sources=[],books=[],selected=null,category='all',page=0,query='',noticeTimer;
let allSearchController=null,matchGroups=new Map(),matchRows=new Map(),nextSourceIds=[],searchStats=null,visibleMatches=60,renderTimer;
let chapters=[],nextToc='',tocVisited=[],chapterIndex=-1,detailVersion=0,readVersion=0,searchVersion=0,searchPage=1,searchMode='search',lastQuery='',searchBusy=false;
try{books=readBooks(localStorage);}catch{}
const smallScreen=matchMedia('(max-width:700px)'),pageSize=()=>smallScreen.matches?9:18;
const date=new Date();$('#today').dateTime=date.toISOString().slice(0,10);$('#today').textContent=new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',weekday:'short'}).format(date);
function showNotice(text){$('#notice').textContent=text;$('#notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{$('#notice').hidden=true;},4000);}
function span(className,text){const el=document.createElement('span');el.className=className;el.textContent=text;return el;}
async function api(action,data){const response=await fetch(`/api/newsstand/${action}`,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});const body=await response.json();if(!response.ok)throw new Error(body.error||'书源请求失败');return body;}
function persist(next){try{localStorage.setItem('newsstand:books:v1',JSON.stringify(next));books=next;return true;}catch{showNotice('书架保存失败，浏览器存储空间不足或已被禁用');return false;}}
function cover(book,{button=true}={}){
 const node=document.createElement(button?'button':'div');
 const themes=['red','green','blue','yellow','pink','mint','cream','purple'];
 node.className=`publication-cover theme-${themes.includes(book.theme)?book.theme:'cream'} layout-bold`;
 node.style.setProperty('--tilt',`${[-2,1.3,-.6,1.8,-1.5,.5][Math.max(0,books.indexOf(book))%6]}deg`);
 node.append(span('cover-kicker',categoryNames[book.category]||'小说'),span('cover-title',book.name),span('cover-mark','書'),span('cover-subtitle',book.author||book.sourceName));
 if(book.progress)node.append(span('cover-saved','·'));
 if(button){node.type='button';node.setAttribute('aria-label',`${book.name}，${book.author||'佚名'}`);node.onclick=()=>openBook(book);}
 return node;
}
function render(){
 const filtered=filterBooks(books,{category,query}),pages=Math.max(1,Math.ceil(filtered.length/pageSize()));page=Math.max(0,Math.min(page,pages-1));racks.replaceChildren();
 const visible=filtered.slice(page*pageSize(),(page+1)*pageSize()),columns=smallScreen.matches?3:6;
 for(let row=0;row<3;row++){const shelf=document.createElement('div');shelf.className='shelf';visible.slice(row*columns,(row+1)*columns).forEach(book=>shelf.append(cover(book)));racks.append(shelf);}
 $('#empty').hidden=filtered.length!==0;$('#empty').firstChild.textContent=books.length?'没有找到这本书':'书架还空着';
 $('#page-number').textContent=`${String(page+1).padStart(2,'0')} / ${String(pages).padStart(2,'0')}`;$('#previous').disabled=page===0;$('#next').disabled=page>=pages-1;
 document.querySelectorAll('[data-category]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.category===category)));
}
function refreshSave(){const saved=books.some(book=>bookId(book)===bookId(selected));$('#save-book').textContent=saved?'从书架移除':'＋ 放上书架';}
function showDetails(){
 $('#publication-title').textContent=selected.name;$('#detail-cover').replaceChildren(cover(selected,{button:false}));$('#detail-category').textContent=categoryNames[selected.category]||'小说';$('#source-name').textContent=`${selected.author||'佚名'} · ${selected.sourceName}`;$('#book-intro').textContent=selected.intro||'';$('#read-book').textContent=selected.progress?'继续阅读':'开始阅读';refreshSave();
}
async function openBook(book){
 const version=++detailVersion;++readVersion;selected={...book};chapters=[];nextToc='';tocVisited=[];chapterIndex=-1;
 $('#chapters').replaceChildren();$('#more-chapters').hidden=true;$('#toc-status').textContent='正在解析书籍与目录…';$('#read-book').disabled=true;showDetails();if(!dialog.open)dialog.showModal();
 try{
  const result=await api('book',{sourceId:book.sourceId,book,variables:book.variables});if(version!==detailVersion)return;
  selected={...book,...result.book};showDetails();await loadToc(version);
 }catch(error){if(version===detailVersion)$('#toc-status').textContent=error.message;}
}
async function loadToc(version=detailVersion){
 $('#more-chapters').disabled=true;
 try{
  const result=await api('toc',{sourceId:selected.sourceId,book:selected,variables:selected.variables,nextUrl:nextToc,visited:tocVisited});if(version!==detailVersion)return;
  const seen=new Set(chapters.map(ch=>ch.url));chapters.push(...result.chapters.filter(ch=>!seen.has(ch.url)));nextToc=result.nextUrl;tocVisited=result.visited;selected.variables=result.variables;
  $('#chapters').replaceChildren(...chapters.map((chapter,index)=>{const li=document.createElement('li'),button=document.createElement('button');button.textContent=chapter.name;button.onclick=()=>readChapter(index);li.append(button);return li;}));
  $('#toc-status').textContent=`已加载 ${chapters.length} 章${nextToc?'，还有后续目录':''}`;$('#more-chapters').hidden=!nextToc;$('#read-book').disabled=!chapters.length;
 }catch(error){if(version===detailVersion)$('#toc-status').textContent=error.message;}finally{if(version===detailVersion)$('#more-chapters').disabled=false;}
}
$('#more-chapters').onclick=()=>loadToc();
$('#save-book').onclick=()=>{const exists=books.some(book=>bookId(book)===bookId(selected));const next=exists?books.filter(book=>bookId(book)!==bookId(selected)):addBook(books,selected);if(persist(next)){refreshSave();render();showNotice(exists?'已从书架移除':'已放上书架');}};
$('#read-book').onclick=async()=>{const version=detailVersion;let index=chapters.findIndex(ch=>ch.url===selected.progress?.url);while(index<0&&selected.progress&&nextToc){const previous=nextToc;await loadToc();if(version!==detailVersion)return;if(nextToc===previous)break;index=chapters.findIndex(ch=>ch.url===selected.progress.url);}if(version===detailVersion)readChapter(Math.max(0,index));};
async function readChapter(index){
 if(index<0||index>=chapters.length)return;const chapter=chapters[index],book=selected,version=++readVersion;chapterIndex=index;
 $('#reading-book').textContent=book.name;$('#chapter-title').textContent=chapter.name;$('#chapter-content').replaceChildren();$('#read-status').textContent='正在读取正文…';$('#chapter-prev').disabled=true;$('#chapter-next').disabled=true;$('#chapter-position').textContent=`${index+1} / ${chapters.length}`;
 if(!reader.open)reader.showModal();$('.reader-paper').scrollTop=0;
 try{
  const result=await api('content',{sourceId:book.sourceId,book,chapterUrl:chapter.url,variables:{...book.variables,...chapter.variables}});if(version!==readVersion)return;
  $('#chapter-content').replaceChildren(...result.content.split(/\n+/).filter(p=>p.trim()).map(text=>{const p=document.createElement('p');p.textContent=text.trim();return p;}));$('#read-status').textContent='';
  const progress={url:chapter.url,name:chapter.name,index};selected={...book,progress,variables:result.variables};
  if(books.some(entry=>bookId(entry)===bookId(book)))persist(books.map(entry=>bookId(entry)===bookId(book)?{...entry,progress,variables:result.variables}:entry));
  $('#read-book').textContent='继续阅读';
 }catch(error){if(version===readVersion)$('#read-status').textContent=error.message;}
 finally{if(version===readVersion){$('#chapter-prev').disabled=index===0;$('#chapter-next').disabled=index===chapters.length-1&&!nextToc;}}
}
$('#chapter-prev').onclick=()=>readChapter(chapterIndex-1);$('#chapter-next').onclick=async()=>{if(chapterIndex===chapters.length-1&&nextToc)await loadToc();readChapter(chapterIndex+1);};$('#reader-back').onclick=()=>reader.close();reader.addEventListener('close',()=>{++readVersion;});dialog.addEventListener('close',()=>{++detailVersion;});
let fontSize=20;function font(delta){fontSize=Math.max(16,Math.min(30,fontSize+delta));$('#chapter-content').style.fontSize=`${fontSize}px`;}$('#font-smaller').onclick=()=>font(-2);$('#font-larger').onclick=()=>font(2);
function sourceChanged(){if(searchMode==='all'){$('#explore-channel').replaceChildren();const id=$('#source-select').value;$('#download-source').href=`/api/newsstand/source/${id}`;try{localStorage.setItem('newsstand:source',id);}catch{}return;}++searchVersion;searchBusy=false;$('#search-books').disabled=false;$('#explore-books').disabled=false;$('#search-results').replaceChildren();$('#more-results').hidden=true;$('#explore-channel').hidden=true;$('#explore-channel').replaceChildren();$('#find-status').textContent='输入书名搜索，也可以逛逛书源。';const source=sources.find(s=>s.id===$('#source-select').value);$('#download-source').href=source?`/api/newsstand/source/${source.id}`:'#';try{localStorage.setItem('newsstand:source',source?.id||'');}catch{}}
function openFinder(){if(!finder.open)finder.showModal();$('#book-query').focus();}$('#find-books').onclick=openFinder;$('#empty-add').onclick=openFinder;
function renderResults(results,append=false){if(!append)$('#search-results').replaceChildren();for(const book of results){const row=document.createElement('div');row.className='result-row';const info=document.createElement('div'),title=document.createElement('strong');title.textContent=book.name;info.append(title,span('result-author',book.author||'佚名'),span('result-intro',book.intro||book.lastChapter||book.sourceName));const button=document.createElement('button');button.textContent='查看 / 加书';button.onclick=()=>openBook(book);row.append(info,button);$('#search-results').append(row);}}
async function search(mode='search',append=false){
 if(searchBusy)return;const sourceId=$('#source-select').value;if(!sourceId)return;
 if(!append){lastQuery=$('#book-query').value.trim();searchPage=1;searchMode=mode;}
 if(mode==='search'&&!lastQuery){$('#find-status').textContent='请输入书名或作者';return;}
 const requestedPage=append?searchPage+1:1,version=++searchVersion;searchBusy=true;$('#search-books').disabled=true;$('#explore-books').disabled=true;$('#more-results').disabled=true;$('#find-status').textContent='正在按书源规则找书…';
 if(!append){$('#search-results').replaceChildren();$('#more-results').hidden=true;}
 try{
  const result=await api(mode,{sourceId,query:lastQuery,page:requestedPage,channel:Number($('#explore-channel').value)||0});if(version!==searchVersion)return;searchPage=requestedPage;
  renderResults(result.books,append);$('#find-status').textContent=result.books.length?`第 ${searchPage} 页 · 找到 ${result.books.length} 本书，选择后可放上书架。`:'没有解析到书籍。可以换个关键词、栏目或书源。';$('#more-results').hidden=!result.hasMore;
  if(mode==='explore'&&result.channels.length){const previous=$('#explore-channel').value;$('#explore-channel').replaceChildren(...result.channels.map((channel,index)=>new Option(channel.title,index)));$('#explore-channel').value=previous||'0';$('#explore-channel').hidden=false;}
 }catch(error){if(version===searchVersion)$('#find-status').textContent=error.message;}finally{if(version===searchVersion){searchBusy=false;$('#search-books').disabled=false;$('#explore-books').disabled=false;$('#more-results').disabled=false;}}
}
$('#book-search').onsubmit=event=>{event.preventDefault();searchAll();};$('#explore-books').onclick=()=>{stopAllSearch(false);search('explore');};$('#more-results').onclick=()=>searchMode==='all'?searchAll(true):search(searchMode,true);$('#source-select').onchange=sourceChanged;$('#explore-channel').onchange=()=>search('explore');
$('#url-form').onsubmit=async event=>{event.preventDefault();const source=sources.find(s=>s.id===$('#source-select').value);if(!source)return;const button=event.submitter;button.disabled=true;$('#find-status').textContent='正在解析书籍…';try{const result=await api('book',{sourceId:source.id,bookUrl:$('#book-url').value.trim()});$('#find-status').textContent='解析成功，可以查看并放上书架。';openBook(result.book);}catch(error){$('#find-status').textContent=error.message;}finally{button.disabled=false;}};
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>document.getElementById(button.dataset.close).close());
document.querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{category=button.dataset.category;page=0;render();});$('#source-query').oninput=()=>{query=$('#source-query').value;page=0;render();};$('#source-search').onsubmit=event=>event.preventDefault();
$('#previous').onclick=()=>{page--;render();};$('#next').onclick=()=>{page++;render();};smallScreen.addEventListener('change',()=>{page=0;render();});
let lights=true;try{lights=localStorage.getItem('newsstand:lights')!=='off';}catch{}
function setLights(){document.body.classList.toggle('lights-off',!lights);$('#light-switch').setAttribute('aria-pressed',String(lights));$('#light-switch').textContent=lights?'☀':'☾';}setLights();$('#light-switch').onclick=()=>{lights=!lights;setLights();try{localStorage.setItem('newsstand:lights',lights?'on':'off');}catch{}};
render();
try{const result=await api('sources');if(result.catalog)$('#source-summary').textContent=`?? ${result.catalog.upstreamCount} ? ? ??? ${result.catalog.uniqueCount} ?? ? ${result.catalog.searchableCount} ???????`;sources=result.sources.filter(source=>source.type===0);$('#source-select').replaceChildren(...sources.map(source=>new Option(`${source.title}${source.searchable?'':' · 发现 / 网址'}`,source.id)));try{const id=localStorage.getItem('newsstand:source');if(sources.some(source=>source.id===id))$('#source-select').value=id;}catch{}sourceChanged();$('#find-status').textContent='????????????????????';}catch(error){$('#find-status').textContent=`书源加载失败：${error.message}`;$('#source-select').replaceChildren(new Option('书源加载失败',''));}

function updateSearchStatus(prefix='正在匹配'){
 const stats=searchStats||{completed:0,total:0,failed:0};
 $('#find-status').textContent=`${prefix} · 已搜索 ${stats.completed} / ${stats.total} 个源 · 找到 ${matchGroups.size} 本书${stats.failed?` · ${stats.failed} 个源失败`:''}`;
 $('#search-progress').max=Math.max(1,stats.total);$('#search-progress').value=stats.completed;
}
function renderMatches(){
 clearTimeout(renderTimer);const ranked=rankBookMatches(matchGroups,lastQuery),visible=ranked.slice(0,visibleMatches),nodes=[];
 for(const group of visible){
  let record=matchRows.get(group.id);
  if(!record){
   const row=document.createElement('div');row.className='result-row';const info=document.createElement('div'),title=document.createElement('strong');title.textContent=group.name;
   const intro=span('result-intro',group.books[0].intro||group.books[0].lastChapter||'');
   const label=document.createElement('label');label.className='match-sources';const count=span('match-count',''),select=document.createElement('select');select.setAttribute('aria-label',`${group.name}的可用来源`);label.append(count,select);
   info.append(title,span('result-author',group.author||'佚名'),intro,label);
   const button=document.createElement('button');button.textContent='查看 / 加书';button.onclick=()=>{const book=group.books.find(book=>bookId(book)===select.value)||group.books[0];openBook(book);};row.append(info,button);record={row,select,count,variants:0};matchRows.set(group.id,record);
  }
  if(record.variants!==group.books.length){const selectedId=record.select.value;record.select.replaceChildren(...group.books.map(book=>new Option(book.sourceName||book.sourceId,bookId(book))));if(group.books.some(book=>bookId(book)===selectedId))record.select.value=selectedId;record.count.textContent=`${group.books.length} 个来源`;record.variants=group.books.length;}
  nodes.push(record.row);
 }
 const previous=[...$('#search-results').children];if(previous.length!==nodes.length||nodes.some((node,index)=>previous[index]!==node))$('#search-results').replaceChildren(...nodes);
 $('#show-matches').hidden=ranked.length<=visibleMatches;$('#show-matches').textContent=`显示更多已找到的书（还有 ${Math.max(0,ranked.length-visibleMatches)} 本）`;
}
function stopAllSearch(show=true){
 if(!allSearchController)return;
 ++searchVersion;allSearchController.abort();allSearchController=null;searchBusy=false;
 $('#stop-search').hidden=true;$('#search-books').textContent='全源搜书';$('#search-books').disabled=false;$('#explore-books').disabled=false;$('#more-results').hidden=true;renderMatches();if(show)updateSearchStatus('已停止，结果已保留');
}
async function searchAll(append=false){
 const keyword=append?lastQuery:$('#book-query').value.trim();if(!keyword){$('#find-status').textContent='请输入书名或作者';return;}
 stopAllSearch(false);const controller=new AbortController(),version=++searchVersion;allSearchController=controller;
 if(!append){lastQuery=keyword;searchPage=0;matchGroups=new Map();matchRows=new Map();nextSourceIds=[];visibleMatches=60;$('#search-results').replaceChildren();}
 const requestedPage=searchPage+1;searchMode='all';searchBusy=true;searchStats={completed:0,total:0,failed:0};
 $('#search-errors').hidden=true;$('#source-failures').replaceChildren();$('#show-matches').hidden=true;$('#more-results').hidden=true;$('#stop-search').hidden=false;$('#search-progress').hidden=false;$('#search-books').disabled=false;$('#search-books').textContent='重新搜索';$('#explore-books').disabled=true;$('#find-status').textContent='正在启动全源搜索，找到的书会陆续出现…';
 let finished=false;
 try{
  const response=await fetch('/api/newsstand/search-all',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:keyword,page:requestedPage,...(append?{sourceIds:nextSourceIds}:{})}),signal:controller.signal});
  await readSearchStream(response,event=>{
   if(version!==searchVersion)return;
   if(event.type==='start'){searchStats={completed:0,total:event.total,failed:0};updateSearchStatus();}
   if(event.type==='source'){
    searchStats=event;mergeBookMatches(matchGroups,event.books);
    if(event.error){$('#search-errors').hidden=false;const item=document.createElement('li');item.textContent=`${event.sourceName}：${event.error}`;$('#source-failures').append(item);$('#error-summary').textContent=`查看失败的书源（${event.failed}）`;}
    updateSearchStatus();if(event.books.length){clearTimeout(renderTimer);renderTimer=setTimeout(renderMatches,100);}
   }
   if(event.type==='done'){finished=true;searchPage=requestedPage;nextSourceIds=event.nextSourceIds;searchStats=event;renderMatches();updateSearchStatus('本轮搜索完成');$('#more-results').hidden=!nextSourceIds.length;$('#more-results').textContent=`继续搜索下一页（${nextSourceIds.length} 个源）`;}
  });
 }catch(error){if(version===searchVersion&&error.name!=='AbortError'){$('#find-status').textContent=`${error.message}；已找到 ${matchGroups.size} 本书`;renderMatches();}}
 finally{if(version===searchVersion){allSearchController=null;searchBusy=false;$('#stop-search').hidden=true;$('#search-books').textContent='全源搜书';$('#explore-books').disabled=false;$('#more-results').disabled=false;if(!finished)$('#more-results').hidden=true;}}
}
$('#stop-search').onclick=()=>stopAllSearch();$('#show-matches').onclick=()=>{visibleMatches+=60;renderMatches();};finder.addEventListener('close',()=>stopAllSearch());window.addEventListener('pagehide',()=>stopAllSearch(false));
