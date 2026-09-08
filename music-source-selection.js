// Probe through the browser's media loader: this also catches expired URLs,
// unsupported formats and responses that contain an error page instead of audio.
export function probeAudio(url,{signal,createAudio=()=>document.createElement('audio')}={}){
  return new Promise((resolve,reject)=>{
    const media=createAudio();media.preload='auto';media.muted=true;
    const clean=()=>{
      media.removeEventListener('canplay',ready);media.removeEventListener('error',failed);
      signal?.removeEventListener('abort',aborted);media.pause();media.removeAttribute('src');media.load();
    };
    const ready=()=>{clean();resolve();};
    const failed=()=>{clean();reject(new Error('播放地址无法加载音频'));};
    const aborted=()=>{clean();reject(signal.reason);};
    if(signal?.aborted){aborted();return;}
    media.addEventListener('canplay',ready,{once:true});media.addEventListener('error',failed,{once:true});
    signal?.addEventListener('abort',aborted,{once:true});
    try{media.src=url;media.load();}catch{failed();}
  });
}

export async function loadProbeTracks(records,signal){
  const usable=track=>track?.source==='wy'&&track.songmid&&typeof track.name==='string';
  const saved=records.filter(usable).slice(0,2);if(saved.length)return saved;
  const response=await fetch('/api/listening/search?q='+encodeURIComponent('许巍 蓝莲花')+'&page=1',{signal});
  if(!response.ok)throw new Error('暂时无法获取检测曲目');
  const data=await response.json(),tracks=(data.tracks||[]).filter(usable).slice(0,2);
  if(!tracks.length)throw new Error('没有可用于检测的曲目');return tracks;
}

function abortable(work,signal){
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>{signal.throwIfAborted();return work();}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}

export async function selectMusicSource({client,ids,preferred,tracks,quality='128k',signal,onAttempt=()=>{},probe=probeAudio,candidateTimeout=22000,trackTimeout=7000}){
  const ordered=[...new Set([preferred,...ids])].filter(id=>ids.includes(id));
  for(const [index,id] of ordered.entries()){
    signal.throwIfAborted();onAttempt(id,index+1,ordered.length);
    const attempt=AbortSignal.any([signal,AbortSignal.timeout(candidateTimeout)]);
    try{
      const {sources}=await abortable(()=>client.load(id),attempt);
      if(!sources?.wy?.actions?.includes('musicUrl')||!sources.wy.qualitys?.length)throw new Error('音源不支持当前曲库');
      for(const track of tracks){
        attempt.throwIfAborted();
        const sample=AbortSignal.any([attempt,AbortSignal.timeout(trackTimeout)]);
        try{
          const url=await abortable(()=>client.resolve(track,quality,sample),sample);
          await abortable(()=>probe(url,{signal:sample}),sample);
          attempt.throwIfAborted();return id;
        }catch(error){if(attempt.aborted)throw error;}
      }
    }catch(error){if(signal.aborted)throw signal.reason;}
    // Dispose only while this run still owns the client. A manual selection may
    // already have started a replacement run with the same client.
    signal.throwIfAborted();client.dispose();
  }
  throw new Error('所有音源暂时不可用，可稍后重新检测');
}
