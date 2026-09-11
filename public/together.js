import { escapeHTML as e, readStorage, saveStorage } from './ui.js';
import { targetPosition } from './together-sync.js';
const $=s=>document.querySelector(s),frame=$('#shared-player');
let player=null,session=null,state=null,anchor=0,pollTimer,connected=false,operation=0,selectionController=null;
let streamController=null,streamRetryTimer=null,streamDelay=500,streamHealthy=false;
const notice=message=>$('#notice').textContent=message;
function sendState(){
  if(!player)return;
  if(state&&connected)void player.setState({...state,position:targetPosition(state,performance.now()-anchor)});
  else player.setConnected(false);
}
function connection(ok,label){connected=ok;$('#connection-led').classList.toggle('online',ok);$('#connection').textContent=label;if(!ok)player?.setConnected(false);}
async function request(action,input={},credentials=session){
  const start=performance.now(),isRead=action==='state';
  const response=await fetch(`/api/together/${action}${isRead?'?room='+encodeURIComponent(credentials.room):''}`,{method:isRead?'GET':'POST',headers:{'Content-Type':'application/json',...(credentials?{'X-Room-Token':credentials.token}:{})},body:isRead?undefined:JSON.stringify({...input,...(credentials?{room:credentials.room}:{})}),signal:AbortSignal.timeout(10000)});
  const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||'房间连接失败'),{status:response.status});
  return {data,lag:(performance.now()-start)/2};
}
function accept({data,lag}){
  if(!session||data.room!==session.room||state&&(data.revision<state.revision||data.serverTime<state.serverTime))return;
  state=data;anchor=performance.now()-(lag||0);
  $('#members').innerHTML=data.members.map(member=>`<span class="member">● ${e(member.name)}${member.id===session.memberId?' · 我':''}</span>`).join('');
  connection(true,`${data.members.length} 人已入座`);
  $('#shared-title').textContent=data.track?.name||'等你放上一张唱片';
  $('#shared-status').textContent=data.track?`${data.track.singer||'共享唱片'} · ${data.playing?'同频播放中':data.position>=data.track.duration?'唱片已播完':'全房间已暂停'}`:'翻开唱片目录，点一首给大家听。';
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
  if(session)return;const code=$('#room-code').value.trim().toUpperCase();if(action==='join'&&!/^[A-F0-9]{8}$/.test(code)){notice('请输入有效的 8 位房间码。');return;}
  for(const button of $('#room-form').querySelectorAll('button'))button.disabled=true;
  try{
    const result=await request(action,{room:code,name:$('#nickname').value.trim()},null);
    session={room:result.data.room,token:result.data.token,memberId:result.data.memberId};state=null;saveStorage('slow-together.name',$('#nickname').value.trim());
    $('#room-form').hidden=true;$('#room-info').hidden=false;$('#active-code').textContent=session.room;$('#room-code').value=session.room;history.replaceState(null,'','#'+session.room);
    accept(result);notice('已入座。翻开唱片目录或从唱片墙选歌，邀请朋友一起听。');
    clearTimeout(pollTimer);pollTimer=setTimeout(poll,1000);
    void openStream();
  }catch(error){notice(error.message);}finally{for(const button of $('#room-form').querySelectorAll('button'))button.disabled=false;}
}
function reset(){operation++;selectionController?.abort();stopStream();session=null;state=null;clearTimeout(pollTimer);player?.reset();$('#enable-audio').hidden=true;$('#room-info').hidden=true;$('#room-form').hidden=false;$('#shared-title').textContent='等你放上一张唱片';$('#shared-status').textContent='创建房间，让音乐把我们连在一起。';connection(false,'尚未入座');}
let controlQueue=Promise.resolve();
function control(command,extra={}){
  operation++;selectionController?.abort();const current=session;
  controlQueue=controlQueue.then(async()=>{
    if(session!==current||!session||!connected)return;
    try{const result=await request('control',{command,revision:state.revision,...extra},current);if(session===current)accept(result);}
    catch(error){if(session===current){notice(error.message);await poll();}}
  });return controlQueue;
}
async function select(track){
  if(!session||!connected||!player){notice('请先创建或加入房间。');return;}
  const current=session,version=++operation,revision=state.revision;
  selectionController?.abort();selectionController=new AbortController();const signal=AbortSignal.any([selectionController.signal,AbortSignal.timeout(180000)]);
  notice(`正在读取《${track.name}》，准备好后为全房间换碟…`);
  try{
    const resolved=await player.resolve(track,signal);if(session!==current||version!==operation)return;
    const result=await request('control',{command:'track',revision,track:resolved},current);
    if(session===current&&version===operation){accept(result);notice(`已为房间放上《${track.name}》。`);}
  }catch(error){if(session===current&&version===operation){notice(error.message);if(error.status===409)await poll();}}
}
function attachPlayer(){
  player=frame.contentWindow.sharedListeningPlayer;
  if(!player){notice('唱片机暂时未能加载，请刷新页面重试。');return;}
  player.connect({select,control,notice,audioBlocked:value=>{$('#enable-audio').hidden=!value;}});sendState();
}
frame.addEventListener('load',attachPlayer);
if(frame.contentWindow?.sharedListeningPlayer)attachPlayer();
$('#create-room').onclick=()=>enter('create');$('#room-form').onsubmit=event=>{event.preventDefault();enter('join');};
$('#leave').onclick=()=>{const current=session;reset();history.replaceState(null,'',location.pathname);request('leave',{},current).catch(()=>{});notice('已离开房间，其他听友可以继续聆听。');};
$('#invite').onclick=async()=>{const url=new URL(location.href);url.hash=session.room;try{await navigator.clipboard.writeText(url.href);notice('邀请链接已复制，发给朋友即可加入。');}catch{notice('复制此邀请链接：'+url.href);}};
$('#enable-audio').onclick=()=>player?.unlock();
$('#nickname').value=readStorage('slow-together.name','')||'';
const roomCode=location.hash.slice(1).toUpperCase();if(/^[A-F0-9]{8}$/.test(roomCode)){$('#room-code').value=roomCode;notice('朋友给你留了个位置。填好称呼，点击加入。');}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)catchUp();});
window.addEventListener('online',()=>{catchUp();if(session&&!streamController)void openStream();});
window.addEventListener('pageshow',()=>{catchUp();if(session&&!streamController)void openStream();});
