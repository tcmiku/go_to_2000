import { $, escapeHTML as e, external, readStorage, saveStorage, showToast, startClock, preserveFocus, api } from './ui.js';
import { flattenCategories, normalizeUrl, selectGroups, validateNavigation, validatePageContent } from './navigation-data.js';
import './radio.js';
import './start-menu.js';
import './window-manager.js';
import { showRetroAd } from './retro-ad.js';
let categories = [], content, settings = {}, view = 'all', page = 1, loaded = false, revision = null, loading = false;
const saved = readStorage('web-surfer-favorites', []);
let favorites = Array.isArray(saved) ? [...new Set(saved.map(normalizeUrl).filter(Boolean))] : [];
const collapsedSaved = readStorage('web-surfer-collapsed-categories', []);
let collapsedCategories = new Set(Array.isArray(collapsedSaved) ? collapsedSaved.filter(value => typeof value === 'string') : []);
const pageSize = 36;
let composing = false;
let density = readStorage('web-surfer-density', 'comfortable') === 'compact' ? 'compact' : 'comfortable';
function restoreLocation() {
  const params = new URLSearchParams(location.search);
  view = params.get('category') || 'all';
  page = Math.max(1, Math.min(10000, Number.parseInt(params.get('page'), 10) || 1));
  $('#site-search').value = params.get('q') || '';
  if (loaded && !['all', 'favorites', ...flattenCategories(categories).map(c => c.id)].includes(view)) view = 'all';
}
function saveLocation(mode) {
  if (!loaded || mode === 'none') return;
  const url = new URL(location.href);
  for (const [key, value] of [['category', view === 'all' ? '' : view], ['q', $('#site-search').value], ['page', page === 1 ? '' : String(page)]]) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  if (url.href !== location.href) history[mode === 'push' ? 'pushState' : 'replaceState']({}, '', url);
}
function paginationMarkup(pages) {
  if (pages <= 1) return '';
  const numbers = [...new Set([1, page - 1, page, page + 1, pages])].filter(n => n > 0 && n <= pages).sort((a,b) => a-b);
  return `<button data-page="${page-1}" data-action="previous-page" ${page===1?'disabled':''} aria-label="上一页">◀</button>` + numbers.map((n,i) => `${i && n - numbers[i-1] > 1 ? '<span class="page-gap" aria-hidden="true">…</span>' : ''}<button data-page="${n}" data-action="page-${n}" aria-label="第 ${n} 页" ${n===page?'aria-current="page"':''}>${n}</button>`).join('') + `<button data-page="${page+1}" data-action="next-page" ${page===pages?'disabled':''} aria-label="下一页">▶</button>`;
}
function setDensity() {
  document.body.classList.toggle('compact-directory', density === 'compact');
  $('#density-select').value = density;
}
function count(category) { return category.sites.length + (category.children || []).reduce((sum, c) => sum + c.sites.length, 0); }
function categoryButton(id, name, total, child = false, attributes = '') { return `<button data-view="${e(id)}" ${attributes} class="${child ? 'child ' : ''}${view === id ? 'selected' : ''}" aria-pressed="${view === id}"><span class="folder">${child ? '└' : '▰'}</span> ${e(name)} <span>${total}</span></button>`; }
function parentCategory(category) {
  const hasChildren = Boolean(category.children?.length);
  const collapsed = hasChildren && collapsedCategories.has(category.id);
  const attributes = hasChildren ? `data-toggle-category="${e(category.id)}" aria-label="${collapsed ? '展开' : '收起'} ${e(category.name)}" aria-expanded="${!collapsed}"` : '';
  return `${categoryButton(category.id, category.name, count(category), false, attributes)}${hasChildren ? `<div class="category-children ${collapsed ? 'is-collapsed' : ''}" data-children-of="${e(category.id)}" ${collapsed ? 'hidden' : ''}>${category.children.map(x => categoryButton(x.id, x.name, x.sites.length, true)).join('')}</div>` : ''}`;
}
function renderTree() {
  const scrollTop = $('#category-list').scrollTop, scrollLeft = $('#category-list').scrollLeft;
  $('#category-list').innerHTML = categoryButton('all', '全部网站', categories.reduce((s,c) => s+count(c),0)) + categoryButton('favorites', '我的收藏', favorites.length) + '<div class="tree-divider"></div>' + categories.map(parentCategory).join('');
  $('#category-list').scrollTop = scrollTop; $('#category-list').scrollLeft = scrollLeft;
  const picker = $('#mobile-category-select');
  picker.innerHTML = `<option value="all">全部网站 (${categories.reduce((sum,c)=>sum+count(c),0)})</option><option value="favorites">我的收藏 (${favorites.length})</option>` + categories.map(c => `<optgroup label="${e(c.name)}"><option value="${e(c.id)}">${e(c.name)} · 全部 (${count(c)})</option>${(c.children || []).map(child=>`<option value="${e(child.id)}">└ ${e(child.name)} (${child.sites.length})</option>`).join('')}</optgroup>`).join('');
  picker.value = view; picker.disabled = false;
  $('#category-total').textContent = `${categories.length} 个目录 / ${flattenCategories(categories).length - categories.length} 个子分类`;
}
function renderSubmissionCategories() {
  $('#submission-category').innerHTML='<option value="">由站长决定</option>'+flattenCategories(categories).map(c=>`<option value="${e(c.id)}">${c.parentId?'　└ ':''}${e(c.name)}</option>`).join('');
}
function render(historyMode = 'replace') {
  const restoreFocus = preserveFocus();
  const flat = flattenCategories(categories), query = $('#site-search').value;
  const groups = selectGroups(categories,view,query,favorites), total = groups.reduce((s,c)=>s+c.sites.length,0), pages = Math.max(1,Math.ceil(total/pageSize));
  page = Math.min(page,pages);
  $('#directory-title').textContent = view === 'favorites' ? '我的收藏' : flat.find(c=>c.id===view)?.name || '全部网站';
  const scope = $('#directory-title').textContent;
  $('#result-count').textContent = `${query ? `在${scope}中找到` : '共收录'} ${total} 个网站 · 第 ${page} / ${pages} 页`;
  $('#site-search').placeholder = view === 'all' ? '搜索网站、网址或关键词…' : `在${scope}中搜索…`;
  $('#search-everywhere').hidden = view === 'all' || !query.trim();
  $('#clear-search').hidden = !query;
  $('#reset-filter').hidden = view === 'all' && !query;
  let offset = 0;
  $('#link-groups').innerHTML = groups.map(g => {
    const start = offset; offset += g.sites.length;
    const sites = g.sites.slice(Math.max(0,(page-1)*pageSize-start),Math.max(0,page*pageSize-start));
    if (!sites.length) return '';
    const parent = flat.find(c=>c.id===g.parentId);
    return `<section class="link-group"><h3 class="group-heading">▰ ${parent ? `${e(parent.name)} / ` : ''}${e(g.name)} <small>${g.sites.length} SITES</small></h3><div class="link-grid">${sites.map(s => {
      const saved = favorites.includes(normalizeUrl(s.url));
      return `<article class="site-link">${external(s)}${s.isNew ? '<span class="new-tag">NEW!</span>' : ''}<p title="${e(s.description)}">${e(s.description || new URL(s.url).hostname)}</p><button class="favorite-star ${saved ? 'saved' : ''}" data-favorite="${e(normalizeUrl(s.url))}" aria-label="${saved ? '取消收藏' : '收藏'} ${e(s.name)}" aria-pressed="${saved}">${saved ? '★' : '☆'}</button></article>`;
    }).join('')}</div></section>`;
  }).join('') || `<div class="empty"><strong>${view === 'favorites' && !query ? '☆ 收藏夹还是空的' : '没有找到相关网站'}</strong>${view === 'favorites' && !query ? '点击网站旁的 ☆，把喜欢的网站留在这里。' : '试试其他关键词，或者查看全部分类。'}<br><button data-action="reset" style="margin-top:16px">查看全部网站</button></div>`;
  $('#pagination').innerHTML = total ? paginationMarkup(pages) : '';
  $('#pagination-top').innerHTML = pages > 1 ? $('#pagination').innerHTML : '';
  if (total && pages > 1) $('#pagination').insertAdjacentHTML('beforeend', `<label class="page-jump" for="page-jump">跳至 <select id="page-jump">${Array.from({length:pages},(_,i)=>`<option value="${i+1}" ${page===i+1?'selected':''}>第 ${i+1} 页</option>`).join('')}</select></label>`);
  renderTree();
  saveLocation(historyMode);
  restoreFocus($('#site-search'));
}
function mikuStage() {
  return `<section class="miku-stage" aria-label="暂无精选，Miku 像素小舞台">
    <div class="miku-stage-copy"><span class="miku-channel">♫ MIKU / PIXEL STAGE</span><h3>精选还在准备，<br>先和 Miku 摇摆一下。</h3><p>下一站的惊喜，正在路上。</p><button id="miku-motion" type="button" aria-pressed="false">暂停动画</button></div>
    <div class="miku-performance"><span class="pixel-note note-one" aria-hidden="true">♪</span><span class="pixel-note note-two" aria-hidden="true">♫</span>
    <svg class="pixel-miku" viewBox="0 0 48 56" role="img" aria-label="青绿色双马尾的像素 Miku 正在跳舞" shape-rendering="crispEdges">
      <ellipse cx="24" cy="53" rx="15" ry="2" fill="#060f28"/>
      <g class="miku-dancer">
        <g class="miku-tail tail-left"><path fill="#137e92" d="M8 10h8v10h-2v22h-2v4H4V26h2V14h2z"/><path fill="#45e4d3" d="M8 16h4v20h-2v6H6V28h2z"/></g>
        <g class="miku-tail tail-right"><path fill="#137e92" d="M32 10h8v4h2v12h2v20h-8v-4h-2V20h-2z"/><path fill="#45e4d3" d="M36 16h4v12h2v14h-4v-6h-2z"/></g>
        <g class="miku-leg leg-left"><path fill="#f4d9c6" d="M17 37h6v6h-6z"/><path fill="#20223b" d="M17 42h6v10h-8v-4h2z"/><path fill="#42d5cd" d="M15 50h8v2h-8z"/></g>
        <g class="miku-leg leg-right"><path fill="#f4d9c6" d="M25 37h6v6h-6z"/><path fill="#20223b" d="M25 42h6v6h2v4h-8z"/><path fill="#42d5cd" d="M25 50h8v2h-8z"/></g>
        <path fill="#b9cfda" d="M18 24h12v4h2v9H16v-9h2z"/><path fill="#31cfc6" d="M22 24h4v4h-1v7h-3v-7h-1v-2h1z"/>
        <path fill="#272640" d="M16 34h16v3h2v4H14v-4h2z"/><path fill="#43dcd0" d="M14 40h20v2H14z"/><path fill="#71758e" d="M18 35h2v5h-2zm5 0h2v5h-2zm5 0h2v5h-2z"/>
        <g class="miku-arm arm-left"><path fill="#f4d9c6" d="M14 26h4v5h-4z"/><path fill="#25273f" d="M12 30h6v9h-6z"/><path fill="#41dace" d="M12 31h6v2h-6z"/><path fill="#f4d9c6" d="M12 39h5v3h-5z"/></g>
        <g class="miku-arm arm-right"><path fill="#f4d9c6" d="M30 26h4v5h-4z"/><path fill="#25273f" d="M30 30h6v9h-6z"/><path fill="#41dace" d="M30 31h6v2h-6z"/><path fill="#f4d9c6" d="M31 39h5v3h-5z"/></g>
        <g class="miku-head"><path fill="#148c9b" d="M16 4h16v2h4v16h-4v3H16v-3h-4V6h4z"/><path fill="#ffe2cd" d="M16 12h16v9h-3v3H19v-3h-3z"/>
        <path fill="#4ce4d3" d="M16 6h16v3h2v7h-4v-5h-2v4h-4V9h-2v4h-4v3h-4V9h2z"/><path fill="#a3fff0" d="M18 6h10v2H18z"/>
        <path fill="#20283f" d="M10 9h4v9h-4zm24 0h4v9h-4z"/><path fill="#e9588d" d="M10 10h2v5h-2zm26 0h2v5h-2z"/>
        <g class="miku-eyes"><path fill="#166879" d="M18 16h3v4h-3zm9 0h3v4h-3z"/><path fill="#fff" d="M18 16h1v2h-1zm9 0h1v2h-1z"/></g><path fill="#e28a91" d="M16 20h3v1h-3zm13 0h3v1h-3zM23 21h3v1h-3z"/></g>
      </g>
    </svg><div class="pixel-stage-floor" aria-hidden="true"></div></div>
  </section>`;
}
function renderContent() {
  const all = new Map(flattenCategories(categories).flatMap(c=>c.sites).map(s=>[s.id,s]));
  const hotWindow = $('#hot-links')?.closest('.window');
  if (hotWindow && !$('#uc-news')) {
    hotWindow.insertAdjacentHTML('beforebegin', `<section class="window uc-news" id="uc-news"><div class="titlebar"><h2>▣ UC资讯</h2><span class="yellow">旧闻</span></div><div class="uc-news-note">复古网传 · 纯属恶搞，请勿当真</div><ul class="uc-news-list"><li><b>今天是马化腾生日，转发获得 5 Q 币！</b><small>据说转发给 10 位好友后，QQ 秀会自动变亮。</small></li><li><b>紧急通知：今晚 12 点关闭 QQ，头像会变成灰色！</b><small>不信你就试试，反正明天还能重新登录。</small></li><li><b>手机按“*#06#”能召唤隐藏彩蛋？</b><small>老网友表示：先记下 IMEI，再去喝杯水。</small></li><li><b>转发这条消息，明天上网速度提升 98%！</b><small>来自某位“内部工作人员”的可靠消息。</small></li></ul></section>`);
    const style = document.createElement('style');
    style.textContent = '.uc-news{order:-1}.uc-news-note{padding:7px 9px;background:#fff1a8;color:#8b2f00;border-bottom:1px dotted #999;font:10px monospace;text-align:center}.uc-news-list{margin:0;padding:4px 9px 5px;list-style:none;background:#fffbe4}.uc-news-list li{padding:8px 0;border-bottom:1px dotted #bbb;line-height:1.4}.uc-news-list li:last-child{border-bottom:0}.uc-news-list b{display:block;color:#9b1c00;font-size:12px}.uc-news-list small{display:block;margin-top:3px;color:#777;font-size:10px}';
    document.head.append(style);
  }
  $('#hot-title').textContent = content.hot.title;
  $('#hot-links').innerHTML = content.hot.siteIds.map(id=>all.get(id)).filter(Boolean).map(s=>`<li>${external(s)}</li>`).join('') || '<li>暂无推荐</li>';
  $('#featured-title').textContent = content.featured.title;
  $('#featured-items').innerHTML = content.featured.items.map(s=>`<a class="featured-card" href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${s.artPath ? `<img src="/${e(s.artPath)}" alt="" loading="lazy">` : ''}<strong>${e(s.name)} ↗</strong><p>${e(s.description)}</p></a>`).join('') || mikuStage();
  const motionButton = $('#miku-motion');
  if (motionButton) {
    const stage = motionButton.closest('.miku-stage');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let paused = reducedMotion;
    motionButton.disabled = reducedMotion;
    const updateMotion = () => {stage.classList.toggle('is-paused', paused);motionButton.setAttribute('aria-pressed', String(paused));motionButton.textContent = reducedMotion ? '已减少动态效果' : paused ? '播放动画' : '暂停动画';};
    updateMotion();
    motionButton.onclick = () => {paused = !paused;updateMotion();};
  }
  $('#friend-links').innerHTML = content.friends.map(s=>external(s,'↗ '+e(s.name))).join('') || '<p>暂无友情链接</p>';
  $('#announcement').textContent = settings.announcement || '欢迎回来！这里总有一个值得收藏的好网站。';
  $('#site-tagline').textContent = settings.tagline || '互联网很大，一起慢慢冲浪。';
}
async function load() {
  if (loading) return;
  loading = true;
  try {
    const response = await fetch('/api/public', {cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error('目录暂时无法连接');
    const data = await response.json();
    if (loaded && data.revision === revision) return;
    categories = validateNavigation(data.navigation).categories;
    content = validatePageContent(data.content,categories); settings = data.settings || {}; loaded = true; revision = data.revision;
    if (!['all','favorites',...flattenCategories(categories).map(c=>c.id)].includes(view)) view = 'all';
    render(); renderContent(); renderSubmissionCategories(); showRetroAd(settings.ad);
  } catch(error) { if(!loaded) $('#link-groups').innerHTML = `<div class="empty"><strong>连接未完成</strong>${e(error.message)}<br><button data-action="retry">重新加载</button></div>`; else showToast('目录更新失败，请稍后刷新重试'); } finally { loading = false; }
}
document.addEventListener('click', event => {
  const category = event.target.closest('[data-view]');
  if(category) {
    const id = category.dataset.toggleCategory;
    if (id) {
      if (collapsedCategories.has(id)) collapsedCategories.delete(id); else collapsedCategories.add(id);
      saveStorage('web-surfer-collapsed-categories', [...collapsedCategories]);
    }
    view = category.dataset.view; page=1; render('push');
  }
  const star = event.target.closest('[data-favorite]');
  if(star) {
    const url=star.dataset.favorite, wasSaved=favorites.includes(url);
    favorites = wasSaved ? favorites.filter(x=>x!==url) : [...favorites,url];
    const persisted = saveStorage('web-surfer-favorites',favorites);
    render();
    showToast(persisted ? (wasSaved ? '已取消收藏' : '已加入我的收藏') : '本次收藏只在当前页面保留', {label:'撤销', action:()=>{
      favorites = wasSaved ? [...new Set([...favorites,url])] : favorites.filter(x=>x!==url);
      const restored = saveStorage('web-surfer-favorites',favorites);
      render(); showToast(restored ? '已撤销收藏操作' : '已撤销，本次更改只在当前页面保留');
    }});
  }
  const pager=event.target.closest('[data-page]');
  if(pager && !pager.disabled) { page=Number(pager.dataset.page);render('push');$('#directory').scrollIntoView({block:'start'}); }
  if(event.target.closest('[data-action="retry"]')) load();
  if(event.target.closest('[data-action="reset"]')) reset();
});
function reset(){view='all';page=1;$('#site-search').value='';render('push');}
$('#reset-filter').onclick=reset;
$('#search-everywhere').onclick=()=>{view='all';page=1;render('push');$('#site-search').focus();};
$('#mobile-category-select').onchange=event=>{view=event.target.value;page=1;render('push');};
$('#site-search').addEventListener('compositionstart',()=>{composing=true;});
$('#site-search').addEventListener('compositionend',()=>{composing=false;page=1;render();});
$('#site-search').addEventListener('input',()=>{if(!composing){page=1;render();}});
$('#clear-search').onclick=()=>{$('#site-search').value='';page=1;render();$('#site-search').focus();};
$('#density-select').onchange=event=>{density=event.target.value;setDensity();saveStorage('web-surfer-density',density);};
$('#search-form').onsubmit=event=>{event.preventDefault();if(composing)return;page=1;render();};
$('#pagination').addEventListener('change',event=>{if(event.target.id==='page-jump'){page=Number(event.target.value);render('push');$('#directory').scrollIntoView({block:'start'});}});
$('#random-button').onclick=()=>{const pool=[...new Map(flattenCategories(categories).flatMap(c=>c.sites).map(s=>[normalizeUrl(s.url),s])).values()];if(pool.length)window.open(pool[Math.floor(Math.random()*pool.length)].url,'_blank','noopener,noreferrer');else showToast('暂无可漫游的网站');};
$('#about-button').onclick=()=>$('#about-dialog').showModal();
$('#submission-open').onclick=()=>{$('#submission-error').textContent='';$('#submission-dialog').showModal();$('#submission-form input[name="name"]').focus();};
$('#submission-cancel').onclick=()=>$('#submission-dialog').close();
$('#submission-form').onsubmit=async event=>{
  event.preventDefault();const form=event.currentTarget,button=$('#submission-submit');$('#submission-error').textContent='';button.disabled=true;button.textContent='正在发送…';
  try{const input=Object.fromEntries(new FormData(form));await api('/api/submissions',{method:'POST',body:JSON.stringify(input)});form.reset();$('#submission-dialog').close();showToast('投稿已送达站长后台，感谢分享！');}
  catch(error){$('#submission-error').textContent=error.message;}
  finally{button.disabled=false;button.textContent='发送投稿';}
};
$('#expand-directory').onclick=()=>{const on=document.body.classList.toggle('expanded');$('#expand-directory').setAttribute('aria-pressed',String(on));};
window.addEventListener('focus',()=>{if(loaded)load();});
window.addEventListener('popstate',()=>{restoreLocation();if(loaded)render('none');});
document.addEventListener('keydown',event=>{
  if(event.isComposing || composing || document.querySelector('dialog[open]')) return;
  const editing = event.target.closest('input, textarea, select, [contenteditable="true"]');
  if(((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='k') || (event.key==='/' && !editing && !event.metaKey && !event.ctrlKey && !event.altKey)) {
    event.preventDefault();$('#site-search').focus();$('#site-search').select();$('#directory').scrollIntoView({block:'start'});
  }
  if(event.key==='Escape' && event.target===$('#site-search') && $('#site-search').value) {event.preventDefault();$('#clear-search').click();}
});
window.addEventListener('storage',event=>{if(event.key==='web-surfer-favorites'){const next=readStorage(event.key,[]);favorites=Array.isArray(next)?next.map(normalizeUrl).filter(Boolean):[];render();}});
restoreLocation();setDensity();startClock();load();
