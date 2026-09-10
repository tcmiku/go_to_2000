const $=s=>document.querySelector(s);
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const slogan='谁都未曾听过的初始之音，——来自未来的访客';
const pictureRoot='https://raw.githubusercontent.com/tcmiku/picgo/main/img/';
const categoryImages={'教程':'1673431932554.jpg','HCIE笔记':'1666706075263.jpg','Python':'-5dbebfceaa1510bf.jpg','开发':'1675320969463.jpg'};
let subtitles=[slogan];
let observer,typingTimer,typingVersion=0,toastTimer,liveStarted=false;
const pref={get(k){try{return localStorage.getItem('surfer.blog.'+k);}catch{return null;}},set(k,v){try{localStorage.setItem('surfer.blog.'+k,v);}catch{}}};
function element(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function toast(text){$('#blog-toast').textContent=text;$('#blog-toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#blog-toast').hidden=true,2500);}
function link(text,url){const a=element('a',text);a.href=url;return a;}
export function groupArchives(posts){const groups=new Map();for(const p of posts){const month=p.date.slice(0,7);groups.set(month,(groups.get(month)||0)+1);}return [...groups].sort(([a],[b])=>b.localeCompare(a));}
export function startWidgets(){
 document.documentElement.dataset.theme=pref.get('theme')==='dark'?'dark':'light';
 document.documentElement.classList.toggle('hide-aside',pref.get('aside')==='hide');
 const tools=element('div',undefined,'blog-tools');tools.id='blog-tools';
 const options=[['settings','⚙','展开阅读设置'],['theme','◐','切换深浅色'],['aside','↔','显示或隐藏侧栏'],['read','▤','切换阅读模式'],['character','♫','显示或隐藏看板娘'],['top','↑','回到顶部']];
 for(const [action,text,title] of options){const b=element('button',text);b.type='button';b.dataset.tool=action;b.title=title;b.setAttribute('aria-label',title);if(!['settings','top'].includes(action))b.className='tool-option';tools.append(b);}
 tools.querySelector('[data-tool=settings]').setAttribute('aria-expanded','false');
 document.body.append(tools);
 const notice=element('div');notice.id='blog-toast';notice.hidden=true;notice.setAttribute('role','status');document.body.append(notice);
 const progress=element('div');progress.id='blog-progress';document.body.append(progress);
 const zoom=element('dialog');zoom.id='image-zoom';const close=element('button','×');close.setAttribute('aria-label','关闭图片');const img=element('img');zoom.append(close,img);document.body.append(zoom);zoom.onclick=()=>zoom.close();
 tools.onclick=event=>{const action=event.target.closest('[data-tool]')?.dataset.tool;if(!action)return;
  if(action==='settings'){const open=tools.classList.toggle('expanded');event.target.setAttribute('aria-expanded',String(open));}
  if(action==='theme'){const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';pref.set('theme',dark?'dark':'light');toast(dark?'你已切换为深色模式':'你已切换为浅色模式');}
  if(action==='aside'){const hidden=document.documentElement.classList.toggle('hide-aside');pref.set('aside',hidden?'hide':'show');}
  if(action==='read'){document.body.classList.toggle('read-mode');toast(document.body.classList.contains('read-mode')?'已开启阅读模式':'已退出阅读模式');}
  if(action==='top')window.scrollTo({top:0,behavior:reduced.matches?'instant':'smooth'});
  if(action==='character'){const hidden=pref.get('character')!=='hide';pref.set('character',hidden?'hide':'show');document.body.classList.toggle('hide-character',hidden);if(!hidden)startCharacter();}
 };
 let pending=false;
 function scroll(){if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;tools.classList.toggle('visible',scrollY>100);document.body.classList.toggle('nav-scrolled',scrollY>150);const height=document.documentElement.scrollHeight-innerHeight;const value=Math.round(height>0?scrollY/height*100:0);const progress=$('#reading-progress');if(progress)progress.textContent=`阅读进度 ${value}%`;const headings=[...document.querySelectorAll('.prose h2,.prose h3')];const active=headings.filter(h=>h.getBoundingClientRect().top<160).at(-1);document.querySelectorAll('#article-toc a').forEach(a=>a.classList.toggle('active',a.hash==='#'+active?.id));});}
 window.addEventListener('scroll',scroll,{passive:true});scroll();
 let word=0;document.addEventListener('click',event=>{
  if(reduced.matches||matchMedia('(max-width: 700px)').matches||event.target.closest('button,a,input,select,textarea,dialog'))return;
  if(document.querySelectorAll('.click-word').length>8)return;
  const text=element('span',['超可爱','是不是','miku'][word++%3],'click-word');text.setAttribute('aria-hidden','true');text.style.left=Math.min(Math.max(event.clientX,40),innerWidth-50)+'px';text.style.top=(event.clientY-20)+'px';text.style.color=['#ff6c9e','#49b1f5','#00bfa5'][word%3];document.body.append(text);text.addEventListener('animationend',()=>text.remove(),{once:true});
 });
 document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(typingTimer);typingVersion++;}else startTyping();});
 reduced.addEventListener('change',()=>{startTyping();document.body.classList.toggle('reduce-motion',reduced.matches);});
 document.body.classList.toggle('hide-character',pref.get('character')==='hide');
 document.body.classList.toggle('reduce-motion',reduced.matches);
 startCharacter();
 fetch('https://v1.hitokoto.cn',{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{if(typeof data.hitokoto==='string'){subtitles=[data.hitokoto.slice(0,250),typeof data.from==='string'?'出自 '+data.from.slice(0,80):'',slogan].filter(Boolean);startTyping();}}).catch(()=>{});
}

