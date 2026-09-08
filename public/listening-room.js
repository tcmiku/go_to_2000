import { escapeHTML as e, readStorage, saveStorage } from './ui.js';
import { LXClient } from './lx-client.js';
import { loadProbeTracks, selectMusicSource } from './music-source-selection.js';
import { createLyricsProjection } from './lyrics.js';
const $=selector=>document.querySelector(selector);
const audio=$('#audio'),lx=new LXClient();
const lyrics=createLyricsProjection({audio,root:$('#holo-lyrics'),caption:$('#lyric-caption')});
const STORAGE='slow-records.collection.v1',PREFS='slow-records.preferences.v1';
const palette=[['#777b63','#f2e3bf','#b6a16f'],['#b4a58a','#303f3a','#617b6d'],['#a55b48','#f4debb','#d0a477'],['#303f48','#ebdfb9','#9d9e78'],['#ccbc9c','#3c4b3b','#908d58'],['#647a79','#f4e6ce','#bd8761']];
const prefs=readStorage(PREFS,{})||{};
let records=[],localTracks=[],current=null,deckTrack=null,busy=false,operation=0,flight=null,connectedId=null,connecting=null,sourceOperation=0,loadingLocal=true;
const flightAnimations=new Set();
let sourceController=null;
let backgroundMarkupKey=null,collectionMarkupKey=null;
const timeDisplay={};
let results=[],searchPage=1,searchTotal=0,lastQuery='',searchController=null,activeDrawer=null,drawerTrigger=null,feedbackTimer;
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const storageRecord=readStorage(STORAGE,null);
function validTrack(track){return track&&typeof track.id==='string'&&track.id.length<300&&typeof track.name==='string'&&track.name.length<500&&['local','wy'].includes(track.source)&&(track.source!=='local'||typeof track.src==='string'&&track.src.startsWith('/data/mp3/'));}
if(Array.isArray(storageRecord))records=storageRecord.filter(validTrack).slice(0,500);
function announce(message){$('#playback-state').textContent=message;}
function feedback(message){announce(message);$('.machine-display').classList.add('is-error');$('.machine-display').setAttribute('aria-description',message);$('#machine-status').textContent='!';clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>{$('.machine-display').classList.remove('is-error');updatePlayback();},6000);}
const remember=()=>{if(!saveStorage(STORAGE,records))feedback('收藏未能保存');};
function savePrefs(){saveStorage(PREFS,{volume:audio.volume,muted:audio.muted,source:$('#source-select').value,quality:$('#quality-select').value,lidOpen:!$('#turntable').classList.contains('lid-closed')});}
function colors(track){let hash=0;for(const char of track.id)hash=(hash*31+char.charCodeAt(0))>>>0;return {colors:palette[hash%palette.length],pattern:hash%4};}
function artwork(track){
  const {colors:[bg,ink,shape],pattern}=colors(track);let image='';
  try{const url=new URL(track.img);if(['https:','http:'].includes(url.protocol))image=`<img src="${e(url.href)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;}catch{}
  return `<span class="cover cover-pattern-${pattern}${image?' has-image':''}" style="--cover-bg:${bg};--cover-ink:${ink};--cover-shape:${shape}"><span class="cover-geometry" aria-hidden="true"></span><strong class="cover-name">${e(track.name)}</strong><span class="cover-artist">${e(track.singer||'')}</span>${image}<span class="cover-paper" aria-hidden="true"></span><span class="cover-seam" aria-hidden="true"></span></span>`;
}
document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement)event.target.closest('.cover')?.classList.add('fallback');},true);
function renderCollection(){
  const background=records.slice(0,10),backgroundKey=JSON.stringify(background);
  if(backgroundKey!==backgroundMarkupKey){
    $('#background-records').innerHTML=background.map(track=>`<span class="background-record" data-sleeve="${e(track.id)}">${artwork(track)}</span>`).join('');
    backgroundMarkupKey=backgroundKey;
  }
  // Build the full collection only when it is opened, and keep its DOM (including
  // decoded artwork and keyboard focus) across visits and same-column resizes.
  if(location.hash==='#wall'){
    const perRow=innerWidth<=500?2:innerWidth<=800?3:5,key=perRow+JSON.stringify(records);
    if(key!==collectionMarkupKey){
      const tiles=records.map(track=>`<button class="record-card" data-record="${e(track.id)}" aria-label="播放 ${e(track.name)}，${e(track.singer||'')}">${artwork(track)}</button>`);
      tiles.push('<button class="empty-slot" data-discover aria-label="添加音乐"><span aria-hidden="true">＋</span></button>');
      $('#record-collection').innerHTML=Array.from({length:Math.ceil(tiles.length/perRow)},(_,i)=>`<div class="collection-row">${tiles.slice(i*perRow,(i+1)*perRow).join('')}</div>`).join('');
      collectionMarkupKey=key;
    }
  }
  $('#record-collection').setAttribute('aria-busy',String(loadingLocal));
  syncSleeves();
}
function syncSleeves(){
  for(const sleeve of document.querySelectorAll('[data-sleeve], [data-record]')){
    const onDeck=(sleeve.dataset.sleeve||sleeve.dataset.record)===deckTrack?.id;
    sleeve.classList.toggle('record-is-playing',onDeck);
    if(sleeve.dataset.record)sleeve.setAttribute('aria-pressed',String(onDeck));
  }
}
function route(){
  const wall=location.hash==='#wall';$('#wall-view').hidden=!wall;document.body.classList.toggle('view-wall',wall);
  $('#background-wall').setAttribute('tabindex',wall?'-1':'0');$('#background-wall').setAttribute('aria-hidden',String(wall));
  $('#wall-toggle').setAttribute('aria-label',wall?'返回唱片机':'打开唱片墙');$('#wall-toggle').setAttribute('aria-pressed',String(wall));
  document.title=wall?'唱片墙 · 慢放':'慢放';if(wall){closeDrawer(false);renderCollection();}
}
window.addEventListener('hashchange',route);
function fitPlayer(){
  const scale=Math.min(1.32,(innerWidth-(innerWidth<500?16:50))/950,innerHeight*.93/800);
  document.documentElement.style.setProperty('--player-scale',String(Math.max(.25,scale)));
}
fitPlayer();let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{fitPlayer();renderCollection();},100);});
function closeDrawer(restore=true){
  if(!activeDrawer)return;activeDrawer.hidden=true;activeDrawer=null;document.body.classList.remove('drawer-is-open');
  $('#source-open').setAttribute('aria-expanded','false');$('#discover-button').setAttribute('aria-pressed','false');if(restore)drawerTrigger?.focus({preventScroll:true});
}
function openDrawer(id,trigger){
  if(activeDrawer?.id===id){closeDrawer();return;}
  closeDrawer(false);drawerTrigger=trigger||document.activeElement;
  if(location.hash==='#wall'){location.hash='room';route();}
  activeDrawer=$('#'+id);activeDrawer.hidden=false;document.body.classList.add('drawer-is-open');
  $('#source-open').setAttribute('aria-expanded',String(id==='source-dialog'));$('#discover-button').setAttribute('aria-pressed',String(id==='discover-dialog'));
  (activeDrawer.querySelector('input, select')||activeDrawer).focus({preventScroll:true});
}
for(const panel of document.querySelectorAll('.machine-drawer'))panel.querySelector('[data-close]').onclick=()=>closeDrawer();
function openDiscover(){if(!lastQuery){results=[...localTracks,...records.filter(track=>track.source!=='local')];renderResults();$('#search-status').textContent='';}openDrawer('discover-dialog',$('#discover-button'));}
$('#discover-button').onclick=openDiscover;
$('#record-collection').onclick=event=>{
  const button=event.target.closest('[data-record]');if(button){const track=records.find(item=>item.id===button.dataset.record);if(track)playRecord(track,button.getBoundingClientRect());}
  if(event.target.closest('[data-discover]'))openDiscover();
};
$('#wall-toggle').onclick=()=>{closeDrawer(false);location.hash=location.hash==='#wall'?'room':'wall';};
$('#now-cover').onclick=()=>{if(!busy)location.hash='wall';};
function setLid(open){$('#turntable').classList.toggle('lid-closed',!open);$('#lid-toggle').setAttribute('aria-pressed',String(open));$('#lid-toggle').setAttribute('aria-label',open?'合上机盖':'打开机盖');savePrefs();}
$('#lid-toggle').onclick=()=>setLid($('#turntable').classList.contains('lid-closed'));
function setStatus(text,symbol){announce(text);if(symbol)$('#machine-status').textContent=symbol;}
function setBusy(value){busy=value;document.body.classList.toggle('busy',value);$('#turntable-stage').setAttribute('aria-busy',String(value));$('#lid-toggle').disabled=value;}
function updatePlayback(){
  const playing=!audio.paused&&!audio.ended;
  $('#turntable').classList.toggle('playing',playing);$('#turntable').classList.toggle('paused',!playing&&!!current&&audio.currentTime>0);
  $('#play-toggle').setAttribute('aria-label',playing?'暂停':'播放');$('#play-toggle').setAttribute('aria-pressed',String(playing));
  $('#play-icon').innerHTML=playing?'<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>':'<path d="m9 5 11 7-11 7Z"/>';
  if(!busy&&!$('.machine-display').classList.contains('is-error'))setStatus(playing?'正在播放':current?'已暂停':'准备就绪',playing?'▶':'Ⅱ');
}
function time(value){if(!Number.isFinite(value)||value<0)return '0:00';return `${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;}
function updateTime(){
  if(document.hidden)return;
  const duration=Number.isFinite(audio.duration)?audio.duration:0,progress=duration?Math.min(1,Math.max(0,audio.currentTime/duration)):0;
  const display=time(audio.currentTime).padStart(5,'0'),value=Math.round(progress*1000),label=`${time(audio.currentTime)} / ${time(duration)}`,angle=(50+progress*7).toFixed(2),seek=$('#seek');
  if(timeDisplay.display!==display){$('#lcd-time').textContent=display;timeDisplay.display=display;}
  if(timeDisplay.disabled!==!duration){seek.disabled=!duration;timeDisplay.disabled=!duration;}
  if(timeDisplay.value!==value){seek.value=value;seek.style.setProperty('--fill',`${value/10}%`);timeDisplay.value=value;}
  if(timeDisplay.label!==label){seek.setAttribute('aria-valuetext',label);timeDisplay.label=label;}
  if(timeDisplay.angle!==angle){$('#tonearm').style.setProperty('--arm-angle',`${angle}deg`);timeDisplay.angle=angle;}
}
function updateVisibility(){document.body.classList.toggle('is-backgrounded',!!document.hidden);if(!document.hidden){updateTime();lyrics.sync();}}
document.addEventListener('visibilitychange',updateVisibility);
function labelDisc(track){$('#record-label').style.backgroundColor=colors(track).colors[0];$('#disc-title').textContent=track.name.slice(0,14);}
function displayTrack(track){current=track;$('#now-title').textContent=track.name;if(!deckTrack)labelDisc(track);}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,reduced()?0:ms));
function sleeveFor(track){return [...document.querySelectorAll('[data-sleeve]')].find(node=>node.dataset.sleeve===track.id);}
async function moveRecordPart(node,frames,duration,token){
  if(token!==operation)return;
  const animation=node.animate(frames,{duration,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});
  flightAnimations.add(animation);
  try{await animation.finished;}catch(error){if(token===operation)throw error;}
  finally{flightAnimations.delete(animation);}
}
async function flyRecord(track,rect,token,returning=false){
  if(reduced())return;
  const shelf=sleeveFor(track),start=rect||shelf?.getBoundingClientRect()||$('#background-wall').getBoundingClientRect();
  const size=Math.min(180,innerWidth*.32),sx=start.x+start.width/2-size/2,sy=start.y+start.height/2-size/2;
  const x=innerWidth/2-size*.83,y=Math.min(innerHeight*.23,220);
  const pose=(px,py,scaleX=1,scaleY=scaleX,angle=0)=>`translate(${px}px,${py}px) rotate(${angle}deg) scale(${scaleX},${scaleY})`;
  const rack=pose(sx,sy,Math.min(start.width/size,1.6)),held=pose(x,y,1,1,-5),extracted=pose(x+size*.72,y-size*.06,1,1,5);
  const el=document.createElement('div');el.className='record-transfer';el.style.setProperty('--label',colors(track).colors[0]);el.style.setProperty('--transfer-size',`${size}px`);
  el.innerHTML=`<div class="transfer-disc flying-vinyl"><span class="transfer-label">${e(track.name.slice(0,14))}</span></div><div class="transfer-sleeve">${artwork(track)}</div>`;
  const disc=el.querySelector('.transfer-disc'),sleeve=el.querySelector('.transfer-sleeve');
  sleeve.style.transform=returning?held:rack;disc.style.transform=returning?'scale(0)':rack;
  document.body.append(el);flight=el;shelf?.classList.add('sleeve-in-hand');
  const platterPose=(lift=0)=>{
    const target=$('#platter-target').getBoundingClientRect(),mat=$('#now-cover').getBoundingClientRect();
    return pose(target.x+target.width/2-size/2,target.y+target.height/2-size/2-lift,mat.width/size*.977,mat.height/size*.977);
  };
  try{
    if(returning){
      disc.style.transform=platterPose();
      await Promise.all([moveRecordPart(disc,[{transform:platterPose()},{transform:platterPose(32),offset:.24},{transform:extracted}],680,token),moveRecordPart(sleeve,[{transform:rack},{transform:held}],530,token)]);
      if(token!==operation)return;
      await moveRecordPart(disc,[{transform:extracted},{transform:held}],430,token);
      if(token!==operation)return;
      await Promise.all([moveRecordPart(sleeve,[{transform:held},{transform:rack}],480,token),moveRecordPart(disc,[{transform:held},{transform:rack}],480,token)]);
    }else{
      await Promise.all([moveRecordPart(sleeve,[{transform:rack},{transform:held}],480,token),moveRecordPart(disc,[{transform:rack},{transform:held}],480,token)]);
      if(token!==operation)return;
      await moveRecordPart(disc,[{transform:held},{transform:extracted}],480,token);
      if(token!==operation)return;
      await Promise.all([moveRecordPart(sleeve,[{transform:held},{transform:rack}],650,token),moveRecordPart(disc,[{transform:extracted},{transform:platterPose(28)}],720,token)]);
      if(token!==operation)return;
      shelf?.classList.remove('sleeve-in-hand');
      await moveRecordPart(disc,[{transform:platterPose(28)},{transform:platterPose()}],300,token);
    }
  }finally{el.remove();if(flight===el){flight=null;shelf?.classList.remove('sleeve-in-hand');}}
}
function cancelPlayback(){
  operation++;lyrics.reset();audio.pause();
  for(const animation of flightAnimations)animation.cancel();flightAnimations.clear();
  if(flight){flight.remove();flight=null;}
  for(const sleeve of document.querySelectorAll('.sleeve-in-hand'))sleeve.classList.remove('sleeve-in-hand');
  $('#turntable').classList.remove('motor-starting','arm-raised','arm-over-record','arm-lifting');setBusy(false);
}
async function lowerTonearm(token){
  const player=$('#turntable');player.classList.add('motor-starting','arm-raised','arm-lifting');
  await delay(260);if(token!==operation)return;
  player.classList.remove('arm-lifting');player.classList.add('arm-over-record');await delay(800);if(token!==operation)return;
  player.classList.remove('arm-raised');await delay(400);
}
async function ensureSource(){if(connecting)return connecting;const id=$('#source-select').value;if(connectedId===id&&lx.sources)return;return connectSource({automatic:true});}
async function connectSource({automatic=false}={}){
  const token=++sourceOperation,preferred=$('#source-select').value;
  sourceController?.abort();lx.dispose();sourceController=new AbortController();const {signal}=sourceController;
  const ids=automatic?[...$('#source-select').options].map(option=>option.value):[preferred];
  $('#source-status').textContent='…';$('#source-connect').disabled=true;$('#source-open').setAttribute('aria-busy','true');connectedId=null;
  $('.status-dot').classList.remove('connected','failed');$('.status-dot').classList.add('testing');
  const promise=(async()=>{
    const tracks=await loadProbeTracks(records,AbortSignal.any([signal,AbortSignal.timeout(10000)]));signal.throwIfAborted();
    const id=await selectMusicSource({client:lx,ids,preferred,tracks,quality:$('#quality-select').value,signal,onAttempt:(_id,index,total)=>{
      if(token===sourceOperation)$('#source-status').textContent=`… ${index}/${total}`;
    }});
    signal.throwIfAborted();if(token!==sourceOperation)return;
    connectedId=id;$('#source-select').value=id;$('.status-dot').classList.add('connected');$('#source-status').textContent='✓';$('#source-status').setAttribute('aria-label','音源可用');announce('已选中可用音源');savePrefs();
  })().catch(error=>{if(token===sourceOperation){connectedId=null;lx.dispose();$('#source-status').textContent='×';$('.status-dot').classList.remove('connected');$('.status-dot').classList.add('failed');announce(error.message);$('#source-status').setAttribute('aria-label',error.message);}
    throw error;
  }).finally(()=>{if(token===sourceOperation){connecting=null;$('#source-connect').disabled=false;$('#source-open').setAttribute('aria-busy','false');$('.status-dot').classList.remove('testing');}});
  $('#source-status').setAttribute('aria-label','检测音源');
  connecting=promise;return promise;
}
async function playRecord(track,rect){
  const previous=deckTrack,needleDown=$('#turntable').classList.contains('playing')||$('#turntable').classList.contains('paused'),lidClosed=$('#turntable').classList.contains('lid-closed')||location.hash==='#wall';
  cancelPlayback();const token=operation;setBusy(true);$('.machine-display').classList.remove('is-error');setStatus('正在取出唱片','…');audio.removeAttribute('src');audio.load();updateTime();closeDrawer(false);
  if(location.hash==='#wall'){location.hash='room';route();}
  $('#play-toggle').focus({preventScroll:true});setLid(true);$('#turntable').classList.remove('playing','paused');displayTrack(track);
  try{
    const sourcePromise=(async()=>{if(track.source==='local')return track.src;await ensureSource();if(token!==operation)throw new Error('播放已取消');return lx.resolve(track,$('#quality-select').value);})();
    const settledSource=sourcePromise.then(url=>({url}),error=>({error}));
    if(previous){
      $('#turntable').classList.add('arm-raised','arm-lifting');if(needleDown)$('#turntable').classList.add('arm-over-record');
      await delay(260);if(token!==operation)return;$('#turntable').classList.remove('arm-over-record','arm-lifting');
      await delay(lidClosed?1040:800);if(token!==operation)return;
      $('#turntable').classList.add('no-record');deckTrack=null;syncSleeves();
      await flyRecord(previous,null,token,true);if(token!==operation)return;
    }
    await flyRecord(track,rect,token);if(token!==operation)return;deckTrack=track;labelDisc(track);syncSleeves();$('#turntable').classList.remove('no-record');setStatus('正在读取唱片','…');
    const {url,error}=await settledSource;if(token!==operation)return;if(error)throw error;
    audio.src=url;audio.load();lyrics.setTrack(track);await lowerTonearm(token);if(token!==operation)return;await audio.play();if(token!==operation)return;$('#turntable').classList.remove('motor-starting','arm-over-record');setBusy(false);updatePlayback();
  }catch(error){if(token!==operation)return;setBusy(false);$('#turntable').classList.remove('playing','paused','motor-starting','arm-raised','arm-over-record','arm-lifting');feedback(error.name==='NotAllowedError'?'等待播放':`播放失败：${error.message||'音源不可用'}`);}
}
$('#play-toggle').onclick=async()=>{
  if(busy){cancelPlayback();setStatus('已取消','■');return;}
  if(!current){if(records.length)playRecord(records[0]);else location.hash='wall';return;}
  if(!audio.paused){audio.pause();return;}
  if(!audio.getAttribute('src')||audio.error||deckTrack?.id!==current.id){playRecord(current);return;}
  const token=operation;
  try{
    $('.machine-display').classList.remove('is-error');
    if(!$('#turntable').classList.contains('paused')){setBusy(true);await lowerTonearm(token);if(token!==operation)return;}
    lyrics.setTrack(current);await audio.play();if(token!==operation)return;$('#turntable').classList.remove('motor-starting','arm-over-record');setBusy(false);
  }catch{if(token!==operation)return;cancelPlayback();feedback('播放失败');}
};
function adjacent(delta){if(!records.length){location.hash='wall';return;}const index=records.findIndex(track=>track.id===current?.id);playRecord(records[(index+(index<0?1:delta)+records.length)%records.length]);}
$('#previous-track').onclick=()=>adjacent(-1);$('#next-track').onclick=()=>adjacent(1);
$('#stop-button').onclick=()=>{cancelPlayback();if(audio.readyState)audio.currentTime=0;$('#turntable').classList.remove('playing','paused');setStatus('已停止','■');updateTime();};
$('#seek').oninput=()=>{if(Number.isFinite(audio.duration))audio.currentTime=Number($('#seek').value)/1000*audio.duration;updateTime();lyrics.sync();};
function updateVolume(){
  const percent=Math.round(audio.volume*100);$('#volume').style.setProperty('--angle',`${audio.volume*280-140}deg`);$('#volume').setAttribute('aria-valuenow',String(percent));$('#volume').setAttribute('aria-valuetext',audio.muted?'静音':`${percent}%`);$('#mute-toggle').setAttribute('aria-label',audio.muted?'取消静音':'静音');$('#mute-toggle').setAttribute('aria-pressed',String(audio.muted));
}
function changeVolume(value){audio.volume=Math.max(0,Math.min(1,value));audio.muted=audio.volume===0;updateVolume();savePrefs();}
let knobDrag=null;
$('#volume').addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();$('#volume').focus({preventScroll:true});knobDrag={id:event.pointerId,x:event.clientX,y:event.clientY,value:audio.volume};$('#volume').setPointerCapture(event.pointerId);document.body.classList.add('grabbing');});
$('#volume').addEventListener('pointermove',event=>{if(!knobDrag||knobDrag.id!==event.pointerId)return;const delta=(knobDrag.y-event.clientY+event.clientX-knobDrag.x)/160;changeVolume(knobDrag.value+delta);});
const releaseKnob=()=>{knobDrag=null;document.body.classList.remove('grabbing');};
for(const name of ['pointerup','pointercancel','lostpointercapture'])$('#volume').addEventListener(name,releaseKnob);
$('#volume').addEventListener('keydown',event=>{let value;if(['ArrowUp','ArrowRight'].includes(event.key))value=audio.volume+.05;else if(['ArrowDown','ArrowLeft'].includes(event.key))value=audio.volume-.05;else if(event.key==='Home')value=0;else if(event.key==='End')value=1;else return;event.preventDefault();changeVolume(value);});
$('#volume').addEventListener('wheel',event=>{event.preventDefault();changeVolume(audio.volume+(event.deltaY<0?.03:-.03));},{passive:false});
$('#mute-toggle').onclick=()=>{audio.muted=!audio.muted;updateVolume();savePrefs();};
for(const name of ['play','pause','playing'])audio.addEventListener(name,updatePlayback);
for(const name of ['timeupdate','loadedmetadata','durationchange','emptied'])audio.addEventListener(name,updateTime);
audio.addEventListener('waiting',()=>{if(!busy&&!audio.paused)setStatus('正在缓冲','…');});
audio.addEventListener('error',()=>{if(!audio.getAttribute('src'))return;cancelPlayback();$('#turntable').classList.remove('playing','paused');feedback('播放失败');});
audio.addEventListener('ended',()=>{if(records.length>1)adjacent(1);else{updatePlayback();setStatus('播放结束','■');}});
$('#source-open').onclick=()=>openDrawer('source-dialog',$('#source-open'));
$('#source-connect').onclick=()=>connectSource({automatic:true}).catch(()=>{});
$('#source-select').onchange=()=>connectSource().catch(()=>{});
$('#quality-select').onchange=savePrefs;
function renderResults(){
  $('#search-results').innerHTML=results.map(track=>{const saved=records.some(record=>record.id===track.id);return `<article class="search-result"><div class="result-cover">${artwork(track)}</div><div class="result-info"><strong>${e(track.name)}</strong><p>${e(track.singer||'')}${track.albumName?` · ${e(track.albumName)}`:''}</p></div><button class="add-record${saved?' saved':''}" data-add="${e(track.id)}" aria-label="${saved?'移除':'收藏'} ${e(track.name)}" aria-pressed="${saved}">${saved?'−':'＋'}</button></article>`;}).join('');
}
$('#search-results').onclick=event=>{
  const button=event.target.closest('[data-add]');if(!button)return;const track=results.find(track=>track.id===button.dataset.add);if(!track)return;
  const index=records.findIndex(record=>record.id===track.id);
  if(index>=0){records.splice(index,1);announce(`已移除 ${track.name}`);}else{if(records.length>=500){$('#search-status').textContent='唱片架已满';return;}records.push(track);announce(`已收藏 ${track.name}`);}
  remember();renderCollection();renderResults();document.querySelector(`[data-add="${CSS.escape(track.id)}"]`)?.focus({preventScroll:true});
};
async function search(query,page=1){
  searchController?.abort();const controller=new AbortController();searchController=controller;const timer=setTimeout(()=>controller.abort('timeout'),25000);
  $('#search-status').textContent='…';$('#search-results').setAttribute('aria-busy','true');$('#load-more').hidden=true;if(page===1){results=[];renderResults();}
  try{
    const response=await fetch(`/api/listening/search?q=${encodeURIComponent(query)}&page=${page}`,{signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.error||'搜索失败');if(searchController!==controller)return;
    searchPage=page;lastQuery=query;searchTotal=data.total;const ids=new Set(results.map(track=>track.id));results.push(...data.tracks.filter(track=>!ids.has(track.id)));renderResults();
    $('#search-status').textContent=results.length?'':'无结果';$('#load-more').hidden=results.length>=searchTotal||data.tracks.length===0;
  }catch(error){if(searchController!==controller)return;$('#search-status').textContent=controller.signal.reason==='timeout'?'连接超时':'搜索失败';announce(error.message);if(page>1)$('#load-more').hidden=false;}
  finally{clearTimeout(timer);if(searchController===controller)$('#search-results').setAttribute('aria-busy','false');}
}
$('#search-form').onsubmit=event=>{event.preventDefault();const query=$('#music-query').value.trim();if(query)search(query);};$('#load-more').onclick=()=>search(lastQuery,searchPage+1);
window.addEventListener('storage',event=>{if(event.key===STORAGE){const value=readStorage(STORAGE,[]);if(Array.isArray(value)){records=value.filter(validTrack).slice(0,500);renderCollection();renderResults();}}});
window.addEventListener('keydown',event=>{
  if(event.key==='Escape'){if(activeDrawer)closeDrawer();else if(location.hash==='#wall')location.hash='room';return;}
  if(event.code!=='Space'||event.repeat||activeDrawer||/INPUT|TEXTAREA|SELECT|BUTTON|A/.test(document.activeElement?.tagName)||document.activeElement?.getAttribute('role')==='slider')return;
  event.preventDefault();$('#play-toggle').click();
});
window.addEventListener('pagehide',()=>{cancelPlayback();sourceOperation++;sourceController?.abort();connecting=null;connectedId=null;lx.dispose();});
window.addEventListener('pageshow',event=>{if(event.persisted)connectSource({automatic:true}).catch(()=>{});});
async function init(){
  audio.volume=Number.isFinite(prefs.volume)?Math.max(0,Math.min(1,prefs.volume)):.65;audio.muted=prefs.muted===true;
  if([...$('#source-select').options].some(option=>option.value===prefs.source))$('#source-select').value=prefs.source;
  if([...$('#quality-select').options].some(option=>option.value===prefs.quality))$('#quality-select').value=prefs.quality;
  setLid(prefs.lidOpen!==false);updateVolume();updateVisibility();route();renderCollection();
  connectSource({automatic:true}).catch(()=>{});
  try{
    const response=await fetch('/api/radio',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();const data=await response.json();
    localTracks=data.tracks.map(track=>{const [name,...artist]=track.name.split(/\s+-\s+/);return {id:`local:${track.src}`,name,singer:artist.join(' - ')||'',albumName:'',source:'local',src:track.src};});
    if(!Array.isArray(storageRecord)){records=localTracks;remember();}if(!current&&records.length){displayTrack(records[0]);setStatus('等待播放','■');}
  }catch{feedback('本地唱片加载失败');}
  finally{loadingLocal=false;renderCollection();}
}
init();
