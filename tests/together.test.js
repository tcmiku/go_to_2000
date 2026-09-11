import test from 'node:test';
import assert from 'node:assert/strict';
import { createTogetherService } from '../server/together-service.js';
import { targetPosition, playbackCorrection } from '../public/together-sync.js';
const track={id:'local:test',source:'local',name:'测试唱片',singer:'测试歌手',src:'/data/mp3/test.mp3',duration:180};
test('open streams keep a room alive across delayed heartbeats and long background periods',()=>{
  const f=fixture();f.control('track',{track});
  const unsubscribe=f.service.subscribe({room:f.first.room},f.first.token,()=>{});
  f.tick(2*24*60*60*1000);
  const lobby=f.service('rooms').rooms;
  assert.equal(lobby.length,1);assert.equal(lobby[0].memberCount,1);
  assert.equal(f.service('state',{room:f.first.room},f.first.token).playlist[0].id,track.id);
  unsubscribe();f.tick(4*60*1000);
  assert.equal(f.service('state',{room:f.first.room},f.first.token).members[0].id,f.first.memberId);
  f.tick(5*60*1000+1);
  assert.throws(()=>f.service('state',{room:f.first.room},f.first.token),{status:401});
  assert.equal(f.service('rooms').rooms[0].memberCount,0);
  const returned=f.service('join',{room:f.first.room,name:'回来的人'});
  assert.equal(returned.playlist[0].id,track.id);
});
test('leaving revokes stream presence and a disconnected room eventually expires',()=>{
  const f=fixture();f.service.subscribe({room:f.first.room},f.first.token,()=>{});
  f.service('leave',{room:f.first.room},f.first.token);
  assert.throws(()=>f.service('state',{room:f.first.room},f.first.token),{status:401});
  f.tick(24*60*60*1000+1);assert.deepEqual(f.service('rooms'),{rooms:[]});
});
test('manual song changes require a majority and broadcast the result without duplicate votes',()=>{
  const f=fixture();f.control('track',{track});f.tick(3000);
  const next={...track,id:'local:next',name:'下一首'};
  const proposed=f.control('track',{track:next}),v=proposed.messages[0].vote;
  assert.equal(proposed.track.id,track.id);assert.equal(proposed.position,3);assert.equal(v.required,2);
  const received=[];f.service.subscribe({room:f.first.room},f.second.token,s=>received.push(s));
  assert.throws(()=>f.control('track',{track:next}),{status:409});
  const input={room:f.first.room,voteId:v.id,approve:true};
  assert.equal(f.service('vote',input,f.first.token).messages[0].vote.status,'pending');
  const result=f.service('vote',input,f.second.token);
  assert.equal(result.track.id,next.id);assert.equal(result.position,0);assert.equal(result.messages[0].vote.status,'approved');
  assert.equal(received.at(-1).track.id,next.id);assert.equal(v.status,'pending');
  assert.throws(()=>f.service('vote',input,f.second.token),{status:409});
});
test('votes reject or expire without switching and cannot be influenced by newcomers or outsiders',()=>{
  const f=fixture();f.control('track',{track});
  let result=f.control('track',{track:{...track,id:'other'}}),v=result.messages[0].vote;
  const late=f.service('join',{room:f.first.room,name:'丙'}),other=f.service('create');
  const input={room:f.first.room,voteId:v.id,approve:true};
  assert.throws(()=>f.service('vote',input,late.token),{status:403});
  assert.throws(()=>f.service('vote',input,other.token),{status:401});
  result=f.service('vote',{...input,approve:false},f.second.token);
  assert.equal(result.messages[0].vote.status,'rejected');assert.equal(result.track.id,track.id);
  result=f.control('track',{track:{...track,id:'third'}});v=result.messages.findLast(m=>m.vote).vote;
  f.tick(30001);result=f.service('state',{room:f.first.room},f.first.token);
  assert.equal(result.messages.findLast(m=>m.vote).vote.status,'expired');assert.equal(result.track.id,track.id);
  assert.throws(()=>f.service('vote',{...input,voteId:v.id},f.second.token),{status:409});
});
test('a solo listener can change songs immediately',()=>{const service=createTogetherService(),member=service('create');service('control',{room:member.room,revision:0,command:'track',track},member.token);const result=service('control',{room:member.room,revision:1,command:'track',track:{...track,id:'second'}},member.token);assert.equal(result.track.id,'second');assert.deepEqual(result.messages,[]);});
test('lobby lists live rooms without member credentials or media URLs',()=>{
  let time=100000;const service=createTogetherService({now:()=>time});
  assert.deepEqual(service('rooms'),{rooms:[]});
  const first=service('create',{name:'甲'}),second=service('create',{name:'乙'});
  service('control',{room:first.room,revision:0,command:'track',track},first.token);
  const rooms=service('rooms').rooms;
  assert.equal(rooms.length,2);
  assert.deepEqual(rooms.find(room=>room.room===first.room),{room:first.room,name:'甲',memberCount:1,playing:true,track:{name:track.name,singer:track.singer}});
  service('leave',{room:second.room},second.token);
  assert.equal(service('rooms').rooms.length,2);
  assert.equal(service('rooms').rooms.find(room=>room.room===second.room).memberCount,0);
  time+=5*60*1000+1;assert.equal(service('rooms').rooms.length,2);
  time+=24*60*60*1000;assert.deepEqual(service('rooms'),{rooms:[]});
});
function fixture(){let time=100000;const service=createTogetherService({now:()=>time});const first=service('create',{name:'甲'});const second=service('join',{room:first.room,name:'乙'});return {service,first,second,tick:delta=>time+=delta,control:(command,extra={})=>service('control',{room:first.room,revision:service('state',{room:first.room},first.token).revision,command,...extra},first.token)};}
test('room playlist is shared, deduplicated and editable without interrupting playback',()=>{
  const f=fixture(),next={...track,id:'local:next',name:'下一首',src:'/data/mp3/next.mp3'};
  const queued=f.control('enqueue',{track});assert.equal(queued.track,null);assert.equal(queued.playlist.length,1);
  f.control('track',{track});f.tick(12000);
  const result=f.control('enqueue',{track:next});assert.equal(result.playlist.length,2);assert.equal(result.track.id,track.id);assert.equal(result.position,12);assert.equal(result.playing,true);
  f.control('enqueue',{track:next});assert.equal(f.service('state',{room:f.first.room},f.second.token).playlist.length,2);
  const joined=f.service('join',{room:f.first.room,name:'丙'});assert.equal(joined.playlist[1].name,'下一首');
  const removed=f.control('remove',{trackId:next.id});assert.equal(removed.playlist.length,1);assert.equal(removed.position,12);assert.equal(removed.playing,true);
  assert.throws(()=>f.control('remove',{trackId:next.id}),{status:404});
  const other=f.service('create',{name:'另一房间'});assert.deepEqual(other.playlist,[]);
  assert.throws(()=>f.service('control',{room:f.first.room,revision:removed.revision,command:'enqueue',track},other.token),{status:401});
});
test('independent listeners share song, elapsed progress, pause, seek and resume',()=>{
  const f=fixture();f.control('track',{track});f.tick(12000);
  let state=f.service('state',{room:f.first.room},f.second.token);assert.equal(state.position,12);assert.equal(state.track.src,track.src);assert.equal(state.members.length,2);assert.equal(state.token,undefined);
  f.control('pause');f.tick(5000);state=f.service('state',{room:f.first.room},f.second.token);assert.equal(state.position,12);assert.equal(state.playing,false);
  f.control('seek',{position:65});f.control('play');f.tick(1000);assert.equal(f.service('state',{room:f.first.room},f.second.token).position,66);
  const late=f.service('join',{room:f.first.room,name:'后来的人'});assert.equal(late.position,66);assert.equal(late.members.length,3);
});
test('stale commands cannot overwrite newer selections and only the creator controls playback',()=>{
  const f=fixture();f.control('track',{track});assert.throws(()=>f.service('control',{room:f.first.room,revision:0,command:'pause'},f.second.token),{status:409});
  for(const command of ['play','pause','stop'])assert.throws(()=>f.service('control',{room:f.first.room,revision:1,command,ownerId:f.second.memberId},f.second.token),{status:403});
  const updated=f.control('pause');assert.equal(updated.playing,false);assert.equal(updated.ownerId,f.first.memberId);
  assert.equal(f.control('play').playing,true);
  assert.equal(f.control('stop').playing,false);
  assert.throws(()=>f.control('seek',{position:Infinity}),{status:400});assert.throws(()=>f.control('seek',{position:181}),{status:400});
});
test('rooms enforce membership, isolation, safe media and expiration',()=>{
  const f=fixture(),other=f.service('create');assert.throws(()=>f.service('state',{room:f.first.room},other.token),{status:401});
  for(const src of ['javascript:alert(1)','/data/mp3/../private.mp3','/data/mp3/%2fprivate.mp3'])assert.throws(()=>f.control('track',{track:{...track,src}}),{status:400});
  f.service('leave',{room:f.first.room},f.second.token);assert.equal(f.service('state',{room:f.first.room},f.first.token).members.length,1);
  f.tick(5*60*1000+1);assert.throws(()=>f.service('state',{room:f.first.room},f.first.token),{status:401});f.tick(24*60*60*1000);assert.throws(()=>f.service('join',{room:f.first.room}),{status:404});
});
test('playback clamps at end and replay starts at zero',()=>{const f=fixture();f.control('track',{track});f.tick(20000);f.control('seek',{position:179});f.tick(2000);assert.equal(f.service('state',{room:f.first.room},f.second.token).position,180);assert.equal(f.control('play').position,0);});
test('finished songs advance to the next queued track without a vote',()=>{
  const f=fixture(),next={...track,id:'local:next',name:'下一首'};
  f.control('track',{track});f.control('enqueue',{track:next});f.tick(181000);
  const state=f.service('state',{room:f.first.room},f.second.token);
  assert.equal(state.track.id,next.id);assert.equal(state.position,0);assert.equal(state.playing,true);
  assert.equal(state.messages.some(message=>message.vote),false);
});
test('a new song selected after playback has ended starts immediately',()=>{
  const f=fixture(),next={...track,id:'local:next',name:'下一首'};
  f.control('track',{track});f.tick(181000);
  const result=f.control('track',{track:next});
  assert.equal(result.track.id,next.id);assert.equal(result.playing,true);assert.equal(result.messages.some(message=>message.vote),false);
});
test('clock compensation and drift correction respect paused and finished tracks',()=>{
  const state={track,position:40,playing:true};assert.equal(targetPosition(state,1200),41.2);assert.equal(targetPosition({...state,playing:false},1200),40);assert.equal(targetPosition(state,200000),180);
  assert.deepEqual(playbackCorrection(30,40),{seek:40,rate:1});assert.deepEqual(playbackCorrection(39.5,40),{seek:null,rate:1.03});assert.deepEqual(playbackCorrection(40.5,40),{seek:null,rate:.97});assert.deepEqual(playbackCorrection(40,40),{seek:null,rate:1});
});


