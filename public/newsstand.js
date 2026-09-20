import {categoryNames,readBooks,filterBooks,addBook,bookId,mergeBookMatches,rankBookMatches,readSearchStream} from './newsstand-data.js';
const $=selector=>document.querySelector(selector);
const racks=$('#racks'),dialog=$('#publication'),finder=$('#finder'),reader=$('#reader');
let sources=[],books=[],selected=null,category='all',page=0,query='',noticeTimer;
let undoRemoval=null,tocTask=null,visibleChapters=120,detailReady=false,readingReady=false,scrollTimer;
let singleController=null,detailController=null,contentController=null;
let allSearchController=null,matchGroups=new Map(),matchRows=new Map(),nextSourceIds=[],searchStats=null,visibleMatches=60,renderTimer;
let chapters=[],nextToc='',tocVisited=[],chapterIndex=-1,detailVersion=0,readVersion=0,searchVersion=0,searchPage=1,searchMode='search',lastQuery='',searchBusy=false;
try{books=readBooks(localStorage);}catch{}
const smallScreen=matchMedia('(max-width:700px)'),pageSize=()=>smallScreen.matches?9:18;
const date=new Date();$('#today').dateTime=date.toISOString().slice(0,10);$('#today').textContent=new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',weekday:'short'}).format(date);
function showNotice(text,undo=null){(reader.open?reader:dialog.open?dialog:finder.open?finder:document.body).append($('#notice'));undoRemoval=undo;$('#notice-text').textContent=text;$('#undo-remove').hidden=!undo;$('#notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{$('#notice').hidden=true;undoRemoval=null;},8000);}
function span(className,text){const el=document.createElement('span');el.className=className;el.textContent=text;return el;}
async function api(action,data,signal){const response=await fetch(`/api/newsstand/${action}`,{...(data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{}),signal});const body=await response.json();if(!response.ok)throw new Error(body.error||'书源请求失败');return body;}
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
 $('#empty').hidden=filtered.length!==0;$('#empty-title').textContent=books.length?'没有匹配的书':'书架为空';$('.rack-area').classList.toggle('is-empty',!filtered.length);$('#clear-filter').hidden=!books.length;$('#empty-add').hidden=!!books.length;$('#shelf-count').textContent=`${books.length} 本`;
 $('#page-number').textContent=`${String(page+1).padStart(2,'0')} / ${String(pages).padStart(2,'0')}`;$('#previous').disabled=page===0;$('#next').disabled=page>=pages-1;
 document.querySelectorAll('[data-category]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.category===category)));
}
function refreshSave(){const saved=books.some(book=>bookId(book)===bookId(selected));$('#save-book').textContent=saved?'从书架移除':'＋ 放上书架';}
function showDetails(){
 $('#publication-title').textContent=selected.name;$('#detail-cover').replaceChildren(cover(selected,{button:false}));$('#detail-category').textContent=categoryNames[selected.category]||'小说';$('#source-name').textContent=`${selected.author||'佚名'} · ${selected.sourceName}`;$('#book-intro').textContent=selected.intro||'';$('#read-book').textContent=selected.progress?'继续阅读':'开始阅读';refreshSave();
}
async function openBook(book){
 saveReadingPosition();readingReady=false;detailController?.abort();contentController?.abort();detailController=new AbortController();const version=++detailVersion;++readVersion;book={...book,...books.find(item=>bookId(item)===bookId(book))};selected={...book};chapters=[];nextToc='';tocVisited=[];chapterIndex=-1;tocTask=null;visibleChapters=120;detailReady=false;$('#retry-toc').hidden=true;
 $('#chapters').replaceChildren();$('#more-chapters').hidden=true;$('#toc-status').textContent='正在解析书籍与目录…';$('#read-book').disabled=true;showDetails();if(!dialog.open)dialog.showModal();
 try{
  const result=await api('book',{sourceId:book.sourceId,book,variables:book.variables},detailController.signal);if(version!==detailVersion)return;
  selected={...book,...result.book,progress:book.progress};detailReady=true;showDetails();await loadToc(version);
 }catch(error){if(version===detailVersion&&error.name!=='AbortError'){$('#toc-status').textContent=error.message;$('#retry-toc').hidden=false;}}
}
function drawChapters(){
 $('#chapters').replaceChildren(...chapters.slice(0,visibleChapters).map((chapter,index)=>{const li=document.createElement('li'),button=document.createElement('button');button.textContent=chapter.name;button.setAttribute('aria-current',String(chapter.url===selected.progress?.url));button.onclick=()=>readChapter(index);li.append(button);return li;}));
 $('#more-chapters').hidden=visibleChapters>=chapters.length&&!nextToc;
 $('#more-chapters').textContent=visibleChapters<chapters.length?'更多目录':'加载后续目录';
 $('#read-book').disabled=!chapters.length;
}
async function loadToc(version=detailVersion){
 if(tocTask)return tocTask;
 const book=selected,controller=detailController;
 $('#more-chapters').disabled=true;$('#retry-toc').hidden=true;
 const task=(async()=>{
  try{
   const result=await api('toc',{sourceId:book.sourceId,book,variables:book.variables,nextUrl:nextToc,visited:tocVisited},controller.signal);
   if(version!==detailVersion)return false;
   const seen=new Set(chapters.map(ch=>ch.url));for(const chapter of result.chapters){if(!seen.has(chapter.url)){seen.add(chapter.url);chapters.push(chapter);}}
   nextToc=result.nextUrl;tocVisited=result.visited;selected.variables=result.variables;
   drawChapters();$('#toc-status').textContent=`${chapters.length} 章${nextToc?' · 未完':''}`;return true;
  }catch(error){if(version===detailVersion&&error.name!=='AbortError'){$('#toc-status').textContent=error.message;$('#retry-toc').hidden=false;}return false;}
  finally{if(version===detailVersion)$('#more-chapters').disabled=false;}
 })();tocTask=task;try{return await task;}finally{if(tocTask===task)tocTask=null;}
}
$('#more-chapters').onclick=async()=>{if(visibleChapters<chapters.length){visibleChapters+=120;drawChapters();}else{visibleChapters+=120;await loadToc();}};
$('#retry-toc').onclick=()=>detailReady?loadToc():openBook(selected);
$('#save-book').onclick=()=>{
 const index=books.findIndex(book=>bookId(book)===bookId(selected)),removed=books[index];
 const next=index>=0?books.filter(book=>bookId(book)!==bookId(selected)):addBook(books,selected);
 if(persist(next)){refreshSave();render();showNotice(index>=0?'已移除':'已上架',removed?{book:removed,index}:null);}
};
$('#undo-remove').onclick=()=>{if(!undoRemoval)return;const {book,index}=undoRemoval;if(!books.some(item=>bookId(item)===bookId(book))){const next=[...books];next.splice(Math.min(index,next.length),0,book);if(!persist(next))return;}render();if(selected)refreshSave();showNotice('已恢复');};
$('#read-book').onclick=async()=>{
 const version=detailVersion;$('#read-book').disabled=true;
 try{
  let index=chapters.findIndex(ch=>ch.url===selected.progress?.url);
  while(index<0&&selected.progress&&nextToc){const previous=nextToc;if(!await loadToc())return;if(version!==detailVersion)return;if(nextToc===previous)break;index=chapters.findIndex(ch=>ch.url===selected.progress.url);}
  if(version!==detailVersion)return;
  if(index<0&&selected.progress){$('#toc-status').textContent='原章节已变更，请从目录选择';return;}
  readChapter(Math.max(0,index));
 }finally{if(version===detailVersion)$('#read-book').disabled=!chapters.length;}
};
function saveReadingPosition(){
 clearTimeout(scrollTimer);if(!readingReady||!selected?.progress)return;
 const panel=$('.reader-paper'),range=Math.max(0,panel.scrollHeight-panel.clientHeight),offset=range?Math.max(0,Math.min(1,panel.scrollTop/range)):0;
 selected.progress={...selected.progress,offset};
 if(books.some(book=>bookId(book)===bookId(selected)))persist(books.map(book=>bookId(book)===bookId(selected)?{...book,progress:selected.progress,variables:selected.variables}:book));
}
$('.reader-paper').addEventListener('scroll',()=>{if(readingReady){clearTimeout(scrollTimer);scrollTimer=setTimeout(saveReadingPosition,350);}},{passive:true});
async function readChapter(index){
 if(index<0||index>=chapters.length)return;saveReadingPosition();readingReady=false;contentController?.abort();contentController=new AbortController();const chapter=chapters[index],book=selected,version=++readVersion;chapterIndex=index;$('#retry-chapter').hidden=true;
 $('#reading-book').textContent=book.name;$('#chapter-title').textContent=chapter.name;$('#chapter-content').replaceChildren();$('#read-status').textContent='正在读取正文…';$('#chapter-prev').disabled=true;$('#chapter-next').disabled=true;$('#chapter-position').textContent=`${index+1} / ${chapters.length}`;
 if(!reader.open)reader.showModal();$('.reader-paper').scrollTop=0;
 try{
  const result=await api('content',{sourceId:book.sourceId,book,chapterUrl:chapter.url,variables:{...book.variables,...chapter.variables}},contentController.signal);if(version!==readVersion)return;
  $('#chapter-content').replaceChildren(...result.content.split(/\n+/).filter(p=>p.trim()).map(text=>{const p=document.createElement('p');p.textContent=text.trim();return p;}));$('#read-status').textContent='';
  const offset=book.progress?.url===chapter.url?Number(book.progress.offset)||0:0;const progress={url:chapter.url,name:chapter.name,index,offset};selected={...book,progress,variables:result.variables};
  if(books.some(entry=>bookId(entry)===bookId(book)))persist(books.map(entry=>bookId(entry)===bookId(book)?{...entry,progress,variables:result.variables}:entry));
  $('#read-book').textContent='继续阅读';readingReady=true;requestAnimationFrame(()=>{if(version===readVersion){const panel=$('.reader-paper');panel.scrollTop=Math.max(0,panel.scrollHeight-panel.clientHeight)*Math.max(0,Math.min(1,offset));}});
 }catch(error){if(version===readVersion&&error.name!=='AbortError'){$('#read-status').textContent=error.message;$('#retry-chapter').hidden=false;}}
 finally{if(version===readVersion){$('#chapter-prev').disabled=index===0;$('#chapter-next').disabled=index===chapters.length-1&&!nextToc;}}
}
$('#retry-chapter').onclick=()=>readChapter(chapterIndex);
$('#chapter-prev').onclick=()=>readChapter(chapterIndex-1);
$('#chapter-next').onclick=async()=>{const version=detailVersion,index=chapterIndex;$('#chapter-next').disabled=true;if(index===chapters.length-1&&nextToc){if(!await loadToc()){if(version===detailVersion)$('#chapter-next').disabled=false;return;}}if(version===detailVersion&&index===chapterIndex)readChapter(index+1);};
$('#reader-back').onclick=()=>reader.close();
reader.addEventListener('close',()=>{saveReadingPosition();readingReady=false;++readVersion;contentController?.abort();drawChapters();render();});
dialog.addEventListener('close',()=>{++detailVersion;detailController?.abort();tocTask=null;});
let fontSize=20;try{fontSize=Number(localStorage.getItem('newsstand:font'))||20;}catch{}
function font(delta){saveReadingPosition();fontSize=Math.max(16,Math.min(30,fontSize+delta));$('#chapter-content').style.fontSize=`${fontSize}px`;$('#font-smaller').disabled=fontSize<=16;$('#font-larger').disabled=fontSize>=30;try{localStorage.setItem('newsstand:font',String(fontSize));}catch{}}
font(0);$('#font-smaller').onclick=()=>font(-2);$('#font-larger').onclick=()=>font(2);
function sourceChanged(){if(searchMode==='all'&&allSearchController){$('#explore-channel').hidden=true;$('#explore-channel').replaceChildren();const id=$('#source-select').value;$('#download-source').href=`/api/newsstand/source/${id}`;try{localStorage.setItem('newsstand:source',id);}catch{}return;}singleController?.abort();++searchVersion;searchBusy=false;$('#search-books').disabled=false;$('#explore-books').disabled=false;$('#search-results').replaceChildren();$('#more-results').hidden=true;$('#explore-channel').hidden=true;$('#explore-channel').replaceChildren();$('#find-status').textContent='';const source=sources.find(s=>s.id===$('#source-select').value);$('#download-source').href=source?`/api/newsstand/source/${source.id}`:'#';try{localStorage.setItem('newsstand:source',source?.id||'');}catch{}}
function openFinder(){if(!finder.open)finder.showModal();$('#book-query').focus();}$('#find-books').onclick=openFinder;$('#empty-add').onclick=openFinder;
function renderResults(results,append=false){if(!append)$('#search-results').replaceChildren();for(const book of results){const row=document.createElement('div');row.className='result-row';const info=document.createElement('div'),title=document.createElement('strong');title.textContent=book.name;info.append(title,span('result-author',book.author||'佚名'),span('result-intro',book.intro||book.lastChapter||book.sourceName));const button=document.createElement('button');button.textContent='查看 / 加书';button.onclick=()=>openBook(book);row.append(info,button);$('#search-results').append(row);}}
async function search(mode='search',append=false){
 if(searchBusy&&append)return;stopAllSearch(false);singleController?.abort();singleController=new AbortController();const sourceId=$('#source-select').value;if(!sourceId)return;
 if(!append){lastQuery=$('#book-query').value.trim();searchPage=1;searchMode=mode;}
 if(mode==='search'&&!lastQuery){$('#find-status').textContent='请输入书名或作者';return;}
 $('#show-matches').hidden=true;$('#search-errors').hidden=true;$('#search-progress').hidden=true;clearTimeout(renderTimer);renderTimer=null;const requestedPage=append?searchPage+1:1,version=++searchVersion;searchBusy=true;$('#search-books').disabled=true;$('#explore-books').disabled=true;$('#more-results').disabled=true;$('#find-status').textContent='正在按书源规则找书…';
 if(!append){$('#search-results').replaceChildren();$('#more-results').hidden=true;}
 try{
  const result=await api(mode,{sourceId,query:lastQuery,page:requestedPage,channel:Number($('#explore-channel').value)||0},singleController.signal);if(version!==searchVersion)return;searchPage=requestedPage;
  renderResults(result.books,append);$('#find-status').textContent=result.books.length?`第 ${searchPage} 页 · ${result.books.length} 本`:'暂无结果';$('#more-results').hidden=!result.hasMore;
  if(mode==='explore'&&result.channels.length){const previous=$('#explore-channel').value;$('#explore-channel').replaceChildren(...result.channels.map((channel,index)=>new Option(channel.title,index)));$('#explore-channel').value=previous||'0';$('#explore-channel').hidden=false;}
 }catch(error){if(version===searchVersion&&error.name!=='AbortError')$('#find-status').textContent=error.message;}finally{if(version===searchVersion){searchBusy=false;$('#search-books').disabled=false;$('#explore-books').disabled=false;$('#more-results').disabled=false;}}
}
$('#search-selected').onclick=()=>search('search');
$('#book-search').onsubmit=event=>{event.preventDefault();searchAll();};$('#explore-books').onclick=()=>{stopAllSearch(false);search('explore');};$('#more-results').onclick=()=>searchMode==='all'?searchAll(true):search(searchMode,true);$('#source-select').onchange=sourceChanged;$('#explore-channel').onchange=()=>search('explore');
$('#url-form').onsubmit=async event=>{
 event.preventDefault();const source=sources.find(s=>s.id===$('#source-select').value);if(!source)return;
 stopAllSearch(false);singleController?.abort();singleController=new AbortController();const version=++searchVersion,button=event.submitter;
 button.disabled=true;$('#find-status').textContent='解析中…';
 try{const result=await api('book',{sourceId:source.id,bookUrl:$('#book-url').value.trim()},singleController.signal);if(version!==searchVersion)return;$('#find-status').textContent='';openBook(result.book);}
 catch(error){if(version===searchVersion&&error.name!=='AbortError')$('#find-status').textContent=error.message;}finally{button.disabled=false;}
};
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>document.getElementById(button.dataset.close).close());
document.querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{category=button.dataset.category;page=0;render();});$('#source-query').oninput=()=>{query=$('#source-query').value;page=0;render();};$('#source-search').onsubmit=event=>event.preventDefault();
$('#clear-filter').onclick=()=>{category='all';query='';page=0;$('#source-query').value='';render();};
$('#previous').onclick=()=>{page--;render();};$('#next').onclick=()=>{page++;render();};smallScreen.addEventListener('change',()=>{page=0;render();});
let lights=true;try{lights=localStorage.getItem('newsstand:lights')!=='off';}catch{}
function setLights(){document.body.classList.toggle('lights-off',!lights);$('#light-switch').setAttribute('aria-pressed',String(lights));$('#light-switch').textContent=lights?'☀':'☾';}setLights();$('#light-switch').onclick=()=>{lights=!lights;setLights();try{localStorage.setItem('newsstand:lights',lights?'on':'off');}catch{}};
render();
async function loadSources(){
 try{
  const result=await api('sources');sources=result.sources.filter(source=>source.type===0);
  $('#source-summary').textContent=result.catalog?`${result.catalog.searchableCount} 个可搜索书源`: `${sources.length} 个书源`;
  $('#source-select').replaceChildren(...sources.map(source=>new Option(`${source.title}${source.searchable?'':' · 发现 / 网址'}`,source.id)));
  try{const id=localStorage.getItem('newsstand:source');if(sources.some(source=>source.id===id))$('#source-select').value=id;}catch{}
  // Loading the catalogue must not clear an already-running search.
  if(!searchBusy)sourceChanged();
 }catch(error){$('#source-summary').textContent=`书源加载失败：${error.message}`;$('#source-select').replaceChildren(new Option('书源加载失败',''));}
}
void loadSources();

