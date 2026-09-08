// Short physical foley, synthesized locally; no media requests or autoplay.
let context,output,noise;
let muted=false;
try{muted=localStorage.getItem('cd-wall-muted')==='true';}catch{}
export const isMuted=()=>muted;
export function setMuted(value){muted=value;if(output)output.gain.setTargetAtTime(muted?0:.32,context.currentTime,.015);try{localStorage.setItem('cd-wall-muted',String(muted));}catch{}}
function init(){
  const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return false;
  if(!context){
    context=new Audio();output=context.createGain();output.gain.value=.32;output.connect(context.destination);
    noise=context.createBuffer(1,context.sampleRate,context.sampleRate);
    const samples=noise.getChannelData(0);let last=0;
    for(let i=0;i<samples.length;i++){last=.65*last+.35*(Math.random()*2-1);samples[i]=last;}
  }
  if(context.state==='suspended')context.resume().catch(()=>{});
  return true;
}
function friction(at,duration,frequency,volume){
  const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
  source.buffer=noise;filter.type='bandpass';filter.frequency.setValueAtTime(frequency,at);filter.frequency.exponentialRampToValueAtTime(frequency*.65,at+duration);filter.Q.value=.7;
  gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume,at+.012);gain.gain.exponentialRampToValueAtTime(.001,at+duration);
  source.connect(filter);filter.connect(gain);gain.connect(output);source.start(at);source.stop(at+duration+.01);
  source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
}
function tap(at,frequency,volume,duration=.085){
  const source=context.createOscillator(),gain=context.createGain();source.type='triangle';
  source.frequency.setValueAtTime(frequency,at);source.frequency.exponentialRampToValueAtTime(frequency*.55,at+duration);
  gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume,at+.002);gain.gain.exponentialRampToValueAtTime(.001,at+duration);
  source.connect(gain);gain.connect(output);source.start(at);source.stop(at+duration+.01);
  source.onended=()=>{source.disconnect();gain.disconnect();};
}
export function playSound(kind){
  if(muted)return;
  try{
    if(!init())return;const at=context.currentTime+.008;
    if(kind==='pull'){friction(at,.24,1500,.24);friction(at+.08,.17,2600,.12);tap(at,380,.09);}
    else if(kind==='open'){friction(at,.045,3600,.45);tap(at,1550,.18,.035);tap(at+.035,820,.08,.055);friction(at+.08,.13,1800,.09);}
    else if(kind==='close'){tap(at,1120,.2,.045);friction(at,.035,3200,.35);tap(at+.045,650,.15,.07);}
    else if(kind==='place'){friction(at,.09,800,.15);tap(at,180,.26,.12);tap(at+.032,340,.1,.085);}
    else if(kind==='paper'){friction(at,.07,2200,.17);}
    else if(kind==='disc'){tap(at,1900,.1,.04);friction(at,.045,2800,.16);}
  }catch{/* Sound must never interrupt navigation or case animation. */}
}
