import { escapeHTML as e } from './ui.js';

export function createRoomChat({getSession,send,vote}) {
  const $=s=>document.querySelector(s),log=$('#qq-messages'),input=$('#qq-input');
  let room=null,revision=-1,online=false,sending=false,pending=null,unread=0,minimized=false,powered=true;
  const formatTime=value=>new Date(value).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  function updateControls(){
    const joined=!!getSession();
    input.disabled=!joined||!online;
    $('#qq-send').disabled=!joined||!online||sending||!input.value.trim();
    $('#keyboard-send').disabled=$('#qq-send').disabled;
    $('#qq-send').textContent=sending?'发送中…':'发送(S)';
    $('#qq-counter').textContent=`${input.value.length}/1000`;
    $('#qq-status').textContent=joined?(online?'已连接':'连接中断'):'未加入房间';
    $('#qq-status-led').classList.toggle('online',joined&&online);
  }
  function updateUnread(){
    $('#qq-unread').hidden=!unread;$('#qq-unread').textContent=`${unread} 条新消息`;
    $('#qq-task').classList.toggle('has-unread',unread>0);$('#qq-task').textContent=unread?`QQ · ${unread} 条新消息`:'QQ · 一起听';
  }
  function scrollLatest(){log.scrollTop=log.scrollHeight;unread=0;updateUnread();}
  function openWindow(value=true){minimized=!value;$('#qq-window').hidden=!value;$('#qq-task').setAttribute('aria-pressed',String(value));if(value){scrollLatest();if(!input.disabled)input.focus({preventScroll:true});}}
  function setPower(value){powered=value;$('#retro-computer').classList.toggle('screen-off',!value);$('#monitor-power').setAttribute('aria-pressed',String(value));$('#computer-display').inert=!value;if(value&&!minimized)scrollLatest();}
  function reset(){
    room=null;revision=-1;pending=null;sending=false;online=false;unread=0;input.value='';
    log.innerHTML='<div class="qq-empty"><span class="qq-watermark" aria-hidden="true">QQ</span><span>未加入房间</span></div>';
    $('#qq-room-title').textContent='一起听 · 聊天室';$('#qq-contact-list').replaceChildren();$('#qq-member-count').textContent='0';$('#qq-identity').textContent='离线';$('#qq-song').textContent='—';$('#qq-error').textContent='';$('#qq-emotes').hidden=true;updateControls();updateUnread();
  }
  function render(state){
    const current=getSession();if(!current||state.room!==current.room)return;
    const newRoom=room!==state.room;if(newRoom){reset();room=state.room;}
    online=true;updateControls();
    $('#qq-room-title').textContent=`一起听 · ${state.room}`;
    $('#qq-identity').textContent=state.members.find(member=>member.id===current.memberId)?.name||'在线';
    $('#qq-song').textContent=state.track?`${state.playing?'正在播放':'已暂停'} · ${state.track.name}`:'—';
    $('#qq-member-count').textContent=state.members.length;
    const members=state.members.map(member=>`<li><span class="qq-avatar" aria-hidden="true">${e(member.name.slice(0,1))}</span><span>${e(member.name)}${member.id===current.memberId?' (我)':''}</span><i aria-label="在线"></i></li>`).join('');
    if($('#qq-contact-list').innerHTML!==members)$('#qq-contact-list').innerHTML=members;
    if(revision===(state.chatRevision||0))return;
    const atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<40;
    const messages=state.messages||[],fresh=messages.filter(message=>message.id>revision),previous=revision;
    revision=state.chatRevision||0;
    if(!messages.length){log.innerHTML='<div class="qq-empty"><span class="qq-watermark" aria-hidden="true">QQ</span><span>暂无消息</span></div>';return;}
    log.querySelector('.qq-empty')?.remove();
    const ids=new Set(messages.map(message=>String(message.id)));
    for(const node of log.querySelectorAll('[data-message-id]'))if(!ids.has(node.dataset.messageId))node.remove();
    for(const message of messages){
      if(!message.vote&&log.querySelector(`[data-message-id="${message.id}"]`))continue;
      const row=document.createElement('article');row.className='qq-message'+(message.memberId===current.memberId?' own':'');row.dataset.messageId=String(message.id);
      row.innerHTML=`<header><b>${e(message.name)}</b><time>${e(formatTime(message.sentAt))}</time></header><p>${e(message.body)}</p>`;
      if(message.vote){
        const v=message.vote,yes=Object.values(v.ballots).filter(Boolean).length,no=Object.values(v.ballots).filter(x=>!x).length;
        const disabled=v.status!=='pending'||!v.eligible.includes(current.memberId)||Object.hasOwn(v.ballots,current.memberId);
        row.classList.add('qq-vote');
        row.innerHTML+=`<p>同意 ${yes} · 反对 ${no} · 需 ${v.required} 票同意</p><small>${v.status==='pending'?`30 秒内过半通过 · 截止 ${e(formatTime(v.expiresAt))}`:({approved:'已通过',rejected:'未通过',expired:'已超时'}[v.status])}</small><div class="qq-vote-actions"><button data-vote="${e(v.id)}" data-approve="true" ${disabled?'disabled':''}>同意切歌</button><button data-vote="${e(v.id)}" data-approve="false" ${disabled?'disabled':''}>继续听</button></div>`;
      }
      const old=log.querySelector(`[data-message-id="${message.id}"]`);if(old)old.replaceWith(row);else log.append(row);
    }
    if(newRoom||(atBottom&&!minimized&&powered)){scrollLatest();}
    else if(previous>=0){unread+=fresh.filter(message=>message.memberId!==current.memberId).length;updateUnread();}
  }
  async function submit(){
    const current=getSession(),body=input.value.trim();if(!current||!online||sending||!body)return;
    if(!pending||pending.body!==body||pending.session!==current)pending={body,clientId:crypto.randomUUID(),session:current};
    const attempt=pending;const draft=input.value;sending=true;$('#qq-error').textContent='';updateControls();
    try{
      await send({message:body,clientId:attempt.clientId},current);
      if(getSession()!==current)return;
      if(input.value===draft)input.value='';pending=null;scrollLatest();
    }catch(error){if(getSession()===current)$('#qq-error').textContent=error.status?error.message:'发送失败，请重试';}
    finally{if(getSession()===current){sending=false;updateControls();}}
  }
  $('#qq-form').onsubmit=event=>{event.preventDefault();void submit();};
  log.addEventListener('click',async event=>{const button=event.target.closest('[data-vote]');if(!button||button.disabled||!online)return;button.disabled=true;try{await vote({voteId:button.dataset.vote,approve:button.dataset.approve==='true'});$('#qq-error').textContent='';}catch(error){$('#qq-error').textContent=error.message;button.disabled=false;}});
  $('#keyboard-send').onclick=()=>void submit();
  input.addEventListener('input',updateControls);
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();void submit();}});
  $('#qq-minimize').onclick=$('#qq-close').onclick=$('#qq-close-bottom').onclick=()=>openWindow(false);
  $('#qq-maximize').onclick=()=>{const value=$('#qq-window').classList.toggle('maximized');$('#qq-maximize').setAttribute('aria-pressed',String(value));};
  $('#qq-shortcut').onclick=()=>openWindow();$('#qq-task').onclick=()=>openWindow(minimized);
  $('#monitor-power').onclick=()=>setPower(!powered);
  $('#air-trackpad').onclick=()=>{setPower(true);openWindow();};
  $('#qq-latest').onclick=$('#qq-unread').onclick=scrollLatest;
  log.addEventListener('scroll',()=>{if(log.scrollHeight-log.scrollTop-log.clientHeight<40){unread=0;updateUnread();}});
  $('#qq-font').onclick=()=>{const value=log.classList.toggle('large-text');$('#qq-font').setAttribute('aria-pressed',String(value));};
  $('#qq-emote-toggle').onclick=()=>{const panel=$('#qq-emotes');panel.hidden=!panel.hidden;$('#qq-emote-toggle').setAttribute('aria-expanded',String(!panel.hidden));};
  $('#qq-emotes').onclick=event=>{const button=event.target.closest('[data-emote]');if(!button||input.disabled)return;input.setRangeText(button.dataset.emote,input.selectionStart,input.selectionEnd,'end');input.value=input.value.slice(0,1000);$('#qq-emotes').hidden=true;$('#qq-emote-toggle').setAttribute('aria-expanded','false');input.focus();updateControls();};
  const clock=()=>{$('#computer-clock').textContent=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});};clock();setInterval(clock,30000);
  reset();
  return {render,reset,setConnected(value){online=value;updateControls();}};
}
