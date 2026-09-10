export function targetPosition(state,elapsed=0){return Math.max(0,Math.min(state.track?.duration||0,state.position+(state.playing?Math.max(0,elapsed)/1000:0)));}
export function playbackCorrection(actual,target){const drift=target-actual;return Math.abs(drift)>1?{seek:target,rate:1}:{seek:null,rate:Math.abs(drift)>.15?1+Math.sign(drift)*.03:1};}
