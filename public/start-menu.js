import {$} from './ui.js';
import {createGame,reveal,toggleFlag} from './minesweeper.js';
import {mountSnakeGame} from './snake.js';
import {mountPinball} from './pinball.js';

const start=$('#start-button'), menu=$('#start-menu'), accessories=$('#accessories-button'), accessoriesWrap=accessories.parentElement, submenu=$('#accessories-menu');
const gameDialog=$('#mines-dialog'),board=$('#mine-board');
mountSnakeGame(submenu);
mountPinball(submenu);
let game=createGame(),flagMode=false,startedAt=0,elapsed=0,timer;
function showAccessories(on){submenu.hidden=!on;accessories.setAttribute('aria-expanded',String(on));}
function closeMenu(focus=false){menu.hidden=true;start.setAttribute('aria-expanded','false');showAccessories(false);if(focus)start.focus();}
start.onclick=()=>{const opening=menu.hidden;menu.hidden=!opening;start.setAttribute('aria-expanded',String(opening));if(opening)menu.querySelector('[role=menuitem]').focus();else showAccessories(false);};
accessories.onclick=()=>showAccessories(true);
accessories.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse'&&window.matchMedia('(min-width: 461px)').matches)showAccessories(true);});
accessoriesWrap.addEventListener('pointerleave',event=>{if(event.pointerType==='mouse'&&window.matchMedia('(min-width: 461px)').matches)showAccessories(false);});
document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!start.contains(event.target))closeMenu();});
menu.addEventListener('click',event=>{
  const action=event.target.closest('[data-start-action]');if(!action)return;
  closeMenu();
  if(action.dataset.startAction==='mines'){gameDialog.showModal();draw();startTimer();}
  if(action.dataset.startAction==='search'){$('#site-search').focus();$('#site-search').select();$('#directory').scrollIntoView({block:'start'});}
  if(action.dataset.startAction==='about')$('#about-dialog').showModal();
  if(action.dataset.startAction==='directory'||action.dataset.startAction==='favorites'){$('#directory').scrollIntoView({block:'start'});$('#site-search').focus();}
});
menu.addEventListener('keydown',event=>{
  if(event.key==='Tab'){closeMenu(true);return;}
  const inSub=submenu.contains(event.target);
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(inSub){showAccessories(false);accessories.focus();}else closeMenu(true);return;}
  if(event.key==='ArrowRight'&&event.target===accessories){event.preventDefault();showAccessories(true);submenu.querySelector('button').focus();return;}
  if(event.key==='ArrowLeft'&&inSub){event.preventDefault();showAccessories(false);accessories.focus();return;}
  const items=[...(inSub?submenu:menu).querySelectorAll('[role=menuitem]')].filter(el=>inSub||!submenu.contains(el));
  const index=items.indexOf(event.target);
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
    event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next].focus();
  }
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden)closeMenu(true);});
function clock(){if(game.status==='playing')elapsed=Math.floor((Date.now()-startedAt)/1000);$('#mine-time').textContent=String(Math.min(999,elapsed)).padStart(3,'0');}
function startTimer(){clearInterval(timer);timer=setInterval(clock,250);}
function draw(){
  const active=board.contains(document.activeElement)?Number(document.activeElement.dataset.cell):null;
  $('#mine-count').textContent=String(game.mines-game.cells.filter(c=>c.flag).length).padStart(3,'0');
  $('#mine-new').textContent=game.status==='lost'?'☹':game.status==='won'?'😎':'☺';
  $('#mine-status').textContent=game.status==='won'?'成功！所有安全格都找到了。':game.status==='lost'?'踩到地雷了，点击笑脸再来一局。':game.status==='ready'?'9 × 9 · 10 颗雷 · 第一次点击安全':'左键翻格 · 右键或 F 键插旗';
  $('#mine-flag-mode').setAttribute('aria-pressed',String(flagMode));
  $('#mine-flag-mode').textContent=flagMode?'⚑ 插旗模式':'⚑ 切换插旗';
  board.innerHTML=game.cells.map((c,i)=>{
    const lost=game.status==='lost',showMine=lost&&c.mine,wrong=lost&&c.flag&&!c.mine;
    const text=wrong?'×':c.flag?'⚑':showMine?'✹':c.open?(c.count||''):'';
    const label=`第 ${Math.floor(i/9)+1} 行，第 ${i%9+1} 列，${wrong?'标记错误':showMine?'地雷':c.flag?'已插旗':c.open?(c.count?`周围 ${c.count} 颗雷`:'空白'):'未翻开'}`;
    return `<button type="button" class="mine-cell ${c.open||showMine?'open':''} ${c.flag?'flagged':''} ${i===game.exploded?'exploded':''}" data-cell="${i}" data-count="${c.open?c.count:0}" aria-label="${label}" ${['won','lost'].includes(game.status)?'aria-disabled="true"':''}>${text}</button>`;
  }).join('');
  if(active!==null)board.querySelector(`[data-cell="${active}"]`)?.focus({preventScroll:true});
  clock();
}
function act(index,flag=false){
  if(flag)toggleFlag(game,index);else{const before=game.status;reveal(game,index);if(before==='ready'&&game.status!=='ready')startedAt=Date.now();}
  draw();
}
board.onclick=event=>{const cell=event.target.closest('[data-cell]');if(cell)act(Number(cell.dataset.cell),flagMode);};
board.oncontextmenu=event=>{event.preventDefault();const cell=event.target.closest('[data-cell]');if(cell)act(Number(cell.dataset.cell),true);};
board.onkeydown=event=>{
  const cell=event.target.closest('[data-cell]');if(!cell)return;const index=Number(cell.dataset.cell);
  if(event.key.toLowerCase()==='f'){event.preventDefault();act(index,true);return;}
  const row=Math.floor(index/9),col=index%9;
  const next={ArrowLeft:row*9+Math.max(0,col-1),ArrowRight:row*9+Math.min(8,col+1),ArrowUp:Math.max(0,row-1)*9+col,ArrowDown:Math.min(8,row+1)*9+col}[event.key];
  if(next!==undefined){event.preventDefault();board.querySelector(`[data-cell="${next}"]`).focus();}
};
$('#mine-new').onclick=()=>{game=createGame();startedAt=0;elapsed=0;draw();};
$('#mine-flag-mode').onclick=()=>{flagMode=!flagMode;draw();};
$('#mine-close').onclick=()=>gameDialog.close();
gameDialog.addEventListener('close',()=>{clearInterval(timer);start.focus();});
