import { escapeHTML as e, readStorage, saveStorage, api } from './ui.js';
import { LXClient } from './lx-client.js';
import { selectMusicSource, loadProbeTracks } from './music-source-selection.js';
import { parseLRC, lyricIndex } from './lyrics.js';
import { playlistInput, uniqueTracks, groupAlbums, validTrack, nextQueueIndex } from './music-wall-data.js';
import { mountAlbumCanvas } from './music-wall-canvas.js';

const $=selector=>document.querySelector(selector),audio=$('#audio'),lx=new LXClient();
const LIBRARY='music-wall.library.v1',PREFS='music-wall.preferences.v1';
const stored=readStorage(LIBRARY,{})||{},prefs=readStorage(PREFS,{})||{},vinylPrefs=readStorage('slow-records.preferences.v1',{})||{};
let playlists=Array.isArray(stored.playlists)?stored.playlists.filter(list=>list&&typeof list.id==='string'&&typeof list.name==='string'&&Array.isArray(list.tracks)).slice(0,20).map(list=>({...list,tracks:uniqueTracks(list.tracks).slice(0,1000)})):[];
let savedTracks=uniqueTracks(Array.isArray(stored.tracks)?stored.tracks:[]),localTracks=[],discovered=[],albums=[],current=null,queue=[],collection='all';
let playController=null,lyricsController=null,sourceController=null,sourcePromise=null,connectedSource='',sources=[],generation=0;
let lines=[],activeLine=-2,searchController=null,searchResults=[],searchQuery='',searchPage=0,searchTotal=0,importController=null;
let shuffled=false,repeated=false,wallLoading=true,noticeTimer,wallError='',seekDragging=false;
let queueName='',playlistView='all';
const icon=name=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const time=value=>Number.isFinite(value)&&value>0?`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`:'0:00';
function notice(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function persist(){if(!saveStorage(LIBRARY,{playlists,tracks:savedTracks}))notice('收藏未能保存');}
function savePrefs(){saveStorage(PREFS,{volume:audio.volume,muted:audio.muted,source:$('#source-select').value,preferred:connectedSource||prefs.preferred,quality:$('#quality-select').value});}
function cover(item,eager=false){
  let url='';try{const parsed=new URL(item.img,location.origin);if(['https:','http:'].includes(parsed.protocol)){if(parsed.hostname.endsWith('.music.126.net')){parsed.protocol='https:';parsed.searchParams.set('param','600y600');}url=parsed.href;}}catch{}
  // Empty metadata gets a neutral record sleeve; it never substitutes another album's artwork.
  if(!item.img)url='';
  let hue=0;for(const char of item.id||item.name)hue=(hue+char.charCodeAt(0)*13)%360;
  return `<span class="cover"><span class="cover-fallback" style="--hue:${hue}">${icon('disc')}<b>${e(item.albumName||item.name)}</b><small>${e(item.singer||'')}</small></span>${url?`<img src="${e(url)}" alt="${e(item.albumName||item.name)}" loading="${eager?'eager':'lazy'}" decoding="async" referrerpolicy="no-referrer">`:''}</span>`;
}
document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement)event.target.remove();},true);
function collectionTracks(){
  if(collection==='local')return localTracks;
  if(collection==='discover')return discovered;
  if(collection!=='all')return playlists.find(list=>list.id===collection)?.tracks||[];
  return uniqueTracks([...localTracks,...savedTracks,...playlists.flatMap(list=>list.tracks),...discovered]);
}
function renderTabs(){
  const tabs=[['all','全部'],['local','本地'],['discover','发现'],...playlists.map(list=>[list.id,list.name])];
  $('#collections').innerHTML=tabs.map(([id,name])=>`<button data-collection="${e(id)}" class="${id===collection?'active':''}" aria-pressed="${id===collection}">${e(name)}</button>`).join('');
  $('#collection-name').textContent=collection==='all'?'全部唱片':tabs.find(([id])=>id===collection)?.[1]||'';
}
function renderWall(){
  albums=groupAlbums(collectionTracks());
  $('#album-count').textContent=albums.length?String(albums.length).padStart(2,'0'):'';
  $('#album-wall').setAttribute('aria-busy',String(wallLoading));
  canvas.setAlbums(albums,collection);
  $('#wall-state').hidden=!!albums.length||wallLoading;$('#wall-state').textContent=wallError||'暂无唱片';
  $('#wall-retry').hidden=!wallError||wallLoading;
  markCurrent();
  if($('#playlist-dialog').open)renderPlaylist();
}
function markCurrent(){
  canvas.setPlayback({id:current?.id,playing:!audio.paused&&!audio.ended,loading:$('#player-dialog').dataset.loading==='true'});
}
const canvas=mountAlbumCanvas({root:$('#album-wall'),cover,escape:e,icon,onZoom:zoom=>$('#canvas-reset').textContent=`${Math.round(zoom*100)}%`});
$('#canvas-in').onclick=()=>canvas.zoomBy(1.15);$('#canvas-out').onclick=()=>canvas.zoomBy(1/1.15);$('#canvas-reset').onclick=()=>canvas.reset();
$('#collections').onclick=event=>{const button=event.target.closest('[data-collection]');if(!button)return;collection=button.dataset.collection;renderTabs();renderWall();};
$('#album-wall').onclick=event=>{
  const inline=event.target.closest('[data-inline-album]');
  if(inline){
    const album=albums.find(item=>item.id===inline.dataset.inlineAlbum);if(!album)return;
    if(album.tracks.some(track=>track.id===current?.id))void togglePlay();
    else void chooseTrack(album.tracks[0],collectionTracks());
    return;
  }
  const button=event.target.closest('[data-album]'),album=albums.find(item=>item.id===button?.dataset.album);if(!album)return;
  openPlayer();if(album.tracks.some(track=>track.id===current?.id))return;
  chooseTrack(album.tracks[0],collectionTracks(),button);
};
function openDialog(id){canvas.clearHover();const dialog=$('#'+id);if(!dialog.open)dialog.showModal();}
function openPlayer(){openDialog('player-dialog');syncLyrics(true);}
for(const dialog of document.querySelectorAll('dialog')){
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();});
}
$('#mini-open').onclick=$('#mini-expand').onclick=openPlayer;
$('#import-open').onclick=()=>{openDialog('import-dialog');$('#playlist-input').focus();};
$('#source-open').onclick=()=>{openDialog('source-dialog');void loadSources().catch(error=>$('#source-state').textContent=error.message);};
$('#search-open').onclick=()=>{openDialog('search-dialog');$('#search-input').focus();if(!$('#search-input').value){searchResults=uniqueTracks([...localTracks,...savedTracks]).slice(0,24);renderSearch();}};