test('mechanical stop is one atomic pause and rewind for every listener',()=>{const f=fixture();f.control('track',{track});f.tick(5000);const stopped=f.control('stop');assert.equal(stopped.position,0);assert.equal(stopped.playing,false);f.tick(1000);assert.equal(f.service('state',{room:f.first.room},f.second.token).position,0);});

test('room subscriptions receive snapshots on control and leave until unsubscribed',()=>{
  const f=fixture();
  const received=[];
  const unsubscribe=f.service.subscribe({room:f.first.room},f.second.token,snapshot=>received.push(snapshot));
  assert.equal(received.length,1);
  assert.equal(received[0].members.length,2);
  f.control('track',{track});
  assert.ok(received.at(-1).track);
  assert.equal(received.at(-1).playing,true);
  f.control('pause');
  assert.equal(received.at(-1).playing,false);
  const beforeLeaving=received.length;
  f.service('leave',{room:f.first.room},f.second.token);
  assert.equal(received.length,beforeLeaving);
  const before=received.length;
  unsubscribe();
  f.control('play');
  assert.equal(received.length,before);
});

test('subscriptions require a live member token and refresh presence via state',()=>{
  const f=fixture();
  assert.throws(()=>f.service.subscribe({room:f.first.room},'bad-token',()=>{}),{status:401});
  assert.throws(()=>f.service.subscribe({room:'ZZZZZZZZ'},f.first.token,()=>{}),{status:404});
  f.service.subscribe({room:f.first.room},f.second.token,()=>{});
  f.tick(4*60*1000);
  f.service('state',{room:f.first.room},f.second.token);
  f.tick(2*60*1000);
  assert.equal(f.service('state',{room:f.first.room},f.second.token).members.length,1);
  assert.throws(()=>f.service('state',{room:f.first.room},f.first.token),{status:401});
});