function updateSearchStatus(prefix='正在匹配'){
 const stats=searchStats||{completed:0,total:0,failed:0};
 $('#find-status').textContent=`${prefix} · 已搜索 ${stats.completed} / ${stats.total} 个源 · 找到 ${matchGroups.size} 本书${stats.failed?` · ${stats.failed} 个源失败`:''}`;
 $('#search-progress').max=Math.max(1,stats.total);$('#search-progress').value=stats.completed;
}
function renderMatches(){
 clearTimeout(renderTimer);renderTimer=null;const ranked=rankBookMatches(matchGroups,lastQuery),visible=ranked.slice(0,visibleMatches),nodes=[];
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
 clearTimeout(renderTimer);renderTimer=null;$('#stop-search').hidden=true;$('#search-books').textContent='全源搜书';$('#search-books').disabled=false;$('#explore-books').disabled=false;$('#more-results').hidden=true;renderMatches();if(show)updateSearchStatus('已停止，结果已保留');
}
async function searchAll(append=false){
 const keyword=append?lastQuery:$('#book-query').value.trim();if(!keyword){$('#find-status').textContent='请输入书名或作者';return;}
 stopAllSearch(false);singleController?.abort();clearTimeout(renderTimer);renderTimer=null;const controller=new AbortController(),version=++searchVersion;allSearchController=controller;
 if(!append){lastQuery=keyword;searchPage=0;matchGroups=new Map();matchRows=new Map();nextSourceIds=[];visibleMatches=60;$('#search-results').replaceChildren();}
 const requestedPage=searchPage+1;searchMode='all';searchBusy=true;searchStats={completed:0,total:0,failed:0};
 $('#search-errors').hidden=true;$('#source-failures').replaceChildren();$('#show-matches').hidden=true;$('#more-results').hidden=true;$('#stop-search').hidden=false;$('#search-progress').hidden=false;$('#search-books').disabled=false;$('#search-books').textContent='重新搜索';$('#explore-books').disabled=true;$('#find-status').textContent='搜索中…';
 let finished=false;
 try{
  const response=await fetch('/api/newsstand/search-all',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:keyword,page:requestedPage,...(append?{sourceIds:nextSourceIds}:{})}),signal:controller.signal});
  await readSearchStream(response,event=>{
   if(version!==searchVersion)return;
   if(event.type==='start'){searchStats={completed:0,total:event.total,failed:0};updateSearchStatus();}
   if(event.type==='source'){
    searchStats=event;mergeBookMatches(matchGroups,event.books);
    if(event.error){$('#search-errors').hidden=false;const item=document.createElement('li');item.textContent=`${event.sourceName}：${event.error}`;$('#source-failures').append(item);$('#error-summary').textContent=`查看失败的书源（${event.failed}）`;}
    updateSearchStatus();if(event.books.length){if(!renderTimer)renderTimer=setTimeout(()=>{renderTimer=null;renderMatches();},100);}
   }
   if(event.type==='done'){finished=true;searchPage=requestedPage;nextSourceIds=event.nextSourceIds;searchStats=event;renderMatches();updateSearchStatus('本轮搜索完成');$('#more-results').hidden=!nextSourceIds.length;$('#more-results').textContent=`继续搜索下一页（${nextSourceIds.length} 个源）`;}
  });
 }catch(error){if(version===searchVersion&&error.name!=='AbortError'){$('#find-status').textContent=`${error.message}；已找到 ${matchGroups.size} 本书`;renderMatches();}}
 finally{if(version===searchVersion){allSearchController=null;searchBusy=false;$('#stop-search').hidden=true;$('#search-books').textContent='全源搜书';$('#explore-books').disabled=false;$('#more-results').disabled=false;if(!finished)$('#more-results').hidden=true;}}
}
$('#stop-search').onclick=()=>stopAllSearch();$('#show-matches').onclick=()=>{visibleMatches+=60;renderMatches();};finder.addEventListener('close',()=>{stopAllSearch();singleController?.abort();++searchVersion;searchBusy=false;$('#search-books').disabled=false;$('#explore-books').disabled=false;$('#more-results').disabled=false;});window.addEventListener('pagehide',()=>{saveReadingPosition();stopAllSearch(false);singleController?.abort();detailController?.abort();contentController?.abort();});

document.addEventListener('keydown',event=>{
 if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)||event.ctrlKey||event.metaKey||event.altKey)return;
 if(reader.open){if(event.key==='ArrowLeft'&&!$('#chapter-prev').disabled){event.preventDefault();$('#chapter-prev').click();}if(event.key==='ArrowRight'&&!$('#chapter-next').disabled){event.preventDefault();$('#chapter-next').click();}}
 else if(event.key==='/'&&!dialog.open){event.preventDefault();if(finder.open)$('#book-query').focus();else $('#source-query').focus();}
});

for(const modal of [finder,dialog,reader])modal.addEventListener('close',()=>{if(!$('#notice').hidden)(reader.open?reader:dialog.open?dialog:finder.open?finder:document.body).append($('#notice'));});
