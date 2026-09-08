import { $, readStorage, saveStorage, showToast } from './ui.js';
const melodies=[{name:'青色回忆',notes:[64,67,71,74,71,67,69,67,64,62,64,67,69,67,62,59]},{name:'千禧漫游',notes:[60,64,67,72,71,67,64,62,65,69,72,76,74,72,69,67]},{name:'星光信号',notes:[69,72,76,79,76,74,72,69,67,71,74,76,74,71,67,64]}];
let localTracks=[],audioContext,output,audio,track=0,playing=false,muted=false,elapsed=0,startedAt=0,tickTimer,nextNoteAt=0;
let doorOpen=false,playRequest=0,pendingPlay=false;
let changing=false,changeTarget=0,resumeAfterChange=false;
let effectsEnabled=readStorage('web-surfer-deck-effects',true)!==false;
let effectsContext,effectsUnlocked=false,effectsEpoch=0;
const effectSources=new Set();
const effectsToggle=document.createElement('button');
effectsToggle.type='button';effectsToggle.id='deck-effects';effectsToggle.textContent='♪';
effectsToggle.setAttribute('aria-label','机械音效');
effectsToggle.title='机械音效开关';
effectsToggle.setAttribute('aria-pressed',String(effectsEnabled));
$('.deck-indicators').append(effectsToggle);
function silenceEffects(){
  ++effectsEpoch;
  effectSources.forEach(source=>{try{source.stop();}catch{}});
  effectSources.clear();
}
// Short filtered noise and a low resonant tap imitate plastic keys and springs.
// Generated locally, with a separate low-volume output from the music.
async function mechanicalSound(kind){
  if(!effectsEnabled||muted||!effectsUnlocked||document.hidden)return;
  const epoch=effectsEpoch;
  try{
    if(!effectsContext){
      const Context=window.AudioContext||window.webkitAudioContext;
      effectsContext=new Context();
    }
    await effectsContext.resume();
    if(epoch!==effectsEpoch||!effectsEnabled||muted)return;
    const context=effectsContext;
    const presets={
      key:[[0,.025,1700,.06],[.035,.025,750,.04]],
      open:[[0,.035,900,.07],[.055,.16,2200,.025]],
      close:[[0,.06,450,.075],[.055,.03,1500,.055]],
      slide:[[0,.18,1300,.03],[.16,.035,550,.045]],
    };
    for(const [delay,length,frequency,volume] of presets[kind]||presets.key){
      const when=context.currentTime+delay;
      const noise=context.createBuffer(1,Math.ceil(context.sampleRate*length),context.sampleRate);
      const samples=noise.getChannelData(0);
      for(let i=0;i<samples.length;i++)samples[i]=Math.random()*2-1;
      const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
      source.buffer=noise;filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=.7;
      gain.gain.setValueAtTime(volume,when);gain.gain.exponentialRampToValueAtTime(.001,when+length);
      source.connect(filter).connect(gain).connect(context.destination);
      effectSources.add(source);
      source.onended=()=>{effectSources.delete(source);source.disconnect();filter.disconnect();gain.disconnect();};
      source.start(when);source.stop(when+length);
    }
  }catch{/* Audio permission or unsupported effects must not block the player. */}
}
effectsToggle.addEventListener('click',()=>{
  effectsUnlocked=true;effectsEnabled=!effectsEnabled;
  effectsToggle.setAttribute('aria-pressed',String(effectsEnabled));
  saveStorage('web-surfer-deck-effects',effectsEnabled);
  if(effectsEnabled)mechanicalSound('key');else silenceEffects();
});
function setDoor(open) {
  if(open!==doorOpen)mechanicalSound(open?'open':'close');
  if(open) pause();
  doorOpen=open;
  $('#deck-bay').classList.toggle('is-open',open);
  for(const id of ['#deck-door','#radio-eject']) {
    $(id).setAttribute('aria-expanded',String(open));
    $(id).setAttribute('aria-label',open?'关闭磁带舱盖':'打开磁带舱盖');
  }
  updatePlayer();
}
$('#deck-door').addEventListener('click',()=>{effectsUnlocked=true;if(!changing)setDoor(!doorOpen);});
$('#radio-eject').addEventListener('click',()=>{effectsUnlocked=true;if(!changing)setDoor(!doorOpen);});
// Keep a brief mechanical key stroke visible for both pointer and keyboard clicks.
document.querySelectorAll('.radio-controls button').forEach(button=>{
  let release;
  button.addEventListener('click',()=>{
    effectsUnlocked=true;
    mechanicalSound('key');
    clearTimeout(release);
    button.classList.add('key-down');
    release=setTimeout(()=>button.classList.remove('key-down'),160);
  });
});
const activeNotes=new Set(), trackList=()=>localTracks.length?localTracks:melodies, currentTrack=()=>trackList()[track]||melodies[0], duration=()=>audio?.duration&&Number.isFinite(audio.duration)?audio.duration:120;
const shellToggle=document.createElement('button');shellToggle.id='cassette-shell-toggle';shellToggle.type='button';shellToggle.className='caption-button icon-button';shellToggle.textContent='◈';shellToggle.setAttribute('aria-label','切换透明磁带外壳');shellToggle.title='透明磁带外壳';shellToggle.setAttribute('aria-pressed',String(readStorage('web-surfer-transparent-cassette',false)===true));
const titleActions=document.createElement('div');titleActions.className='titlebar-actions';const likeButton=$('#radio-like');likeButton.parentNode.insertBefore(titleActions,likeButton);titleActions.append(shellToggle,likeButton);
if(shellToggle.getAttribute('aria-pressed')==='true')$('#cassette').classList.add('transparent-shell');
const formatTime=s=>{const t=Math.max(0,Math.floor(s));return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;};
function timeNow(){return playing?(audio?audio.currentTime:Math.min(120,elapsed+(audioContext.currentTime-startedAt))):elapsed;}
function updatePlayer(){const time=Math.min(duration(),timeNow()),current=currentTrack();$('#radio-time').textContent=formatTime(time);$('#radio-duration').textContent='/ '+(current.src&&(!audio||!Number.isFinite(audio.duration))?'--:--':formatTime(duration()));$('#deck-led').classList.toggle('is-lit',playing);$('#deck-door-status').textContent=changing?(resumeAfterChange?'换带后播放':'正在更换磁带'):doorOpen?'舱盖已打开':playing?'正在播放':'磁带就绪';$('#seek').max=String(Math.max(1,Math.floor(duration())));$('#seek').value=String(Math.floor(time));$('#track-name').textContent=`0${track+1} · ${current.name}${current.src?' / 本地 MP3':' / 原创合成旋律'}`;$('#radio-play').textContent=(playing||(changing&&resumeAfterChange))?'Ⅱ':'▶';$('#radio-play').setAttribute('aria-label',changing?(resumeAfterChange?'取消换带后播放':'换带后播放'):playing?'暂停电台':'播放电台');$('#cassette').classList.toggle('playing',playing);const progress=Math.min(1,time/Math.max(1,duration()));$('#cassette').style.setProperty('--left-pack',String(1-progress*.35));$('#cassette').style.setProperty('--right-pack',String(.65+progress*.35));$('#tape-status').textContent=changing?'LOAD':doorOpen?'OPEN':playing?'PLAY':time>0?'PAUSE':'STOP';$('#radio-play').setAttribute('aria-pressed',String(playing));}
function stopNotes(){activeNotes.forEach(note=>{try{note.stop();}catch{}});activeNotes.clear();}
function scheduleNote(midi,time,noteDuration,volume,type){const oscillator=audioContext.createOscillator(),envelope=audioContext.createGain();oscillator.type=type;oscillator.frequency.value=440*2**((midi-69)/12);envelope.gain.setValueAtTime(0,time);envelope.gain.linearRampToValueAtTime(volume,time+.025);envelope.gain.exponentialRampToValueAtTime(.001,time+noteDuration);oscillator.connect(envelope).connect(output);oscillator.start(time);oscillator.stop(time+noteDuration+.03);activeNotes.add(oscillator);oscillator.onended=()=>{activeNotes.delete(oscillator);oscillator.disconnect();envelope.disconnect();};}
function tick(){if(!playing)return;if(audio){if(audio.ended||timeNow()>=duration()-.05){changeTrack(1);return;}updatePlayer();return;}if(timeNow()>=120){changeTrack(1);return;}while(nextNoteAt<audioContext.currentTime+.12){const index=Math.floor((elapsed+nextNoteAt-startedAt)/.3),notes=currentTrack().notes;scheduleNote(notes[((index%notes.length)+notes.length)%notes.length],nextNoteAt,.42,.13,'triangle');if(index%4===0)scheduleNote(notes[0]-24,nextNoteAt,.9,.12,'sine');nextNoteAt+=.3;}updatePlayer();}
function setupAudio(source){if(audio)audio.pause();audio=new window.Audio(source);audio.preload='metadata';audio.volume=muted?0:.7;audio.addEventListener('ended',()=>{if(playing)changeTrack(1);});audio.addEventListener('error',()=>{if(playing){pause();showToast('本地音乐暂时无法播放，请检查文件格式。');}});audio.addEventListener('loadedmetadata',updatePlayer);}
async function play(){
  if(changing){resumeAfterChange=true;return;}
  if(playing||pendingPlay)return;
  if(doorOpen)setDoor(false);
  const request=++playRequest, current=currentTrack();
  pendingPlay=true;
  try{
    if(current.src){
      if(!audio||audio.src!==new URL(current.src,location.href).href)setupAudio(current.src);
      const source=audio;
      if(elapsed>=duration())elapsed=0;
      source.currentTime=elapsed;
      await source.play();
      if(request!==playRequest)return;
    }else{
      if(!audioContext){
        const AudioContext=window.AudioContext||window.webkitAudioContext;
        audioContext=new AudioContext();output=audioContext.createGain();
        output.gain.value=muted?0:.6;output.connect(audioContext.destination);
      }
      await audioContext.resume();
      if(request!==playRequest)return;
      if(elapsed>=120)elapsed=0;
      startedAt=audioContext.currentTime;nextNoteAt=startedAt+.03;
    }
    playing=true;clearInterval(tickTimer);tickTimer=setInterval(tick,80);tick();
  }catch(error){
    if(request===playRequest&&error.name!=='AbortError')showToast('当前音频无法播放，请检查文件或声音权限后重试。');
  }finally{
    if(request===playRequest)pendingPlay=false;
  }
}
function pause(reset=false){
  ++playRequest;pendingPlay=false;
  elapsed=reset?0:Math.min(duration(),timeNow());playing=false;
  clearInterval(tickTimer);stopNotes();
  if(audio){audio.pause();if(reset)audio.currentTime=0;}
  updatePlayer();
}
const waitForDeck=ms=>new Promise(resolve=>setTimeout(resolve,window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:ms));
async function changeTrack(direction){
  const count=trackList().length;
  changeTarget=((changing?changeTarget:track)+direction+count)%count;
  if(changing)return;
  resumeAfterChange=playing||pendingPlay;
  changing=true;
  const bay=$('#deck-bay');
  bay.setAttribute('aria-busy','true');
  for(const id of ['#deck-door','#radio-eject','#seek'])$(id).disabled=true;
  pause(true);
  try{
    do{
      setDoor(true);
      await waitForDeck(350);
      bay.classList.add('tape-out');
      mechanicalSound('slide');
      await waitForDeck(300);
      track=changeTarget;
      if(audio){audio.pause();audio.removeAttribute('src');audio.load();audio=null;}
      const current=currentTrack();
      if(current.src)setupAudio(current.src);
      $('#cassette').dataset.side=String(track%3);
      $('.cassette-side').textContent=String(track+1).padStart(2,'0');
      updatePlayer();
      // Keep the empty bay visible briefly before the replacement slides in.
      await waitForDeck(90);
      bay.classList.remove('tape-out');
      mechanicalSound('slide');
      await waitForDeck(320);
      setDoor(false);
      await waitForDeck(400);
    }while(track!==changeTarget);
  }finally{
    changing=false;
    bay.classList.remove('tape-out');bay.setAttribute('aria-busy','false');
    for(const id of ['#deck-door','#radio-eject','#seek'])$(id).disabled=false;
    updatePlayer();
  }
  if(resumeAfterChange)play();
}
$('#radio-play').addEventListener('click',()=>{
  if(changing){resumeAfterChange=!resumeAfterChange;updatePlayer();return;}
  (playing||pendingPlay)?pause():play();
});
$('#radio-stop').addEventListener('click',()=>{resumeAfterChange=false;pause(true);});
$('#radio-next').addEventListener('click',()=>changeTrack(1));
$('#radio-previous').addEventListener('click',()=>changeTrack(-1));
$('#radio-mute').addEventListener('click',()=>{muted=!muted;if(muted)silenceEffects();if(output)output.gain.setValueAtTime(muted?0:.6,audioContext.currentTime);if(audio)audio.volume=muted?0:.7;$('#radio-mute').textContent=muted?'×':'♫';$('#radio-mute').setAttribute('aria-pressed',String(muted));$('#radio-mute').setAttribute('aria-label',muted?'取消静音':'静音');});
shellToggle.addEventListener('click',()=>{const transparent=!$('#cassette').classList.contains('transparent-shell');$('#cassette').classList.toggle('transparent-shell',transparent);shellToggle.setAttribute('aria-pressed',String(transparent));saveStorage('web-surfer-transparent-cassette',transparent);});
$('#seek').addEventListener('input',event=>{const value=Number(event.target.value),wasPlaying=playing;pause();elapsed=value;updatePlayer();if(wasPlaying)play();});let radioLiked=readStorage('web-surfer-radio-liked',false)===true;function updateLike(){$('#radio-like').textContent=radioLiked?'♥':'♡';$('#radio-like').setAttribute('aria-pressed',String(radioLiked));}$('#radio-like').addEventListener('click',()=>{radioLiked=!radioLiked;saveStorage('web-surfer-radio-liked',radioLiked);updateLike();});window.addEventListener('pagehide',()=>{resumeAfterChange=false;pause();silenceEffects();});
fetch('/api/radio',{cache:'no-store'}).then(response=>response.ok?response.json():null).then(data=>{if(data?.tracks?.length){pause(true);localTracks=data.tracks;track=0;updatePlayer();}}).catch(()=>{});updateLike();updatePlayer();
