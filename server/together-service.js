import { randomBytes } from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
export function createTogetherService({now=Date.now}={}) {
  const rooms=new Map();
  let nextSubscriberId=0;
  function system(room,body,vote){room.messages.push({id:++room.chatRevision,memberId:'system',name:'房间通知',body,sentAt:now(),...(vote?{vote}: {})});if(room.messages.length>100)room.messages.shift();}
  function finishVote(room,status){
    const vote=room.vote;if(!vote||vote.status!=='pending')return;
    vote.status=status;room.chatRevision++;
    if(status==='approved'){room.track=vote.track;room.position=0;room.playing=true;room.updatedAt=now();room.revision++;}
    system(room,status==='approved'?`投票通过，正在播放《${vote.track.name}》`:status==='rejected'?'切歌投票未通过，继续当前歌曲。':'切歌投票已超时，继续当前歌曲。');
  }
  function settleVote(room){const v=room.vote;if(v?.status!=='pending')return;if(now()>=v.expiresAt){finishVote(room,'expired');return;}const yes=Object.values(v.ballots).filter(Boolean).length,no=Object.values(v.ballots).filter(x=>!x).length;if(yes>=v.required)finishVote(room,'approved');else if(no>v.eligible.length-v.required)finishVote(room,'rejected');}
  function advanceIfFinished(room,at=now()){
    if(!room.playing||!room.track)return false;
    const position=room.position+(at-room.updatedAt)/1000;
    if(position<room.track.duration)return false;
    const index=room.playlist.findIndex(item=>item.id===room.track.id),next=index>=0?room.playlist[index+1]:room.playlist[0];
    if(next){room.track=next;room.position=0;room.playing=true;}
    else {room.position=room.track.duration;room.playing=false;}
    if(room.vote?.status==='pending'){room.vote.status='expired';room.chatRevision++;}
    room.updatedAt=at;room.revision++;
    return true;
  }
  function clean(){
    const time=now();
    for(const [id,room] of rooms){
      const connected=new Set([...room.subscribers.values()].map(subscriber=>subscriber.token));
      for(const [token,member] of room.members){
        if(connected.has(token)){member.seen=time;room.touched=time;}
        else if(time-member.seen>5*60*1000)room.members.delete(token);
      }
      if(!room.members.size&&time-room.touched>24*60*60*1000)rooms.delete(id);
    }
  }
  function snapshot(room){settleVote(room);const serverTime=now();advanceIfFinished(room,serverTime);return {room:room.id,ownerId:room.ownerId,revision:room.revision,serverTime,track:room.track,playing:room.playing,position:Math.min(room.track?.duration||Infinity,room.position+(room.playing?(serverTime-room.updatedAt)/1000:0)),members:[...room.members.values()].map(({id,name})=>({id,name})),playlist:room.playlist.slice(),chatRevision:room.chatRevision,messages:structuredClone(room.messages)};}
  function notify(room){if(!room?.subscribers?.size)return;const payload=snapshot(room);for(const [id,subscriber] of room.subscribers){if(!room.members.has(subscriber.token)){room.subscribers.delete(id);continue;}try{subscriber.emit(payload);}catch{room.subscribers.delete(id);}}}
  function handle(action,input={},token='') {
    clean();
    if(!input||typeof input!=='object')throw fail(400,'房间请求无效');
    if(action==='rooms')return {rooms:[...rooms.values()].sort((a,b)=>b.touched-a.touched).map(room=>{
      const current=snapshot(room);
      return {room:room.id,name:room.name,memberCount:room.members.size,playing:current.playing,track:current.track?{name:current.track.name,singer:current.track.singer}:null};
    })};
    let room;
    if(action==='create'){
      if(rooms.size>=300)throw fail(429,'房间已满，请稍后再试');
      let id;do{id=randomBytes(4).toString('hex').toUpperCase();}while(rooms.has(id));
      room={id,name:text(input.name,20)||'听友',members:new Map(),subscribers:new Map(),track:null,playing:false,position:0,updatedAt:now(),touched:now(),revision:0,playlist:[],chatRevision:0,messages:[]};rooms.set(id,room);
    }else {room=rooms.get(text(input.room,8).toUpperCase());if(!room)throw fail(404,'房间不存在或已过期，请重新创建');}
    if(action==='create'||action==='join'){
      if(room.members.size>=20)throw fail(409,'房间已满（最多 20 人）');
      const memberToken=randomBytes(24).toString('hex'),id=randomBytes(6).toString('hex');
      if(action==='create')room.ownerId=id;
      room.members.set(memberToken,{id,name:text(input.name,20)||'听友',seen:now()});room.touched=now();
      notify(room);
      return {...snapshot(room),token:memberToken,memberId:id};
    }
    const member=room.members.get(token);if(!member)throw fail(401,'连接已过期，请重新加入房间');
    member.seen=now();room.touched=now();
    if(action==='leave'){room.members.delete(token);for(const [id,subscriber] of room.subscribers)if(subscriber.token===token)room.subscribers.delete(id);notify(room);return {ok:true};}
    if(action==='state')return snapshot(room);
    settleVote(room);
    if(action==='vote'){
      const vote=room.vote;
      if(!vote||vote.id!==input.voteId||vote.status!=='pending')throw fail(409,'投票已结束，请同步聊天室');
      if(!vote.eligible.includes(member.id))throw fail(403,'仅发起投票时在房间的成员可参与');
      if(typeof input.approve!=='boolean')throw fail(400,'请选择同意或反对');
      if(Object.hasOwn(vote.ballots,member.id))return snapshot(room);
      vote.ballots[member.id]=input.approve;room.chatRevision++;settleVote(room);notify(room);return snapshot(room);
    }
    if(action==='message'){
      if(typeof input.message!=='string'||!input.message.trim()||input.message.length>1000)throw fail(400,'消息须为 1—1000 字');
      if(typeof input.clientId!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(input.clientId))throw fail(400,'消息标识无效');
      if(room.messages.some(message=>message.memberId===member.id&&message.clientId===input.clientId))return snapshot(room);
      if(member.lastMessageAt!==undefined&&now()-member.lastMessageAt<500)throw fail(429,'发送太快，请稍后重试');
      member.lastMessageAt=now();
      room.messages.push({id:++room.chatRevision,memberId:member.id,name:member.name,body:input.message.trim(),sentAt:now(),clientId:input.clientId});
      if(room.messages.length>100)room.messages.shift();
      notify(room);return snapshot(room);
    }
    if(action!=='control')throw fail(404,'房间接口不存在');
    if(input.revision!==room.revision)throw fail(409,'有人刚刚调整了播放，请同步后重试');
    const command=input.command;
    if(['play','pause','stop'].includes(command)&&member.id!==room.ownerId)throw fail(403,'只有房间创建者可以控制播放和暂停');
    if(command==='track'||command==='enqueue'){
      const track=input.track;
      if(!track||!text(track.name,150)||!['local','wy'].includes(track.source)||!text(track.id,300))throw fail(400,'歌曲信息无效');
      const src=text(track.src,8192);
      if(track.source==='local'){
        if(!/^\/data\/mp3\/[^/]+\.mp3$/i.test(src)||decodeURIComponent(src).includes('..')||decodeURIComponent(src).slice(10).includes('/'))throw fail(400,'本地歌曲地址无效');
      }else {let url;try{url=new URL(src);}catch{throw fail(400,'歌曲地址无效');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw fail(400,'歌曲地址无效');}
      const duration=Number(track.duration);if(!Number.isFinite(duration)||duration<=0||duration>86400)throw fail(400,'歌曲时长无效');
      const normalized={id:text(track.id,300),name:text(track.name,150),singer:text(track.singer,150),source:track.source,src,duration,...(track.source==='wy'&&/^[1-9]\d{0,19}$/.test(String(track.songmid))?{songmid:String(track.songmid)}:{})};
      const index=room.playlist.findIndex(item=>item.id===normalized.id);
      if(command==='track'&&room.vote?.status==='pending')throw fail(409,'已有切歌投票，请先在聊天室投票');
      if(index<0&&room.playlist.length>=100)throw fail(409,'房间歌单已满（100 首）');
      if(index<0)room.playlist.push(normalized);else room.playlist[index]=normalized;
      if(command==='track'&&room.track&&room.playing&&room.members.size>1){
        const eligible=[...room.members.values()].map(item=>item.id);
        room.vote={id:randomBytes(12).toString('hex'),track:normalized,eligible,required:Math.floor(eligible.length/2)+1,ballots:{[member.id]:true},expiresAt:now()+30000,status:'pending'};
        system(room,`${member.name} 提议切换到《${normalized.name}》`,room.vote);
        notify(room);return snapshot(room);
      }
      if(command==='track'){room.track=normalized;room.position=0;room.playing=true;}
      else if(room.playing)room.position=Math.min(room.track.duration,room.position+(now()-room.updatedAt)/1000);
    }else if(command==='advance'){
      if(!advanceIfFinished(room))return snapshot(room);
      const result=snapshot(room);notify(room);return result;
    }else if(command==='remove'){
      const index=room.playlist.findIndex(item=>item.id===input.trackId);
      if(index<0)throw fail(404,'歌曲不在房间歌单中');
      room.playlist.splice(index,1);
      if(room.playing)room.position=Math.min(room.track.duration,room.position+(now()-room.updatedAt)/1000);
    }else {
      if(!room.track)throw fail(400,'请先点一首歌');
      const position=Math.min(room.track.duration,room.position+(room.playing?(now()-room.updatedAt)/1000:0));
      if(command==='play'){room.position=position>=room.track.duration?0:position;room.playing=true;}
      else if(command==='stop'){room.position=0;room.playing=false;}
      else if(command==='pause'){room.position=position;room.playing=false;}
      else if(command==='seek'){if(typeof input.position!=='number'||!Number.isFinite(input.position)||input.position<0||input.position>room.track.duration)throw fail(400,'播放进度无效');room.position=input.position;}
      else throw fail(400,'播放操作无效');
    }
    room.updatedAt=now();room.revision++;
    const result=snapshot(room);
    notify(room);
    return result;
  }
  handle.subscribe=function subscribe(input={},token='',emit){
    if(typeof emit!=='function')throw fail(400,'房间订阅无效');
    clean();
    if(!input||typeof input!=='object')throw fail(400,'房间请求无效');
    const room=rooms.get(text(input.room,8).toUpperCase());
    if(!room)throw fail(404,'房间不存在或已过期，请重新创建');
    const member=room.members.get(token);
    if(!member)throw fail(401,'连接已过期，请重新加入房间');
    member.seen=now();room.touched=now();
    const id=++nextSubscriberId;
    room.subscribers.set(id,{token,emit});
    emit(snapshot(room));
    return function unsubscribe(){if(room.subscribers.delete(id)&&room.members.has(token)){room.members.get(token).seen=now();room.touched=now();}};
  };
  return handle;
}
