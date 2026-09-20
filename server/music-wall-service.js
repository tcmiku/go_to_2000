import { publicRequest, normalizeSearchResult } from './listening-service.js';
import { playlistInput } from '../public/music-wall-data.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createMusicWallService({request=publicRequest}={}){
  const cache=new Map();let active=0;
  return async function playlist(input){
    let parsed=playlistInput(input);
    if(active>=3)throw fail(429,'导入繁忙，请稍后重试');
    active++;
    try{
      if(parsed.shortUrl){
        const result=await request(parsed.shortUrl,{raw:true,maxBytes:512*1024,timeout:10000});
        parsed=playlistInput(result.url);
        if(!parsed.id)throw fail(400,'短链接无法解析');
      }
      const {id}=parsed;
      if(cache.get(id)?.until>Date.now())return cache.get(id).data;
      const response=await request(`https://music.163.com/api/v6/playlist/detail?id=${id}&n=1000&s=0`,{maxBytes:8*1024*1024});
      const list=response.body?.playlist;
      if(response.statusCode!==200||response.body?.code!==200||!list||!Array.isArray(list.tracks))throw fail(502,'歌单无法读取，请检查是否公开');
      if(Math.max(list.trackCount||0,list.trackIds?.length||0,list.tracks.length)>1000)throw fail(413,'歌单最多支持 1000 首');
      const ids=Array.isArray(list.trackIds)?[...new Set(list.trackIds.map(item=>String(item.id)))]:list.tracks.map(item=>String(item.id));
      if(ids.some(songId=>!/^\d{1,20}$/.test(songId)))throw fail(502,'歌单数据无效');
      const songs=new Map(list.tracks.map(song=>[String(song.id),song]));
      const missing=ids.filter(songId=>!songs.has(songId));
      for(let offset=0;offset<missing.length;offset+=100){
        const batch=missing.slice(offset,offset+100);
        const details=await request('https://music.163.com/api/v3/song/detail',{method:'POST',form:{c:JSON.stringify(batch.map(songId=>({id:songId})))},maxBytes:2*1024*1024});
        if(details.statusCode!==200||details.body?.code!==200||!Array.isArray(details.body.songs))throw fail(502,'歌单加载中断，请重试');
        for(const song of details.body.songs)songs.set(String(song.id),song);
      }
      const ordered=ids.map(songId=>songs.get(songId)).filter(Boolean);
      const tracks=normalizeSearchResult({code:200,result:{songs:ordered}}).tracks;
      if(tracks.length<ids.length||tracks.length<(list.trackCount||0))throw fail(502,'歌单包含无法读取的曲目');
      const data={id,name:String(list.name||'歌单'),cover:list.coverImgUrl||'',tracks,total:tracks.length};
      if(cache.size>=20)cache.delete(cache.keys().next().value);
      cache.set(id,{data,until:Date.now()+5*60*1000});return data;
    }finally{active--;}
  };
}