test('chat uses room identity, reaches listeners and does not alter playback revision',()=>{
  const f=fixture(),received=[];f.control('track',{track});f.tick(3000);
  f.service.subscribe({room:f.first.room},f.second.token,data=>received.push(data));
  const result=f.service('message',{room:f.first.room,clientId:'test-message-0001',message:'  好久不见\n一起听歌  ',name:'冒充乙',memberId:f.second.memberId},f.first.token);
  assert.equal(result.revision,1);assert.equal(result.position,3);assert.equal(result.playing,true);
  assert.deepEqual(result.messages,[{id:1,memberId:f.first.memberId,name:'甲',body:'好久不见\n一起听歌',sentAt:103000,clientId:'test-message-0001'}]);
  assert.deepEqual(received.at(-1).messages,result.messages);
  const late=f.service('join',{room:f.first.room,name:'丙'});assert.deepEqual(late.messages,result.messages);
  const duplicate=f.service('message',{room:f.first.room,clientId:'test-message-0001',message:'重复请求'},f.first.token);
  assert.equal(duplicate.messages.length,1);assert.equal(duplicate.chatRevision,1);
  assert.equal(f.control('pause').revision,2);
});

test('chat rejects outsiders, left listeners, invalid content and rapid sends',()=>{
  const f=fixture(),other=f.service('create',{name:'其他房间'});
  const input={room:f.first.room,clientId:'test-message-0002',message:'你好'};
  assert.throws(()=>f.service('message',input,other.token),{status:401});
  assert.throws(()=>f.service('state',{room:f.first.room},other.token),{status:401});
  for(const message of ['', '   ', 'a'.repeat(1001), null, {}])assert.throws(()=>f.service('message',{...input,message},f.first.token),{status:400});
  assert.throws(()=>f.service('message',{...input,clientId:'bad'},f.first.token),{status:400});
  f.service('message',input,f.first.token);
  assert.throws(()=>f.service('message',{...input,clientId:'test-message-0003'},f.first.token),{status:429});
  const received=[];f.service.subscribe({room:f.first.room},f.second.token,data=>received.push(data));
  f.service('leave',{room:f.first.room},f.second.token);f.tick(500);
  f.service('message',{...input,clientId:'test-message-0003'},f.first.token);
  assert.equal(received.length,1);
  assert.throws(()=>f.service('message',input,f.second.token),{status:401});
  assert.deepEqual(f.service('state',{room:other.room},other.token).messages,[]);
  assert.equal(f.service('rooms').rooms.some(room=>Object.hasOwn(room,'messages')),false);
});

test('chat retains only the latest 100 messages in order',()=>{
  const f=fixture();
  for(let index=1;index<=105;index++){f.tick(500);f.service('message',{room:f.first.room,clientId:`test-message-${String(index).padStart(4,'0')}`,message:`消息 ${index}`},f.first.token);}
  const state=f.service('state',{room:f.first.room},f.first.token);
  assert.equal(state.messages.length,100);assert.equal(state.messages[0].id,6);assert.equal(state.messages.at(-1).id,105);assert.equal(state.chatRevision,105);assert.equal(state.revision,0);
});
