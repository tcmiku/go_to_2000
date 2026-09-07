import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp, validateStore } from '../server.js';

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
  for(const route of ['/','/admin','/admin/','/styles.css','/admin.css','/app.js','/admin.js','/ui.js','/radio.js','/navigation-data.js','/assets/layers/hero/globe.png']){
    const result=await fetch(app.base+route);assert.equal(result.status,200,route);assert.ok(result.headers.get('content-type'));assert.ok(!result.headers.get('content-security-policy').includes("script-src 'self' 'unsafe-inline'"));
  }
});

test('radio exposes and serves only local mp3 files',async t=>{
  const app=await instance(t,{withAudio:true});
  const listing=await app.req('/api/radio');
  assert.deepEqual(listing.data.tracks,[{name:'sample-track',src:'/data/mp3/sample-track.mp3'}]);
  const audio=await fetch(app.base+'/data/mp3/sample-track.mp3');
  assert.equal(audio.status,200);assert.equal(audio.headers.get('content-type'),'audio/mpeg');assert.equal(await audio.text(),'ID3 test');
  assert.equal((await fetch(app.base+'/data/mp3/ignore.txt')).status,404);
});

test('complete backup validator preserves explicitly hidden links but rejects malformed files',()=>{
  assert.throws(()=>validateStore(null));assert.throws(()=>validateStore({navigation:fixture(),content:{},settings:{}}));
});
