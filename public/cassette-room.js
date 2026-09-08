const $=selector=>document.querySelector(selector);
const DEFAULT={id:'xyz:5e280fac418a84a0461fb129',title:'无聊斋',author:'教主_单口喜剧'};
const colors=['#83b7b0','#d7b16f','#aba58e','#b38370','#92a6af','#b0b887','#c9bca6','#9d999f'];
const escape=text=>String(text??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const time=value=>{const n=Math.floor(Number(value)||0);return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;};
const audio=$('#audio'),deck=$('#walkman'),dialog=$('#search-dialog');
let collection=[DEFAULT],podcast=null,episodeIndex=0,requestVersion=0,searchVersion=0,transition=false,doorOpen=false,playIntent=false,archiveLoading=false;
let flight=null,saveAt=0;
const memory=new Map();
function readStored(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function saveStored(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{/* Storage may be unavailable in private browsing. */}}
const saved=readStored('surfer.cassettes',[]);
if(Array.isArray(saved))for(const p of saved)if(p&&/^(xyz:[a-f\d]{24}|apple:\d{1,16})$/.test(p.id)&&typeof p.title==='string'&&!collection.some(item=>item.id===p.id))collection.push({id:p.id,title:p.title.slice(0,150),author:String(p.author||'').slice(0,150)});
const preferences=readStored('surfer.cassette.settings',{});
audio.volume=Number.isFinite(preferences?.volume)?Math.max(0,Math.min(1,preferences.volume)):.7;
audio.playbackRate=[.75,1,1.25,1.5,2].includes(preferences?.speed)?preferences.speed:1;
audio.defaultPlaybackRate=audio.playbackRate;
const positionKey=()=>podcast?`surfer.cassette.position:${podcast.id}`:'';
function savePosition(){if(podcast&&podcast.episodes[episodeIndex])saveStored(positionKey(),{id:podcast.episodes[episodeIndex].id,time:audio.currentTime||0});}
function savePreferences(){saveStored('surfer.cassette.settings',{volume:audio.volume,speed:audio.playbackRate});}
function colorFor(id){const index=collection.findIndex(p=>p.id===id);if(index>=0)return colors[index%colors.length];return colors[[...id].reduce((n,c)=>n+c.charCodeAt(0),0)%colors.length];}
function cassetteMarkup(p){return `<span class="cassette" style="--tape-color:${colorFor(p.id)}"><span class="tape-label"><span class="tape-letter">A</span><span class="tape-title">${escape(p.title)}</span><span class="tape-grade">NORMAL<br>POSITION</span></span><span class="tape-reels"><span class="reel"><i></i></span><span class="reel"><i></i></span></span><span class="tape-fineprint">LOW NOISE · HIGH OUTPUT</span><span class="tape-bottom"><i></i><i></i><i></i></span></span>`;}
function renderRack(){
  const size=Math.max(8,Math.ceil(collection.length/8)*8);
  $('#rack-slots').innerHTML=Array.from({length:size},(_,i)=>{const p=collection[i];return `<div class="tape-slot">${p?`<button class="tape-spine ${podcast?.id===p.id?'active':''}" style="--tape-color:${colorFor(p.id)}" data-id="${escape(p.id)}" title="${escape(p.title)}" aria-label="放入${escape(p.title)}磁带" aria-pressed="${podcast?.id===p.id}"><span class="spine-name">${escape(p.title)}</span><span class="spine-number">${String(i+1).padStart(2,'0')}</span></button>`:''}</div>`;}).join('');
  $('#rack-slots').classList.toggle('scrolling',size>8);
  $('#collection-count').textContent=`${String(collection.length).padStart(2,'0')} / ${String(size).padStart(2,'0')}`;
}
async function api(path,params={}){
  const res=await fetch(`/api/podcasts/${path}?${new URLSearchParams(params)}`,{signal:AbortSignal.timeout(45000)});
  let data;try{data=await res.json();}catch{throw new Error('暂时连接不上，请重试');}
  if(!res.ok)throw new Error(data.error||'暂时连接不上，请重试');return data;
}
function status(message=''){$('#paper-status').textContent=message;$('#paper-status').title=message;}
function setDoor(open){doorOpen=open;deck.classList.toggle('door-open',open);$('#door').setAttribute('aria-expanded',String(open));$('#door').setAttribute('aria-label',open?'合上磁带舱':'打开磁带舱');}
function reflectPlaying(on){deck.classList.toggle('playing',on);$('#power-led').classList.toggle('on',on);$('#play').classList.toggle('pressed',on);$('#play-icon').textContent=on?'Ⅱ':'▶';$('#play').setAttribute('aria-label',on?'暂停':'播放');$('#play-state').textContent=on?'PLAY':podcast&&audio.currentTime>0?'PAUSE':'STOP';}
function renderEpisodes(){
  const filter=$('#episode-filter').value.trim().toLocaleLowerCase();
  const episodes=podcast?.episodes||[];
  const visible=episodes.map((e,index)=>({...e,index})).filter(e=>e.title.toLocaleLowerCase().includes(filter));
  $('#episode-count').textContent=podcast?`${visible.length}${filter?' / '+episodes.length:' TRACKS'}`:'—';
  $('#episode-list').setAttribute('aria-busy','false');
  $('#episode-list').innerHTML=visible.length?visible.map(e=>`<button class="episode-row ${e.index===episodeIndex?'current':''}" data-index="${e.index}" aria-label="播放 ${escape(e.title)}" ${e.index===episodeIndex?'aria-current="true"':''}><span class="episode-number">${e.index===episodeIndex?'▶':String(e.index+1).padStart(2,'0')}</span><span class="episode-name">${escape(e.title)}</span><span class="episode-duration">${e.duration?Math.ceil(e.duration/60)+'′':'—'}</span></button>`).join(''):`<div class="empty-message">${podcast?(filter?'没有这期节目':'暂无公开音频'):'从架上取一张磁带'}</div>`;
  $('#archive').hidden=!podcast||podcast.complete===true;
  $('#archive').disabled=archiveLoading;
  $('#archive').textContent=archiveLoading?'读取中…':'往期 ↓';
}
function setControls(){const enabled=Boolean(podcast?.episodes.length)&&!transition;for(const id of ['play','previous','rewind','forward','next','stop','seek'])$('#'+id).disabled=!enabled;$('#previous').disabled=!enabled||episodeIndex<=0;$('#next').disabled=!enabled||episodeIndex>=podcast.episodes.length-1;$('#door').disabled=transition;$('#eject').disabled=transition;}
function updateProgress(){const duration=Number.isFinite(audio.duration)?audio.duration:podcast?.episodes[episodeIndex]?.duration||0;$('#current-time').textContent=time(audio.currentTime);$('#duration').textContent=duration?time(duration):'--:--';$('#counter').textContent=String(Math.floor(audio.currentTime/10)%1000).padStart(3,'0');$('#seek').max=String(duration||100);$('#seek').value=String(audio.currentTime||0);}
async function playCurrent(){
  if(!podcast?.episodes[episodeIndex]||transition)return;
  setDoor(false);playIntent=true;status();
  const version=requestVersion;
  if(audio.error)audio.load();
  try{await audio.play();if(version!==requestVersion)return;}catch(error){if(version!==requestVersion||error.name==='AbortError')return;playIntent=false;reflectPlaying(false);status(error.name==='NotAllowedError'?'按 ▶ 开始播放':'音频连接失败，按 ▶ 重试');}
}
function selectEpisode(index,{play=false,restore=0}={}){
  if(!podcast?.episodes[index])return;
  audio.pause();playIntent=false;episodeIndex=index;
  const episode=podcast.episodes[index];
  audio.src=episode.audio;
  audio.onloadedmetadata=()=>{if(restore>0)audio.currentTime=Math.min(restore,Math.max(0,(audio.duration||episode.duration)-1));updateProgress();};
  audio.load();renderEpisodes();setControls();updateProgress();status();
  if('mediaSession' in navigator){navigator.mediaSession.metadata=new MediaMetadata({title:episode.title,artist:podcast.title,album:'随身听'});}
  if(play)void playCurrent();
}
async function animateTape(p,origin,reverse=false){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const holder=$('#loaded-tape'),target=holder.getBoundingClientRect();
  const source=origin?.getBoundingClientRect()||$('#rack').getBoundingClientRect();
  const width=holder.offsetWidth,height=holder.offsetHeight;
  const matrixFor=el=>{const transform=getComputedStyle(el).transform;return transform==='none'?new DOMMatrix():new DOMMatrix(transform);};
  const matrix=matrixFor($('.scene')).multiply(matrixFor($('.walkman-wrap')));
  const scale=Math.hypot(matrix.a,matrix.b),angle=Math.atan2(matrix.b,matrix.a),degrees=angle*180/Math.PI;
  // Recover the rotated top-left corner, rather than stretching the cassette to its bounding box.
  const endX=target.left+Math.max(0,Math.sin(angle))*height*scale;
  const endY=target.top-Math.min(0,Math.sin(angle))*width*scale;
  const startX=source.left+source.width/2-width*scale*.225;
  const el=document.createElement('div');el.className='flying-tape';el.innerHTML=cassetteMarkup(p);Object.assign(el.style,{width:`${width}px`,height:`${height}px`,left:'0',top:'0'});document.body.append(el);
  const start={transform:`translate(${startX}px, ${source.top+15}px) rotate(9deg) scale(${scale*.45})`,opacity:0};
  const mid={transform:`translate(${(startX+endX)/2}px, ${Math.min(source.top,endY)-65*scale}px) rotate(${degrees-3}deg) scale(${scale*.78})`,opacity:1,offset:.38};
  const end={transform:`translate(${endX}px, ${endY}px) rotate(${degrees}deg) scale(${scale})`,opacity:1};
  flight=el.animate(reverse?[end,{...mid,offset:.62},start]:[start,mid,end],{duration:780,easing:'cubic-bezier(.25,.65,.3,1)',fill:'both'});
  try{await flight.finished;}catch{/* Interrupted by navigation. */}finally{el.remove();flight=null;}
}
async function insertTape(p,origin,{initial=false}={}){
  if(transition)return;
  savePosition();const version=++requestVersion;transition=true;audio.pause();playIntent=false;setControls();status();
  $('#paper-title').textContent=p.title;$('#episode-filter').value='';$('#episode-list').setAttribute('aria-busy','true');$('#episode-list').innerHTML='<div class="paper-loading"><i></i><i></i><i></i></div>';
  setDoor(true);$('#loaded-tape').style.opacity='0';
  try{
    const [loaded]=await Promise.all([memory.get(p.id)?Promise.resolve(memory.get(p.id)):api('podcast',{id:p.id}),initial?Promise.resolve():animateTape(p,origin)]);
    let data=loaded;
    const savedPosition=readStored(`surfer.cassette.position:${data.id}`,{});
    if(savedPosition?.id&&!data.episodes.some(e=>e.id===savedPosition.id)&&!data.complete){
      try{data=await api('archive',{id:data.id});}catch{/* Recent episodes remain available if the archive is temporarily offline. */}
    }
    if(version!==requestVersion)return;
    memory.set(p.id,data);podcast=data;
    saveStored('surfer.cassette.current',data.id);
    if(!collection.some(item=>item.id===data.id)){collection.push({id:data.id,title:data.title,author:data.author});saveStored('surfer.cassettes',collection);}
    $('#loaded-tape').innerHTML=cassetteMarkup(data);$('#loaded-tape').style.opacity='1';setDoor(false);transition=false;renderRack();
    const index=data.episodes.findIndex(e=>e.id===savedPosition?.id);
    episodeIndex=0;
    if(data.episodes.length)selectEpisode(Math.max(0,index),{restore:index>=0?Number(savedPosition?.time)||0:0});
    else{audio.removeAttribute('src');audio.load();renderEpisodes();setControls();}
    $('#paper-title').textContent=data.title;
    if(!initial&&data.episodes.length)void playCurrent();
  }catch(error){
    if(version!==requestVersion)return;
    transition=false;podcast=null;audio.removeAttribute('src');audio.load();$('#loaded-tape').innerHTML='';$('#loaded-tape').style.opacity='1';reflectPlaying(false);renderRack();setControls();updateProgress();
    $('#episode-list').setAttribute('aria-busy','false');$('#episode-count').textContent='—';$('#archive').hidden=true;
    $('#episode-list').innerHTML=`<div class="empty-message">${escape(error.message)}<button class="retry" id="retry-load">重试 ↻</button></div>`;
    $('#retry-load').onclick=()=>void insertTape(p,origin,{initial});status('取带失败');
  }
}
async function eject(){
  if(transition)return;
  if(!podcast){setDoor(!doorOpen);return;}
  savePosition();transition=true;++requestVersion;playIntent=false;audio.pause();setControls();setDoor(true);$('#loaded-tape').style.opacity='0';
  const p=podcast,origin=[...document.querySelectorAll('.tape-spine')].find(el=>el.dataset.id===p.id);
  await animateTape(p,origin,true);podcast=null;transition=false;audio.removeAttribute('src');audio.load();$('#loaded-tape').innerHTML='';$('#paper-title').textContent='—';$('#episode-filter').value='';renderRack();renderEpisodes();reflectPlaying(false);setControls();updateProgress();status();
}
$('#rack-slots').onclick=event=>{const button=event.target.closest('[data-id]');if(button)void insertTape(collection.find(p=>p.id===button.dataset.id),button);};
$('#door').onclick=()=>{if(!doorOpen){audio.pause();playIntent=false;}setDoor(!doorOpen);};
$('#eject').onclick=()=>void eject();
$('#play').onclick=()=>{if(!audio.paused||playIntent){playIntent=false;audio.pause();reflectPlaying(false);}else void playCurrent();};
$('#stop').onclick=()=>{playIntent=false;audio.pause();audio.currentTime=0;updateProgress();savePosition();$('#play-state').textContent='STOP';};
$('#previous').onclick=()=>{savePosition();selectEpisode(episodeIndex-1,{play:true});};
$('#next').onclick=()=>{savePosition();selectEpisode(episodeIndex+1,{play:true});};
function seekTo(value){const max=Number.isFinite(audio.duration)?audio.duration:podcast?.episodes[episodeIndex]?.duration||0;if(max&&audio.readyState>0){audio.currentTime=Math.max(0,Math.min(max,value));updateProgress();savePosition();}}
$('#rewind').onclick=()=>seekTo(audio.currentTime-15);$('#forward').onclick=()=>seekTo(audio.currentTime+15);
$('#seek').oninput=event=>seekTo(Number(event.target.value));
function reflectVolume(){$('#volume').value=String(Math.round(audio.volume*100));$('#volume-knob').style.setProperty('--volume-angle',`${audio.volume*270-135}deg`);}
$('#volume').oninput=event=>{audio.volume=Number(event.target.value)/100;reflectVolume();savePreferences();};
let volumeDrag=null;
$('#volume').onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);volumeDrag={x:event.clientX,y:event.clientY,value:audio.volume};};
$('#volume').onpointermove=event=>{if(!volumeDrag)return;audio.volume=Math.max(0,Math.min(1,volumeDrag.value+(event.clientX-volumeDrag.x+volumeDrag.y-event.clientY)/120));reflectVolume();};
const endVolumeDrag=()=>{volumeDrag=null;savePreferences();};
$('#volume').onpointerup=endVolumeDrag;$('#volume').onpointercancel=endVolumeDrag;
$('#volume').addEventListener('wheel',event=>{event.preventDefault();audio.volume=Math.max(0,Math.min(1,audio.volume+(event.deltaY<0?.05:-.05)));reflectVolume();savePreferences();},{passive:false});
function reflectSpeed(){$('#speed').textContent=`${audio.playbackRate}×`;$('#speed').setAttribute('aria-label',`播放速度 ${audio.playbackRate} 倍`);}
$('#speed').onclick=()=>{const speeds=[.75,1,1.25,1.5,2];audio.playbackRate=speeds[(speeds.indexOf(audio.playbackRate)+1)%speeds.length];audio.defaultPlaybackRate=audio.playbackRate;reflectSpeed();savePreferences();};
audio.addEventListener('ratechange',reflectSpeed);
$('#episode-list').onclick=event=>{const button=event.target.closest('[data-index]');if(button&&!transition){savePosition();selectEpisode(Number(button.dataset.index),{play:true});}};
$('#episode-filter').oninput=()=>{if(!transition)renderEpisodes();};
$('#archive').onclick=async()=>{
  if(!podcast||archiveLoading)return;const id=podcast.id,version=requestVersion;archiveLoading=true;renderEpisodes();status();
  try{const data=await api('archive',{id});memory.set(id,data);if(version!==requestVersion)return;const current=podcast.episodes[episodeIndex]?.id;podcast=data;episodeIndex=Math.max(0,data.episodes.findIndex(e=>e.id===current));status(data.complete?'':`已收录 ${data.episodes.length} 期`);}
  catch(error){if(version===requestVersion)status(error.message);}
  finally{archiveLoading=false;if(version===requestVersion){renderEpisodes();setControls();}}
};
$('#add-tape').onclick=()=>{dialog.showModal();$('#podcast-query').focus();};$('#close-search').onclick=()=>dialog.close();dialog.onclick=event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}};
let searchResults=[];
$('#search-form').onsubmit=async event=>{
  event.preventDefault();const query=$('#podcast-query').value.trim();if(!query)return;const version=++searchVersion;
  $('#search-status').textContent='寻找磁带…';$('#search-results').innerHTML='';$('#search-results').setAttribute('aria-busy','true');
  try{const data=await api('search',{q:query});if(version!==searchVersion)return;searchResults=data.podcasts;$('#search-status').textContent=searchResults.length?'':'没有找到，换个名字试试';$('#search-results').innerHTML=searchResults.map((p,index)=>`<button class="search-result" data-result="${index}" aria-label="添加并播放 ${escape(p.title)}">${cassetteMarkup(p)}<span class="result-author">${escape(p.author)}</span></button>`).join('');}
  catch(error){if(version===searchVersion)$('#search-status').textContent=error.message;}
  finally{if(version===searchVersion)$('#search-results').setAttribute('aria-busy','false');}
};
$('#search-results').onclick=event=>{const button=event.target.closest('[data-result]');if(!button||transition)return;const p=searchResults[Number(button.dataset.result)];dialog.close();void insertTape(p,$('#add-tape'));};
audio.addEventListener('playing',()=>{playIntent=true;reflectPlaying(true);status();});
audio.addEventListener('pause',()=>{reflectPlaying(false);savePosition();});
audio.addEventListener('waiting',()=>{deck.classList.remove('playing');$('#play-state').textContent='WAIT';});
audio.addEventListener('timeupdate',()=>{updateProgress();if(Date.now()-saveAt>5000){savePosition();saveAt=Date.now();}});
audio.addEventListener('ended',()=>{playIntent=false;if(podcast&&episodeIndex<podcast.episodes.length-1)selectEpisode(episodeIndex+1,{play:true});else{reflectPlaying(false);$('#play-state').textContent='END';}});
audio.addEventListener('error',()=>{if(podcast&&!transition&&audio.getAttribute('src')){playIntent=false;reflectPlaying(false);status('音频连接失败，按 ▶ 重试');}});
document.addEventListener('keydown',event=>{if(dialog.open||event.target.matches('input,button,a,textarea,select'))return;if(event.code==='Space'&&podcast){event.preventDefault();$('#play').click();}});
window.addEventListener('pagehide',()=>{savePosition();flight?.cancel();});
if('mediaSession' in navigator){for(const [name,fn] of Object.entries({play:()=>void playCurrent(),pause:()=>{playIntent=false;audio.pause();},previoustrack:()=>$('#previous').click(),nexttrack:()=>$('#next').click(),seekbackward:()=>seekTo(audio.currentTime-15),seekforward:()=>seekTo(audio.currentTime+15)}))try{navigator.mediaSession.setActionHandler(name,fn);}catch{/* Older browsers support fewer media controls. */}}
const lastTape=collection.find(p=>p.id===readStored('surfer.cassette.current',''))||DEFAULT;
renderRack();reflectVolume();reflectSpeed();setControls();void insertTape(lastTape,null,{initial:true});
