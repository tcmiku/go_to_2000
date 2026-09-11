import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, validateStore } from '../server/server.js';

const fixture=()=>({version:1,source:{name:'Original source',url:'https://example.com'},categories:[{id:'tools',name:'工具',sites:[{id:'one',name:'工具一',url:'https://one.example.com',description:'原始说明'}],children:[{id:'books',name:'书籍',sites:[{id:'two',name:'书籍二',url:'https://two.example.com',description:'电子书'}]}]}]});
async function instance(t,options={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'surfer-test-'));
  await writeFile(path.join(dir,'navigation.json'),JSON.stringify(fixture()));
  await writeFile(path.join(dir,'page-content.json'),JSON.stringify({hot:{title:'推荐',siteIds:['one']},featured:{title:'精选',items:[{name:'精选',url:'https://featured.example.com',description:'精选介绍'}]},friends:[{name:'朋友',url:'https://friend.example.com'}]}));
  if(options.withAudio){await mkdir(path.join(dir,'mp3'));await writeFile(path.join(dir,'mp3','sample-track.mp3'),Buffer.from('ID3 test'));await writeFile(path.join(dir,'mp3','ignore.txt'),'ignore');}
  let server=await createApp({dataDir:dir,adminEnabled:true,...options});
  const listen=async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return`http://127.0.0.1:${server.address().port}`;};
  let base=await listen();let cookie='';
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  return {dir,get base(){return base;},get cookie(){return cookie;},async restart(){await new Promise(resolve=>server.close(resolve));server=await createApp({dataDir:dir,adminEnabled:true,...options});base=await listen();},async req(route,method='GET',body,headers={}){
    const res=await fetch(base+route,{method,headers:{'Content-Type':'application/json',Cookie:cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)});
    if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    return{status:res.status,data:await res.json(),headers:res.headers};
  }};
}
const credentials={username:'site-owner',password:'test-only-password-2026'};