function startCharacter(){
 if(liveStarted||reduced.matches||matchMedia('(max-width: 700px)').matches||pref.get('character')==='hide')return;
 liveStarted=true;
 const script=document.createElement('script');script.src='/live2dw/lib/L2Dwidget.min.js';script.onload=()=>{window.L2Dwidget.init({pluginRootPath:'/live2dw/',pluginJsPath:'lib/',pluginModelPath:'assets/',tagMode:false,debug:false,model:{jsonPath:'/live2dw/assets/miku.model.json'},display:{position:'right',width:150,height:300,hOffset:35,vOffset:0},mobile:{show:false},log:false});};script.onerror=()=>{liveStarted=false;toast('看板娘暂时无法加载');};document.body.append(script);
}
function startTyping(){
 clearTimeout(typingTimer);const version=++typingVersion,target=$('#hero-subtitle');if(!target)return;
 if(document.body.classList.contains('article-view')){target.hidden=true;return;}target.hidden=false;
 if(reduced.matches){target.textContent=slogan;return;}
 let index=0,back=false,line=0;
 function tick(){if(version!==typingVersion||document.hidden)return;target.textContent=subtitles[line].slice(0,index);if(!back&&index===subtitles[line].length){back=true;typingTimer=setTimeout(tick,2200);return;}if(back&&index===0){back=false;line=(line+1)%subtitles.length;}index+=back?-1:1;typingTimer=setTimeout(tick,back?50:150);}
 typingTimer=setTimeout(tick,300);
}
export function refreshWidgets(posts){
 startTyping();observer?.disconnect();
 if(!reduced.matches){observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){e.target.classList.add('revealed');observer.unobserve(e.target);}},{threshold:.08});for(const n of document.querySelectorAll('.post-card,.widget')){n.classList.add('reveal');observer.observe(n);}}
 const archives=$('#blog-archives');archives.replaceChildren(...groupArchives(posts).map(([month,count])=>{const a=link(`${month.replace('-',' 年 ')} 月`, '/blog?month='+month+'#archive');a.append(element('span',String(count)));return a;}));
 const info=$('#blog-info-stats');const days=Math.floor((Date.now()-Date.parse('2023-06-23T05:00:00Z'))/86400000);
 info.replaceChildren(...[['文章数目',posts.length],['已运行时间',days+' 天'],['最后更新',posts[0]?.date||'—']].map(([k,v])=>{const n=element('div',k);n.append(element('span',String(v)));return n;}));
 if(!document.body.classList.contains('article-view')&&!location.search){const bar=element('section',undefined,'category-cards');bar.setAttribute('aria-label','文章分类');for(const c of [...new Set(posts.map(p=>p.category))]){const a=link(c,'/blog?category='+encodeURIComponent(c)+'#archive');if(categoryImages[c])a.style.backgroundImage=`linear-gradient(#0003,#0004),url("${pictureRoot+categoryImages[c]}")`;a.append(element('span',String(posts.filter(p=>p.category===c).length)));bar.append(a);}$('#content').prepend(bar);}
 const prose=$('.prose'),toc=$('#article-toc');$('#toc-widget').hidden=!prose;toc.replaceChildren();
 if(prose){
  for(const [i,h] of [...prose.querySelectorAll('h1,h2,h3')].entries()){h.id='heading-'+i;const a=link(h.textContent,'#'+h.id);a.className='toc-'+h.tagName.toLowerCase();toc.append(a);}
  if(!toc.childElementCount)toc.textContent='本文暂无分节标题';
  for(const image of prose.querySelectorAll('img')){image.classList.add('zoomable');image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label','放大图片：'+(image.alt||'文章插图'));const open=()=>{const zoom=$('#image-zoom');zoom.querySelector('img').src=image.src;zoom.querySelector('img').alt=image.alt;zoom.showModal();};image.onclick=open;image.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};}
  for(const pre of prose.querySelectorAll('pre')){const box=element('div',undefined,'code-box'),toolbar=element('div',undefined,'code-toolbar'),copy=element('button','复制'),expand=element('button','展开');copy.type=expand.type='button';const text=pre.textContent;copy.onclick=async()=>{try{await navigator.clipboard.writeText(text);toast('复制成功');}catch{toast('复制失败，请手动选择代码');}};expand.onclick=()=>{const open=box.classList.toggle('code-expanded');expand.textContent=open?'收起':'展开';};toolbar.append(element('span','CODE'),copy,expand);pre.before(box);box.append(toolbar,pre);}
 }
}
export function loadingWidgets(busy){$('#blog-progress')?.classList.toggle('loading-active',busy);}
