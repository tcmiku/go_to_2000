export const defaultAd = {enabled:true,title:'好消息！冲浪时间到了！',text:'发现互联网里的宝藏小站，今天也要快乐冲浪！',image:'/assets/art/retro-web-hero-v1.png',url:'',button:'立即看看'};

export function validateAd(value) {
  const ad = value === undefined ? {...defaultAd} : value;
  if (!ad || typeof ad.enabled !== 'boolean') throw new Error('广告开关格式无效');
  for (const [key,max] of Object.entries({title:80,text:500,image:500,url:2000,button:30})) {
    if(typeof ad[key] !== 'string' || ad[key].length>max) throw new Error('广告内容格式无效或过长');
  }
  if(ad.enabled && (!ad.title.trim() || !ad.text.trim())) throw new Error('请填写广告标题和正文');
  if(ad.image && !/^\/assets\/(?:[\w-]+\/)*[\w-]+\.(?:png|svg)$/.test(ad.image)) throw new Error('广告图片请使用 /assets/ 下的 PNG 或 SVG 路径');
  if(ad.url) {let url;try{url=new URL(ad.url);}catch{throw new Error('广告跳转地址无效');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('广告地址仅支持 HTTP/HTTPS');}
  return Object.fromEntries(Object.keys(defaultAd).map(key=>[key,ad[key]]));
}

let shown = false;
export function showRetroAd(value) {
  const ad = validateAd(value);
  if(shown || !ad.enabled) return;
  try {if(localStorage.getItem('web-surfer-hide-ad')==='1') return;} catch {}
  shown = true;
  const box=document.createElement('aside');
  box.className='retro-ad window';box.setAttribute('aria-label','站内广告');
  box.innerHTML='<div class="titlebar"><b>互联网特别放送 · 广告</b><span class="retro-ad-countdown" aria-live="polite">5s</span><button class="caption-button" aria-label="关闭广告" title="关闭广告">×</button></div><div class="retro-ad-body"><div class="retro-ad-ribbon">★ SPECIAL OFFER ★</div><h2></h2><img alt="广告配图"><p class="retro-ad-copy"></p><a class="button primary" target="_blank" rel="noopener noreferrer"></a><div class="retro-ad-playground"><button type="button" class="retro-ad-runner">来抓我呀！</button></div><small>上面的淘气按钮会躲开鼠标，右上角可直接关闭。</small><label class="retro-ad-optout"><input type="checkbox"> 永不显示此广告</label><p class="retro-ad-storage" role="status"></p></div>';
  box.querySelector('h2').textContent=ad.title;
  box.querySelector('.retro-ad-copy').textContent=ad.text;
  const img=box.querySelector('img');img.hidden=!ad.image;if(ad.image)img.src=ad.image;img.onerror=()=>{img.hidden=true;};
  const link=box.querySelector('a');link.hidden=!ad.url;link.textContent=ad.button||'立即看看';if(ad.url)link.href=ad.url;
  const dismiss=box.querySelector('.caption-button');
  const countdown=box.querySelector('.retro-ad-countdown');
  let seconds=5;
  const timer=setInterval(()=>{seconds-=1;countdown.textContent=`${seconds}s`;if(seconds<=0)clearInterval(timer);},1000);
  dismiss.onclick=()=>{clearInterval(timer);const focused=box.contains(document.activeElement);box.remove();if(focused)document.querySelector('#start-button')?.focus();};
  setTimeout(()=>{if(box.isConnected)dismiss.click();},5000);
  box.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();dismiss.click();}});
  box.querySelector('input').onchange=event=>{
    try {if(event.target.checked)localStorage.setItem('web-surfer-hide-ad','1');else localStorage.removeItem('web-surfer-hide-ad');box.querySelector('.retro-ad-storage').textContent='';}
    catch {box.querySelector('.retro-ad-storage').textContent='浏览器无法保存偏好，下次打开仍可能显示。';}
  };
  const runner=box.querySelector('.retro-ad-runner'), area=box.querySelector('.retro-ad-playground');
  runner.onpointerenter=event=>{if(event.pointerType!=='mouse'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;const width=area.clientWidth-runner.offsetWidth;runner.style.left=runner.offsetLeft<width/2?width+'px':'0px';};
  runner.onclick=()=>{runner.textContent='抓到啦！';runner.onpointerenter=null;};
  document.body.append(box);
}