test('newsstand exposes source definitions and validates method, source and public network boundary',async t=>{
  const app=await instance(t,{adminEnabled:false});
  const catalog=await app.req('/api/newsstand/sources');assert.equal(catalog.status,200);assert.ok(catalog.data.sources.length>2000);assert.ok(catalog.data.catalog.upstreamCount>=3907);assert.equal(catalog.data.sources.find(source=>source.id==='hongxiu').searchable,true);
  assert.equal((await app.req('/api/newsstand/search')).status,405);
  assert.equal((await app.req('/api/newsstand/search','POST',{sourceId:'missing',query:'书'})).status,404);
  assert.equal((await app.req('/api/newsstand/book','POST',{sourceId:'hongxiu',bookUrl:'http://127.0.0.1/private'})).status,403);
  assert.equal((await app.req('/api/newsstand/search','POST',{sourceId:'hongxiu',query:'书'},{Origin:'https://evil.example'})).status,403);
  assert.equal((await app.req('/api/newsstand/search-all','POST',{query:''})).status,400);
  assert.equal((await app.req('/api/newsstand/search-all','POST',{query:'书'},{Origin:'https://evil.example'})).status,403);
  const imported=catalog.data.sources.find(source=>source.id.startsWith('lg-'));
  const definition=await app.req(`/api/newsstand/source/${imported.id}`);assert.equal(definition.status,200);assert.equal(definition.data[0].bookSourceName,imported.name);
  const html=await fetch(app.base+'/newsstand').then(response=>response.text());assert.match(html,/我的书架/);assert.match(html,/chapter-content/);assert.doesNotMatch(html,/id="read-source"/);
});
test('visit totals persist, count concurrent visits and keep reads uncounted',async t=>{
  const app=await instance(t,{adminEnabled:false});
  assert.deepEqual((await app.req('/api/visits')).data,{total:0,today:0,visitors:0});
  const results=await Promise.all(Array.from({length:5},()=>app.req('/api/visits','POST',{})));
  assert.ok(results.every(result=>result.status===200));
  assert.deepEqual((await app.req('/api/visits')).data,{total:5,today:5,visitors:5});
  assert.equal((await app.req('/api/visits','POST',{}, {Origin:'https://evil.example'})).status,403);
  await app.restart();
  assert.deepEqual((await app.req('/api/visits')).data,{total:5,today:5,visitors:5});
  const stored=JSON.parse(await readFile(path.join(app.dir,'.private/visits.json'),'utf8'));
  await writeFile(path.join(app.dir,'.private/visits.json'),JSON.stringify({...stored,date:'2000-01-01'}));
  await app.restart();assert.deepEqual((await app.req('/api/visits')).data,{total:5,today:0,visitors:5});
  assert.deepEqual((await app.req('/api/visits','POST',{})).data,{total:6,today:1,visitors:5});
});
test('visitor cookies deduplicate refreshes and survive server restarts',async t=>{
  const app=await instance(t);
  const first=await app.req('/api/visits','POST',{});
  assert.equal(first.data.visitors,1);
  assert.match(first.headers.get('set-cookie'),/HttpOnly/);
  const cookie=app.cookie;
  assert.equal((await app.req('/api/visits','POST',{})).data.visitors,1);
  await app.restart();
  assert.equal((await app.req('/api/visits','POST',{})).data.visitors,1);
  assert.equal((await app.req('/api/visits','POST',{}, {Cookie:''})).data.visitors,2);
  const returning=await app.req('/api/visits','POST',{}, {Cookie:cookie});
  assert.equal(returning.data.visitors,2);assert.equal(returning.data.total,5);
  assert.equal(returning.data.visitorIds,undefined);
});
test('advertisement config persists and unsafe URLs are rejected',async t=>{
  const app=await instance(t);await setup(app);
  const current=(await app.req('/api/admin/data')).data;
  current.settings.ad={enabled:true,title:'测试广告',text:'测试正文',image:'/assets/art/retro-web-hero-v1.png',url:'https://example.com',button:'查看'};
  const saved=await app.req('/api/admin/data','PUT',current);assert.equal(saved.status,200);
  await app.restart();assert.deepEqual((await app.req('/api/public')).data.settings.ad,current.settings.ad);
  assert.deepEqual(JSON.parse(await readFile(path.join(app.dir,'store.json'),'utf8')).settings.ad,current.settings.ad);
  for(const url of ['javascript:alert(1)','data:text/html,test'])assert.throws(()=>validateStore({...current,settings:{...current.settings,ad:{...current.settings.ad,url}}}));
  assert.throws(()=>validateStore({...current,settings:{...current.settings,ad:{...current.settings.ad,image:'https://example.com/image.png'}}}));
  for(const route of ['/retro-ad.js','/window-manager.js']){const res=await fetch(app.base+route);assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/javascript/);}
});
async function setup(app){assert.equal((await app.req('/api/setup','POST',credentials)).status,200);}

test('public directory works before setup; authentication protects every write and private file',async t=>{
  const app=await instance(t);
  assert.equal((await app.req('/api/public')).data.navigation.categories[0].sites[0].name,'工具一');
  assert.deepEqual((await app.req('/api/auth')).data,{setupRequired:true,authenticated:false});
  assert.equal((await app.req('/api/admin/data')).status,401);
  assert.equal((await app.req('/api/admin/data','PUT',{})).status,401);
  assert.equal((await app.req('/api/admin/backup')).status,401);
  for(const route of ['/data/store.json','/data/.private/account.json','/server.js','/tests/server.test.js','/package.json','/%2e%2e%2fserver.js'])assert.equal((await app.req(route)).status,404,route);
  assert.equal((await app.req('/api/setup','POST',{username:'admin',password:'short'})).status,400);
  await setup(app);
  assert.equal((await app.req('/api/auth')).data.authenticated,true);
  assert.match(app.cookie,/surfer_session=[0-9a-f]{64}/);
  assert.equal((await app.req('/api/setup','POST',credentials)).status,409);
  const stored=JSON.parse(await readFile(path.join(app.dir,'.private/account.json'),'utf8'));
  assert.ok(stored.hash);assert.equal(stored.password,undefined);assert.ok(!JSON.stringify(stored).includes(credentials.password));
});