function playlistOptions(){return [
  ...(queue.length?[{id:'queue',name:`播放队列 · ${queueName||'音乐墙'}`,tracks:queue}]:[]),
  {id:'all',name:'全部歌曲',tracks:uniqueTracks([...localTracks,...savedTracks,...playlists.flatMap(list=>list.tracks),...discovered])},
  {id:'local',name:'本地',tracks:localTracks},{id:'discover',name:'发现',tracks:discovered},...playlists
];}
function renderPlaylist(){
  const scrollTop=$('#playlist-tracks').scrollTop;
  const lists=playlistOptions();if(!lists.some(list=>list.id===playlistView))playlistView='all';
  const list=lists.find(item=>item.id===playlistView),editable=playlists.some(item=>item.id===playlistView);
  $('#playlist-select').innerHTML=lists.map(item=>`<option value="${e(item.id)}">${e(item.name)}</option>`).join('');$('#playlist-select').value=playlistView;
  $('#playlist-count').textContent=`${list.tracks.length} 首`;$('#playlist-play').disabled=!list.tracks.length;
  $('#playlist-add-current').hidden=!editable;$('#playlist-add-current').disabled=!current;
  $('#playlist-tracks').innerHTML=list.tracks.length?list.tracks.map((track,index)=>`<button class="playlist-track" data-playlist-track="${index}" aria-label="播放 ${index+1}. ${e(track.name)}"><span class="playlist-number">${String(index+1).padStart(2,'0')}</span>${cover(track)}<span class="playlist-track-name"><b>${e(track.name)}</b><small>${e(track.singer||'')}</small></span><span class="playlist-duration">${track.duration?time(track.duration):''}</span><span class="playlist-track-state">${icon('play')}</span></button>`).join(''):'<div class="search-status">暂无歌曲</div>';
  syncPlaylistPlayback();
  $('#playlist-tracks').scrollTop=scrollTop;
}
function syncPlaylistPlayback(){
  if(!$('#playlist-dialog').open)return;
  const tracks=playlistOptions().find(list=>list.id===playlistView)?.tracks||[];
  for(const row of $('#playlist-tracks').children){
    if(!row.hasAttribute('data-playlist-track'))continue;
    const selected=tracks[Number(row.dataset.playlistTrack)]?.id===current?.id;
    row.classList.toggle('is-current',selected);
    if(selected)row.setAttribute('aria-current','true');else row.removeAttribute('aria-current');
    row.querySelector('.playlist-track-state use').setAttribute('href',`#i-${selected&&!audio.paused?'pause':'play'}`);
  }
}
function openPlaylist(view){playlistView=view;$('#playlist-notice').hidden=true;$('#playlist-create-form').hidden=true;openDialog('playlist-dialog');renderPlaylist();}
$('#playlist-open').onclick=()=>openPlaylist(collection);
$('#mini-queue').onclick=$('#player-queue').onclick=()=>openPlaylist(queue.length?'queue':collection);
$('#playlist-select').onchange=event=>{playlistView=event.target.value;$('#playlist-notice').hidden=true;renderPlaylist();};
function playPlaylist(index=0){
  const list=playlistOptions().find(item=>item.id===playlistView);if(!list?.tracks[index])return;
  setPlaybackMode('sequence');
  const name=playlistView==='queue'?queueName:list.name;
  void chooseTrack(list.tracks[index],list.tracks,undefined,name);
}
$('#playlist-play').onclick=()=>playPlaylist();
$('#playlist-tracks').onclick=event=>{
  const row=event.target.closest('[data-playlist-track]');if(!row)return;
  const index=Number(row.dataset.playlistTrack),list=playlistOptions().find(item=>item.id===playlistView);
  const sameQueue=list?.tracks.length===queue.length&&list.tracks.every((track,i)=>track.id===queue[i].id);
  if(sameQueue&&list.tracks[index]?.id===current?.id)void togglePlay();else playPlaylist(index);
};
$('#playlist-create').onclick=()=>{$('#playlist-create-form').hidden=!$('#playlist-create-form').hidden;if(!$('#playlist-create-form').hidden)$('#playlist-name').focus();};
function playlistNotice(text){$('#playlist-notice').textContent=text;$('#playlist-notice').hidden=false;}
$('#playlist-create-form').onsubmit=event=>{
  event.preventDefault();const name=$('#playlist-name').value.trim();if(!name)return;
  if(playlists.length>=20){playlistNotice('最多保存 20 个歌单');return;}
  const list={id:`custom:${crypto.randomUUID()}`,name,tracks:[]};playlists.push(list);playlistView=list.id;persist();renderTabs();renderPlaylist();$('#playlist-create-form').hidden=true;$('#playlist-name').value='';
};
$('#playlist-add-current').onclick=()=>{
  const list=playlists.find(item=>item.id===playlistView);if(!list||!current)return;
  if(list.tracks.some(track=>track.id===current.id)){playlistNotice('歌曲已在歌单中');return;}
  if(list.tracks.length>=1000){playlistNotice('歌单最多支持 1000 首');return;}
  list.tracks.push({...current});persist();renderPlaylist();renderWall();playlistNotice('已加入歌单');
};

