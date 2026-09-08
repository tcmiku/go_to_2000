// No allow-same-origin: neither this frame nor its Worker can read app storage/cookies.
let worker;
window.addEventListener('message',event=>{
  if(event.source!==parent||!event.data||typeof event.data!=='object')return;
  if(event.data.kind==='boot') {
    worker?.terminate();
    const url=URL.createObjectURL(new Blob([event.data.runtime],{type:'text/javascript'}));
    worker=new Worker(url);URL.revokeObjectURL(url);
    worker.onmessage=({data})=>parent.postMessage(data,'*');
    worker.onerror=()=>parent.postMessage({kind:'error',error:'音源脚本运行失败'},'*');
    worker.postMessage({kind:'init',source:event.data.source});
  }else if(event.data.kind==='dispose'){worker?.terminate();worker=null;}
  else if(['resolve','network-result'].includes(event.data.kind))worker?.postMessage(event.data);
});
parent.postMessage({kind:'ready'},'*');
