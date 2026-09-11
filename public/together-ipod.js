import { escapeHTML as e, readStorage, saveStorage } from './ui.js';
import { createSharedListeningPlayer, readAudioDuration } from './listening-shared.js';
import { LXClient } from './lx-client.js';
import { loadProbeTracks, selectMusicSource } from './music-source-selection.js';
import { createLyricsProjection } from './lyrics.js';

export function createIPod({notice,getRoom,enqueue,remove}) {
  const $=s=>document.querySelector(s),audio=$('#audio'),lx=new LXClient();
  const prefs=readStorage('slow-records.preferences.v1',{})||{},stored=readStorage('slow-records.collection.v1',[]);
  let favorites=Array.isArray(stored)?stored.filter(t=>t&&typeof t.id==='string'&&typeof t.name==='string'):[],playlist=[];
  let view='lobby',selected=null,local=[],results=[],musicMode='library',searchController=null,searchPage=0,searchTotal=0,connecting=null,sourceId='',roomsLoading=false,seeking=false;
  const titles={menu:'一起听',lobby:'房间大厅',join:'加入房间',room:'我的房间',playlist:'房间歌单',music:'音乐',now:'正在播放',settings:'设置',lyrics:'歌词'};
  const lyrics=createLyricsProjection({audio,root:$('#lyrics')});
  const time=value=>`${Math.floor(Math.max(0,value||0)/60)}:${String(Math.floor(Math.max(0,value||0)%60)).padStart(2,'0')}`;
  const savePrefs=()=>saveStorage('slow-records.preferences.v1',{...prefs,volume:audio.volume,quality:$('#quality-select').value,source:$('#source-select').value});
  function candidates(){return [...$(`[data-screen="${view}"]`).querySelectorAll('button:not(:disabled),a,input,select')].filter(node=>node.getClientRects().length);}
  function highlight(node,scroll=false){
    selected?.classList.remove('selected');selected=node;selected?.classList.add('selected');
    if(scroll&&selected){const panel=$(`[data-screen="${view}"]`),box=selected.getBoundingClientRect(),bounds=panel.getBoundingClientRect();if(box.top<bounds.top)panel.scrollTop+=box.top-bounds.top;else if(box.bottom>bounds.bottom)panel.scrollTop+=box.bottom-bounds.bottom;}
  }
  function syncSelection(){const nodes=candidates();if(!nodes.includes(selected))highlight(nodes.find(n=>n.matches('.room-item,.song-main,.menu-row'))||nodes[0]);}
  function count(){if(view==='lobby')return;if(view==='music')$('#screen-count').textContent=`${results.length} 首`;else $('#screen-count').textContent='一起听';}
  const navigation=[];
  function show(next,{action='join',code='',returning=false}={}){
    if(!titles[next])return;
    if(next==='join'&&getRoom())next='room';
    if(next==='menu')navigation.length=0;
    else if(next!==view&&!returning)navigation.push(view);
    if(next==='join'){
      const creating=action==='create';
      $('#room-form').dataset.action=action;$('#nickname').value='';$('#room-code').value=code;
      $('#room-code-field').hidden=creating;$('#room-code').disabled=creating;
      $('#enter-room').textContent=creating?'创建房间':'加入房间';
      titles.join=creating?'创建房间':'加入房间';
    }
    view=next;for(const node of document.querySelectorAll('[data-screen]'))node.hidden=node.dataset.screen!==next;
    $('#screen-title').textContent=titles[next];$('#notice').hidden=true;syncSelection();count();
    if(next==='lobby')void refreshRooms();
    if(next==='music')void search();
    if(next==='settings'&&$('#source-select').options.length===1)void loadSources().catch(error=>notice(error.message));
  }
  function move(delta){
    if(view==='now'){setVolume(audio.volume+delta*.04);return;}
    const nodes=candidates();if(!nodes.length)return;
    const index=nodes.indexOf(selected);highlight(nodes[(Math.max(0,index)+delta+nodes.length)%nodes.length],true);
  }
  function confirm(){if(view==='now'){show('lyrics');return;}if(selected?.matches('input,select'))selected.focus();else selected?.click();}
  function back(){let previous=navigation.pop();while(previous==='join'&&getRoom())previous=navigation.pop();show(previous||(view==='menu'?'lobby':'menu'),{returning:true});}
  $('#screen-back').onclick=back;$('#screen-home').onclick=()=>show('menu');$('#wheel-menu').onclick=back;$('#wheel-select').onclick=confirm;
  for(const node of document.querySelectorAll('[data-view]'))node.onclick=()=>show(node.dataset.view);
  $('#screen').addEventListener('focusin',event=>{if(event.target.closest('[data-screen]'))highlight(event.target);});
  $('#screen').addEventListener('pointerover',event=>{const node=event.target.closest('.menu-row,.room-item,.song-main');if(node)highlight(node);});
  async function refreshRooms(){
    if(roomsLoading)return;roomsLoading=true;$('#room-list').setAttribute('aria-busy','true');$('#refresh-rooms').disabled=true;
    try{
      const response=await fetch('/api/together/rooms',{signal:AbortSignal.timeout(10000)}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'大厅加载失败');
      const focused=document.activeElement?.dataset.join,selection=selected?.dataset.join;
      const markup=data.rooms.length?data.rooms.map(room=>`<button class="room-item" data-join="${e(room.room)}" ${room.memberCount>=20?'disabled':''}><b>${e(room.name)}的房间</b><span class="room-people">${room.memberCount} / 20</span><small>${room.playing?'▶ ':''}${e(room.track?.name||room.room)}</small><span class="room-arrow">›</span></button>`).join(''):'<div class="screen-empty">暂无在线房间</div>';
      if($('#room-list').innerHTML!==markup){$('#room-list').innerHTML=markup;if(view==='lobby'){if(selection)highlight([...$('#room-list').querySelectorAll('[data-join]')].find(n=>n.dataset.join===selection));syncSelection();if(focused)[...$('#room-list').querySelectorAll('[data-join]')].find(n=>n.dataset.join===focused)?.focus();}}
      if(view==='lobby')$('#screen-count').textContent=`${data.rooms.length} 个房间`;
    }catch(error){$('#room-list').innerHTML='<div class="screen-empty"><button id="retry-rooms" class="wide-button">加载失败 · 重试</button></div>';$('#retry-rooms').onclick=refreshRooms;if(view==='lobby')syncSelection();}
    finally{roomsLoading=false;$('#room-list').setAttribute('aria-busy','false');$('#refresh-rooms').disabled=false;}
  }
  $('#room-list').onclick=event=>{const button=event.target.closest('[data-join]');if(button&&!button.disabled)show('join',{code:button.dataset.join});};
  $('#refresh-rooms').onclick=refreshRooms;$('#new-room').onclick=()=>show('join',{action:'create'});
  function refresh(){
    const track=player.track,playing=!audio.paused&&!audio.ended;
    if(!seeking)$('#seek').value=track?Math.min(1000,audio.currentTime/track.duration*1000):0;
    $('#seek').disabled=!track;$('#elapsed').textContent=time(audio.currentTime);$('#duration').textContent=time(track?.duration);
    $('#room-now-title').textContent=track?.name||'未在播放';$('#room-now-artist').textContent=track?.singer||'—';
    if(!seeking)$('#room-seek').value=$('#seek').value;
    $('#room-seek').disabled=!track;$('#room-time').textContent=`${time(audio.currentTime)} / ${time(track?.duration)}`;
    for(const id of ['room-play','now-play']){$('#'+id).textContent=playing?'Ⅱ':'▶';$('#'+id).disabled=!track;$('#'+id).setAttribute('aria-label',playing?'暂停':'播放');$('#'+id).setAttribute('aria-pressed',String(playing));}
    $('#play-toggle').setAttribute('aria-pressed',String(playing));$('#play-toggle').setAttribute('aria-label',playing?'暂停':'播放');$('#play-indicator').textContent=playing?'▶':'Ⅱ';$('#play-indicator').setAttribute('aria-label',playing?'正在播放':'已暂停');
    const saved=favorites.some(t=>t.id===track?.id);$('#favorite-track').textContent=saved?'✓ 已收藏':'＋ 收藏';$('#favorite-track').disabled=!track;$('#favorite-track').setAttribute('aria-pressed',String(saved));
    lyrics.sync();$('#lyrics-empty').hidden=!$('#lyrics').hidden;
  }
  async function loadSources(){
    const response=await fetch('/api/listening/sources',{signal:AbortSignal.timeout(10000)}),data=await response.json();if(!response.ok)throw new Error(data.error||'音源加载失败');
    const previous=$('#source-select').value||prefs.source;
    $('#source-select').innerHTML=data.sources.length?data.sources.map(s=>`<option value="${e(s.id)}">${e(s.name)}</option>`).join(''):'<option value="">暂无音源</option>';
    if(data.sources.some(s=>s.id===previous))$('#source-select').value=previous;
    return data.sources;
  }
  async function connectSource(automatic=true){
    if(connecting)return connecting;
    $('#source-connect').disabled=true;
    connecting=(async()=>{
      const sources=await loadSources();if(!sources.length)throw new Error('暂无可用音源');
      const signal=AbortSignal.timeout(120000),preferred=$('#source-select').value;
      const tracks=await loadProbeTracks([...local,...favorites],signal);
      sourceId=await selectMusicSource({client:lx,ids:automatic?sources.map(s=>s.id):[preferred],preferred,tracks,quality:$('#quality-select').value,signal});
      $('#source-select').value=sourceId;savePrefs();
    })().finally(()=>{connecting=null;$('#source-connect').disabled=false;});
    return connecting;
  }
  const player=createSharedListeningPlayer({audio,
    load:track=>{lyrics.reset();audio.src=track.src;audio.load();lyrics.setTrack(track);},
    clear:()=>{lyrics.reset();audio.pause();audio.removeAttribute('src');audio.load();},
    resolveTrack:async(track,signal)=>{
      let src=track.src;
      if(track.source!=='local'){if(!lx.sources||sourceId!==$('#source-select').value)await connectSource();signal.throwIfAborted();src=await lx.resolve(track,$('#quality-select').value,signal);}
      signal.throwIfAborted();const duration=await readAudioDuration(src,AbortSignal.any([signal,AbortSignal.timeout(15000)]));return {...track,src,duration};
    },refresh,
  });
  function setVolume(value){audio.volume=Math.max(0,Math.min(1,value));$('#volume').value=Math.round(audio.volume*100);$('#volume-value').textContent=`${Math.round(audio.volume*100)}%`;savePrefs();if(view==='now')notice(`音量 ${Math.round(audio.volume*100)}%`);}
  audio.volume=Number.isFinite(prefs.volume)?Math.max(0,Math.min(1,prefs.volume)):.65;
  $('#volume').value=Math.round(audio.volume*100);$('#volume-value').textContent=`${$('#volume').value}%`;
  if(['128k','320k','flac'].includes(prefs.quality))$('#quality-select').value=prefs.quality;
  $('#volume').oninput=()=>setVolume(Number($('#volume').value)/100);$('#quality-select').onchange=savePrefs;
  $('#source-connect').onclick=()=>connectSource().then(()=>notice('音源已连接')).catch(error=>notice(error.message));
  $('#source-select').onchange=()=>connectSource(false).then(()=>notice('音源已连接')).catch(error=>notice(error.message));
  $('#play-toggle').onclick=()=>player.track?player.toggle():show(getRoom()?'music':'lobby');
  $('#room-play').onclick=$('#now-play').onclick=()=>player.toggle();
  $('#room-seek').oninput=()=>{seeking=true;};
  $('#room-seek').onchange=()=>{seeking=false;if(player.track)player.command('seek',{position:Number($('#room-seek').value)/1000*player.track.duration});};
  $('#room-seek').onblur=$('#room-seek').onpointercancel=()=>{seeking=false;};
  $('#stop').onclick=()=>player.command('stop');$('#seek').oninput=()=>{seeking=true;};
  $('#seek').onchange=()=>{seeking=false;if(player.track)player.command('seek',{position:Number($('#seek').value)/1000*player.track.duration});};
  $('#seek').onblur=$('#seek').onpointercancel=()=>{seeking=false;};
  function choose(track){if(!getRoom()){show('join');notice('尚未加入房间');return;}show('now');player.select(track);}
  function adjacent(delta){if(view!=='now'&&view!=='lyrics'&&view!=='room'){move(delta);return;}const pool=playlist;if(!pool.length){show('music');return;}const index=pool.findIndex(t=>t.id===player.track?.id);choose(pool[(index+(index<0?1:delta)+pool.length)%pool.length]);}
  $('#previous-track').onclick=()=>adjacent(-1);$('#next-track').onclick=()=>adjacent(1);
  function toggleFavorite(track){
    if(!track)return;const index=favorites.findIndex(t=>t.id===track.id);
    if(index>=0)favorites.splice(index,1);else if(favorites.length<500)favorites.push(track);else{notice('收藏已满');return;}
    saveStorage('slow-records.collection.v1',favorites);if(musicMode==='favorites')results=filterLocal();renderMusic();refresh();
  }
  $('#favorite-track').onclick=()=>toggleFavorite(player.track);
  function filterLocal(){const query=$('#music-query').value.trim().toLocaleLowerCase(),pool=musicMode==='favorites'?favorites:[...local,...favorites.filter(t=>!local.some(item=>item.id===t.id))];return pool.filter(t=>`${t.name} ${t.singer||''}`.toLocaleLowerCase().includes(query));}
  function renderMusic(){
    $('#music-list').innerHTML=results.length?results.map(t=>`<div class="song-item"><button class="song-main" data-track="${e(t.id)}"><b>${e(t.name)}</b><small>${e(t.singer||'—')}</small></button><button class="song-enqueue" data-enqueue="${e(t.id)}" aria-label="加入房间歌单 ${e(t.name)}">＋</button><button class="song-save" data-save="${e(t.id)}" aria-label="${favorites.some(item=>item.id===t.id)?'取消收藏':'收藏'} ${e(t.name)}">${favorites.some(item=>item.id===t.id)?'✓':'＋'}</button></div>`).join(''):'<div class="screen-empty">暂无歌曲</div>';
    if(view==='music'){syncSelection();count();}
  }
  async function search(page=1){
    searchController?.abort();const controller=new AbortController();searchController=controller;
    const query=$('#music-query').value.trim();$('#load-more').hidden=true;
    if(page===1){results=filterLocal();renderMusic();searchPage=0;}
    if(!query||musicMode==='favorites')return;
    $('#music-list').setAttribute('aria-busy','true');if(!results.length)$('#music-list').innerHTML='<div class="screen-empty">搜索中…</div>';
    try{
      const response=await fetch(`/api/listening/search?q=${encodeURIComponent(query)}&page=${page}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])}),data=await response.json();if(!response.ok)throw new Error(data.error||'搜索失败');if(controller.signal.aborted)return;
      const ids=new Set(results.map(t=>t.id));results.push(...data.tracks.filter(t=>!ids.has(t.id)));searchPage=page;searchTotal=data.total;renderMusic();$('#load-more').hidden=page*24>=searchTotal||!data.tracks.length;
    }catch(error){if(controller.signal.aborted)return;renderMusic();notice('搜索失败，请重试');}
    finally{if(searchController===controller)$('#music-list').setAttribute('aria-busy','false');}
  }
  $('#search-form').onsubmit=event=>{event.preventDefault();void search();};$('#load-more').onclick=()=>void search(searchPage+1);
  for(const [id,mode] of [['library-tab','library'],['favorites-tab','favorites']])$('#'+id).onclick=()=>{musicMode=mode;$('#library-tab').setAttribute('aria-pressed',String(mode==='library'));$('#favorites-tab').setAttribute('aria-pressed',String(mode==='favorites'));void search();};
  $('#music-list').onclick=event=>{const node=event.target.closest('[data-track],[data-save],[data-enqueue]');if(!node)return;const track=results.find(t=>t.id===(node.dataset.track||node.dataset.save||node.dataset.enqueue));if(node.dataset.save)toggleFavorite(track);else if(node.dataset.enqueue){if(!getRoom()){show('join');return;}enqueue(track);}else choose(track);};
  $('#room-playlist').onclick=event=>{const node=event.target.closest('[data-queue-track],[data-remove]');if(!node)return;if(node.dataset.remove)remove(node.dataset.remove);else{const track=playlist.find(t=>t.id===node.dataset.queueTrack);if(track)choose(track);}};
  function updatePlaylist(state){
    playlist=state.playlist||[];$('#playlist-count').textContent=playlist.length;
    const markup=playlist.length?playlist.map((track,index)=>`<div class="song-item${track.id===state.track?.id?' is-current':''}"><button class="song-main" data-queue-track="${e(track.id)}"><b>${track.id===state.track?.id?(state.playing?'▶':'Ⅱ'):String(index+1).padStart(2,'0')} ${e(track.name)}</b><small>${e(track.singer||'—')}</small></button><button class="song-save" data-remove="${e(track.id)}" aria-label="移出歌单 ${e(track.name)}">×</button></div>`).join(''):'<div class="screen-empty">歌单为空</div>';
    if($('#room-playlist').innerHTML!==markup){$('#room-playlist').innerHTML=markup;if(view==='playlist')syncSelection();}
  }
  const wheel=$('#click-wheel');let drag=null,suppressClick=false,wheelTime=0;
  const angle=event=>{const rect=wheel.getBoundingClientRect();return Math.atan2(event.clientY-rect.top-rect.height/2,event.clientX-rect.left-rect.width/2);};
  wheel.addEventListener('wheel',event=>{event.preventDefault();if(performance.now()-wheelTime<70)return;wheelTime=performance.now();move(event.deltaY>0?1:-1);},{passive:false});
  wheel.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('#wheel-select'))return;drag={id:event.pointerId,angle:angle(event),delta:0,moved:false};suppressClick=false;});
  wheel.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;const next=angle(event);let delta=next-drag.angle;if(delta>Math.PI)delta-=Math.PI*2;if(delta<-Math.PI)delta+=Math.PI*2;drag.angle=next;drag.delta+=delta;if(Math.abs(drag.delta)>.32){move(Math.sign(drag.delta));drag.delta=0;drag.moved=true;wheel.setPointerCapture(event.pointerId);}});
  const release=()=>{if(drag)suppressClick=drag.moved;drag=null;};for(const event of ['pointerup','pointercancel','lostpointercapture'])wheel.addEventListener(event,release);
  window.addEventListener('pointerup',release);wheel.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopPropagation();suppressClick=false;}},true);
  window.addEventListener('keydown',event=>{
    if(event.target.closest?.('.retro-computer'))return;
    if(event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
    const typing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if(event.key==='Escape'){event.preventDefault();back();return;}if(typing)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();move(event.key==='ArrowDown'?1:-1);}
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();adjacent(event.key==='ArrowLeft'?-1:1);}
    else if(event.key==='Enter'&&(!document.activeElement?.matches('button,a')||document.activeElement.closest('.click-wheel'))){event.preventDefault();confirm();}
    else if(event.code==='Space'&&(!document.activeElement?.matches('button,a')||document.activeElement.closest('.click-wheel'))){event.preventDefault();$('#play-toggle').click();}
  });
  for(const event of ['timeupdate','play','pause','loadedmetadata','emptied'])audio.addEventListener(event,refresh);
  audio.addEventListener('error',()=>{if(audio.getAttribute('src'))notice('播放失败，请重新点歌');});
  setInterval(()=>{player.sync();if(!document.hidden&&view==='lobby')void refreshRooms();},5000);
  setInterval(()=>{if(!document.hidden)player.sync();},500);
  async function loadLibrary(){try{const response=await fetch('/api/radio',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error();const data=await response.json();local=data.tracks.map(t=>{const [name,...singer]=t.name.split(/\s+-\s+/);return {id:`local:${t.src}`,source:'local',src:t.src,name,singer:singer.join(' - ')};});if(view==='music')void search();}catch{if(view==='music')notice('本地曲库加载失败');}}
  void loadLibrary();show('lobby');refresh();
  return {player,show,refreshRooms,updatePlaylist,updateRoom(code){navigation.length=0;$('#no-room').hidden=!!code;$('#room-badge').textContent=code||'未加入';$('#invite-url').hidden=true;if(!code)updatePlaylist({playlist:[]});}};
}
