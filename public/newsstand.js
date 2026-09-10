import {categoryNames,filterSources,searchUrl,safeWebUrl,readSaved} from './newsstand-data.js';
const $=selector=>document.querySelector(selector);
const racks=$('#racks'),dialog=$('#publication');
let sources=[],selected=null,category='all',page=0,query='',noticeTimer;
let saved=[];try{saved=readSaved(localStorage);}catch{}
const smallScreen=matchMedia('(max-width:700px)');
const pageSize=()=>smallScreen.matches?9:18;
const date=new Date();$('#today').dateTime=date.toISOString().slice(0,10);$('#today').textContent=new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',weekday:'short'}).format(date);
function showNotice(text){$('#notice').textContent=text;$('#notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{$('#notice').hidden=true;},2600);}
function span(className,text){const el=document.createElement('span');el.className=className;el.textContent=text;return el;}
function cover(source,{button=true}={}){
 const node=document.createElement(button?'button':'div');node.className=`publication-cover theme-${source.theme} layout-${source.layout}`;
 node.style.setProperty('--tilt',`${[-2,1.3,-.6,1.8,-1.5,.5][sources.indexOf(source)%6]}deg`);
 const art=document.createElement('span');art.className='cover-art';art.setAttribute('aria-hidden','true');
 const col=source.art%7,row=Math.floor(source.art/7);
 art.style.backgroundPosition=`${(21.3+col*8.14)/.926}% ${(25.4+row*15.8)/.86}%`;
 node.append(art,span('cover-kicker',categoryNames[source.category]),span('cover-title',source.title),span('cover-subtitle',new URL(source.url).hostname.replace(/^www\./,'')));
 if(saved.includes(source.id))node.append(span('cover-saved','♥'));
 if(button){node.type='button';node.setAttribute('aria-label',`${source.title}，${categoryNames[source.category]}`);node.onclick=()=>openPublication(source);}
 return node;
}
function render(){
 const filtered=filterSources(sources,{category,query,saved});
 const pages=Math.max(1,Math.ceil(filtered.length/pageSize()));page=Math.max(0,Math.min(page,pages-1));
 racks.replaceChildren();
 const visible=filtered.slice(page*pageSize(),(page+1)*pageSize()),columns=smallScreen.matches?3:6;
 for(let row=0;row<3;row++){const shelf=document.createElement('div');shelf.className='shelf';visible.slice(row*columns,(row+1)*columns).forEach(source=>shelf.append(cover(source)));racks.append(shelf);}
 $('#empty').hidden=filtered.length!==0;
 $('#page-number').textContent=`${String(page+1).padStart(2,'0')} / ${String(pages).padStart(2,'0')}`;
 $('#previous').disabled=page===0;$('#next').disabled=page>=pages-1;
 document.querySelectorAll('[data-category]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.category===category)));
}
function refreshSavedButton(){const on=saved.includes(selected.id);$('#save-source').setAttribute('aria-pressed',String(on));$('#save-source').textContent=on?'♥ 已收藏':'♡ 收藏';}
function openPublication(source){
 selected=source;$('#detail-cover').replaceChildren(cover(source,{button:false}));
 $('#publication-title').textContent=source.title;$('#detail-category').textContent=categoryNames[source.category];
 $('#source-name').textContent=source.name===source.title?'':source.name;
 $('#source-domain').textContent=new URL(source.url).hostname;$('#source-domain').href=source.url;$('#read-source').href=source.url;
 $('#book-query').value='';$('#book-search').hidden=!searchUrl(source,'示例');
 $('#import-source').href=`legado://import/bookSource?src=${encodeURIComponent('https://legado.aoaostar.com/sources/b778fe6b.json')}`;
 $('#source-bundle').href='https://github.com/aoaostar/legado';refreshSavedButton();
 if(!dialog.open)dialog.showModal();
}
$('#close-publication').onclick=()=>dialog.close();
dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
$('#save-source').onclick=()=>{const isSaved=saved.includes(selected.id);saved=isSaved?saved.filter(id=>id!==selected.id):[...saved,selected.id];try{localStorage.setItem('newsstand:saved',JSON.stringify(saved));}catch{showNotice('收藏未保存');}refreshSavedButton();render();$('#detail-cover').replaceChildren(cover(selected,{button:false}));};
$('#book-search').onsubmit=event=>{event.preventDefault();const url=searchUrl(selected,$('#book-query').value);if(url)window.open(url,'_blank','noopener,noreferrer');};
$('#download-source').onclick=async()=>{const button=$('#download-source'),source=selected;button.disabled=true;try{const response=await fetch(`/newsstand-sources/${source.id}.json`);if(!response.ok)throw new Error();const payload=await response.json();if(!Array.isArray(payload)||payload[0]?.bookSourceName!==source.name)throw new Error();const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${source.title}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch{showNotice('书源下载失败');}finally{button.disabled=false;}};
document.querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{category=button.dataset.category;page=0;render();});
$('#source-query').oninput=()=>{query=$('#source-query').value;page=0;render();};$('#source-search').onsubmit=event=>{event.preventDefault();query=$('#source-query').value;page=0;render();};
$('#previous').onclick=()=>{page--;render();};$('#next').onclick=()=>{page++;render();};smallScreen.addEventListener('change',()=>{page=0;render();});
let lights=true;try{lights=localStorage.getItem('newsstand:lights')!=='off';}catch{}
function setLights(){document.body.classList.toggle('lights-off',!lights);$('#light-switch').setAttribute('aria-pressed',String(lights));$('#light-switch').textContent=lights?'☀':'☾';}setLights();
$('#light-switch').onclick=()=>{lights=!lights;setLights();try{localStorage.setItem('newsstand:lights',lights?'on':'off');}catch{}};
document.addEventListener('keydown',event=>{if(event.key==='/'&&!dialog.open&&!/INPUT|TEXTAREA/.test(document.activeElement.tagName)){event.preventDefault();$('#source-query').focus();}});
try{const response=await fetch('/newsstand-catalog.json');if(!response.ok)throw new Error();const catalog=await response.json();if(!Array.isArray(catalog.sources))throw new Error();sources=catalog.sources.filter(s=>/^[a-z0-9-]+$/.test(s.id)&&safeWebUrl(s.url)&&categoryNames[s.category]);render();}catch{$('#empty').textContent='书刊暂未上架';$('#empty').hidden=false;$('#previous').disabled=true;$('#next').disabled=true;}
