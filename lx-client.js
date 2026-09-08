export class LXClient {
  constructor(){this.pending=new Map();this.requests=new Map();this.sequence=0;this.generation=0;this.receive=this.receive.bind(this);window.addEventListener('message',this.receive);}
  async load(id) {
    this.dispose();const generation=this.generation;
    this.loadController=new AbortController();const signal=AbortSignal.any([this.loadController.signal,AbortSignal.timeout(25000)]);
    const fetchJSON=async url=>{const response=await fetch(url,{signal});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;};
    const [source,runtimeResponse]=await Promise.all([fetchJSON(`/api/listening/source?id=${encodeURIComponent(id)}`),fetch('/lx-worker.js',{signal})]);
    if(!runtimeResponse.ok)throw new Error('音源运行环境无法加载');const runtime=await runtimeResponse.text();
    if(generation!==this.generation)throw new Error('音源切换已取消');
    return new Promise((resolve,reject)=>{
      this.initial={resolve,reject,source,runtime};
      this.frame=document.createElement('iframe');this.frame.hidden=true;this.frame.setAttribute('sandbox','allow-scripts');this.frame.src='/lx-sandbox.html';this.frame.title='音乐音源';
      this.timer=setTimeout(()=>this.fail(new Error('音源初始化超时，请尝试其他音源')),25000);
      document.body.append(this.frame);
    });
  }
  post(data){this.frame?.contentWindow?.postMessage(data,'*');}
  async receive(event){
    if(!this.frame||event.source!==this.frame.contentWindow||event.origin!=='null')return;
    const data=event.data;if(!data||typeof data!=='object')return;
    if(data.kind==='ready'&&this.initial){this.post({kind:'boot',runtime:this.initial.runtime,source:this.initial.source});return;}
    if(data.kind==='inited'&&this.initial){
      if(data.error||!data.sources||typeof data.sources!=='object'){this.fail(new Error(data.error||'音源未提供可用平台'));return;}
      this.sources=data.sources;clearTimeout(this.timer);const {resolve,source}=this.initial;this.initial=null;resolve({source,sources:this.sources});return;
    }
    if(data.kind==='error'){this.fail(new Error(data.error||'音源运行失败'));return;}
    if(data.kind==='resolved') {const task=this.pending.get(data.id);if(!task)return;this.pending.delete(data.id);clearTimeout(task.timer);if(data.error)task.reject(new Error(data.error));else {try{const url=new URL(data.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error();task.resolve(url.href);}catch{task.reject(new Error('音源未返回有效的播放地址'));}}return;}
    if(data.kind==='cancel-network'){this.requests.get(data.id)?.abort();return;}
    if(data.kind==='network') {
      if(this.requests.size>=6){this.post({kind:'network-result',id:data.id,error:'音源请求过多'});return;}
      const generation=this.generation,controller=new AbortController();this.requests.set(data.id,controller);
      try {const response=await fetch('/api/listening/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:data.url,options:data.options}),signal:controller.signal});const result=await response.json();if(generation===this.generation)this.post({kind:'network-result',id:data.id,...(response.ok&&result.statusCode<400?{response:result}:{error:result.error||`音源服务暂时不可用（HTTP ${result.statusCode}）`})});}
      catch(error){if(generation===this.generation)this.post({kind:'network-result',id:data.id,error:error.message});}
      finally{if(generation===this.generation)this.requests.delete(data.id);}
    }
  }
  resolve(track,quality='128k',signal) {
    if(signal?.aborted)return Promise.reject(signal.reason);
    if(!this.sources?.[track.source]?.actions?.includes('musicUrl'))return Promise.reject(new Error('当前音源不支持该平台，请更换音源'));
    const qualities=this.sources[track.source].qualitys||[],selected=qualities.includes(quality)?quality:qualities[0];
    if(!selected)return Promise.reject(new Error('当前音源没有可用音质'));
    return new Promise((resolve,reject)=>{
      const id=++this.sequence,timer=setTimeout(()=>this.fail(new Error('播放地址解析超时，请更换音源后重试')),30000);
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      const abort=()=>{this.pending.delete(id);cleanup();reject(signal.reason);};
      this.pending.set(id,{resolve:value=>{cleanup();resolve(value);},reject:error=>{cleanup();reject(error);},timer});
      signal?.addEventListener('abort',abort,{once:true});this.post({kind:'resolve',id,track,quality:selected});
    });
  }
  fail(error){this.dispose(error);}
  dispose(error=new Error('音源切换已取消')) {
    this.generation++;this.loadController?.abort();this.loadController=null;clearTimeout(this.timer);this.initial?.reject(error);this.initial=null;
    this.post({kind:'dispose'});this.frame?.remove();this.frame=null;this.sources=null;
    for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(error);}this.pending.clear();
    for(const controller of this.requests.values())controller.abort();this.requests.clear();
  }
}
