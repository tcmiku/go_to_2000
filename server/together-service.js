import { randomBytes } from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
export function createTogetherService({now=Date.now}={}) {
  const rooms=new Map();
  let nextSubscriberId=0;
  function clean(){for(const [id,room] of rooms){for(const [token,member] of room.members)if(now()-member.seen>45000)room.members.delete(token);if(!room.members.size&&now()-room.touched>45000)room.subscribers.clear();if(now()-room.touched>3600000)rooms.delete(id);}}
  function snapshot(room){const serverTime=now();if(room.playing&&room.track&&room.position+(serverTime-room.updatedAt)/1000>=room.track.duration){room.position=room.track.duration;room.playing=false;room.updatedAt=serverTime;room.revision++;}return {room:room.id,revision:room.revision,serverTime,track:room.track,playing:room.playing,position:Math.min(room.track?.duration||Infinity,room.position+(room.playing?(serverTime-room.updatedAt)/1000:0)),members:[...room.members.values()].map(({id,name})=>({id,name}))};}
  function notify(room){if(!room?.subscribers?.size)return;const payload=snapshot(room);for(const [id,emit] of room.subscribers){try{emit(payload);}catch{room.subscribers.delete(id);}}}
  function handle(action,input={},token='') {
    clean();
    if(!input||typeof input!=='object')throw fail(400,'房间请求无效');
    let room;
    if(action==='create'){
      if(rooms.size>=300)throw fail(429,'房间已满，请稍后再试');
      let id;do{id=randomBytes(4).toString('hex').toUpperCase();}while(rooms.has(id));
      room={id,members:new Map(),subscribers:new Map(),track:null,playing:false,position:0,updatedAt:now(),touched:now(),revision:0};rooms.set(id,room);
    }else {room=rooms.get(text(input.room,8).toUpperCase());if(!room)throw fail(404,'房间不存在或已过期，请重新创建');}
    if(action==='create'||action==='join'){
      if(room.members.size>=20)throw fail(409,'房间已满（最多 20 人）');
      const memberToken=randomBytes(24).toString('hex'),id=randomBytes(6).toString('hex');
      room.members.set(memberToken,{id,name:text(input.name,20)||'听友',seen:now()});room.touched=now();
      notify(room);
      return {...snapshot(room),token:memberToken,memberId:id};
    }
    const member=room.members.get(token);if(!member)throw fail(401,'连接已过期，请重新加入房间');
    member.seen=now();room.touched=now();
    if(action==='leave'){room.members.delete(token);notify(room);return {ok:true};}
    if(action==='state')return snapshot(room);
    if(action!=='control')throw fail(404,'房间接口不存在');
    if(input.revision!==room.revision)throw fail(409,'有人刚刚调整了播放，请同步后重试');
    const command=input.command;
    if(command==='track'){
      const track=input.track;
      if(!track||!text(track.name,150)||!['local','wy'].includes(track.source)||!text(track.id,300))throw fail(400,'歌曲信息无效');
      const src=text(track.src,8192);
      if(track.source==='local'){
        if(!/^\/data\/mp3\/[^/]+\.mp3$/i.test(src)||decodeURIComponent(src).includes('..')||decodeURIComponent(src).slice(10).includes('/'))throw fail(400,'本地歌曲地址无效');
      }else {let url;try{url=new URL(src);}catch{throw fail(400,'歌曲地址无效');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw fail(400,'歌曲地址无效');}
      const duration=Number(track.duration);if(!Number.isFinite(duration)||duration<=0||duration>86400)throw fail(400,'歌曲时长无效');
      room.track={id:text(track.id,300),name:text(track.name,150),singer:text(track.singer,150),source:track.source,src,duration,...(track.source==='wy'&&/^[1-9]\d{0,19}$/.test(String(track.songmid))?{songmid:String(track.songmid)}:{})};room.position=0;room.playing=true;
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
    room.subscribers.set(id,emit);
    emit(snapshot(room));
    return function unsubscribe(){room.subscribers.delete(id);};
  };
  return handle;
}
