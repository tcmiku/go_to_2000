import test from 'node:test';
import assert from 'node:assert/strict';
import { playlistInput, uniqueTracks, groupAlbums, nextQueueIndex } from '../public/music-wall-data.js';
import { createMusicWallService } from '../server/music-wall-service.js';
import { albumAt, dockScale } from '../public/music-wall-canvas.js';

const song=id=>({id,name:`歌曲 ${id}`,ar:[{name:'歌手'}],al:{id:11,name:'专辑',picUrl:'https://p1.music.126.net/album.jpg'},dt:180000});
const response=(tracks,extra={})=>({statusCode:200,body:{code:200,playlist:{name:'我的歌单',tracks,trackIds:tracks.map(({id})=>({id})),trackCount:tracks.length,...extra}}});

test('playlist input accepts IDs, desktop/mobile links and shared text',()=>{
  for(const input of ['3778678','https://music.163.com/playlist?id=3778678','https://music.163.com/#/playlist?id=3778678','https://y.music.163.com/m/playlist?id=3778678&userid=3','分享歌单 https://music.163.com/playlist?id=3778678 (@网易云音乐)'])assert.deepEqual(playlistInput(input),{id:'3778678'});
  assert.deepEqual(playlistInput('https://163cn.tv/abc'),{shortUrl:'https://163cn.tv/abc'});
});
test('playlist input refuses arbitrary URLs, credentials and song links',()=>{
  for(const input of ['',0,'-23','1e4','http://127.0.0.1/playlist?id=1','https://music.163.com.evil.example/playlist?id=1','https://user:pass@music.163.com/playlist?id=1','https://music.163.com:8080/playlist?id=1','https://music.163.com/song?id=1','https://music.163.com/#/playlist?id=-2','file:///playlist?id=1'])assert.throws(()=>playlistInput(input),{status:400},String(input));
});
test('import supplies the same LX metadata as listening-room, and caches successes',async()=>{
  let calls=0;const service=createMusicWallService({request:async url=>{calls++;assert.equal(new URL(url).hostname,'music.163.com');return response([song(1),song(2)]);}});
  const data=await service('42');assert.equal(data.name,'我的歌单');assert.equal(data.total,2);
  assert.deepEqual(data.tracks.map(track=>track.id),['wy:1','wy:2']);assert.equal(data.tracks[0].songmid,1);assert.equal(data.tracks[0].source,'wy');assert.equal(data.tracks[0].duration,180);assert.equal(data.tracks[0].albumId,11);assert.ok(data.tracks[0]._types['128k']);
  await service('https://music.163.com/#/playlist?id=42');assert.equal(calls,1);
});
test('truncated playlist responses fetch missing songs and preserve playlist order',async()=>{
  const calls=[];const service=createMusicWallService({request:async(url,options)=>{
    calls.push(url);
    if(url.includes('/playlist/detail'))return response([song(3)],{trackIds:[{id:1},{id:2},{id:3}],trackCount:3});
    assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.form.c),[{id:'1'},{id:'2'}]);
    return {statusCode:200,body:{code:200,songs:[song(2),song(1)]}};
  }});
  assert.deepEqual((await service('42')).tracks.map(track=>track.songmid),[1,2,3]);assert.equal(calls.length,2);
});
test('private, incomplete, oversized and failed imports never report partial success or enter cache',async()=>{
  for(const result of [{statusCode:403,body:{code:403}},response([song(1)],{trackCount:1001}),response([song(1)],{trackCount:2})]){
    let calls=0;const service=createMusicWallService({request:async()=>{calls++;return result;}});
    await assert.rejects(service('42'));await assert.rejects(service('42'));assert.equal(calls,2);
  }
  const service=createMusicWallService({request:async url=>url.includes('/playlist/detail')?response([],{trackIds:[{id:1}],trackCount:1}):{statusCode:200,body:{code:200,songs:[]}}});
  await assert.rejects(service('42'),{status:502});
});
test('short links resolve only to a NetEase playlist and never trust an arbitrary final URL',async()=>{
  const service=createMusicWallService({request:async url=>url.includes('163cn.tv')?{url:'https://music.163.com/playlist?id=42'}:response([song(1)])});
  assert.equal((await service('https://163cn.tv/abc')).id,'42');
  const unsafe=createMusicWallService({request:async()=>({url:'http://localhost/playlist?id=42'})});
  await assert.rejects(unsafe('https://163cn.tv/abc'),{status:400});
});
test('empty public playlists are valid imports',async()=>{
  const service=createMusicWallService({request:async()=>response([])});assert.deepEqual((await service('42')).tracks,[]);
});
test('album grouping deduplicates tracks without merging unknown albums or losing album order',()=>{
  const first={id:'wy:1',source:'wy',songmid:1,name:'一',albumId:11,albumName:'同一张专辑'};
  const second={...first,id:'wy:2',songmid:2,name:'二',img:'https://example.com/cover.jpg'};
  const local={id:'local:one',source:'local',src:'/data/mp3/one.mp3',name:'本地'};
  const tracks=[first,second,first,local,{...local,id:'local:two',src:'/data/mp3/two.mp3'},null,{id:'bad',name:'坏数据',source:'wy'}];
  assert.equal(uniqueTracks(tracks).length,4);const albums=groupAlbums(tracks);
  assert.equal(albums.length,3);assert.deepEqual(albums[0].tracks.map(track=>track.name),['一','二']);assert.equal(albums[0].img,second.img);
});

test('infinite canvas maps negative and distant coordinates to actual albums',()=>{
  for(const row of [-10000,-20,-1,0,1,30,10000])for(const column of [-10000,-1,0,1,10000]){
    const index=albumAt(column,row,12,67);assert.ok(index>=0&&index<67);assert.equal(Number.isInteger(index),true);
  }
  assert.equal(albumAt(0,0,12,67),0);assert.equal(albumAt(1,0,12,67),1);assert.equal(albumAt(0,0,12,0),0);
});
test('Dock magnification falls off smoothly and honors reduced motion',()=>{
  assert.equal(dockScale(0,200),1.62);assert.ok(dockScale(50,200)>dockScale(100,200));assert.ok(dockScale(100,200)>1);
  assert.equal(dockScale(200,200),1);assert.equal(dockScale(1000,200),1);assert.equal(dockScale(0,200,true),1);
});

test('ordered playback advances to the next item and stops after the last song',()=>{
  assert.equal(nextQueueIndex(3,0,1,{automatic:true}),1);
  assert.equal(nextQueueIndex(3,1,1,{automatic:true}),2);
  assert.equal(nextQueueIndex(3,2,1,{automatic:true}),-1);
  assert.equal(nextQueueIndex(1,0,1,{automatic:true}),-1);
  assert.equal(nextQueueIndex(0,-1,1),-1);
  assert.equal(nextQueueIndex(3,2,1),0);
  assert.equal(nextQueueIndex(3,1,-1),0);
});
test('shuffled playback selects a different song while ordered queues preserve imported order',()=>{
  for(const random of [()=>0,()=>.5,()=>.999])assert.notEqual(nextQueueIndex(4,2,1,{shuffle:true,random}),2);
  const tracks=[3,1,2].map(id=>({id:`wy:${id}`,source:'wy',songmid:id,name:`歌曲${id}`,albumId:id===2?20:10}));
  assert.deepEqual(uniqueTracks(tracks).map(track=>track.songmid),[3,1,2]);
  assert.deepEqual(groupAlbums(tracks).map(album=>album.tracks.length),[2,1]);
});
