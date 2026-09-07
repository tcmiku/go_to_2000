import {readStorage,saveStorage} from './ui.js';

const W=340,H=540,R=7;
export const bumpers=[{x:118,y:155,r:24},{x:211,y:167,r:24},{x:166,y:239,r:21}];
const rails=[[24,48,55,22],[55,22,277,22],[277,22,318,58],[24,48,24,420],[318,58,318,520],[291,140,291,520],[24,420,96,459],[291,420,238,459],[50,335,104,388],[264,335,224,388]];
export function createPinball(){return{ball:{x:305,y:494,vx:0,vy:0},score:0,lives:3,status:'ready',left:0,right:0,flash:0};}
export function launchPinball(g){if(g.status!=='ready')return;g.ball={x:305,y:494,vx:-30,vy:-910};g.status='playing';}
function segment(b,x1,y1,x2,y2,r=R){
  const dx=x2-x1,dy=y2-y1,t=Math.max(0,Math.min(1,((b.x-x1)*dx+(b.y-y1)*dy)/(dx*dx+dy*dy)));
  const px=x1+t*dx,py=y1+t*dy,d=Math.hypot(b.x-px,b.y-py);
  if(d>=r)return false;
  const nx=d?(b.x-px)/d:0,ny=d?(b.y-py)/d:-1;
  b.x=px+nx*(r+.2);b.y=py+ny*(r+.2);
  const speed=b.vx*nx+b.vy*ny;
  if(speed<0){b.vx-=1.82*speed*nx;b.vy-=1.82*speed*ny;}
  return true;
}
export function stepPinball(g,dt,input={}){
  g.left+=(Number(!!input.left)-g.left)*Math.min(1,dt*24);
  g.right+=(Number(!!input.right)-g.right)*Math.min(1,dt*24);
  g.flash=Math.max(0,g.flash-dt);
  if(g.status!=='playing')return;
  const b=g.ball;
  b.vy+=420*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;
  for(const rail of rails)segment(b,...rail);
  if(b.y<115&&b.x>270){b.vx=Math.min(b.vx,-210);}
  for(const p of bumpers){
    const dx=b.x-p.x,dy=b.y-p.y,d=Math.hypot(dx,dy);
    if(d<p.r+R){
      const nx=d?dx/d:0,ny=d?dy/d:-1;
      b.x=p.x+nx*(p.r+R+.5);b.y=p.y+ny*(p.r+R+.5);
      b.vx=nx*390;b.vy=ny*390;g.score+=100;g.flash=.15;
    }
  }
  for(const [x,end,amount,held] of [[96,157,g.left,input.left],[238,177,g.right,input.right]]){
    if(segment(b,x,459,end,480-amount*46,R+7)&&held){
      b.vy=-620;b.vx=(170-b.x)*3;g.score+=10;
    }
  }
  const speed=Math.hypot(b.vx,b.vy);
  if(speed>1000){b.vx*=1000/speed;b.vy*=1000/speed;}
  if(b.y>H+R){
    g.lives--;g.status=g.lives?'ready':'over';g.ball={x:305,y:494,vx:0,vy:0};
  }
}

