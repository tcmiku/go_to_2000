export function createGame() {
  return {size:9, mines:10, status:'ready', cells:Array.from({length:81},()=>({mine:false,open:false,flag:false,count:0})), exploded:-1};
}
export function neighbors(game,index) {
  const row=Math.floor(index/game.size),col=index%game.size, result=[];
  for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++) {
    const r=row+y,c=col+x;
    if((x||y)&&r>=0&&c>=0&&r<game.size&&c<game.size)result.push(r*game.size+c);
  }
  return result;
}
export function toggleFlag(game,index) {
  const cell=game.cells[index];
  if(!cell||cell.open||['won','lost'].includes(game.status))return;
  cell.flag=!cell.flag;
}
export function reveal(game,index,random=Math.random) {
  const cell=game.cells[index];
  if(!cell||cell.open||cell.flag||['won','lost'].includes(game.status))return;
  if(game.status==='ready') {
    const safe=new Set([index,...neighbors(game,index)]);
    const candidates=game.cells.map((_,i)=>i).filter(i=>!safe.has(i));
    for(let i=candidates.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
    for(const i of candidates.slice(0,game.mines))game.cells[i].mine=true;
    game.cells.forEach((c,i)=>{c.count=neighbors(game,i).filter(n=>game.cells[n].mine).length;});
    game.status='playing';
  }
  if(cell.mine){cell.open=true;game.exploded=index;game.status='lost';return;}
  const queue=[index];
  while(queue.length){const i=queue.pop(),c=game.cells[i];if(c.open||c.flag||c.mine)continue;c.open=true;if(c.count===0)queue.push(...neighbors(game,i));}
  if(game.cells.every(c=>c.mine||c.open)){game.status='won';game.cells.forEach(c=>{if(c.mine)c.flag=true;});}
}
