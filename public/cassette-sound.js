// Mechanical foley only: no downloads, continuous tape hiss or audio on entry.
export class CassetteSound {
  constructor({enabled=true,level=()=>1,hidden=()=>document.hidden,createContext=()=>{
    const Audio=window.AudioContext||window.webkitAudioContext;return Audio?new Audio():null;
  }}={}){Object.assign(this,{enabled,level,hidden,createContext});this.sources=new Set();this.epoch=0;this.unlocked=false;}
  unlock(){this.unlocked=true;}
  setEnabled(value){this.enabled=value;if(!value)this.silence();}
  silence(){this.epoch++;for(const source of this.sources){try{source.stop();}catch{}}this.sources.clear();}
  async play(kind='key'){
    if(!this.enabled||!this.unlocked||this.hidden()||this.level()<=0)return;
    const epoch=this.epoch;
    try{
      if(!this.context){
        const context=this.createContext();if(!context)return;this.context=context;
        this.output=context.createGain();this.output.connect(context.destination);
        this.noise=context.createBuffer(1,Math.ceil(context.sampleRate*.4),context.sampleRate);
        const samples=this.noise.getChannelData(0);let last=0;
        for(let i=0;i<samples.length;i++){last=last*.45+(Math.random()*2-1)*.55;samples[i]=last;}
      }
      const context=this.context;
      if(context.state==='suspended')await context.resume();
      if(epoch!==this.epoch||!this.enabled||this.hidden()||this.level()<=0)return;
      // Limit simultaneous voices when keys are pressed repeatedly.
      if(this.sources.size>=8)this.silence();
      this.output.gain.setValueAtTime(Math.min(1,this.level())*.45,context.currentTime);
      const presets={key:[[0,.022,2100,.17],[.027,.035,620,.12]],stop:[[0,.04,550,.2],[.045,.025,1450,.12]],open:[[0,.03,2300,.16],[.045,.14,1050,.1]],close:[[0,.055,440,.23],[.045,.024,1900,.14]],slide:[[.08,.24,1250,.09]],seat:[[0,.07,360,.2],[.035,.024,1800,.11]],wind:[[0,.2,1700,.075],[.17,.027,650,.12]],dial:[[0,.012,2200,.085]]};
      for(const [offset,length,frequency,volume] of presets[kind]||presets.key){
        const at=context.currentTime+.004+offset,source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
        source.buffer=this.noise;filter.type='bandpass';filter.frequency.value=frequency;filter.Q.value=.8;
        gain.gain.setValueAtTime(.001,at);gain.gain.linearRampToValueAtTime(volume,at+.003);gain.gain.exponentialRampToValueAtTime(.001,at+length);
        source.connect(filter).connect(gain).connect(this.output);this.sources.add(source);
        source.onended=()=>{this.sources.delete(source);source.disconnect();filter.disconnect();gain.disconnect();};
        source.start(at);source.stop(at+length+.005);
      }
    }catch{/* Unsupported or blocked audio never blocks the podcast player. */}
  }
  dispose(){this.silence();try{this.context?.close()?.catch(()=>{});}catch{}this.context=null;this.output=null;this.noise=null;this.unlocked=false;}
}