test('disabled admin surface is indistinguishable from a missing page',async t=>{
  const app=await instance(t,{adminEnabled:false});
  for(const route of ['/admin','/admin/','/admin.html','/admin.js','/admin.css','/api/auth','/api/setup','/api/login','/api/logout','/api/admin/data','/api/admin/backup']){
    assert.equal((await app.req(route,route.startsWith('/api/')?'POST':'GET',route.startsWith('/api/')?{}:undefined)).status,404,route);
  }
  assert.equal((await app.req('/api/public')).status,200);
});

test('admin path can be changed without keeping the default route alive',async t=>{
  const app=await instance(t,{adminPath:'/control-room'});
  assert.equal((await app.req('/admin')).status,404);
  assert.equal((await fetch(app.base+'/control-room')).status,200);
  assert.equal((await fetch(app.base+'/control-room/')).status,200);
});

test('save, hide, add, move, delete, backup and restart preserve the complete directory',async t=>{
  const app=await instance(t);await setup(app);
  let data=(await app.req('/api/admin/data')).data;
  data.navigation.categories[0].sites[0].name='已编辑的网站';
  data.navigation.categories[0].sites[0].hidden=true;
  data.content.featured.items[0].hidden=true;
  data.content.friends[0].hidden=true;
  data.settings.announcement='来自后台的公告';
  let result=await app.req('/api/admin/data','PUT',data);assert.equal(result.status,200);data=result.data;
  const pub=(await app.req('/api/public')).data;
  assert.equal(pub.navigation.categories[0].sites.length,0);assert.equal(pub.content.hot.siteIds.length,0);assert.equal(pub.content.featured.items.length,0);assert.equal(pub.content.friends.length,0);assert.equal(pub.settings.announcement,'来自后台的公告');
  assert.equal(data.navigation.categories[0].sites.length,1);
  data.navigation.categories.push({id:'new-cat',name:'新分类',sites:[],children:[]});
  const moved=data.navigation.categories[0].children[0].sites.pop();data.navigation.categories[1].sites.push(moved,{id:'third',name:'新网站',url:'https://third.example.com',description:'新说明',isNew:true});
  result=await app.req('/api/admin/data','PUT',data);assert.equal(result.status,200);data=result.data;
  assert.equal(data.navigation.categories[1].sites.length,2);assert.equal(data.navigation.categories[0].children[0].sites.length,0);
  const backup=await app.req('/api/admin/backup');assert.deepEqual(backup.data,data);assert.match(backup.headers.get('content-disposition'),/attachment/);
  data.navigation.categories[0].sites=[];data.content.hot.siteIds=[];
  result=await app.req('/api/admin/data','PUT',data);assert.equal(result.status,200);
  const previous=JSON.parse(await readFile(path.join(app.dir,'.private/previous-store.json'),'utf8'));assert.equal(previous.navigation.categories[0].sites[0].name,'已编辑的网站');
  await app.restart();assert.equal((await app.req('/api/admin/data')).status,401);
  assert.equal((await app.req('/api/login','POST',credentials)).status,200);
  data=(await app.req('/api/admin/data')).data;assert.equal(data.navigation.categories[1].sites.length,2);
  backup.data.revision=data.revision;assert.equal((await app.req('/api/admin/data','PUT',backup.data)).status,200);
  assert.equal((await app.req('/api/admin/data')).data.navigation.categories[0].sites[0].name,'已编辑的网站');
});

