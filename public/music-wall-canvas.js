export const albumAt=(column,row,columns,count)=>count?((row*columns+column)%count+count)%count:0;
export function dockScale(distance,radius,reduced=false){
  if(reduced||distance>=radius)return 1;
  return 1+.62*Math.pow(Math.cos(distance/radius*Math.PI/2),3);
}

export function mountAlbumCanvas({root,cover,escape,icon,onZoom=()=>{}}){
  let albums=[],collection='',currentId='',playing=false,loading=false,tile=176,columns=12;
  let x=-tile*.35,y=-tile*.3,zoom=1,frame=0,hover=null,drag=null,pinch=null,suppressClick=false;
  const cells=new Map(),pointers=new Map(),reduced=matchMedia('(prefers-reduced-motion: reduce)'),coarse=matchMedia('(pointer: coarse)');
  const bounds=()=>({width:root.clientWidth,height:root.clientHeight});
  function schedule(){if(!frame)frame=requestAnimationFrame(draw);}
  function draw(){
    frame=0;if(!albums.length)return;
    const {width,height}=bounds(),size=tile*zoom;
    const startColumn=Math.floor(-x/size)-1,endColumn=Math.ceil((width-x)/size)+1;
    const startRow=Math.floor(-y/size)-1,endRow=Math.ceil((height-y)/size)+1;
    const focusKey=hover?`${Math.floor((hover.x-x)/size)}:${Math.floor((hover.y-y)/size)}`:null;
    const visible=new Set();
    for(let row=startRow;row<endRow;row++)for(let column=startColumn;column<endColumn;column++){
      const key=`${column}:${row}`,album=albums[albumAt(column,row,columns,albums.length)];visible.add(key);
      let cell=cells.get(key);
      if(!cell){
        const node=document.createElement('div');node.className='canvas-cell';
        const tileNode=document.createElement('div');tileNode.className='album-tile';
        const button=document.createElement('button');button.className='album-card';
        const playButton=document.createElement('button');playButton.className='tile-play';
        tileNode.append(button,playButton);node.append(tileNode);root.append(node);
        cell={node,tile:tileNode,button,playButton,album:null,playbackKey:''};cells.set(key,cell);
      }
      if(cell.album!==album){
        cell.album=album;cell.button.dataset.album=album.id;cell.button.setAttribute('aria-label',`播放 ${album.name} · ${album.singer}`);
        cell.button.innerHTML=`${cover(album,true)}<span class="card-caption"><b>${escape(album.name)}</b><small>${escape(album.singer)}</small></span>`;
        cell.playButton.dataset.inlineAlbum=album.id;cell.playbackKey='';
      }
      const selected=album.tracks.some(track=>track.id===currentId);cell.button.classList.toggle('is-current',selected);cell.button.setAttribute('aria-pressed',String(selected));
      cell.tile.classList.toggle('is-current',selected);
      const playbackKey=`${selected}:${playing}:${loading}`;
      if(cell.playbackKey!==playbackKey){
        cell.playbackKey=playbackKey;
        cell.playButton.innerHTML=selected&&loading?'<i class="spinner"></i>':icon(selected&&playing?'pause':'play');
        cell.playButton.setAttribute('aria-label',`${selected&&loading?'取消加载':selected&&playing?'暂停':'播放'} ${album.name}`);
        cell.playButton.setAttribute('aria-pressed',String(selected&&playing));
        cell.playButton.setAttribute('aria-busy',String(selected&&loading));
      }
      const left=x+column*size,top=y+row*size;
      cell.node.style.width=cell.node.style.height=`${tile}px`;
      // A tiny overlap prevents subpixel seams while zooming. At rest covers touch edge to edge.
      cell.node.style.transform=`translate3d(${left}px,${top}px,0) scale(${zoom+0.001})`;
      const distance=hover?Math.hypot(hover.x-left-size/2,hover.y-top-size/2):Infinity;
      const scale=dockScale(distance,size*1.65,reduced.matches);
      cell.tile.style.transform=`scale(${scale.toFixed(4)})`;
      cell.tile.style.filter=focusKey&&key!==focusKey?'blur(4px)':'blur(0px)';
      cell.node.style.zIndex=String(key===focusKey?1000:Math.round((scale-1)*1000));
      cell.tile.classList.toggle('is-hovered',key===focusKey);
      cell.button.classList.toggle('is-magnified',scale>1.36);
      cell.tile.style.setProperty('--lift',String(Math.min(1,(scale-1)*2)));
    }
    for(const [key,cell] of cells)if(!visible.has(key)){cell.node.remove();cells.delete(key);}
    root.dataset.zoom=zoom.toFixed(3);onZoom(zoom);
  }
  function moveZoom(value,point){
    const next=Math.max(.55,Math.min(1.85,value));
    x=point.x-(point.x-x)*next/zoom;y=point.y-(point.y-y)*next/zoom;zoom=next;hover=null;schedule();
  }
  function local(event){const box=root.getBoundingClientRect();return{x:event.clientX-box.left,y:event.clientY-box.top};}
  root.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    const point=local(event);pointers.set(event.pointerId,point);suppressClick=false;
    if(pointers.size===1)drag={id:event.pointerId,start:point,last:point,moved:false};
    if(pointers.size===2){
      const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),zoom};
      if(drag)drag.moved=true;suppressClick=true;hover=null;
      root.setPointerCapture(event.pointerId);
    }
  });
  root.addEventListener('pointermove',event=>{
    const point=local(event);
    if(pointers.has(event.pointerId))pointers.set(event.pointerId,point);
    if(pinch&&pointers.size===2){
      const [a,b]=[...pointers.values()];moveZoom(pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance),{x:(a.x+b.x)/2,y:(a.y+b.y)/2});return;
    }
    if(drag&&pointers.has(event.pointerId)){
      if(Math.hypot(point.x-drag.start.x,point.y-drag.start.y)>6){drag.moved=true;root.setPointerCapture(event.pointerId);root.classList.add('is-dragging');}
      if(drag.moved){x+=point.x-drag.last.x;y+=point.y-drag.last.y;hover=null;suppressClick=true;}
      drag.last=point;
    }else if(!coarse.matches&&event.pointerType!=='touch')hover=point;
    schedule();
  });
  function release(event){
    pointers.delete(event.pointerId);if(root.hasPointerCapture(event.pointerId))root.releasePointerCapture(event.pointerId);
    if(drag?.moved)suppressClick=true;pinch=null;
    if(pointers.size===1){const [id,point]=[...pointers.entries()][0];drag={id,start:point,last:point,moved:true};}
    else{drag=null;root.classList.remove('is-dragging');}
    schedule();
  }
  root.addEventListener('pointerup',release);root.addEventListener('pointercancel',release);
  root.addEventListener('pointerleave',()=>{hover=null;schedule();});
  root.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;hover=null;schedule();}},true);
  root.addEventListener('wheel',event=>{
    event.preventDefault();
    if(event.shiftKey){x-=event.deltaY;hover=null;schedule();}
    else moveZoom(zoom*Math.exp(-event.deltaY*(event.ctrlKey ? .007 : .0012)),local(event));
  },{passive:false});
  root.addEventListener('keydown',event=>{
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
      event.preventDefault();if(event.key==='ArrowLeft')x+=tile;if(event.key==='ArrowRight')x-=tile;if(event.key==='ArrowUp')y+=tile;if(event.key==='ArrowDown')y-=tile;hover=null;schedule();
    }
    if(event.key==='+'||event.key==='='){event.preventDefault();api.zoomBy(1.15);}
    if(event.key==='-'){event.preventDefault();api.zoomBy(1/1.15);}
    if(event.key==='0'){event.preventDefault();api.reset();}
  });
  root.addEventListener('focusin',event=>{const node=event.target.closest('.canvas-cell');if(node){node.classList.add('is-focused');}});
  root.addEventListener('focusout',event=>event.target.closest('.canvas-cell')?.classList.remove('is-focused'));
  const observer=new ResizeObserver(()=>{tile=innerWidth<=600?132:176;schedule();});observer.observe(root);
  const api={
    setAlbums(value,key){
      albums=value;columns=Math.max(8,Math.ceil(Math.sqrt(albums.length*1.6)));
      if(key!==collection){collection=key;api.reset();}
      if(!albums.length){for(const cell of cells.values())cell.node.remove();cells.clear();}
      hover=null;schedule();
    },
    setPlayback(state){currentId=state.id||'';playing=state.playing;loading=state.loading;schedule();},
    zoomBy(factor){const {width,height}=bounds();moveZoom(zoom*factor,{x:width/2,y:height/2});},
    reset(){zoom=1;x=-tile*.35;y=-tile*.3;hover=null;schedule();},
    clearHover(){hover=null;schedule();},
    destroy(){observer.disconnect();cancelAnimationFrame(frame);}
  };
  return api;
}