function displayTrack(track){
  const album=groupAlbums(queue).find(item=>item.tracks.some(song=>song.id===track.id))||groupAlbums([track])[0];
  $('#player-art').innerHTML=cover(track,true);$('#mini-art').innerHTML=cover(track,true);
  $('#player-tint').innerHTML='';const image=$('#player-art img');if(image){const tint=image.cloneNode();tint.alt='';$('#player-tint').append(tint);}
  $('#album-title').textContent=album.name;$('#album-singer').textContent=album.singer;
  $('#track-title').textContent=$('#mini-title').textContent=track.name;
  $('#track-singer').textContent=$('#mini-singer').textContent=track.singer||'';
  $('#album-tracks').innerHTML=album.tracks.map(song=>`<option value="${e(song.id)}">${e(song.name)}</option>`).join('');
  $('#album-tracks').value=track.id;$('#album-tracks').hidden=album.tracks.length<2;
  $('#mini-player').hidden=false;$('#play-error').hidden=true;markCurrent();document.title=`${track.name} · 音乐墙`;
  if('mediaSession' in navigator&&typeof MediaMetadata!=='undefined')navigator.mediaSession.metadata=new MediaMetadata({title:track.name,artist:track.singer||'',album:track.albumName||'',artwork:image?[{src:image.src}]:[]});
}
function busy(value){$('#player-dialog').dataset.loading=String(value);$('#main-play').setAttribute('aria-busy',String(value));markCurrent();}
async function chooseTrack(track,pool=queue,from,context){
  if(!validTrack(track))return;
  if(context!==undefined)queueName=context;
  else if(pool!==queue)queueName=playlistOptions().find(list=>list.id===collection)?.name||'音乐墙';
  playController?.abort();const controller=new AbortController(),token=++generation;playController=controller;
  audio.pause();audio.removeAttribute('src');audio.load();current=track;queue=uniqueTracks(pool.length?pool:[track]);
  if(!queue.some(song=>song.id===track.id))queue.push(track);
  resetLyrics();displayTrack(track);busy(true);syncTime();
  if($('#playlist-dialog').open)renderPlaylist();
  if(from&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
    const fromBox=from.querySelector('.cover').getBoundingClientRect(),toBox=$('#player-art').getBoundingClientRect();
    $('#player-art').animate([{transform:`translate(${fromBox.x-toBox.x}px,${fromBox.y-toBox.y}px) scale(${fromBox.width/toBox.width})`,opacity:.5},{transform:'none',opacity:1}],{duration:500,easing:'cubic-bezier(.16,1,.3,1)'});
  }
  if(track.source==='wy')void loadLyrics(track);
  try{
    let url=track.src;
    if(track.source!=='local'){
      await connectSource(false,track);controller.signal.throwIfAborted();
      url=await lx.resolve(track,$('#quality-select').value,AbortSignal.any([controller.signal,AbortSignal.timeout(35000)]));
    }
    controller.signal.throwIfAborted();audio.src=url;
    await audio.play();if(token!==generation)return;busy(false);
  }catch(error){
    if(token!==generation||controller.signal.aborted)return;busy(false);
    const message=error.name==='NotAllowedError'?'点击播放':error.message||'播放失败，请重试';
    $('#play-error').textContent=message;$('#play-error').hidden=false;notice(message);
  }
}
$('#album-tracks').onchange=event=>{const track=queue.find(item=>item.id===event.target.value);if(track)chooseTrack(track);};
async function togglePlay(){
  if(!current)return;
  if($('#player-dialog').dataset.loading==='true'){
    playController?.abort();generation++;audio.pause();busy(false);return;
  }
  if(!audio.paused){audio.pause();return;}
  if(!audio.getAttribute('src')||audio.error){void chooseTrack(current);return;}
  try{await audio.play();$('#play-error').hidden=true;}catch{notice('播放失败，请重试');}
}
function adjacent(delta,automatic=false){
  if(!queue.length)return;const index=queue.findIndex(track=>track.id===current?.id);
  const next=nextQueueIndex(queue.length,index,delta,{automatic,shuffle:shuffled});if(next<0)return;
  void chooseTrack(queue[next]);
}
for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>{if(button.dataset.action==='play')void togglePlay();else adjacent(button.dataset.action==='next'?1:-1);};
function setPlaybackMode(mode){shuffled=mode==='shuffle';repeated=mode==='repeat';$('#shuffle').setAttribute('aria-pressed',String(shuffled));$('#repeat').setAttribute('aria-pressed',String(repeated));$('#playlist-mode').value=mode;}
$('#shuffle').onclick=()=>setPlaybackMode(shuffled?'sequence':'shuffle');
$('#repeat').onclick=()=>setPlaybackMode(repeated?'sequence':'repeat');
$('#playlist-mode').onchange=event=>setPlaybackMode(event.target.value);
function syncPlayback(){
  const playing=!audio.paused&&!audio.ended;
  for(const button of document.querySelectorAll('[data-action=play]')){button.setAttribute('aria-label',playing?'暂停':'播放');button.setAttribute('aria-pressed',String(playing));button.querySelector('use').setAttribute('href',`#i-${playing?'pause':'play'}`);}
  if('mediaSession'in navigator)navigator.mediaSession.playbackState=playing?'playing':'paused';
  markCurrent();
  syncPlaylistPlayback();
}
function syncTime(){
  const duration=Number.isFinite(audio.duration)?audio.duration:0,value=duration?audio.currentTime/duration:0;
  if(!seekDragging){$('#seek').value=Math.round(value*1000);$('#seek').style.setProperty('--fill',`${value*100}%`);}
  $('#seek').disabled=!duration;$('#seek').setAttribute('aria-valuetext',`${time(audio.currentTime)} / ${time(duration)}`);
  $('#elapsed').textContent=time(audio.currentTime);$('#duration').textContent=time(duration||current?.duration);
  $('#mini-progress').style.transform=`scaleX(${value})`;syncLyrics();
}
$('#seek').onpointerdown=()=>seekDragging=true;
$('#seek').oninput=event=>{if(Number.isFinite(audio.duration)){audio.currentTime=audio.duration*Number(event.target.value)/1000;event.target.style.setProperty('--fill',`${Number(event.target.value)/10}%`);syncLyrics(true);$('#elapsed').textContent=time(audio.currentTime);}};
for(const type of ['pointerup','pointercancel','change','blur'])$('#seek').addEventListener(type,()=>{seekDragging=false;syncTime();});
function syncVolume(){
  $('#volume').value=audio.volume;$('#volume').style.setProperty('--fill',`${audio.muted?0:audio.volume*100}%`);
  $('#mute').setAttribute('aria-pressed',String(audio.muted));$('#mute').setAttribute('aria-label',audio.muted?'取消静音':'静音');$('#mute use').setAttribute('href',`#i-${audio.muted?'muted':'volume'}`);
}
audio.volume=Number.isFinite(prefs.volume)?Math.min(1,Math.max(0,prefs.volume)):.65;audio.muted=!!prefs.muted;syncVolume();
$('#volume').oninput=event=>{audio.volume=Number(event.target.value);audio.muted=false;syncVolume();savePrefs();};
$('#mute').onclick=()=>{audio.muted=!audio.muted;syncVolume();savePrefs();};
audio.addEventListener('timeupdate',()=>{if(!document.hidden)syncTime();});
for(const type of ['play','pause','ended'])audio.addEventListener(type,syncPlayback);
audio.addEventListener('playing',()=>busy(false));
audio.addEventListener('loadedmetadata',()=>{syncTime();if(current?.source==='local')void loadLyrics(current);});
audio.addEventListener('ended',()=>{if(repeated){audio.currentTime=0;void audio.play().catch(()=>notice('点击播放'));}else adjacent(1,true);});
audio.addEventListener('error',()=>{busy(false);if(current&&audio.getAttribute('src')){$('#play-error').textContent='音频暂不可用，点击播放重试';$('#play-error').hidden=false;}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){syncTime();syncPlayback();}});