test('concurrent and stale writes cannot silently overwrite newer data',async t=>{
  const app=await instance(t);await setup(app);const data=(await app.req('/api/admin/data')).data;
  const results=await Promise.all([app.req('/api/admin/data','PUT',{...data,settings:{...data.settings,tagline:'A'}}),app.req('/api/admin/data','PUT',{...data,settings:{...data.settings,tagline:'B'}})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const latest=(await app.req('/api/admin/data')).data;assert.equal(latest.revision,data.revision+1);
  assert.equal((await app.req('/api/admin/data','PUT',data)).status,409);
});

test('invalid URLs, references, categories and cross-origin requests never change stored data',async t=>{
  const app=await instance(t);await setup(app);const data=(await app.req('/api/admin/data')).data;
  for(const alter of [d=>d.navigation.categories[0].sites[0].url='javascript:alert(1)',d=>d.content.hot.siteIds.push('missing'),d=>d.navigation.categories[0].sites.push({...d.navigation.categories[0].sites[0]}),d=>d.navigation.categories[0].sites[0].hidden='false',d=>d.settings.tagline='x'.repeat(101),d=>d.navigation.categories[0].children[0].children=[{id:'deep',name:'三级',sites:[]}]]){
    const next=structuredClone(data);alter(next);assert.equal((await app.req('/api/admin/data','PUT',next)).status,400);
  }
  assert.equal((await app.req('/api/admin/data','PUT',data,{Origin:'https://evil.example'})).status,403);
  assert.equal((await app.req('/api/admin/data','PUT',data,{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await app.req('/api/admin/data','PUT',data,{'Content-Type':'text/plain'})).status,415);
  assert.deepEqual((await app.req('/api/admin/data')).data,data);
});

test('website submissions stay private, persist, and can be accepted into the directory',async t=>{
  const app=await instance(t);
  const submitted=await app.req('/api/submissions','POST',{name:'新发现',url:'https://submitted.example.com/path',description:'值得收藏的网站',categoryId:'books',contact:'visitor@example.com'});
  assert.equal(submitted.status,201);assert.match(submitted.data.id,/^submission-/);
  assert.equal((await app.req('/api/admin/submissions')).status,401);
  await setup(app);
  let listing=await app.req('/api/admin/submissions');assert.equal(listing.status,200);assert.equal(listing.data.items.length,1);
  const item=listing.data.items[0];assert.equal(item.status,'pending');assert.equal(item.contact,'visitor@example.com');
  const accepted=await app.req(`/api/admin/submissions/${item.id}`,'PATCH',{action:'accept',categoryId:'books'});
  assert.equal(accepted.status,200);assert.equal(accepted.data.item.status,'accepted');
  const publicData=(await app.req('/api/public')).data;
  const added=publicData.navigation.categories[0].children[0].sites.find(site=>site.url==='https://submitted.example.com/path');
  assert.equal(added.name,'新发现');assert.equal(added.description,'值得收藏的网站');assert.equal(added.isNew,true);
  assert.equal((await app.req(`/api/admin/submissions/${item.id}`,'PATCH',{action:'accept',categoryId:'books'})).status,409);
  await app.restart();await app.req('/api/login','POST',credentials);
  listing=await app.req('/api/admin/submissions');assert.equal(listing.data.items[0].status,'accepted');
  assert.ok(JSON.parse(await readFile(path.join(app.dir,'.private/submissions.json'),'utf8'))[0].reviewedAt);
});

test('submissions validate input, limit abuse, and support reject and delete',async t=>{
  const app=await instance(t);
  assert.equal((await app.req('/api/submissions','POST',null)).status,400);
  assert.equal((await app.req('/api/submissions','POST',{name:'坏链接',url:'javascript:alert(1)',description:'x'})).status,400);
  assert.equal((await app.req('/api/submissions','POST',{name:'',url:'https://empty.example.com',description:'x'})).status,400);
  assert.equal((await app.req('/api/submissions','POST',{name:'机器人',url:'https://bot.example.com',description:'x',company:'spam'})).status,200);
  for(let i=0;i<5;i++)assert.equal((await app.req('/api/submissions','POST',{name:`网站 ${i}`,url:`https://submission-${i}.example.com`,description:'介绍'})).status,201);
  assert.equal((await app.req('/api/submissions','POST',{name:'第六个',url:'https://sixth.example.com',description:'介绍'})).status,429);
  await setup(app);let listing=(await app.req('/api/admin/submissions')).data.items;assert.equal(listing.length,5);
  const id=listing[0].id;assert.equal((await app.req(`/api/admin/submissions/${id}`,'PATCH',null)).status,400);
  assert.equal((await app.req(`/api/admin/submissions/${id}`,'PATCH',{action:'reject'})).status,200);
  assert.equal((await app.req('/api/admin/submissions')).data.items.find(item=>item.id===id).status,'rejected');
  assert.equal((await app.req(`/api/admin/submissions/${id}`,'DELETE',{})).status,200);
  assert.equal((await app.req('/api/admin/submissions')).data.items.some(item=>item.id===id),false);
});

test('password change invalidates previous sessions, logout revokes the session, failed logins are limited',async t=>{
  const app=await instance(t);await setup(app);const oldCookie=app.cookie;
  assert.equal((await app.req('/api/admin/password','POST',{current:'incorrect',password:'new-password-123'})).status,400);
  assert.equal((await app.req('/api/admin/password','POST',{current:credentials.password,password:'new-password-123'})).status,200);
  assert.equal((await app.req('/api/admin/data','GET',undefined,{Cookie:oldCookie})).status,401);
  assert.equal((await app.req('/api/admin/data')).status,200);
  assert.equal((await app.req('/api/logout','POST',{})).status,200);assert.equal((await app.req('/api/admin/data')).status,401);
  assert.equal((await app.req('/api/login','POST',{username:credentials.username,password:'new-password-123'})).status,200);
  await app.req('/api/logout','POST',{});
  for(let i=0;i<8;i++)assert.equal((await app.req('/api/login','POST',credentials)).status,401);
  assert.equal((await app.req('/api/login','POST',credentials)).status,429);
});

test('both entry points and their public modules are served with correct content types',async t=>{
  const app=await instance(t);
  for(const route of ['/','/cd-wall.html','/cd-wall.css','/cd-case.css','/cd-wall.js','/cd-sound.js','/admin','/admin/','/styles.css','/admin.css','/app.js','/admin.js','/ui.js','/radio.js','/navigation-data.js','/assets/layers/hero/globe.png']){
    const result=await fetch(app.base+route);assert.equal(result.status,200,route);assert.ok(result.headers.get('content-type'));assert.ok(!result.headers.get('content-security-policy').includes("script-src 'self' 'unsafe-inline'"));
  }
});

test('radio exposes and serves only local mp3 files',async t=>{
  const app=await instance(t,{withAudio:true});
  const listing=await app.req('/api/radio');
  assert.deepEqual(listing.data.tracks,[{name:'sample-track',src:'/data/mp3/sample-track.mp3'}]);
  const audio=await fetch(app.base+'/data/mp3/sample-track.mp3');
  assert.equal(audio.status,200);assert.equal(audio.headers.get('content-type'),'audio/mpeg');assert.equal(await audio.text(),'ID3 test');
  assert.equal(audio.headers.get('accept-ranges'),'bytes');assert.equal(audio.headers.get('content-length'),'8');
  for(const [range,expected,contentRange] of [['bytes=0-2','ID3','bytes 0-2/8'],['bytes=4-','test','bytes 4-7/8'],['bytes=-4','test','bytes 4-7/8'],['bytes=4-100','test','bytes 4-7/8']]){
    const partial=await fetch(app.base+'/data/mp3/sample-track.mp3',{headers:{Range:range}});
    assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),contentRange);assert.equal(await partial.text(),expected);
  }
  for(const range of ['bytes=20-','bytes=4-2','bytes=-0','bytes=abc']){
    const invalid=await fetch(app.base+'/data/mp3/sample-track.mp3',{headers:{Range:range}});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('content-range'),'bytes */8');
  }
  const head=await fetch(app.base+'/data/mp3/sample-track.mp3',{method:'HEAD',headers:{Range:'bytes=0-2'}});assert.equal(head.status,206);assert.equal(await head.text(),'');
  assert.equal((await fetch(app.base+'/data/mp3/ignore.txt')).status,404);
  await writeFile(path.join(app.dir,'mp3','sample-track.lrc'),'[00:00]窗边的光\n[00:03]唱片转过一圈');
  const lyrics=await app.req('/api/listening/lyrics?source=local&src=%2Fdata%2Fmp3%2Fsample-track.mp3');
  assert.equal(lyrics.status,200);assert.match(lyrics.data.lyric,/窗边的光/);
  assert.equal((await app.req('/api/listening/lyrics?source=local&src=%2Fdata%2Fmp3%2F..%2F.private%2Faccount.json')).status,404);
  assert.equal((await fetch(app.base+'/data/mp3/sample-track.lrc')).status,404);
  assert.equal((await fetch(app.base+'/lyrics.js')).status,200);assert.equal((await fetch(app.base+'/lyrics.css')).status,200);
});

test('complete backup validator preserves explicitly hidden links but rejects malformed files',()=>{
  assert.throws(()=>validateStore(null));assert.throws(()=>validateStore({navigation:fixture(),content:{},settings:{}}));
});

test('static files and public data revalidate, while saved changes invalidate the public cache',async t=>{
  const app=await instance(t);await setup(app);
  for(const route of ['/cd-wall.js','/cd-case.css','/assets/wood-grain.svg','/api/public']){
    const first=await fetch(app.base+route),etag=first.headers.get('etag');
    assert.ok(etag,route);await first.arrayBuffer();
    const cached=await fetch(app.base+route,{headers:{'If-None-Match':etag}});
    assert.equal(cached.status,304,route);assert.equal((await cached.arrayBuffer()).byteLength,0);
  }
  const before=await app.req('/api/public'),data=(await app.req('/api/admin/data')).data;
  data.navigation.categories[0].sites[0].hidden=true;
  assert.equal((await app.req('/api/admin/data','PUT',data)).status,200);
  const after=await app.req('/api/public','GET',undefined,{'If-None-Match':before.headers.get('etag')});
  assert.equal(after.status,200);assert.notEqual(after.headers.get('etag'),before.headers.get('etag'));
  assert.equal(after.data.navigation.categories[0].sites.length,0);
  assert.equal((await app.req('/api/admin/data')).headers.get('cache-control'),'no-store');
  assert.equal((await fetch(app.base+'/http-cache.js')).status,404);
});

test('listening room and isolated source runtime are served with scoped CSP',async t=>{
  const app=await instance(t,{adminEnabled:false});
  for(const route of ['/listening-room','/listening-room.html','/listening-room.css','/listening-room.js','/music-source-selection.js','/lx-client.js','/lx-sandbox.html','/lx-sandbox.js','/lx-worker.js']){
    const response=await fetch(app.base+route);assert.equal(response.status,200,route);
    const csp=response.headers.get('content-security-policy');
    if(route==='/lx-sandbox.html'){assert.match(csp,/sandbox allow-scripts/);assert.match(csp,/connect-src 'none'/);assert.doesNotMatch(csp,/allow-same-origin/);}
    if(route==='/listening-room.html'){assert.match(csp,/media-src 'self' blob: https: http:/);assert.doesNotMatch(csp,/unsafe-eval/);}
  }
  const root=await fetch(app.base);assert.doesNotMatch(root.headers.get('content-security-policy'),/media-src.*https:/);
  assert.equal((await fetch(app.base+'/listening-service.js')).status,404);
  const catalog=await app.req('/api/listening/sources');assert.equal(catalog.status,200);assert.equal(catalog.data.sources.length,8);
  assert.equal((await app.req('/api/listening/request','POST',{url:'http://127.0.0.1/api/admin/data'})).status,403);
  assert.equal((await app.req('/api/listening/request','POST',{url:'https://example.com'}, {Origin:'https://evil.example'})).status,403);
  assert.equal((await app.req('/api/listening/request')).status,405);
});

test('cassette room serves its assets, scopes media CSP and validates read-only API requests',async t=>{
  const app=await instance(t,{adminEnabled:false});
  for(const route of ['/cassette-room','/cassette-room.html','/cassette-room.css','/cassette-room.js','/cassette-sound.js']){
    const response=await fetch(app.base+route);assert.equal(response.status,200,route);
    if(route==='/cassette-room'||route.endsWith('.html')){assert.match(response.headers.get('content-security-policy'),/media-src 'self' https: http:/);assert.doesNotMatch(response.headers.get('content-security-policy'),/unsafe-eval/);}
  }
  assert.equal((await fetch(app.base+'/podcast-service.js')).status,404);
  assert.equal((await app.req('/api/podcasts/podcast?id=invalid')).status,400);
  assert.equal((await app.req('/api/podcasts/search?q=')).status,400);
  assert.equal((await app.req('/api/podcasts/search','POST',{q:'test'})).status,405);
});

test('blog management persists drafts, publishes articles, protects writes and includes backups',async t=>{
  const app=await instance(t);
  assert.equal((await app.req('/api/admin/data')).status,401);
  await app.req('/api/setup','POST',credentials);
  const post={id:'post-test',title:'测试文章',date:'2026-09-09',category:'学习笔记',tags:['网络'],summary:'摘要',body:'# 正文\n\n文章内容',status:'draft',sourceUrl:''};
  let data=(await app.req('/api/admin/data')).data;
  data.blog={posts:[post]};
  let saved=await app.req('/api/admin/data','PUT',data);assert.equal(saved.status,200);
  assert.deepEqual((await app.req('/api/blog')).data,{posts:[]});
  assert.equal((await app.req('/api/blog?id=post-test')).status,404);
  assert.equal((await app.req('/api/public')).data.blog,undefined);
  assert.equal((await app.req('/api/admin/backup')).data.blog.posts[0].status,'draft');
  data=saved.data;data.blog.posts[0].status='published';
  saved=await app.req('/api/admin/data','PUT',data);assert.equal(saved.status,200);
  assert.equal((await app.req('/api/blog')).data.posts[0].body,undefined);
  assert.equal((await app.req('/api/blog?id=post-test')).data.body,post.body);
  assert.equal((await app.req('/api/admin/data','PUT',data)).status,409);
  await app.restart();
  assert.equal((await app.req('/api/blog?id=post-test')).data.title,post.title);
  await app.req('/api/login','POST',credentials);
  data=(await app.req('/api/admin/data')).data;
  const invalid=structuredClone(data);invalid.blog.posts.push({...post});
  assert.equal((await app.req('/api/admin/data','PUT',invalid)).status,400);
  const badDate=structuredClone(data);badDate.blog.posts[0].date='2026-02-30';
  assert.equal((await app.req('/api/admin/data','PUT',badDate)).status,400);
  const oldBackup=structuredClone(data);delete oldBackup.blog;
  saved=await app.req('/api/admin/data','PUT',oldBackup);assert.equal(saved.data.blog.posts.length,1);
  data=saved.data;data.blog.posts=[];
  assert.equal((await app.req('/api/admin/data','PUT',data)).status,200);
  assert.equal((await app.req('/api/blog?id=post-test')).status,404);
});
test('blog routes and vendor renderer work with administration disabled',async t=>{
 const app=await instance(t,{adminEnabled:false});
 for(const route of ['/blog','/blog.html','/blog.js','/blog.css','/blog-render.js','/vendor/marked.js'])assert.equal((await fetch(app.base+route)).status,200,route);
 assert.equal((await app.req('/api/admin/data')).status,404);
 assert.equal((await app.req('/api/blog')).status,200);
});

test('blog widgets serve only explicit Live2D model assets and local scripts',async t=>{
 const app=await instance(t,{adminEnabled:false});
 for(const route of ['/blog-widgets.js','/live2dw/lib/L2Dwidget.min.js','/live2dw/lib/L2Dwidget.0.min.js','/live2dw/assets/miku.model.json','/live2dw/assets/moc/miku.moc','/live2dw/assets/moc/miku.2048/texture_00.png','/live2dw/assets/mtn/miku_idle_01.mtn']){
   const r=await fetch(app.base+route);assert.equal(r.status,200,route);assert.ok((await r.arrayBuffer()).byteLength>100);
 }
 assert.equal((await fetch(app.base+'/live2dw/private.json')).status,404);
 const model=await (await fetch(app.base+'/live2dw/assets/miku.model.json')).json();
 for(const filename of [model.model,model.physics,...model.textures,...Object.values(model.motions).flat().map(m=>m.file)])assert.equal((await fetch(app.base+'/live2dw/assets/'+filename)).status,200,filename);
});

test('administrator music sources persist, reorder, disable, delete and survive legacy saves',async t=>{
  const app=await instance(t);
  assert.equal((await app.req('/api/listening/sources')).data.sources.length,8);
  assert.equal((await app.req('/api/admin/data','PUT',{})).status,401);
  await app.req('/api/setup','POST',credentials);
  let store=(await app.req('/api/admin/data')).data;
  const a={id:'custom-a',name:'Custom A',url:'https://example.com/a.js',enabled:true};
  const b={id:'custom-b',name:'Custom B',url:'https://example.com/b.js',enabled:true};
  let result=await app.req('/api/admin/data','PUT',{...store,musicSources:[a,b]});assert.equal(result.status,200);store=result.data;
  assert.deepEqual((await app.req('/api/listening/sources')).data.sources,[{id:a.id,name:a.name},{id:b.id,name:b.name}]);
  assert.equal((await app.req('/api/public')).data.musicSources,undefined);
  const backup=(await app.req('/api/admin/backup')).data;assert.deepEqual(backup.musicSources,[a,b]);
  result=await app.req('/api/admin/data','PUT',{...store,musicSources:[{...b,name:'Renamed',url:'https://example.com/new.js'},{...a,enabled:false}]});store=result.data;
  assert.deepEqual((await app.req('/api/listening/sources')).data.sources,[{id:b.id,name:'Renamed'}]);
  assert.equal((await app.req('/api/listening/source?id=custom-a')).status,400);
  assert.equal((await app.req('/api/admin/data','PUT',backup)).status,409);
  const legacy={...store};delete legacy.musicSources;result=await app.req('/api/admin/data','PUT',legacy);store=result.data;assert.equal(store.musicSources[0].name,'Renamed');
  await app.restart();assert.deepEqual((await app.req('/api/listening/sources')).data.sources,[{id:b.id,name:'Renamed'}]);
  await app.req('/api/login','POST',credentials);store=(await app.req('/api/admin/data')).data;
  result=await app.req('/api/admin/data','PUT',{...store,musicSources:[]});assert.equal(result.status,200);
  assert.deepEqual((await app.req('/api/listening/sources')).data.sources,[]);assert.equal((await app.req('/api/listening/source?id=custom-b')).status,400);
  result=await app.req('/api/admin/data','PUT',{...backup,revision:result.data.revision});assert.equal(result.status,200);assert.deepEqual(result.data.musicSources,[a,b]);
});

test('invalid music source configurations and cross-origin writes never replace saved data',async t=>{
  const app=await instance(t);await app.req('/api/setup','POST',credentials);const store=(await app.req('/api/admin/data')).data;
  const source={id:'custom',name:'Test',url:'https://example.com/source.js',enabled:true};
  const invalid=[null,[source,source],[{...source,name:''}],[{...source,enabled:'yes'}],[{...source,id:'../secret'}],Array.from({length:33},(_,i)=>({...source,id:`s${i}`}))];
  for(const url of ['file:///tmp/source.js','http://127.0.0.1/a','http://[::1]/a','http://192.168.1.1/a','http://localhost/a','https://user:pass@example.com/a','https://example.com:3000/a'])invalid.push([{...source,url}]);
  for(const musicSources of invalid)assert.equal((await app.req('/api/admin/data','PUT',{...store,musicSources})).status,400);
  assert.equal((await app.req('/api/admin/data','PUT',{...store,musicSources:[source]},{Origin:'https://other.example'})).status,403);
  assert.equal((await app.req('/api/admin/data')).data.revision,store.revision);
  assert.equal((await fetch(app.base+'/music-sources.js')).status,200);
});

test('together page and room HTTP API share state across independent listeners',async t=>{
  const app=await instance(t,{adminEnabled:false});
  for(const route of ['/together','/together.html','/together.js','/together.css','/together-sync.js','/listening-shared.js']){const response=await fetch(app.base+route);assert.equal(response.status,200,route);if(route.includes('html'))assert.match(response.headers.get('content-security-policy'),/media-src 'self' blob: https: http:/);}
  const first=await app.req('/api/together/create','POST',{name:'甲'});assert.equal(first.status,200);
  const second=await app.req('/api/together/join','POST',{room:first.data.room,name:'乙'});assert.equal(second.status,200);
  const selected=await app.req('/api/together/control','POST',{room:first.data.room,revision:0,command:'track',track:{id:'local:test',name:'唱片',source:'local',src:'/data/mp3/test.mp3',duration:180}},{'X-Room-Token':first.data.token});assert.equal(selected.status,200);
  const state=await app.req('/api/together/state?room='+first.data.room,'GET',undefined,{'X-Room-Token':second.data.token});assert.equal(state.data.track.name,'唱片');assert.equal(state.data.playing,true);assert.equal(state.data.members.length,2);
  assert.equal((await app.req('/api/together/state?room='+first.data.room)).status,401);
  assert.equal((await app.req('/api/together/create','POST',{}, {Origin:'https://evil.example'})).status,403);
  assert.equal((await app.req('/api/together/create')).status,405);
});
