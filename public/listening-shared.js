import { targetPosition, playbackCorrection } from './together-sync.js';

// Transport adapter for the original listening-room player. The room page owns
// membership and HTTP; this adapter owns only media timing and the shared deck.
export function createSharedListeningPlayer({audio,load,clear,resolveTrack,refresh,onNotice=()=>{},now=()=>performance.now()}) {
  let transport=null,state=null,anchor=0,key='',generation=0,loading=false,connected=false,blocked=false,starting=false,forceSeek=false;
  function notify(message){onNotice(message);transport?.notice?.(message);}
  async function start(){
    if(starting)return;starting=true;const token=generation;
    try{await audio.play();if(token!==generation)return;blocked=false;transport?.audioBlocked?.(false);}
    catch(error){if(token!==generation)return;blocked=true;transport?.audioBlocked?.(true);notify(error.name==='NotAllowedError'?'已同步房间，按唱片机播放键或点击“打开声音”。':'音频暂时无法播放，请重新点歌或更换音源。');}
    finally{if(token===generation){starting=false;if(!connected||!state?.playing)audio.pause();}}
  }
  function sync(){
    if(!connected||!state?.track||loading)return;
    const position=targetPosition(state,now()-anchor),finished=position>=state.track.duration;
    if(audio.readyState>=1){
      const correction=playbackCorrection(audio.currentTime,position);
      if(forceSeek||correction.seek!==null){audio.currentTime=Math.min(position,Number.isFinite(audio.duration)?audio.duration:position);forceSeek=false;}
      audio.playbackRate=correction.rate;
      if(!state.playing||finished)audio.pause();else if(audio.paused&&!blocked)void start();
    }
    refresh();
  }
  const api={
    connect(value){transport=value;},
    setConnected(value){connected=value;if(!value)audio.pause();else sync();},
    async setState(value){
      if(!value){api.reset();return;}
      const revised=state?.revision!==value.revision;
      forceSeek ||= revised;state=value;anchor=now();connected=true;
      const next=value.track?value.track.id+'\n'+value.track.src:'';
      if(next!==key||(revised&&audio.error)){
        key=next;const token=++generation;loading=true;blocked=false;starting=false;transport?.audioBlocked?.(false);
        try{if(value.track)await load(value.track);else clear();}
        catch(error){if(token===generation){blocked=true;notify(error.message||'唱片加载失败，请重新点歌。');}}
        finally{if(token===generation){loading=false;forceSeek=true;sync();}}
      }else sync();
    },
    select(track){if(!connected){notify('请先创建或加入房间。');return;}transport?.select?.(track);},
    command(command,extra={}){if(!connected){notify('请先创建或加入房间。');return;}transport?.control?.(command,extra);},
    toggle(){if(blocked&&state?.playing){api.unlock();return;}api.command(state?.playing?'pause':'play');},
    unlock(){if(!connected||!state?.track)return;blocked=false;if(!loading&&audio.readyState>=1){audio.currentTime=targetPosition(state,now()-anchor);if(state.playing)void start();}},
    resolve:resolveTrack,
    sync,
    reset(){generation++;state=null;key='';loading=false;connected=false;blocked=false;starting=false;forceSeek=false;audio.playbackRate=1;clear();transport?.audioBlocked?.(false);},
    get track(){return state?.track||null;},
    get ready(){return connected;},
  };
  for(const event of ['loadedmetadata','canplay'])audio.addEventListener(event,sync);
  return api;
}

export function readAudioDuration(src,signal,createAudio=()=>new Audio()) {
  return new Promise((resolve,reject)=>{
    const media=createAudio();
    const cleanup=()=>{signal.removeEventListener('abort',abort);media.onloadedmetadata=media.onerror=null;media.removeAttribute('src');media.load();};
    const abort=()=>{cleanup();reject(new Error('歌曲加载超时或已取消，请重试'));};
    media.onloadedmetadata=()=>{const duration=media.duration;cleanup();Number.isFinite(duration)&&duration>0?resolve(duration):reject(new Error('无法读取歌曲时长'));};
    media.onerror=()=>{cleanup();reject(new Error('歌曲音频无法加载，请尝试其他音源'));};
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)return abort();media.preload='metadata';media.src=src;
  });
}
