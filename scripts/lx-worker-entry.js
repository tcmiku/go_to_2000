import CryptoJS from 'crypto-js';
import { Buffer } from 'buffer';
import { unzlibSync, zlibSync } from 'fflate';
import forge from 'node-forge';
// Runs only in a terminable Worker inside an opaque-origin, network-disabled iframe.
let handler, counter=0;
const pending=new Map();
const emit=globalThis.postMessage.bind(globalThis);
const from=(value,encoding)=>Buffer.from(value,encoding);
const word=value=>CryptoJS.lib.WordArray.create(from(value));
const bytes=value=>from(value.toString(CryptoJS.enc.Hex),'hex');
const events={inited:'inited',request:'request',updateAlert:'updateAlert'};
const report=error=>emit({kind:'error',error:String(error?.message||error).slice(0,400)});
self.onunhandledrejection=event=>{event.preventDefault();report(event.reason);};
self.onerror=event=>{event.preventDefault();report(event.message);};
self.onmessage=async({data})=>{
  if(data.kind==='network-result') {
    const callback=pending.get(data.id);if(!callback)return;pending.delete(data.id);
    callback(data.error?new Error(data.error):null,data.response,data.response?.body);return;
  }
  if(data.kind==='resolve') {
    try {if(!handler)throw new Error('音源尚未初始化');const url=await handler({source:data.track.source,action:'musicUrl',info:{type:data.quality,musicInfo:data.track}});emit({kind:'resolved',id:data.id,url});}
    catch(error){emit({kind:'resolved',id:data.id,error:String(error.message||error)});}return;
  }
  if(data.kind!=='init')return;
  const {script,...info}=data.source;
  globalThis.lx={
    env:'desktop',version:'2.0.0',currentScriptInfo:{...info,rawScript:script},EVENT_NAMES:events,
    on:(event,fn)=>{if(event===events.request)handler=fn;},
    send:(event,value)=>{if(event===events.inited)emit({kind:'inited',sources:value.sources,error:value.status===false?'音源初始化失败':null});},
    request:(url,options,callback)=>{const id=++counter;pending.set(id,callback);emit({kind:'network',id,url,options});return ()=>{pending.delete(id);emit({kind:'cancel-network',id});};},
    utils:{buffer:{from,bufToString:(value,encoding)=>from(value).toString(encoding)},crypto:{
      md5:value=>CryptoJS.MD5(typeof value==='string'?value:word(value)).toString(),
      randomBytes:size=>{if(!Number.isInteger(size)||size<0||size>65536)throw new Error('随机字节长度无效');return from(crypto.getRandomValues(new Uint8Array(size)));},
      aesEncrypt:(value,mode,key,iv)=>{const name=mode.split('-').pop().toUpperCase();if(!CryptoJS.mode[name])throw new Error(`不支持 AES ${name}`);return bytes(CryptoJS.AES.encrypt(word(value),word(key),{iv:iv?word(iv):undefined,mode:CryptoJS.mode[name],padding:CryptoJS.pad.Pkcs7}).ciphertext);},
      rsaEncrypt:(value,key)=>{const publicKey=forge.pki.publicKeyFromPem(key),length=Math.ceil(publicKey.n.bitLength()/8),input=from(value);if(input.length>length)throw new Error('RSA 输入过长');const padded=Buffer.concat([Buffer.alloc(length-input.length),input]);return from(publicKey.encrypt(padded.toString('binary'),'RAW'),'binary');},
    },zlib:{inflate:async value=>from(unzlibSync(from(value))),deflate:async value=>from(zlibSync(from(value)))}}
  };
  try {new Function(script)();}catch(error){report(error);}
};
