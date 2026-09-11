import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { defaultMusicSources } from '../public/music-sources.js';

export const sourceCatalog = defaultMusicSources;
const fail = (status, message) => Object.assign(new Error(message), {status});
// Resolve and pin public addresses for every redirect; no connection to local services.
export function isPublicAddress(address) {
  if (address.includes(':')) {
    const value = address.toLowerCase();
    if (value.startsWith('::ffff:')) return isPublicAddress(value.slice(7));
    return /^[23][0-9a-f]{3}:/.test(value) && !value.startsWith('2001:db8:') && !value.startsWith('2002:') && !value.startsWith('2001:0:');
  }
  if (isIP(address) !== 4) return false;
  const [a,b,c] = address.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&(b===168 || b===0 || (b===2))) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19||b===51&&c===100)) || (a===203&&b===0&&c===113));
}
export async function publicRequest(input, options={}, redirects=0) {
  let url;
  try {url = new URL(input);} catch {throw fail(400,'音源地址无效');}
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || (url.port&&!['80','443'].includes(url.port))) throw fail(400,'音源需要使用公开的 HTTP / HTTPS 地址');
  const hostname = url.hostname.replace(/^\[|\]$/g,'');
  const addresses = await lookup(hostname,{all:true,verbatim:true}).catch(()=>{throw fail(502,'音源域名无法连接');});
  if (!addresses.length || addresses.some(item=>!isPublicAddress(item.address))) throw fail(403,'音源不能访问本机或内网地址');
  const address = addresses.find(item=>item.family===4) || addresses[0];
  const method = String(options.method||'GET').toUpperCase();
  if (!['GET','POST','HEAD'].includes(method)) throw fail(400,'音源请求方式不支持');
  const headers = {'User-Agent':'lx-music-desktop/2.0.0','Accept':'application/json, text/plain, */*','Accept-Encoding':'identity'};
  for (const [key,value] of Object.entries(options.headers||{})) {
    if (/^(host|cookie|set-cookie|authorization|proxy-.*|connection|content-length|accept-encoding|transfer-encoding|upgrade|sec-.*)$/i.test(key)) continue;
    if (typeof value==='string' && value.length<4096 && !/[\r\n]/.test(value)) headers[key]=value;
  }
  let body;
  if (options.form) {body=new URLSearchParams(options.form).toString();headers['Content-Type']='application/x-www-form-urlencoded';}
  else if (options.formData) {const boundary=`vinyl-${randomBytes(12).toString('hex')}`;body=Object.entries(options.formData).map(([key,value])=>`--${boundary}\r\nContent-Disposition: form-data; name="${key.replace(/["\r\n]/g,'')}"\r\n\r\n${String(value)}\r\n`).join('')+`--${boundary}--\r\n`;headers['Content-Type']=`multipart/form-data; boundary=${boundary}`;}
  else if (options.body!==undefined) body=typeof options.body==='string'?options.body:JSON.stringify(options.body);
  if (body && Buffer.byteLength(body)>256*1024) throw fail(413,'音源请求内容过大');
  if (body && method==='POST') headers['Content-Length']=Buffer.byteLength(body);
  return new Promise((resolve,reject)=>{
    const req=(url.protocol==='https:'?https:http).request(url,{method,headers,lookup:(_host,lookupOptions,callback)=>lookupOptions.all?callback(null,[address]):callback(null,address.address,address.family)},res=>{
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects>=4) {reject(fail(502,'音源重定向次数过多'));return;}
        const next=new URL(res.headers.location,url);
        // Never forward source keys to another host on a redirect.
        const nextOptions={...options,headers:next.origin===url.origin?options.headers:{}};
        if (res.statusCode===303 || ((res.statusCode===301||res.statusCode===302)&&method==='POST')) {nextOptions.method='GET';delete nextOptions.body;delete nextOptions.form;delete nextOptions.formData;}
        publicRequest(next.href,nextOptions,redirects+1).then(resolve,reject);return;
      }
      const chunks=[];let size=0;
      const maxBytes=Math.min(8*1024*1024,Math.max(1024,Number(options.maxBytes)||2*1024*1024));
      res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy();reject(fail(502,'音源响应过大'));}else chunks.push(chunk);});
      res.on('error',()=>reject(fail(502,'音源连接中断')));
      res.on('end',()=>{const bytes=Buffer.concat(chunks),text=bytes.toString('utf8');let body=text;try {body=JSON.parse(text);}catch {}resolve({statusCode:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).filter(([key])=>key!=='set-cookie')),body,...(options.raw?{bytes,url:url.href}:{})});});
    });
    const timer=setTimeout(()=>req.destroy(fail(504,'音源连接超时，请尝试其他音源')),Math.min(20000,Math.max(1000,Number(options.timeout)||15000)));
    req.on('close',()=>clearTimeout(timer));req.on('error',error=>reject(error.status?error:fail(502,'音源暂时无法连接，请尝试其他音源')));
    req.end(method==='POST'?body:undefined);
  });
}
export function eapiParams(route,data) {
  const text=JSON.stringify(data),digest=createHash('md5').update(`nobody${route}use${text}md5forencrypt`).digest('hex');
  const cipher=createCipheriv('aes-128-ecb','e82ckenh8dichen8',null);
  return Buffer.concat([cipher.update(`${route}-36cd479b6b5-${text}-36cd479b6b5-${digest}`),cipher.final()]).toString('hex').toUpperCase();
}
export function normalizeSearchResult(body) {
  if (body?.code!==200) throw fail(502,'搜索平台暂时不可用，请稍后重试');
  const raw=body.data?.resources ?? body.result?.songs;
  if (!Array.isArray(raw)) throw fail(502,'搜索平台返回了无法识别的数据');
  const tracks=raw.map(entry=>entry.baseInfo?.simpleSongData||entry).filter(item=>item.id&&item.name).map(item=>({
    id:`wy:${item.id}`,source:'wy',songmid:item.id,name:item.name,singer:(item.ar||item.artists||[]).map(artist=>artist.name).join(' / '),
    albumName:(item.al||item.album)?.name||'',albumId:(item.al||item.album)?.id||'',img:(item.al||item.album)?.picUrl||'',
    duration:(item.dt||item.duration||0)/1000,types:[{type:'128k'},{type:'320k'}],_types:{'128k':{},'320k':{}},
  }));
  return {tracks,total:body.data?.totalCount??body.result?.songCount??tracks.length};
}
const lyricText=value=>typeof value==='string'?value.slice(0,128000):'';
const matchText=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu,'');
export function createListeningService({request=publicRequest,readLocalLyrics=async()=>null,getSources=()=>sourceCatalog}={}) {
  const scripts=new Map(),searches=new Map(),lyrics=new Map();let active=0;
  async function searchSongs(query,page=1){
    const key=`${query}:${page}`;
    if(searches.get(key)?.until>Date.now())return searches.get(key).data;
    const route='/api/search/song/list/page';
    const result=await request('https://interface.music.163.com/eapi/batch',{method:'POST',headers:{origin:'https://music.163.com'},form:{params:eapiParams(route,{keyword:query,needCorrect:'1',channel:'typing',offset:24*(page-1),scene:'normal',total:page===1,limit:24})}});
    if(result.statusCode!==200)throw fail(502,'搜索平台暂时不可用，请稍后重试');
    const data={...normalizeSearchResult(result.body),page};
    if(searches.size>=100)searches.delete(searches.keys().next().value);
    searches.set(key,{data,until:Date.now()+60000});return data;
  }
  async function songLyrics(id){
    if(lyrics.get(id)?.until>Date.now())return lyrics.get(id).data;
    const result=await request(`https://music.163.com/api/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1`,{maxBytes:512*1024,timeout:10000});
    if(result.statusCode!==200||result.body?.code!==200)throw fail(502,'歌词暂时不可用');
    const data={lyric:lyricText(result.body.lrc?.lyric),translation:lyricText(result.body.tlyric?.lyric)};
    if(lyrics.size>=100)lyrics.delete(lyrics.keys().next().value);
    lyrics.set(id,{data,until:Date.now()+15*60*1000});return data;
  }
  return async function handle(route,url,input) {
    if (route==='/api/listening/sources') return {sources:getSources().filter(item=>item.enabled!==false).map(({id,name})=>({id,name}))};
    if (active>=6) throw fail(429,'请求较多，请稍后再试');
    active++;
    try {
      if (route==='/api/listening/source') {
        const source=getSources().find(item=>item.enabled!==false&&item.id===url.searchParams.get('id'));
        if (!source) throw fail(400,'请选择列表中的音源');
        const cacheKey=source.id+'\n'+source.url;
        if (scripts.get(cacheKey)?.until>Date.now()) return {...scripts.get(cacheKey).data,...source};
        let result;
        try{result=await request(source.url);}catch(error){
          if(!source.url.startsWith('https://raw.githubusercontent.com/pdone/lx-music-source/main/'))throw error;
        }
        if((!result||result.statusCode!==200)&&source.url.startsWith('https://raw.githubusercontent.com/pdone/lx-music-source/main/')){
          result=await request(source.url.replace('https://raw.githubusercontent.com/pdone/lx-music-source/main/','https://cdn.jsdelivr.net/gh/pdone/lx-music-source@main/'));
        }
        if (result.statusCode!==200 || typeof result.body!=='string' || !/@name\s/.test(result.body)) throw fail(502,'音源脚本暂时无法获取');
        const meta=key=>result.body.match(new RegExp(`@${key}\\s+([^\\r\\n]+)`))?.[1]?.trim()||'';
        const data={...source,script:result.body,version:meta('version'),author:meta('author'),description:meta('description')};
        if(scripts.size>=64)scripts.delete(scripts.keys().next().value);
        scripts.set(cacheKey,{data,until:Date.now()+15*60*1000});return data;
      }
      if (route==='/api/listening/search') {
        const query=(url.searchParams.get('q')||'').trim(),page=Math.max(1,Math.min(100,Number(url.searchParams.get('page'))||1));
        if (!query||query.length>100) throw fail(400,'请输入 1—100 字的歌曲或歌手名称');
        return await searchSongs(query,page);
      }
      if(route==='/api/listening/lyrics'){
        const source=url.searchParams.get('source');
        if(source==='wy'){
          const id=url.searchParams.get('id')||'';
          if(!/^[1-9]\d{0,19}$/.test(id))throw fail(400,'歌曲 ID 无效');
          return await songLyrics(id);
        }
        if(source!=='local')throw fail(400,'不支持的歌词来源');
        const src=url.searchParams.get('src')||'';
        if(!src.startsWith('/data/mp3/')||src.length>2000)throw fail(400,'本地歌曲地址无效');
        const local=await readLocalLyrics(src);
        if(local!==null)return{lyric:lyricText(local),translation:''};
        const name=(url.searchParams.get('name')||'').trim(),singer=(url.searchParams.get('singer')||'').trim(),duration=Number(url.searchParams.get('duration'));
        if(name.length>150||singer.length>150)throw fail(400,'歌曲信息过长');
        // Do not guess an instrumental, cover, live version or an ambiguous filename.
        if(!name||!singer||!Number.isFinite(duration)||duration<=0)return{lyric:'',translation:''};
        const result=await searchSongs(`${name} ${singer}`);
        const match=result.tracks.find(track=>matchText(track.name)===matchText(name)&&track.singer.split(' / ').some(artist=>matchText(artist)===matchText(singer))&&Math.abs(track.duration-duration)<=3);
        return match?await songLyrics(String(match.songmid)):{lyric:'',translation:''};
      }
      if (route==='/api/listening/request') {
        if (!input||typeof input.url!=='string'||input.url.length>8192)throw fail(400,'音源请求无效');
        return await request(input.url,input.options||{});
      }
      throw fail(404,'音乐接口不存在');
    }finally {active--;}
  };
}
