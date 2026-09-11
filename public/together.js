import { escapeHTML as e } from './ui.js';
import { targetPosition } from './together-sync.js';
import { createIPod } from './together-ipod.js';
import { createRoomChat } from './together-chat.js';
const $=s=>document.querySelector(s);
let player=null,session=null,state=null,anchor=0,pollTimer,connected=false,operation=0,selectionController=null;
let streamController=null,streamRetryTimer=null,streamDelay=500,streamHealthy=false;
let noticeTimer,entering=false;
const notice=message=>{clearTimeout(noticeTimer);$('#notice').textContent=message;$('#notice').hidden=!message;noticeTimer=setTimeout(()=>{$('#notice').hidden=true;},4500);};
function sendState(){
  if(!player)return;
  if(state&&connected)void player.setState({...state,position:targetPosition(state,performance.now()-anchor)});
  else player.setConnected(false);
}
function connection(ok,label){connected=ok;$('#connection-led').classList.toggle('online',ok);$('#connection').textContent=label;chat.setConnected(ok);if(!ok)player?.setConnected(false);}
async function request(action,input={},credentials=session){
  const start=performance.now(),isRead=action==='state';
  const response=await fetch(`/api/together/${action}${isRead?'?room='+encodeURIComponent(credentials.room):''}`,{method:isRead?'GET':'POST',headers:{'Content-Type':'application/json',...(credentials?{'X-Room-Token':credentials.token}:{})},body:isRead?undefined:JSON.stringify({...input,...(credentials?{room:credentials.room}:{})}),signal:AbortSignal.timeout(10000)});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'房间连接失败'),{status:response.status});
  return {data,lag:(performance.now()-start)/2};
}
function accept({data,lag}){
  if(!session||data.room!==session.room||state&&(data.revision<state.revision||data.serverTime<state.serverTime))return;
  if(state&&data.chatRevision<state.chatRevision)data={...data,chatRevision:state.chatRevision,messages:state.messages};
  state=data;anchor=performance.now()-(lag||0);
  $('#members').innerHTML=data.members.map(member=>`<span class="member">● ${e(member.name)}${member.id===session.memberId?' · 我':''}</span>`).join('');
  connection(true,`${data.members.length} 人在线`);
  $('#shared-title').textContent=data.track?.name||'未在播放';
  $('#shared-status').textContent=data.track?`${data.track.singer||'—'} · ${data.playing?'播放中':data.position>=data.track.duration?'已结束':'已暂停'}`:'—';
  chat.render(data);
  ipod.updatePlaylist(data);
  sendState();
}
function stopStream(){
  streamController?.abort();streamController=null;
  clearTimeout(streamRetryTimer);streamRetryTimer=null;
  streamHealthy=false;
}
function scheduleStreamRetry(current){
  if(session!==current)return;
  clearTimeout(streamRetryTimer);
  streamRetryTimer=setTimeout(()=>{if(session===current)void openStream();},streamDelay);
  streamDelay=Math.min(5000,streamDelay*2);
}
async function openStream(){
  stopStream();
  const current=session;
  if(!current)return;
  const controller=new AbortController();
  streamController=controller;
  try{
    const response=await fetch(`/api/together/stream?room=${encodeURIComponent(current.room)}`,{headers:{'X-Room-Token':current.token},signal:controller.signal});
    if(!response.ok){
      const data=await response.json().catch(()=>({}));
      throw Object.assign(new Error(data.error||'实时连接失败'),{status:response.status});
    }
    streamHealthy=true;
    streamDelay=500;
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer='';
    while(session===current&&!controller.signal.aborted){
      const {done,value}=await reader.read();
      if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      const parts=buffer.split('\n\n');
      buffer=parts.pop()||'';
      for(const part of parts){
        const line=part.split('\n').find(item=>item.startsWith('data: '));
        if(!line)continue;
        try{accept({data:JSON.parse(line.slice(6)),lag:0});}catch{}
      }
    }
    if(session===current&&!controller.signal.aborted)throw new Error('实时连接已断开');
  }catch(error){
    if(session!==current||controller.signal.aborted)return;
    streamHealthy=false;
    if(error.status===401||error.status===404){reset();notice(error.message+'，输入房间码重新入座。');return;}
    scheduleStreamRetry(current);
    clearTimeout(pollTimer);
    pollTimer=setTimeout(poll,1000);
  }
}
let pollRunning=false;
async function poll(){
  if(pollRunning)return;
  clearTimeout(pollTimer);const current=session;if(!current)return;pollRunning=true;
  try{const result=await request('state',{},current);if(session===current)accept(result);}
  catch(error){if(session!==current)return;connection(false,'连接中断');notice(error.message);if(error.status===401||error.status===404){reset();notice(error.message+'，输入房间码重新入座。');return;}}
  finally{pollRunning=false;}
  if(session===current)pollTimer=setTimeout(poll,streamHealthy?10000:1000);
}
function catchUp(){
  if(!session)return;
  void poll();
  player?.sync?.();
  player?.unlock?.();
}
async function enter(action){
  if(session){ipod.show('room');return;}if(entering)return;
  const name=$('#nickname').value.trim();if(!name){notice('请输入昵称');$('#nickname').focus();return;}
  const code=$('#room-code').value.trim().toUpperCase();if(action==='join'&&!/^[A-F0-9]{8}$/.test(code)){notice('请输入有效的 8 位房间码。');return;}
  entering=true;$('#new-room').disabled=true;for(const button of $('#room-form').querySelectorAll('button'))button.disabled=true;
  try{
    const result=await request(action,{room:code,name},null);
    session={room:result.data.room,token:result.data.token,memberId:result.data.memberId};state=null;
    $('#room-info').hidden=false;ipod.updateRoom(session.room);ipod.show('room');$('#active-code').textContent=session.room;$('#room-code').value=session.room;history.replaceState(null,'','#'+session.room);
    accept(result);
    clearTimeout(pollTimer);pollTimer=setTimeout(poll,1000);
    void openStream();
  }catch(error){notice(error.message);}finally{entering=false;$('#new-room').disabled=false;for(const button of $('#room-form').querySelectorAll('button'))button.disabled=false;}
}
function reset(){operation++;selectionController?.abort();stopStream();session=null;state=null;clearTimeout(pollTimer);player?.reset();chat.reset();$('#enable-audio').hidden=true;$('#room-info').hidden=true;$('#shared-title').textContent='未在播放';$('#shared-status').textContent='—';connection(false,'未加入');ipod.updateRoom(null);ipod.show('lobby');}
let controlQueue=Promise.resolve();
function control(command,extra={}){
  operation++;selectionController?.abort();const current=session;
  controlQueue=controlQueue.then(async()=>{
    if(session!==current||!session||!connected)return;
    try{const result=await request('control',{command,revision:state.revision,...extra},current);if(session===current)accept(result);}
    catch(error){if(session===current){notice(error.message);await poll();}}
  });return controlQueue;
}
async function select(track,enqueue=false){
  if(!session||!connected||!player){notice('请先创建或加入房间。');return;}
  const current=session,version=++operation,revision=state.revision;
  selectionController?.abort();selectionController=new AbortController();const signal=AbortSignal.any([selectionController.signal,AbortSignal.timeout(180000)]);
  notice(`正在加载 · ${track.name}`);
  try{
    const resolved=await player.resolve(track,signal);if(session!==current||version!==operation)return;
    const result=await request('control',{command:enqueue?'enqueue':'track',revision,track:resolved},current);
    if(session===current&&version===operation){accept(result);notice(enqueue?'已加入房间歌单':'');}
  }catch(error){if(session===current&&version===operation){notice(error.message);if(error.status===409)await poll();}}
}
const chat=createRoomChat({getSession:()=>session,send:async(input,current)=>{const result=await request('message',input,current);if(session===current)accept(result);}});
const ipod=createIPod({notice,getRoom:()=>session?.room,enqueue:track=>select(track,true),remove:trackId=>control('remove',{trackId})});
player=ipod.player;player.connect({select,control,notice,audioBlocked:value=>{$('#enable-audio').hidden=!value;}});sendState();
$('#room-form').onsubmit=event=>{event.preventDefault();enter($('#room-form').dataset.action||'join');};
$('#leave').onclick=()=>{const current=session;reset();history.replaceState(null,'',location.pathname);request('leave',{},current).then(()=>ipod.refreshRooms()).catch(()=>{});notice('已离开房间');};
$('#invite').onclick=async()=>{if(!session)return;const url=new URL(location.href);url.hash=session.room;try{await navigator.clipboard.writeText(url.href);notice('邀请链接已复制');}catch{$('#invite-url').hidden=false;$('#invite-url').value=url.href;$('#invite-url').focus();$('#invite-url').select();}};
$('#enable-audio').onclick=()=>player?.unlock();
function openInvitation(){const code=location.hash.slice(1).toUpperCase();if(!session&&/^[A-F0-9]{8}$/.test(code))ipod.show('join',{code});}
openInvitation();window.addEventListener('hashchange',openInvitation);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)catchUp();});
window.addEventListener('online',()=>{catchUp();if(session&&!streamController)void openStream();});
window.addEventListener('pageshow',()=>{catchUp();if(session&&!streamController)void openStream();});
