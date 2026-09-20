const fail=message=>Object.assign(new Error(message),{status:400});
export function playlistInput(value){
  const text=String(value||'').trim();
  if(!text||text.length>2000)throw fail('歌单链接无效');
  if(/^[1-9]\d{0,19}$/.test(text))return {id:text};
  const match=text.match(/https?:\/\/[^\s<>「」“”]+/i);
  let url;try{url=new URL(match?.[0]||text);}catch{throw fail('歌单链接无效');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port)throw fail('歌单链接无效');
  if(url.hostname==='163cn.tv')return {shortUrl:url.href};
  if(!['music.163.com','y.music.163.com'].includes(url.hostname))throw fail('请输入网易云歌单链接');
  const route=url.hash.startsWith('#/')?new URL(url.hash.slice(1),url.origin):url;
  if(!/(?:^|\/)playlist\/?$/.test(route.pathname))throw fail('请输入歌单链接');
  const id=route.searchParams.get('id');
  if(!/^[1-9]\d{0,19}$/.test(id||''))throw fail('歌单 ID 无效');
  return {id};
}
export function validTrack(track){
  return track&&typeof track.id==='string'&&track.id.length<2000&&typeof track.name==='string'&&track.name.length<500&&
    (track.source==='wy'&&/^[1-9]\d{0,19}$/.test(String(track.songmid))||track.source==='local'&&typeof track.src==='string'&&track.src.startsWith('/data/mp3/'));
}
export function uniqueTracks(tracks){return [...new Map(tracks.filter(validTrack).map(track=>[track.id,track])).values()];}
export function nextQueueIndex(count,index,delta,{automatic=false,shuffle=false,random=Math.random}={}){
  if(!count)return -1;
  if(shuffle&&count>1)return (Math.max(0,index)+1+Math.floor(random()*(count-1)))%count;
  if(automatic&&delta>0&&index>=count-1)return -1;
  return (index+delta+count)%count;
}
export function groupAlbums(tracks){
  const albums=new Map();
  for(const track of uniqueTracks(tracks)){
    const key=track.albumId?`album:${track.albumId}`:track.id;
    if(!albums.has(key))albums.set(key,{id:key,name:track.albumName||track.name,singer:track.singer||'',img:track.img||'',tracks:[]});
    const album=albums.get(key);album.tracks.push(track);if(!album.img&&track.img)album.img=track.img;
  }
  return [...albums.values()];
}