function resetLyrics(){lyricsController?.abort();lyricsController=null;lines=[];activeLine=-2;$('#lyrics-lines').innerHTML='';$('#lyrics-lines').style.transform='';$('#lyrics-state').innerHTML='<i class="spinner"></i>';$('#lyrics-state').hidden=false;}
async function loadLyrics(track){
  lyricsController?.abort();const controller=new AbortController();lyricsController=controller;
  const params=new URLSearchParams({source:track.source});
  if(track.source==='wy')params.set('id',String(track.songmid));else{params.set('src',track.src);params.set('name',track.name);params.set('singer',track.singer||'');params.set('duration',String(audio.duration||0));}
  try{
    const data=await api(`/api/listening/lyrics?${params}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(18000)])});
    if(controller.signal.aborted||current?.id!==track.id)return;
    const translations=new Map(parseLRC(data.translation).map(line=>[line.time,line.text]));
    lines=parseLRC(data.lyric).filter(line=>line.text).map(line=>({...line,translation:translations.get(line.time)||''}));
    $('#lyrics-lines').innerHTML=lines.map((line,index)=>`<button class="lyric-line" data-line="${index}" aria-label="${e(time(line.time)+' '+line.text)}">${e(line.text)}${line.translation?`<small>${e(line.translation)}</small>`:''}</button>`).join('');
    $('#lyrics-state').hidden=!!lines.length;$('#lyrics-state').textContent=lines.length?'':'暂无歌词';activeLine=-2;syncLyrics(true);
  }catch{if(controller.signal.aborted||current?.id!==track.id)return;$('#lyrics-state').textContent='歌词暂不可用';}
}
function syncLyrics(force=false){
  if(!$('#player-dialog').open||!lines.length)return;
  const index=lyricIndex(lines,audio.currentTime||0);if(index===activeLine&&!force)return;activeLine=index;
  const nodes=$('#lyrics-lines').children;
  for(let i=0;i<nodes.length;i++){nodes[i].classList.toggle('active',i===index);if(i===index)nodes[i].setAttribute('aria-current','true');else nodes[i].removeAttribute('aria-current');}
  const target=nodes[Math.max(0,index)];if(target)$('#lyrics-lines').style.transform=`translateY(${$('#lyrics-window').clientHeight/2-target.offsetTop-target.offsetHeight/2}px)`;
}
$('#lyrics-lines').onclick=event=>{const line=lines[Number(event.target.closest('[data-line]')?.dataset.line)];if(line&&Number.isFinite(audio.duration)){audio.currentTime=Math.min(line.time,audio.duration);syncTime();}};
window.addEventListener('resize',()=>syncLyrics(true));

let catalogPromise=null;
async function loadSources(){
  if(catalogPromise)return catalogPromise;
  catalogPromise=(async()=>{
    const data=await api('/api/listening/sources',{signal:AbortSignal.timeout(12000)});sources=data.sources||[];
    $('#source-select').innerHTML='<option value="">自动</option>'+sources.map(source=>`<option value="${e(source.id)}">${e(source.name)}</option>`).join('');
    if(sources.some(source=>source.id===prefs.source))$('#source-select').value=prefs.source;
    if(['128k','320k','flac'].includes(prefs.quality))$('#quality-select').value=prefs.quality;
  })().catch(error=>{catalogPromise=null;throw error;});return catalogPromise;
}
function connectSource(force=false,track){
  if(!force&&connectedSource&&lx.sources)return Promise.resolve(connectedSource);
  if(!force&&sourcePromise)return sourcePromise;
  sourceController?.abort();lx.dispose();connectedSource='';
  const controller=new AbortController();sourceController=controller;
  $('#source-led').dataset.state='loading';$('#source-state').textContent='检测中';
  const task=(async()=>{
    await loadSources();controller.signal.throwIfAborted();
    const selected=$('#source-select').value,ids=selected?[selected]:sources.map(source=>source.id);
    if(!ids.length)throw new Error('暂无可用音源');
    const tracks=track?.source==='wy'?[track]:await loadProbeTracks(collectionTracks(),controller.signal);
    const id=await selectMusicSource({client:lx,ids,preferred:prefs.preferred||vinylPrefs.source,tracks,quality:$('#quality-select').value,signal:controller.signal,onAttempt:id=>$('#source-state').textContent=sources.find(source=>source.id===id)?.name||id});
    controller.signal.throwIfAborted();connectedSource=id;$('#source-led').dataset.state='ready';$('#source-state').textContent=sources.find(source=>source.id===id)?.name||id;savePrefs();return id;
  })().catch(error=>{if(!controller.signal.aborted){$('#source-led').dataset.state='error';$('#source-state').textContent=error.message;}throw error;}).finally(()=>{if(sourceController===controller)sourcePromise=null;});
  sourcePromise=task;return task;
}
function changeSource(){
  savePrefs();const wasNetwork=current?.source==='wy';
  if(wasNetwork){playController?.abort();generation++;audio.pause();audio.removeAttribute('src');audio.load();busy(false);}
  void connectSource(true,current).then(()=>{if(wasNetwork&&current?.source==='wy')void chooseTrack(current);}).catch(error=>{if(error.name!=='AbortError')notice(error.message);});
}
$('#source-select').onchange=changeSource;$('#source-retry').onclick=changeSource;
$('#quality-select').onchange=()=>{savePrefs();if(current?.source==='wy')void chooseTrack(current);};

$('#import-form').onsubmit=async event=>{
  event.preventDefault();$('#import-error').hidden=true;
  const value=$('#playlist-input').value;
  try{playlistInput(value);}catch(error){$('#import-error').textContent=error.message;$('#import-error').hidden=false;return;}
  if(playlists.length>=20){try{const {id}=playlistInput(value);if(!playlists.some(list=>list.id===id))throw new Error('最多保存 20 个歌单');}catch(error){$('#import-error').textContent=error.message;$('#import-error').hidden=false;return;}}
  importController?.abort();const controller=new AbortController();importController=controller;
  $('#import-submit').disabled=true;$('#import-submit').innerHTML='<i class="spinner"></i>';$('#import-form').setAttribute('aria-busy','true');
  try{
    const list=await api('/api/listening/playlist?input='+encodeURIComponent(value),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(90000)])});
    if(controller.signal.aborted)return;
    const entry={id:list.id,name:list.name,tracks:uniqueTracks(list.tracks)};
    if(playlists.some(item=>item.id===entry.id))playlists=playlists.map(item=>item.id===entry.id?entry:item);else playlists.push(entry);
    persist();collection=entry.id;renderTabs();renderWall();$('#import-dialog').close();$('#playlist-input').value='';notice(`${entry.name} · ${entry.tracks.length} 首`);
  }catch(error){if(controller.signal.aborted)return;$('#import-error').textContent=error.name==='TimeoutError'?'导入超时，请重试':error.message;$('#import-error').hidden=false;}
  finally{if(importController===controller){$('#import-submit').disabled=false;$('#import-submit').innerHTML=icon('arrow');$('#import-form').setAttribute('aria-busy','false');}}
};
$('#import-dialog').addEventListener('close',()=>{importController?.abort();});
function renderSearch(){
  $('#search-results').innerHTML=searchResults.length?searchResults.map((track,index)=>`<button class="search-result" data-search-track="${index}" aria-label="播放 ${e(track.name)}">${cover(track)}<span><b>${e(track.name)}</b><small>${e(track.singer)} · ${e(track.albumName||track.name)}</small></span>${icon('play')}</button>`).join(''):'<div class="search-status">暂无结果</div>';
  $('#search-more').hidden=searchResults.length>=searchTotal||!searchQuery;
}
async function search(more=false){
  const query=$('#search-input').value.trim();if(!query){searchResults=uniqueTracks([...localTracks,...savedTracks]);searchTotal=0;searchQuery='';renderSearch();return;}
  searchController?.abort();const controller=new AbortController();searchController=controller;
  const page=more&&query===searchQuery?searchPage+1:1;$('#search-more').disabled=true;
  if(page===1){$('#search-results').innerHTML='<div class="search-status"><i class="spinner"></i></div>';$('#search-more').hidden=true;}
  try{
    const data=await api(`/api/listening/search?q=${encodeURIComponent(query)}&page=${page}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});
    if(controller.signal.aborted)return;
    searchResults=uniqueTracks(page===1?data.tracks:[...searchResults,...data.tracks]);searchPage=page;searchQuery=query;searchTotal=data.total;renderSearch();
  }catch(error){if(controller.signal.aborted)return;if(page===1)$('#search-results').innerHTML=`<div class="search-status">${e(error.message)}</div>`;else notice(error.message);}
  finally{if(searchController===controller)$('#search-more').disabled=false;}
}
$('#search-form').onsubmit=event=>{event.preventDefault();void search();};$('#search-more').onclick=()=>void search(true);
$('#search-input').addEventListener('input',()=>{searchController?.abort();$('#search-more').hidden=true;});
$('#search-dialog').addEventListener('close',()=>searchController?.abort());
$('#search-results').onclick=event=>{const button=event.target.closest('[data-search-track]'),track=searchResults[Number(button?.dataset.searchTrack)];if(!button||!track)return;savedTracks=uniqueTracks([...savedTracks,track]).slice(-500);persist();renderWall();$('#search-dialog').close();openPlayer();void chooseTrack(track,searchResults,undefined,'搜索结果');};

