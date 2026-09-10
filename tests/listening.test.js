import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDecipheriv, createHash } from 'node:crypto';
import vm from 'node:vm';
import { createListeningService, isPublicAddress, normalizeSearchResult, eapiParams, publicRequest, sourceCatalog } from '../server/listening-service.js';

test('music network bridge blocks private addresses, mapped loopback and reserved ranges',async()=>{
  for(const value of ['127.0.0.1','10.4.1.2','172.16.2.1','192.168.1.1','169.254.169.254','100.64.2.1','0.0.0.0','::1','::ffff:127.0.0.1','fd00::1','fe80::1','2001:db8::1','2002:7f00:1::','198.19.1.2','203.0.113.1'])assert.equal(isPublicAddress(value),false,value);
  for(const value of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])assert.equal(isPublicAddress(value),true,value);
  await assert.rejects(publicRequest('http://127.0.0.1/api/admin/data'),{status:403});
  await assert.rejects(publicRequest('file:///etc/passwd'),{status:400});
  await assert.rejects(publicRequest('https://example.com:3000/'),{status:400});
});

test('LX catalog is fixed, source downloads are validated and cached',async()=>{
  let calls=0;
  const service=createListeningService({request:async url=>{calls++;assert.equal(url,sourceCatalog[0].url);return {statusCode:200,body:'/**\n * @name Fixture\n * @version 1.0\n */\nthrow new Error("MUST NOT EXECUTE IN SERVER");'};}});
  assert.equal((await service('/api/listening/sources')).sources.length,8);
  const url=new URL('http://localhost/api/listening/source?id=huibq');
  const source=await service(url.pathname,url);assert.equal(source.version,'1.0');assert.match(source.script,/MUST NOT EXECUTE/);
  await service(url.pathname,url);assert.equal(calls,1);
  await assert.rejects(service(url.pathname,new URL('http://localhost/api/listening/source?id=../private')),{status:400});
});

test('search returns LX musicInfo fields and refuses upstream failure as empty success',async()=>{
  const body={code:200,data:{totalCount:1,resources:[{baseInfo:{simpleSongData:{id:77,name:'回声',ar:[{name:'歌手'}],al:{name:'专辑',id:4,picUrl:'https://example.com/cover.jpg'},dt:180000}}}]}};
  const result=normalizeSearchResult(body);
  assert.equal(result.tracks[0].songmid,77);assert.equal(result.tracks[0].source,'wy');assert.equal(result.tracks[0].singer,'歌手');assert.equal(result.tracks[0].duration,180);
  assert.throws(()=>normalizeSearchResult({code:403}),{status:502});
  assert.throws(()=>normalizeSearchResult({code:200,data:{}}),{status:502});
  let calls=0;const service=createListeningService({request:async(url,options)=>{calls++;assert.equal(options.method,'POST');return {statusCode:200,body};}});
  const url=new URL('http://localhost/api/listening/search?q=回声&page=2');const data=await service(url.pathname,url);assert.equal(data.page,2);
  await service(url.pathname,url);assert.equal(calls,1);
  await assert.rejects(service(url.pathname,new URL('http://localhost/api/listening/search?q=')),{status:400});
});

test('search encryption follows the LX EAPI envelope',()=>{
  const route='/api/search/song/list/page',data={keyword:'回声',limit:24};
  const encrypted=eapiParams(route,data),decipher=createDecipheriv('aes-128-ecb','e82ckenh8dichen8',null);
  const plain=Buffer.concat([decipher.update(Buffer.from(encrypted,'hex')),decipher.final()]).toString();
  const digest=createHash('md5').update(`nobody${route}use${JSON.stringify(data)}md5forencrypt`).digest('hex');
  assert.equal(plain,`${route}-36cd479b6b5-${JSON.stringify(data)}-36cd479b6b5-${digest}`);
});

test('isolated LX runtime supports init, callback network, crypto and musicUrl',async()=>{
  const bundle=await readFile(new URL('../public/lx-worker.js',import.meta.url),'utf8');
  const messages=[],context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,setTimeout,clearTimeout,console:{log(){},error(){},warn(){}},crypto:globalThis.crypto,postMessage:value=>messages.push(value)});
  vm.runInContext('self=globalThis',context);vm.runInContext(bundle,context,{timeout:3000});
  const script=`const {on,send,request,EVENT_NAMES,utils}=lx;
    if(utils.crypto.md5('abc')!=='900150983cd24fb0d6963f7d28e17f72')throw Error('MD5 mismatch');
    if(utils.buffer.bufToString(utils.buffer.from('唱片'))!=='唱片')throw Error('Buffer mismatch');
    const aes=utils.crypto.aesEncrypt(utils.buffer.from('hello'),'aes-128-ecb',utils.buffer.from('1234567890123456'),null);
    if(utils.buffer.bufToString(aes,'hex')!=='ebb7c703e675db3da397038b4c17823c')throw Error('AES mismatch');
    on(EVENT_NAMES.request,({info,source})=>new Promise((resolve,reject)=>request('https://fixture.example/'+source+'/'+info.musicInfo.songmid,{method:'GET'},(err,res)=>err?reject(err):resolve(res.body.url))));
    send(EVENT_NAMES.inited,{sources:{wy:{actions:['musicUrl'],qualitys:['128k']}}});`;
  await context.onmessage({data:{kind:'init',source:{script,name:'fixture'}}});
  assert.equal(messages[0].kind,'inited');
  const resolve=context.onmessage({data:{kind:'resolve',id:3,track:{source:'wy',songmid:77},quality:'128k'}});
  const network=messages.find(message=>message.kind==='network');assert.equal(network.url,'https://fixture.example/wy/77');
  await context.onmessage({data:{kind:'network-result',id:network.id,response:{body:{url:'https://example.com/music.mp3'}}}});
  await resolve;assert.equal(messages.at(-1).url,'https://example.com/music.mp3');assert.equal(messages.at(-1).id,3);
});

test('managed sources invalidate edited script URLs and reject disabled or deleted entries',async()=>{
  let catalog=[{id:'custom',name:'First',url:'https://example.com/a.js',enabled:true}],calls=[];
  const service=createListeningService({getSources:()=>catalog,request:async url=>{calls.push(url);return {statusCode:200,body:'/** @name Test */\n'};}});
  const url=new URL('http://localhost/api/listening/source?id=custom');
  await service(url.pathname,url);await service(url.pathname,url);assert.equal(calls.length,1);
  catalog=[{...catalog[0],url:'https://example.com/b.js',name:'Updated'}];const updated=await service(url.pathname,url);assert.equal(updated.name,'Updated');assert.equal(calls.length,2);
  catalog[0].enabled=false;assert.deepEqual((await service('/api/listening/sources')).sources,[]);await assert.rejects(service(url.pathname,url),{status:400});
  catalog=[];await assert.rejects(service(url.pathname,url),{status:400});assert.equal(calls.length,2);
});