export function mountPinball(menu){
  const item=document.createElement('button');
  item.type='button';item.setAttribute('role','menuitem');item.dataset.startAction='pinball';
  item.innerHTML='<span aria-hidden="true">◉</span>3D 弹球';menu.append(item);
  const dialog=document.createElement('dialog');
  dialog.className='window pinball-window';dialog.setAttribute('aria-labelledby','pinball-title');
  dialog.innerHTML='<div class="titlebar"><h2 id="pinball-title">◉ 3D 弹球 · SPACE SURFER</h2><button class="caption-button" data-close aria-label="关闭弹球">×</button></div><div class="pinball-toolbar"><button data-new>新游戏</button><button data-pause aria-pressed="false">暂停</button><span>太空冲浪 / 1998</span></div><div class="pinball-score"><span>得分 <output data-score>000000</output></span><span>剩余球 <output data-lives>3</output></span><span>最高分 <output data-best>0</output></span></div><canvas width="680" height="1080" tabindex="0" aria-label="弹球球台：左右方向键或 A、D 操作挡板，空格发球，P 暂停"></canvas><p class="pinball-status" role="status"></p><div class="pinball-controls"><button data-flipper="left" aria-label="左挡板">◀ 左挡板</button><button data-launch>弹射发球</button><button data-flipper="right" aria-label="右挡板">右挡板 ▶</button></div><p class="pinball-help">← → / A D 挡板 · 空格发球 · P 暂停</p>';
  document.body.append(dialog);
  const canvas=dialog.querySelector('canvas'),ctx=canvas.getContext('2d'),status=dialog.querySelector('.pinball-status');
  let game=createPinball(),paused=false,frame=0,last=0,best=Number(readStorage('surfer-pinball-best',0))||0;
  const keys=new Set(),touch=new Set();
  const input=()=>({left:keys.has('arrowleft')||keys.has('a')||touch.has('left'),right:keys.has('arrowright')||keys.has('d')||touch.has('right')});
  // Perspective projection: distant objects shrink; height lifts the solid surfaces.
  function project(x,y,z=0){const scale=.72+y/H*.28;return{x:W/2+(x-W/2)*scale,y:24+y*.91-z};}
  function path(points,fill,stroke){
    ctx.beginPath();points.forEach(([x,y,z],i)=>{const p=project(x,y,z);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});ctx.closePath();
    if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}
  }
  function disc(x,y,r,z,fill,stroke){
    path(Array.from({length:32},(_,i)=>[x+Math.cos(i*Math.PI/16)*r,y+Math.sin(i*Math.PI/16)*r,z]),fill,stroke);
  }
  function rail(x1,y1,x2,y2,color='#6599b2'){
    path([[x1,y1,0],[x2,y2,0],[x2,y2,12],[x1,y1,12]],'#25374f',color);
    const a=project(x1,y1,12),b=project(x2,y2,12);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=4;ctx.stroke();
  }
  function draw(){
    ctx.setTransform(2,0,0,2,0,0);ctx.fillStyle='#080d1d';ctx.fillRect(0,0,W,H);
    path([[8,9,0],[330,9,0],[330,530,0],[8,530,0]],'#162741','#70859a');
    for(let y=40;y<510;y+=30)for(let x=38;x<280;x+=30){const p=project(x,y);ctx.fillStyle='#28415d';ctx.fillRect(p.x,p.y,1,1);}
    ctx.textAlign='center';ctx.font='bold 20px monospace';ctx.fillStyle='#c2ddeb';ctx.fillText('SPACE SURFER',W/2,98);
    ctx.font='10px monospace';ctx.fillStyle='#77bdd3';ctx.fillText('★  BUMPER +100  ★',W/2,117);
    path([[70,310,0],[100,350,0],[120,310,0]],'#364575','#968fda');
    path([[220,310,0],[242,350,0],[270,310,0]],'#364575','#968fda');
    for(const r of rails)rail(...r);
    for(const p of bumpers){
      disc(p.x+3,p.y+7,p.r+3,0,'#050b19');
      disc(p.x,p.y,p.r,3,'#793843','#a95458');
      disc(p.x,p.y,p.r,13,game.flash?'#fff0a3':'#ed8f61','#ffd9a1');
      disc(p.x,p.y,p.r*.62,15,'#673951','#ffc089');
      const pos=project(p.x,p.y,15);ctx.fillStyle='#fff2ac';ctx.font='bold 15px monospace';ctx.fillText('★',pos.x,pos.y+5);
    }
    for(const [x,end,amount] of [[96,157,game.left],[238,177,game.right]]){
      rail(x,459,end,480-amount*46,'#ffcc77');
      disc(x,459,7,13,'#eae3c5','#fff');
    }
    const ball=game.ball,p=project(ball.x,ball.y,9);
    disc(ball.x+3,ball.y+5,R,0,'#0009');
    const gradient=ctx.createRadialGradient(p.x-2,p.y-3,1,p.x,p.y,R);
    gradient.addColorStop(0,'#fff');gradient.addColorStop(.35,'#d5e7f7');gradient.addColorStop(1,'#435c77');
    ctx.beginPath();ctx.arc(p.x,p.y,R,0,Math.PI*2);ctx.fillStyle=gradient;ctx.fill();
    if(paused||game.status==='over'){
      ctx.fillStyle='#030816b8';ctx.fillRect(25,230,290,65);ctx.fillStyle='#fff1c7';ctx.font='bold 23px monospace';ctx.fillText(paused?'PAUSED':'GAME OVER',170,270);
    }
    dialog.querySelector('[data-score]').textContent=String(game.score).padStart(6,'0');
    dialog.querySelector('[data-lives]').textContent=game.lives;
    dialog.querySelector('[data-best]').textContent=best;
    const message=paused?'已暂停，按 P 或“继续”返回。':game.status==='ready'?'按空格或“弹射发球”发射钢珠。':game.status==='over'?'本局结束，点击“新游戏”再来一局。':'击中撞击柱 +100 · 挡板救球 +10';
    if(status.textContent!==message)status.textContent=message;
    dialog.querySelector('[data-launch]').disabled=paused||game.status!=='ready';
  }
  function loop(time){
    if(!dialog.open)return;
    let dt=Math.min((time-last)/1000,.05);last=time;
    if(!paused)while(dt>0){const step=Math.min(dt,1/120);stepPinball(game,step,input());dt-=step;}
    if(game.score>best){best=game.score;saveStorage('surfer-pinball-best',best);}
    draw();frame=requestAnimationFrame(loop);
  }
  function pause(on=!paused){paused=on;keys.clear();touch.clear();const b=dialog.querySelector('[data-pause]');b.textContent=on?'继续':'暂停';b.setAttribute('aria-pressed',String(on));draw();}
  item.addEventListener('click',()=>{dialog.showModal();last=performance.now();pause(false);canvas.focus();frame=requestAnimationFrame(loop);});
  dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.querySelector('[data-new]').onclick=()=>{game=createPinball();pause(false);canvas.focus();};
  dialog.querySelector('[data-pause]').onclick=()=>pause();
  dialog.querySelector('[data-launch]').onclick=()=>{if(!paused)launchPinball(game);canvas.focus();};
  dialog.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase();
    if(['arrowleft','arrowright','a','d',' ','p'].includes(key)){
      event.preventDefault();event.stopPropagation();
      if(key===' '&&!event.repeat&&!paused)launchPinball(game);
      else if(key==='p'&&!event.repeat)pause();
      else keys.add(key);
    }
  });
  dialog.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));
  dialog.querySelectorAll('[data-flipper]').forEach(button=>{
    button.addEventListener('pointerdown',event=>{button.setPointerCapture(event.pointerId);touch.add(button.dataset.flipper);});
    for(const name of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(name,()=>touch.delete(button.dataset.flipper));
  });
  window.addEventListener('blur',()=>{if(dialog.open)pause(true);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open)pause(true);});
  dialog.addEventListener('close',()=>{cancelAnimationFrame(frame);keys.clear();touch.clear();document.querySelector('#start-button').focus();});
}
