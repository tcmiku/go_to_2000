import { publicRequest } from './listening-service.js';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const DEFAULT_ID='xyz:5e280fac418a84a0461fb129';
const plain=value=>String(value||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&(amp|lt|gt|quot|apos);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[key]).trim();
function mediaUrl(value){try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:'';}catch{return '';}}
export function parsePodcastPage(html){
  const match=String(html).match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  let podcast;try{podcast=JSON.parse(match?.[1]).props.pageProps.podcast;}catch{throw fail(502,'暂时读不到这张磁带');}
  if(!podcast?.pid||!podcast.title||!Array.isArray(podcast.episodes))throw fail(502,'节目目录格式已变化');
  const episodes=podcast.episodes.map(e=>({id:e.eid,title:e.title,duration:Number(e.duration)||0,date:e.pubDate||'',audio:e.isPrivateMedia||e.media?.source?.mode&&e.media.source.mode!=='PUBLIC'?'':mediaUrl(e.enclosure?.url||e.media?.source?.url)})).filter(e=>e.id&&e.title&&e.audio);
  return {id:`xyz:${podcast.pid}`,title:podcast.title,author:podcast.author||'',total:podcast.episodeCount||episodes.length,episodes,source:`https://www.xiaoyuzhoufm.com/podcast/${podcast.pid}`};
}
export function parseFeed(xml){
  if(typeof xml!=='string'||!/<rss[\s>]/i.test(xml))throw fail(502,'这张磁带的目录暂时无法读取');
  const tag=(text,name)=>plain(text.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]);
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(([,item])=>{
    const enclosure=item.match(/<enclosure\b[^>]*\burl\s*=\s*["']([^"']+)["']/i)?.[1];
    const duration=tag(item,'itunes:duration').split(':').reduce((n,part)=>n*60+(Number(part)||0),0);
    return {id:tag(item,'guid')||enclosure,title:tag(item,'title'),audio:mediaUrl(plain(enclosure)),duration,date:tag(item,'pubDate')};
  }).filter(e=>e.id&&e.title&&e.audio);
}
export function createPodcastService({request=publicRequest}={}){
  const cache=new Map(),pending=new Map();let active=0;
  async function cached(key,fn){
    if(cache.get(key)?.until>Date.now())return cache.get(key).value;
    if(pending.has(key))return pending.get(key);
    if(active>=5)throw fail(429,'请稍后再试');
    const task=(async()=>{active++;try{const value=await fn();if(cache.size>=80)cache.delete(cache.keys().next().value);cache.set(key,{value,until:Date.now()+10*60*1000});return value;}finally{active--;pending.delete(key);}})();
    pending.set(key,task);return task;
  }
  async function get(url,options={}){const r=await request(url,{headers:{'User-Agent':'Mozilla/5.0'},...options});if(r.statusCode!==200)throw fail(502,'节目暂时连接不上，请重试');return r.body;}
  async function apple(id,withEpisodes=true){
    const data=await get(`https://itunes.apple.com/lookup?id=${id}&country=cn${withEpisodes?'&entity=podcastEpisode&limit=200':''}`);
    const p=data?.results?.find(p=>p.kind==='podcast');if(!p)throw fail(404,'没有找到这张磁带');
    return {id:`apple:${p.collectionId}`,title:p.collectionName,author:p.artistName||'',source:p.collectionViewUrl,feed:p.feedUrl,total:p.trackCount||0,episodes:(data.results||[]).filter(e=>e.kind==='podcast-episode').map(e=>({id:e.episodeGuid||String(e.trackId),title:e.trackName,audio:mediaUrl(e.episodeUrl),duration:(Number(e.trackTimeMillis)||0)/1000,date:e.releaseDate||''})).filter(e=>e.audio)};
  }
  async function podcast(id){
    if(!/^(xyz:[a-f\d]{24}|apple:\d{1,16})$/.test(id))throw fail(400,'磁带编号无效');
    return cached(id,async()=>{
      const p=id.startsWith('xyz:')?parsePodcastPage(await get(`https://www.xiaoyuzhoufm.com/podcast/${id.slice(4)}`)):await apple(id.slice(6));
      return p;
    });
  }
  return async function handle(route,url){
    if(route==='/api/podcasts/podcast')return podcast(url.searchParams.get('id')||DEFAULT_ID);
    if(route==='/api/podcasts/archive'){
      const id=url.searchParams.get('id')||DEFAULT_ID;
      // Resolve feeds only from the public directory, never from a client-provided URL.
      const p=await podcast(id);
      return cached(`archive:${id}`,async()=>{
        let feed=p.feed;
        if(id===DEFAULT_ID)feed=(await apple('1433530822',false)).feed;
        if(!feed)return {...p,complete:false};
        const episodes=parseFeed(await get(feed,{maxBytes:8*1024*1024}));
        const combined=new Map(p.episodes.map(e=>[e.id,e]));for(const e of episodes)if(!combined.has(e.id))combined.set(e.id,e);
        return {...p,episodes:[...combined.values()].sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0)),complete:true};
      });
    }
    if(route==='/api/podcasts/search'){
      const query=(url.searchParams.get('q')||'').trim();if(!query||query.length>300)throw fail(400,'输入播客名称或小宇宙链接');
      if(/^https?:\/\//i.test(query)){
        let u;try{u=new URL(query);}catch{throw fail(400,'链接无效');}
        const match=u.pathname.match(/^\/podcast\/([a-f\d]{24})\/?$/);
        if(u.hostname!=='www.xiaoyuzhoufm.com'&&u.hostname!=='xiaoyuzhoufm.com'||!match)throw fail(400,'请使用小宇宙播客主页链接');
        const p=await podcast(`xyz:${match[1]}`);return {podcasts:[{id:p.id,title:p.title,author:p.author,total:p.total}]};
      }
      return cached(`search:${query}`,async()=>{
        const body=await get(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&entity=podcast&country=cn&limit=16`);
        if(!Array.isArray(body?.results))throw fail(502,'搜索暂时不可用');
        return {podcasts:body.results.filter(p=>p.kind==='podcast').map(p=>({id:p.collectionId===1433530822?DEFAULT_ID:`apple:${p.collectionId}`,title:p.collectionName,author:p.artistName||'',total:p.trackCount||0}))};
      });
    }
    throw fail(404,'没有这个节目接口');
  };
}