async function enrichLocal(){
  const cached=readStorage('music-wall.local-covers.v1',{})||{};
  for(const track of localTracks){
    if(cached[track.id]?.img){Object.assign(track,cached[track.id]);continue;}
    try{
      const result=await api('/api/listening/search?q='+encodeURIComponent(`${track.name} ${track.singer}`),{signal:AbortSignal.timeout(15000)});
      const match=result.tracks.find(item=>item.name.toLowerCase()===track.name.toLowerCase()&&item.singer.split(' / ').includes(track.singer));
      if(match){const metadata={img:match.img,albumName:match.albumName,albumId:match.albumId};Object.assign(track,metadata);cached[track.id]=metadata;saveStorage('music-wall.local-covers.v1',cached);}
    }catch{}
  }
  renderWall();
  if(current?.source==='local')displayTrack(current);
}
async function init(){
  wallLoading=true;wallError='';renderTabs();renderWall();
  const results=await Promise.allSettled([
    api('/api/radio',{signal:AbortSignal.timeout(12000)}).then(data=>{
      localTracks=data.tracks.map(track=>{const [name,...artists]=track.name.split(/\s+-\s+/);return {id:`local:${track.src}`,name,singer:artists.join(' - '),source:'local',src:track.src};});
      const art=readStorage('music-wall.local-covers.v1',{})||{};for(const track of localTracks)if(art[track.id])Object.assign(track,art[track.id]);
      const vinyl=readStorage('slow-records.collection.v1',[]);if(Array.isArray(vinyl))savedTracks=uniqueTracks([...vinyl.filter(track=>track.source==='wy'),...savedTracks]);
      renderWall();
    }),
    api('/api/listening/playlist?input=3778678',{signal:AbortSignal.timeout(30000)}).then(data=>{discovered=uniqueTracks(data.tracks).slice(0,60);renderWall();})
  ]);
  wallLoading=false;if(results.some(result=>result.status==='rejected'))wallError='唱片加载失败';renderWall();
  void enrichLocal();void loadSources().catch(()=>{});
}
$('#wall-retry').onclick=()=>void init();
document.addEventListener('keydown',event=>{
  if(event.isComposing)return;const typing=/INPUT|SELECT|TEXTAREA/.test(event.target.tagName);
  if((event.key==='/'&&!typing)||((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k')){event.preventDefault();if(!document.querySelector('dialog[open]'))$('#search-open').click();}
  if(event.code==='Space'&&!typing&&!event.repeat&&!/BUTTON|A/.test(event.target.tagName)){event.preventDefault();void togglePlay();}
});
if('mediaSession'in navigator){
  for(const [action,handler] of Object.entries({play:()=>void togglePlay(),pause:()=>audio.pause(),previoustrack:()=>adjacent(-1),nexttrack:()=>adjacent(1),seekto:details=>{if(Number.isFinite(audio.duration)&&Number.isFinite(details.seekTime))audio.currentTime=Math.max(0,Math.min(details.seekTime,audio.duration));}})){
    try{navigator.mediaSession.setActionHandler(action,handler);}catch{}
  }
}
window.addEventListener('pagehide',()=>{playController?.abort();sourceController?.abort();lyricsController?.abort();searchController?.abort();importController?.abort();audio.pause();lx.dispose();connectedSource='';busy(false);});
void init();
