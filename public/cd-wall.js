import { escapeHTML as e } from './ui.js';
import { playSound, isMuted, setMuted } from './cd-sound.js';
import { flattenCategories, validateNavigation, normalizeUrl } from './navigation-data.js';
const $=selector=>document.querySelector(selector);
const soundButton=document.createElement('button');soundButton.className='brass-button sound-switch';soundButton.type='button';
function drawSoundSwitch(){const muted=isMuted();soundButton.setAttribute('aria-label',muted?'开启音效':'关闭音效');soundButton.title=muted?'开启音效':'关闭音效';soundButton.setAttribute('aria-pressed',String(!muted));soundButton.innerHTML=`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/>${muted?'<path d="m16 9 6 6m0-6-6 6"/>':'<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'}</svg>`;}
drawSoundSwitch();$('.wood-crown').insertBefore(soundButton,$('.shelf-search'));
soundButton.onclick=()=>{setMuted(!isMuted());drawSoundSwitch();playSound('paper');};
const palette=[['#b9ae98','#292824'],['#313d49','#ede9dc'],['#803e35','#f0dfc7'],['#d9d4c2','#343735'],['#536553','#eee7cd'],['#bfa36c','#372f27'],['#655666','#efe0d2'],['#d5c5b1','#684533'],['#2f3437','#eee8d9'],['#859a9b','#21373a']];
let sites=[],groups=[],category='all',page=0,perRow=30,rowsPerPage=4,activeButton=null,transitioning=false;
let loading=false,loaded=false,revision=null,searchTimer,composing=false,filterCache=null,renderKey='';
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function color(id){let hash=0;for(const c of id)hash=(hash*31+c.charCodeAt(0))>>>0;return palette[hash%palette.length];}
function filtered(){
  const query=$('#cd-search').value.trim().toLowerCase();
  if(filterCache?.query===query&&filterCache.category===category)return filterCache.items;
  const items=sites.filter(s=>(category==='all'||s.categoryId===category||s.parentId===category)&&s.searchText.includes(query));
  filterCache={query,category,items};return items;
}
function renderTags(){
  const parent=groups.find(c=>c.id===category)?.parentId||category;
  const tag=(id,name,selected)=>`<button class="paper-tag" data-category="${e(id)}" aria-pressed="${selected}">${e(name)}</button>`;
  $('#category-tabs').innerHTML=tag('all','全部',category==='all')+groups.filter(c=>!c.parentId).map(c=>tag(c.id,c.name,c.id===parent)).join('');
  const children=groups.filter(c=>c.parentId===parent);
  $('#subcategory-tabs').hidden=!children.length;
  $('#subcategory-tabs').innerHTML=children.length?tag(parent,'全部',category===parent)+children.map(c=>tag(c.id,c.name,c.id===category)).join(''):'';
}
function render(){
  clearTimeout(searchTimer);
  const items=filtered(),size=perRow*rowsPerPage,pages=Math.max(1,Math.ceil(items.length/size));page=Math.min(page,pages-1);
  const key=JSON.stringify([revision,category,filterCache.query,page,perRow]);
  if(key===renderKey)return;renderKey=key;
  const visible=items.slice(page*size,(page+1)*size);
  $('#cabinet').style.setProperty('--per-row',perRow);
  $('#cabinet').innerHTML=visible.length?Array.from({length:Math.ceil(visible.length/perRow)},(_,row)=>{
    const batch=visible.slice(row*perRow,(row+1)*perRow),start=page*size+row*perRow+1;
    return `<section class="shelf" aria-label="第 ${page*rowsPerPage+row+1} 层 CD"><div class="shelf-back"></div><div class="cd-row">${batch.map(s=>{const [paper,ink]=color(s.id);return `<button class="cd-spine variant-${s.number%5}" style="--paper:${paper};--ink:${ink};--lean:${s.number%13===0?'-1.2':'0'}deg" data-id="${e(s.id)}" aria-label="取出 ${e(s.name)}" title="${e(s.name)} · ${e(s.categoryName)}"><span class="spine-cap">CD</span><span class="spine-title">${e(s.name)}</span><span class="spine-code">WS ${String(s.number).padStart(3,'0')}</span></button>`;}).join('')}</div><div class="shelf-edge"><span class="shelf-label">${String(start).padStart(3,'0')} — ${String(start+batch.length-1).padStart(3,'0')}</span><span class="shelf-screw"></span></div></section>`;
  }).join(''):'<div class="empty-state"><button class="paper-tag" id="reset-search">全部</button></div>';
  $('#collection-status').textContent=items.length?`${items.length} 张收藏 · 当前陈列 ${page*size+1}—${page*size+visible.length}`:'没有匹配的收藏';
  $('#page-number').textContent=`${String(page+1).padStart(2,'0')} / ${String(pages).padStart(2,'0')}`;
  $('#previous-page').disabled=page===0;$('#next-page').disabled=page===pages-1;
}
async function load(){
  if(loading)return;loading=true;
  $('#cabinet').setAttribute('aria-busy','true');
  try{
    const response=await fetch('/api/public',{cache:'no-cache',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('目录暂时无法连接');
    const data=await response.json();if(loaded&&data.revision===revision)return;
    const nextGroups=flattenCategories(validateNavigation(data.navigation).categories);
    sites=nextGroups.flatMap(c=>c.sites.filter(s=>!s.hidden&&normalizeUrl(s.url)).map(s=>({...s,categoryId:c.id,categoryName:c.name,parentId:c.parentId}))).map((s,i)=>({...s,number:i+1,searchText:`${s.name} ${s.url} ${s.description||''}`.toLowerCase()}));
    groups=nextGroups;revision=data.revision;loaded=true;filterCache=null;renderKey='';
    if(!groups.some(c=>c.id===category))category='all';renderTags();render();
  }catch{if(!loaded){renderKey='';$('#cabinet').innerHTML='<div class="empty-state"><button class="paper-tag" id="retry-load">连接失败 · 重试</button></div>';$('#collection-status').textContent='目录加载失败';}}
  finally{loading=false;$('#cabinet').setAttribute('aria-busy','false');}
}
async function openCase(button){
  if(transitioning||$('#case-dialog').open)return;
  const site=sites.find(s=>s.id===button.dataset.id);if(!site)return;
  transitioning=true;activeButton=button;playSound('pull');
  const bounds=button.getBoundingClientRect(),[paper,ink]=color(site.id),dialog=$('#case-dialog');
  $('#open-case').style.setProperty('--paper',paper);$('#open-case').style.setProperty('--ink',ink);
  for(const [id,value] of [['case-title',site.name],['disc-name',site.name],['cover-title',site.name],['booklet-number',String(site.number).padStart(3,'0')],['booklet-category',site.categoryName],['booklet-initial',site.name.slice(0,1)],['booklet-description',site.description||''],['booklet-domain',new URL(site.url).hostname]])$('#'+id).textContent=value;
  $('#disc-link').href=site.url;$('#disc-link').setAttribute('aria-label',`访问 ${site.name}（新窗口）`);
  dialog.classList.remove('unfolded');dialog.showModal();document.body.classList.add('case-is-open');button.classList.add('taken');
  const box=$('#open-case'),dest=box.getBoundingClientRect(),half=dest.width/2;
  try{
    if(!reduced())await box.animate([{transform:`translate(${bounds.x+bounds.width/2-(dest.x+dest.width*.75)}px,${bounds.y+bounds.height/2-(dest.y+dest.height/2)}px) scale(${bounds.width/half},${bounds.height/dest.height})`,opacity:.5},{transform:'translate(0,0) scale(1)',opacity:1}],{duration:650,easing:'cubic-bezier(.18,.75,.22,1)'}).finished;
    dialog.classList.add('unfolded');playSound('open');
  }finally{transitioning=false;}
}
async function closeCase(){
  if(transitioning||!$('#case-dialog').open)return;transitioning=true;
  const dialog=$('#case-dialog');dialog.classList.remove('unfolded');playSound('close');
  const box=$('#open-case'),dest=box.getBoundingClientRect(),source=activeButton?.isConnected?activeButton.getBoundingClientRect():null;
  const target=source?`translate(${source.x+source.width/2-(dest.x+dest.width*.75)}px,${source.y+source.height/2-(dest.y+dest.height/2)}px) scale(${source.width/(dest.width/2)},${source.height/dest.height})`:'translateY(36px) scale(.88)';
  try{if(!reduced())await box.animate([{opacity:1,transform:'translate(0,0) scale(1)'},{opacity:0,transform:target}],{duration:500,delay:500,easing:'cubic-bezier(.6,0,.8,.4)'}).finished;}
  finally{dialog.close();playSound('place');document.body.classList.remove('case-is-open');activeButton?.classList.remove('taken');activeButton?.focus({preventScroll:true});transitioning=false;}
}
$('#cabinet').addEventListener('click',event=>{const button=event.target.closest('[data-id]');if(button)openCase(button);if(event.target.closest('#retry-load'))load();if(event.target.closest('#reset-search')){$('#cd-search').value='';category='all';page=0;renderTags();render();}});
function scheduleSearch(){clearTimeout(searchTimer);if(composing)return;searchTimer=setTimeout(()=>{page=0;render();},120);}
$('#cd-search').addEventListener('compositionstart',()=>{composing=true;clearTimeout(searchTimer);});
$('#cd-search').addEventListener('compositionend',()=>{composing=false;scheduleSearch();});
$('#cd-search').addEventListener('input',scheduleSearch);
for(const id of ['category-tabs','subcategory-tabs'])$('#'+id).addEventListener('click',event=>{if(event.target.closest('[data-category]'))playSound('paper');});
for(const id of ['previous-page','next-page'])$('#'+id).addEventListener('click',()=>playSound('place'));
$('#disc-link').addEventListener('click',()=>playSound('disc'));
for(const id of ['category-tabs','subcategory-tabs'])$('#'+id).addEventListener('click',event=>{const tag=event.target.closest('[data-category]');if(!tag)return;category=tag.dataset.category;page=0;renderTags();render();document.querySelector(`[data-category="${CSS.escape(category)}"][aria-pressed="true"]`)?.focus({preventScroll:true});});
for(const [id,delta] of [['previous-page',-1],['next-page',1]])$('#'+id).onclick=()=>{page+=delta;render();$('.collection').scrollIntoView({block:'start',behavior:reduced()?'instant':'smooth'});};
$('#return-case').onclick=closeCase;$('#case-dialog').addEventListener('cancel',event=>{event.preventDefault();closeCase();});
$('#case-dialog').addEventListener('click',event=>{if(event.target===$('#case-dialog'))closeCase();});
new ResizeObserver(entries=>{const width=entries[0].contentRect.width,next=Math.max(7,Math.min(34,Math.floor((width-32)/31)));if(next!==perRow){perRow=next;page=0;if(sites.length)render();}}).observe($('#cabinet'));
window.addEventListener('focus',()=>{if(!document.hidden&&!$('#case-dialog').open)load();});
load();
