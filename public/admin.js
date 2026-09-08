import { categoryNodes as categoryRefs, deleteSites, moveSites, upsertSite, deleteCategory } from './management-data.js';
import { defaultAd, validateAd } from './retro-ad.js';
import { $, escapeHTML as e, api, external, showToast, startClock } from './ui.js';
import { flattenCategories, normalizeUrl, validateNavigation, validatePageContent } from './navigation-data.js';
let data, submissions=[], section='sites', query='', categoryFilter='all', statusFilter='all', submissionFilter='pending', page=1, busy=false, selected=new Set(), undoData=null, editorHandler=null, confirmHandler=null, setupRequired=false;
const pageSize=20;
const sections={sites:['▧','网站管理','DIRECTORY','添加、整理和维护导航页中的每一个网站。','添加网站'],submissions:['✉','处理投稿','SUBMISSIONS','审核访客推荐的网站，收录或拒绝投稿。',null],categories:['▰','分类管理','CATEGORIES','整理两级目录，调整分类顺序。','添加分类'],hot:['★','热门推荐','RECOMMENDATIONS','挑选值得发现的网站，按顺序展示在前台。','添加推荐'],featured:['✦','精选网站','FEATURED SITES','维护前台精选栏中的网站、简介和封面。','添加精选'],friends:['↗','友情链接','WEB RING','让有趣的小站彼此相连。','添加友链'],settings:['⚙','站点设置','PREFERENCES','修改公告、展示文案和管理员密码。',null],backup:['▣','备份与恢复','BACKUP & RESTORE','带走一份完整目录，随时从备份恢复。',null]};
const flat=()=>flattenCategories(data.navigation.categories);
const records=()=>flat().flatMap(c=>c.sites.map(s=>({...s,categoryId:c.id,categoryName:c.name,parentId:c.parentId})));
function findCategory(d,id){for(const c of d.navigation.categories){if(c.id===id)return c;for(const child of c.children||[])if(child.id===id)return child;}return null;}
function categoryOptions(value='',allowAll=false){return `${allowAll?'<option value="all">全部分类</option>':''}`+flat().map(c=>`<option value="${e(c.id)}" ${c.id===value?'selected':''}>${c.parentId?'　└ ':''}${e(c.name)}</option>`).join('');}
function selectOptions(options,value){return options.map(([id,name])=>`<option value="${e(id)}" ${id===value?'selected':''}>${e(name)}</option>`).join('');}
function badge(hidden){return `<span class="status-badge ${hidden?'off':''}">${hidden?'已隐藏':'已显示'}</span>`;}
function empty(message){return `<div class="content-empty"><b>这里还是空的</b>${message}</div>`;}
function actionButton(action,id,text,classes='',disabled=false){return `<button data-action="${action}" data-id="${e(id)}" class="${classes}" ${disabled?'disabled':''}>${text}</button>`;}
function orderButtons(id,index,total){return actionButton('up',id,'↑','reorder',index===0)+actionButton('down',id,'↓','reorder',index===total-1);}
function siteCell(s){return `<div class="site-cell"><strong>${e(s.name)}${s.isNew?' <span class="new-tag">NEW!</span>':''}</strong>${external(s,e(s.url))}</div>`;}
function drawStats(){const all=records(),pending=submissions.filter(item=>item.status==='pending').length;$('#stats-row').innerHTML=[['网站总数',all.length,'DIRECTORY ENTRIES','▧'],['待处理投稿',pending,'PENDING SUBMISSIONS','✉'],['前台显示',all.filter(s=>!s.hidden).length,'PUBLIC SITES','◉'],['精选与友链',data.content.featured.items.length+data.content.friends.length,'HAND-PICKED LINKS','✦']].map(([name,count,note,icon])=>`<div class="stat"><span>${name}</span><strong>${count}</strong><small>${note}</small><i>${icon}</i></div>`).join('');}
function drawNav(){$('#admin-nav').innerHTML=Object.entries(sections).map(([id,[icon,name]])=>`${id==='settings'?'<div class="nav-separator"></div>':''}<button data-section="${id}" class="${section===id?'active':''}" aria-current="${section===id?'page':'false'}"><span>${icon}</span>${name}${['sites','submissions','categories'].includes(id)?`<span class="nav-count">${id==='sites'?records().length:id==='submissions'?submissions.filter(item=>item.status==='pending').length:flat().length}</span>`:''}</button>`).join('');}
function draw(){
  const [icon,title,code,description,add]=sections[section];
  $('#section-title').textContent=title;$('#section-code').textContent=code;$('#section-description').textContent=description;$('#workspace-title').textContent=`${icon} ${title}`;$('#main-add').hidden=!add;$('#main-add').textContent=`＋ ${add||''}`;
  $('#updated-at').textContent=`最后保存：${new Date(data.updatedAt).toLocaleString('zh-CN')} · v${data.revision}`;
  $('#undo-button').hidden=!undoData;drawStats();drawNav();
  if(section==='sites')drawSites();else if(section==='submissions')drawSubmissions();else if(section==='categories')drawCategories();else if(section==='hot')drawHot();else if(section==='featured'||section==='friends')drawLinks();else if(section==='settings')drawSettings();else drawBackup();
}
function siteRows(){
  const allowed=categoryFilter==='all'?null:new Set([categoryFilter,...flat().filter(c=>c.parentId===categoryFilter).map(c=>c.id)]);
  const tokens=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return records().filter(s=>(!allowed||allowed.has(s.categoryId))&&(statusFilter==='all'||(statusFilter==='hidden'?s.hidden:!s.hidden))&&tokens.every(t=>`${s.name} ${s.description} ${s.url}`.toLowerCase().includes(t)));
}
function drawSites(){
  $('#workspace-body').innerHTML=`<div class="admin-toolbar"><label class="sr-only" for="admin-search">搜索网站</label><input type="search" id="admin-search" class="admin-search" placeholder="搜索名称、网址或关键词…" value="${e(query)}"><label class="sr-only" for="category-filter">筛选分类</label><select id="category-filter">${categoryOptions(categoryFilter,true)}</select><label class="sr-only" for="status-filter">筛选状态</label><select id="status-filter">${selectOptions([['all','全部状态'],['visible','前台显示'],['hidden','已隐藏']],statusFilter)}</select></div><div id="bulk-area"></div><div class="table-wrap"><table><thead><tr><th class="check"><input type="checkbox" id="select-page" aria-label="选择当前页全部网站"></th><th>网站名称 / 网址</th><th>所属分类</th><th>状态</th><th style="text-align:right">操作</th></tr></thead><tbody id="sites-tbody"></tbody></table><div id="sites-empty"></div></div><div class="table-bottom"><span id="table-summary"></span><div class="pagination" id="admin-pagination"></div></div>`;
  updateSiteTable();
}
function updateSiteTable(){
  const rows=siteRows(),pages=Math.max(1,Math.ceil(rows.length/pageSize));page=Math.min(page,pages);const shown=rows.slice((page-1)*pageSize,page*pageSize);
  $('#sites-tbody').innerHTML=shown.map(s=>{const list=findCategory(data,s.categoryId).sites,index=list.findIndex(x=>x.id===s.id);return `<tr><td class="check"><input type="checkbox" data-select="${e(s.id)}" aria-label="选择 ${e(s.name)}" ${selected.has(s.id)?'checked':''}></td><td>${siteCell(s)}</td><td><span class="category-pill">${e(s.categoryName)}</span></td><td>${badge(s.hidden)}</td><td><div class="row-actions">${orderButtons(s.id,index,list.length)}${actionButton('edit',s.id,'编辑')}${actionButton('toggle',s.id,s.hidden?'显示':'隐藏')}${actionButton('delete',s.id,'删除','delete')}</div></td></tr>`;}).join('');
  $('#sites-empty').innerHTML=rows.length?'':empty(query||categoryFilter!=='all'||statusFilter!=='all'?'没有匹配的网站，试试其他筛选条件。':'点击「添加网站」开始整理你的目录。');
  $('#table-summary').textContent=`共 ${rows.length} 条记录${rows.length?` · 显示 ${(page-1)*pageSize+1}—${Math.min(page*pageSize,rows.length)}`:''}`;
  $('#admin-pagination').innerHTML=`${actionButton('page',page-1,'◀ 上一页','',page===1)}<span>${page} / ${pages}</span>${actionButton('page',page+1,'下一页 ▶','',page===pages)}`;
  const checkbox=$('#select-page');checkbox.checked=shown.length>0&&shown.every(s=>selected.has(s.id));checkbox.indeterminate=shown.some(s=>selected.has(s.id))&&!checkbox.checked;checkbox.disabled=!shown.length;drawBulk();
}
function drawBulk(){$('#bulk-area').innerHTML=selected.size?`<div class="bulk-toolbar"><strong>已选 ${selected.size} 项</strong>${actionButton('bulk-show','','显示')}${actionButton('bulk-hide','','隐藏')}<label class="sr-only" for="bulk-category">移动到分类</label><select id="bulk-category">${categoryOptions()}</select>${actionButton('bulk-move','','移动到此分类')}${actionButton('bulk-delete','','删除','danger')}${actionButton('clear-selection','','取消选择')}</div>`:'';}
function drawCategories(){
  const all=flat();$('#workspace-body').innerHTML=`<p class="section-intro">支持一级目录与子分类。上下箭头调整同一级的显示顺序；编辑分类可调整所属目录。</p>`+(all.length?`<div class="table-wrap"><table><thead><tr><th>分类名称</th><th>层级</th><th>网站数量</th><th style="text-align:right">操作</th></tr></thead><tbody>${all.map(c=>{const list=c.parentId?findCategory(data,c.parentId).children:data.navigation.categories,index=list.findIndex(x=>x.id===c.id);return `<tr><td class="category-name ${c.parentId?'child':''}">${c.parentId?'└':'▰'} ${e(c.name)}<small>${e(c.id)}</small></td><td>${c.parentId?'子分类':'一级目录'}</td><td>${c.sites.length}${c.children?.length?` + ${c.children.reduce((sum,x)=>sum+x.sites.length,0)} 子类网站`:''}</td><td><div class="row-actions">${orderButtons(c.id,index,list.length)}${actionButton('edit',c.id,'编辑')}${!c.parentId?actionButton('add-child',c.id,'＋ 子类'):''}${actionButton('delete',c.id,'删除','delete')}</div></td></tr>`;}).join('')}</tbody></table></div>`:empty('点击「添加分类」建立第一个目录。'));
}
function drawHot(){const all=records(),list=data.content.hot.siteIds;$('#workspace-body').innerHTML=`<p class="section-intro">从网站目录中选择推荐。隐藏的网站不会在前台显示，删除网站会同时移除对应推荐。</p>`+(list.length?`<div class="table-wrap"><table><thead><tr><th>排序</th><th>推荐网站</th><th>状态</th><th style="text-align:right">操作</th></tr></thead><tbody>${list.map((id,i)=>{const s=all.find(x=>x.id===id);return `<tr><td>${String(i+1).padStart(2,'0')}</td><td>${siteCell(s)}</td><td>${badge(s.hidden)}</td><td><div class="row-actions">${orderButtons(id,i,list.length)}${actionButton('delete',id,'移除','delete')}</div></td></tr>`;}).join('')}</tbody></table></div>`:empty('点击「添加推荐」，挑选一个值得发现的网站。'));}
function drawLinks(){const list=section==='featured'?data.content.featured.items:data.content.friends;$('#workspace-body').innerHTML=`<p class="section-intro">${section==='featured'?'精选内容显示在前台底部，封面可选。':'友情链接显示在前台右侧。'}上下箭头调整显示顺序。</p>`+(list.length?`<div class="table-wrap"><table><thead><tr><th>排序</th><th>网站名称 / 网址</th><th>状态</th><th style="text-align:right">操作</th></tr></thead><tbody>${list.map((s,i)=>`<tr><td>${String(i+1).padStart(2,'0')}</td><td>${siteCell(s)}${s.description?`<div class="cell-description">${e(s.description)}</div>`:''}</td><td>${badge(s.hidden)}</td><td><div class="row-actions">${orderButtons(i,i,list.length)}${actionButton('edit',i,'编辑')}${actionButton('toggle',i,s.hidden?'显示':'隐藏')}${actionButton('delete',i,'删除','delete')}</div></td></tr>`).join('')}</tbody></table></div>`:empty('点击右上角的添加按钮，收录一个好网站。'));}
function drawSubmissions(){
  const labels={pending:'待处理',accepted:'已收录',rejected:'已拒绝'},items=submissions.filter(item=>submissionFilter==='all'||item.status===submissionFilter);
  $('#workspace-body').innerHTML=`<div class="admin-toolbar"><label for="submission-filter">处理状态</label><select id="submission-filter">${selectOptions([['pending','待处理'],['accepted','已收录'],['rejected','已拒绝'],['all','全部投稿']],submissionFilter)}</select><span class="admin-tabs-hint">共 ${submissions.length} 条，待处理 ${submissions.filter(item=>item.status==='pending').length} 条</span></div>`+(items.length?`<div class="table-wrap submission-table"><table><thead><tr><th>投稿网站</th><th>简介 / 投稿人</th><th>建议分类</th><th>状态</th><th style="text-align:right">操作</th></tr></thead><tbody>${items.map(item=>`<tr><td>${siteCell(item)}<small class="submission-date">${new Date(item.createdAt).toLocaleString('zh-CN')}</small></td><td><div class="submission-description">${e(item.description||'（未填写简介）')}</div>${item.contact?`<small class="submission-contact">联系：${e(item.contact)}</small>`:''}</td><td>${item.status==='pending'?`<label class="sr-only" for="submission-category-${e(item.id)}">${e(item.name)} 的收录分类</label><select id="submission-category-${e(item.id)}" data-submission-category="${e(item.id)}"><option value="">选择收录分类</option>${categoryOptions(item.categoryId)}</select>`:`<span class="category-pill">${e(flat().find(c=>c.id===item.categoryId)?.name||item.categoryId||'—')}</span>`}</td><td><span class="submission-status ${e(item.status)}">${labels[item.status]}</span></td><td><div class="row-actions">${item.status==='pending'?`${actionButton('accept-submission',item.id,'收录','primary')}${actionButton('reject-submission',item.id,'拒绝')}`:''}${actionButton('delete-submission',item.id,'删除','delete')}</div></td></tr>`).join('')}</tbody></table></div>`:empty(submissionFilter==='pending'?'没有待处理投稿。':'此状态下没有投稿。'));
}
function drawSettings(){const ad={...defaultAd,...data.settings.ad};$('#workspace-body').innerHTML=`<form id="settings-form" class="settings-form"><h3>✎ 前台内容</h3><label>首页标语<input name="tagline" maxlength="100" value="${e(data.settings.tagline)}" required></label><label>站内公告<textarea name="announcement" maxlength="500" required>${e(data.settings.announcement)}</textarea></label><div class="form-grid"><label>热门推荐栏目名称<input name="hotTitle" maxlength="80" value="${e(data.content.hot.title)}" required></label><label>精选栏目名称<input name="featuredTitle" maxlength="80" value="${e(data.content.featured.title)}" required></label></div><h3>弹窗广告</h3><label><input name="adEnabled" type="checkbox" ${ad.enabled?'checked':''}> 开启首页弹窗广告</label><label>广告标题<input name="adTitle" maxlength="80" value="${e(ad.title)}"></label><label>广告正文<textarea name="adText" maxlength="500">${e(ad.text)}</textarea></label><label>图片路径<input name="adImage" maxlength="500" value="${e(ad.image)}"><small class="field-hint">使用 /assets/ 下的 PNG 或 SVG 图片路径；留空不显示图片。</small></label><label>跳转链接<input name="adUrl" type="url" maxlength="2000" value="${e(ad.url)}" placeholder="https://example.com"><small class="field-hint">留空则不显示跳转按钮。</small></label><label>跳转按钮文字<input name="adButton" maxlength="30" value="${e(ad.button)}"></label><p class="field-hint">关闭按钮始终可用；趣味按钮会躲开鼠标。“永不显示”适用于当前浏览器。</p><p class="form-error" id="settings-error" role="alert"></p><button class="primary" type="submit">▣ 保存设置</button><span class="save-note">保存后立即生效</span></form><form id="password-form" class="password-section"><h3>▣ 修改管理员密码</h3><div class="form-grid"><label>当前密码<input name="current" type="password" required maxlength="200" autocomplete="current-password"></label><label>新密码（至少 10 位）<input name="password" type="password" required minlength="10" maxlength="200" autocomplete="new-password"></label></div><p class="form-error" id="password-error" role="alert"></p><button type="submit">更新密码</button></form>`;}
function drawBackup(){$('#workspace-body').innerHTML=`<div class="backup-grid"><div class="backup-card"><span class="backup-icon">▣ ↓</span><h3>导出完整备份</h3><p>下载全部网站、分类、热门推荐、精选、友情链接及站点设置。</p><a class="button" href="/api/admin/backup" download>↓ 下载 JSON 备份</a></div><div class="backup-card"><span class="backup-icon">▣ ↑</span><h3>从备份恢复</h3><p>选择本站导出的 JSON 文件。系统会先检查内容，并展示恢复范围。</p><button data-action="import">↑ 选择备份文件</button></div></div><p class="backup-note">恢复会替换当前目录与站点设置。管理员账号和浏览器收藏不包含在备份内，也不会被替换。每次保存前，服务器会自动保留上一版数据；当前会话也可以撤销最近一次修改。</p>`;}
async function loadData(){const [nextData,nextSubmissions]=await Promise.all([api('/api/admin/data'),api('/api/admin/submissions')]);data=nextData;submissions=nextSubmissions.items;selected.clear();draw();}
async function authenticate(){
  try{const auth=await api('/api/auth');setupRequired=auth.setupRequired;if(auth.authenticated){$('#admin-username').textContent=auth.username;await loadData();$('#auth-screen').hidden=true;$('#admin-screen').hidden=false;return;}
    $('#auth-screen').hidden=false;$('#admin-screen').hidden=true;$('#auth-title').textContent=setupRequired?'创建你的站长账号':'欢迎回来，站长';$('#auth-note').textContent=setupRequired?'首次使用，请设置管理员账号。之后使用这个账号管理所有网站。':'输入用户名和密码，继续整理你的互联网收藏。';$('#confirm-label').hidden=!setupRequired;$('#confirm-label input').required=setupRequired;$('#auth-form input[name=password]').minLength=setupRequired?10:1;$('#auth-form input[name=password]').autocomplete=setupRequired?'new-password':'current-password';$('#auth-submit').textContent=setupRequired?'创建账号并进入 →':'进入后台 →';$('#auth-form').hidden=false;$('#auth-loading').hidden=true;
  }catch(error){$('#auth-title').textContent='暂时无法连接';$('#auth-loading').innerHTML=`${e(error.message)} <button data-action="retry-auth">重新连接</button>`;$('#auth-loading').hidden=false;}
}
function setBusy(value){busy=value;$('#admin-screen').inert=value;$('#editor-fields').inert=value;document.body.classList.toggle('saving',value);$('#save-state').textContent=value?'正在保存…':'所有更改已保存';$('#admin-status').textContent=value?'▣ 正在保存更改…':'✓ 就绪';}
async function save(next,message='更改已保存',remember=true){
  if(busy)throw new Error('正在保存，请稍候');
  const before=structuredClone(data);setBusy(true);
  try{next.revision=data.revision;const saved=await api('/api/admin/data',{method:'PUT',body:JSON.stringify(next)});data=saved;if(remember)undoData=before;selected.clear();draw();showToast(message);}
  catch(error){$('#save-state').textContent='保存失败';if(error.status===401){for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();$('#admin-screen').hidden=true;$('#auth-screen').hidden=false;await authenticate();}if(error.status===409){data=await api('/api/admin/data');selected.clear();draw();}throw error;}
  finally{setBusy(false);}
}
async function mutate(fn,message){const next=structuredClone(data);fn(next);await save(next,message);}
function showEditor(title,fields,handler){$('#editor-title').textContent=title;$('#editor-fields').innerHTML=fields;$('#editor-error').textContent='';editorHandler=handler;$('#editor-dialog').showModal();}
function showConfirm(title,message,handler){$('#confirm-title').textContent=title;$('#confirm-message').textContent=message;$('#confirm-error').textContent='';confirmHandler=handler;$('#confirm-dialog').showModal();}
function siteFields(site={},categoryId=''){
  return `<label>网站名称<input name="name" value="${e(site.name||'')}" maxlength="150" required autofocus placeholder="例如：一个有趣的网站"></label><label>网站地址<input name="url" type="url" value="${e(site.url||'')}" maxlength="4000" required placeholder="https://example.com"><small class="field-hint">请输入完整的 http:// 或 https:// 地址。</small></label>${section==='sites'?`<label>所属分类<select name="categoryId" required>${categoryOptions(categoryId)}</select></label>`:''}${section!=='friends'?`<label>网站简介<textarea name="description" maxlength="2000" placeholder="用一句话介绍这个网站">${e(site.description||'')}</textarea></label>`:''}${section==='featured'?`<label>封面图片（可选）<select name="artPath"><option value="">不使用封面</option>${selectOptions([['assets/layers/featured/01-miku.png','初音未来'],['assets/layers/featured/02-expo.png','Miku Expo'],['assets/layers/featured/03-garden.png','紫罗兰永恒花园'],['assets/layers/featured/04-game.png','星之卡比'],['assets/layers/featured/05-night.png','赛博朋克'],...(site.artPath&&!/^assets\/layers\/featured\/0[1-5]-/.test(site.artPath)?[[site.artPath,'当前封面']]:[])],site.artPath)}</select></label>`:''}<label class="checkbox-label"><input name="hidden" type="checkbox" ${site.hidden?'checked':''}>隐藏此网站，暂不在前台显示</label>${section==='sites'?`<label class="checkbox-label"><input name="isNew" type="checkbox" ${site.isNew?'checked':''}>标记为 NEW 新网站</label>`:''}`;
}
function openSite(id){
  if(!flat().length){showToast('请先添加一个网站分类');section='categories';draw();return;}
  const original=id?records().find(s=>s.id===id):null;
  showEditor(original?'编辑网站':'添加网站',siteFields(original||{},original?.categoryId||(categoryFilter!=='all'?categoryFilter:flat()[0].id)),async form=>{
    const url=normalizeUrl(form.get('url'));if(!url)throw new Error('网址必须以 http:// 或 https:// 开头');
    await mutate(d=>{
      const dest=findCategory(d,form.get('categoryId'));if(!dest)throw new Error('分类已不存在，请关闭后重试');
      let old={};if(original){const owner=categoryRefs(d).find(c=>c.sites.some(s=>s.id===id));if(!owner)throw new Error('网站已不存在，请重新打开');old=owner.sites.find(s=>s.id===id);}
      const next={...old,id:id||`site-${crypto.randomUUID()}`,name:String(form.get('name')).trim(),url,description:String(form.get('description')).trim(),isNew:form.has('isNew'),hidden:form.has('hidden')};
      upsertSite(d,next,dest.id);
    },original?'网站已更新':'网站已添加');
  });
}
function openCategory(id,parentId=''){
  const original=id?flat().find(c=>c.id===id):null;const parent=original?.parentId||parentId;
  showEditor(original?'编辑分类':'添加分类',`<label>分类名称<input name="name" value="${e(original?.name||'')}" required maxlength="80" autofocus placeholder="例如：设计灵感"></label><label>所属目录<select name="parentId"><option value="">无（作为一级目录）</option>${data.navigation.categories.filter(c=>c.id!==id).map(c=>`<option value="${e(c.id)}" ${parent===c.id?'selected':''}>${e(c.name)}</option>`).join('')}</select><small class="field-hint">最多支持两级。有子分类的目录只能保留在第一级。</small></label>`,async form=>{
    await mutate(d=>{const parentId=String(form.get('parentId'));let category=original?findCategory(d,id):{id:`cat-${crypto.randomUUID()}`,sites:[],children:[]};if(!category)throw new Error('分类不存在，请重新打开');if(parentId&&category.children?.length)throw new Error('请先移出子分类，再将此目录改为子分类');
      const previousParent=original?.parentId||'';
      if(original&&previousParent!==parentId){const list=previousParent?findCategory(d,previousParent).children:d.navigation.categories;list.splice(list.findIndex(c=>c.id===id),1);}
      category.name=String(form.get('name')).trim();
      if(!original||previousParent!==parentId){if(parentId){const dest=findCategory(d,parentId);if(!dest)throw new Error('所属目录已不存在');dest.children ||= [];dest.children.push(category);}else d.navigation.categories.push(category);}
    },original?'分类已更新':'分类已添加');
  });
}
function openLink(id){const target=section,original=id!==undefined?(target==='featured'?data.content.featured.items:data.content.friends)[Number(id)]:null;
  showEditor(`${original?'编辑':'添加'}${target==='featured'?'精选网站':'友情链接'}`,siteFields(original||{}),async form=>{
    const url=normalizeUrl(form.get('url'));if(!url)throw new Error('网址必须以 http:// 或 https:// 开头');
    await mutate(d=>{const list=target==='featured'?d.content.featured.items:d.content.friends;const next={...original,name:String(form.get('name')).trim(),url,hidden:form.has('hidden')};if(target==='featured'){next.description=String(form.get('description')).trim();next.artPath=String(form.get('artPath')||'');}if(original)list[Number(id)]=next;else list.push(next);},'网站已保存');
  });
}
function openHot(){const available=records().filter(s=>!data.content.hot.siteIds.includes(s.id));if(!available.length){showToast('暂无可添加的网站，请先在目录中添加网站');return;}
  showEditor('添加热门推荐',`<label>选择网站<select name="siteId">${available.map(s=>`<option value="${e(s.id)}">${e(s.name)} · ${e(s.categoryName)}${s.hidden?'（已隐藏）':''}</option>`).join('')}</select></label><p class="field-hint">推荐按此列表顺序展示。可在添加后使用上下箭头调整。</p>`,async form=>mutate(d=>{const id=form.get('siteId');if(!categoryRefs(d).some(c=>c.sites.some(s=>s.id===id)))throw new Error('网站不存在');if(!d.content.hot.siteIds.includes(id))d.content.hot.siteIds.push(id);},'推荐已添加'));
}
function add(){if(section==='sites')openSite();else if(section==='categories')openCategory();else if(section==='hot')openHot();else if(section==='featured'||section==='friends')openLink();}
function deleteItem(id){
  const target=section;let name,detail='';
  if(target==='sites')name=records().find(s=>s.id===id).name;
  else if(target==='categories'){const c=findCategory(data,id),total=c.sites.length+(c.children||[]).reduce((sum,x)=>sum+x.sites.length,0);name=c.name;detail=`\n此操作还会删除其中的 ${total} 个网站与 ${(c.children||[]).length} 个子分类，以及相关热门推荐。`;}
  else if(target==='hot')name=records().find(s=>s.id===id).name;
  else name=(target==='featured'?data.content.featured.items:data.content.friends)[Number(id)].name;
  showConfirm(target==='hot'?'移除推荐':'删除确认',`确定${target==='hot'?'从热门推荐移除':'删除'}「${name}」吗？${detail}`,async()=>{
    await mutate(d=>{
      if(target==='sites')deleteSites(d,new Set([id]));
      else if(target==='categories')deleteCategory(d,id);
      else if(target==='hot')d.content.hot.siteIds=d.content.hot.siteIds.filter(x=>x!==id);
      else (target==='featured'?d.content.featured.items:d.content.friends).splice(Number(id),1);
    },target==='hot'?'推荐已移除':'已删除，可撤销上一次操作');
  });
}
async function reorder(id,direction){await mutate(d=>{let list,index;if(section==='sites'){list=categoryRefs(d).find(c=>c.sites.some(s=>s.id===id)).sites;index=list.findIndex(s=>s.id===id);}else if(section==='categories'){const c=flat().find(c=>c.id===id);list=c.parentId?findCategory(d,c.parentId).children:d.navigation.categories;index=list.findIndex(x=>x.id===id);}else if(section==='hot'){list=d.content.hot.siteIds;index=list.indexOf(id);}else{list=section==='featured'?d.content.featured.items:d.content.friends;index=Number(id);}const other=index+direction;if(other>=0&&other<list.length)[list[index],list[other]]=[list[other],list[index]];},'显示顺序已更新');}
async function toggle(id){await mutate(d=>{let site;if(section==='sites')site=categoryRefs(d).flatMap(c=>c.sites).find(s=>s.id===id);else site=(section==='featured'?d.content.featured.items:d.content.friends)[Number(id)];site.hidden=!site.hidden;},'显示状态已更新');}
async function bulk(kind){
  const ids=new Set(selected),dest=$('#bulk-category')?.value;
  const run=async()=>mutate(d=>{
    if(kind==='delete')deleteSites(d,ids);
    else if(kind==='move')moveSites(d,ids,dest);
    else for(const c of categoryRefs(d))for(const s of c.sites)if(ids.has(s.id))s.hidden=kind==='hide';
  },`${ids.size} 个网站已${{delete:'删除',move:'移动',hide:'隐藏',show:'显示'}[kind]}`);
  if(kind==='delete')showConfirm('批量删除',`确定删除选中的 ${ids.size} 个网站吗？\n相关热门推荐也会移除。`,run);else await run();
}
async function updateSubmission(id,action,categoryId=''){
  setBusy(true);
  try{await api(`/api/admin/submissions/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({action,categoryId})});await loadData();showToast(action==='accept'?'投稿已收录并显示在前台目录':'投稿已拒绝');}
  finally{setBusy(false);}
}
function handleSubmission(action,id){
  const item=submissions.find(value=>value.id===id);if(!item){showToast('投稿已不存在，请刷新');return;}
  if(action==='accept'){
    const categoryId=document.querySelector(`[data-submission-category="${CSS.escape(id)}"]`)?.value;
    if(!categoryId){showToast('请先选择收录分类');return;}
    const category=flat().find(value=>value.id===categoryId);
    showConfirm('收录投稿',`将「${item.name}」收录到“${category?.name||categoryId}”，并立即显示在前台目录。`,()=>updateSubmission(id,'accept',categoryId));
  }else if(action==='reject')showConfirm('拒绝投稿',`确定拒绝「${item.name}」吗？这条记录仍会保留在“已拒绝”中。`,()=>updateSubmission(id,'reject'));
  else showConfirm('删除投稿',`确定永久删除「${item.name}」的投稿记录吗？此操作不会删除已经收录的网站。`,async()=>{setBusy(true);try{await api(`/api/admin/submissions/${encodeURIComponent(id)}`,{method:'DELETE',body:'{}'});await loadData();showToast('投稿记录已删除');}finally{setBusy(false);}});
}
$('#auth-form').onsubmit=async event=>{event.preventDefault();const form=new FormData(event.target);$('#auth-error').textContent='';if(setupRequired&&form.get('password')!==form.get('confirm')){$('#auth-error').textContent='两次输入的密码不一致';return;}$('#auth-submit').disabled=true;try{await api(setupRequired?'/api/setup':'/api/login',{method:'POST',body:JSON.stringify({username:form.get('username'),password:form.get('password')})});event.target.reset();await authenticate();}catch(error){$('#auth-error').textContent=error.message;}finally{$('#auth-submit').disabled=false;}};
$('#editor-form').onsubmit=async event=>{event.preventDefault();if(busy)return;$('#editor-error').textContent='';try{await editorHandler(new FormData(event.target));$('#editor-dialog').close();}catch(error){$('#editor-error').textContent=error.message;}};
$('#confirm-action').onclick=async()=>{if(busy)return;$('#confirm-error').textContent='';try{await confirmHandler();$('#confirm-dialog').close();}catch(error){$('#confirm-error').textContent=error.message;}};
$('#main-add').onclick=add;
$('#reload-button').onclick=async()=>{if(busy)return;try{await loadData();undoData=null;$('#undo-button').hidden=true;showToast('已加载最新数据');}catch(error){showToast(error.message);}};
$('#undo-button').onclick=()=>{if(!undoData)return;const previous=structuredClone(undoData);showConfirm('撤销上一次操作','将目录与设置恢复到上一次保存前的状态。',async()=>{await save(previous,'已撤销上一次操作',false);undoData=null;$('#undo-button').hidden=true;});};
$('#logout-button').onclick=async()=>{if(busy)return;try{await api('/api/logout',{method:'POST',body:'{}'});data=null;undoData=null;selected.clear();await authenticate();}catch(error){showToast(error.message);}};
document.addEventListener('click',async event=>{
  const close=event.target.closest('[data-close]');if(close&&!busy){document.getElementById(close.dataset.close).close();return;}
  const nav=event.target.closest('[data-section]');if(nav&&!busy){section=nav.dataset.section;page=1;query='';categoryFilter='all';statusFilter='all';selected.clear();draw();return;}
  const button=event.target.closest('[data-action]');if(!button||busy)return;const {action,id}=button.dataset;
  try{
    if(action==='retry-auth')await authenticate();
    else if(action==='page'){page=Number(id);updateSiteTable();}
    else if(action==='edit'){if(section==='sites')openSite(id);else if(section==='categories')openCategory(id);else openLink(id);}
    else if(action==='delete')deleteItem(id);
    else if(action==='up'||action==='down')await reorder(id,action==='up'?-1:1);
    else if(action==='toggle')await toggle(id);
    else if(action==='add-child')openCategory(undefined,id);
    else if(action==='accept-submission')handleSubmission('accept',id);
    else if(action==='reject-submission')handleSubmission('reject',id);
    else if(action==='delete-submission')handleSubmission('delete',id);
    else if(action==='clear-selection'){selected.clear();updateSiteTable();}
    else if(action.startsWith('bulk-'))await bulk(action.slice(5));
    else if(action==='import'){$('#import-file').value='';$('#import-file').click();}
  }catch(error){showToast(error.message);}
});
document.addEventListener('input',event=>{if(event.target.id==='admin-search'){query=event.target.value;page=1;selected.clear();updateSiteTable();}});
document.addEventListener('change',event=>{
  if(event.target.id==='submission-filter'){submissionFilter=event.target.value;drawSubmissions();}
  if(event.target.id==='category-filter'||event.target.id==='status-filter'){categoryFilter=$('#category-filter').value;statusFilter=$('#status-filter').value;page=1;selected.clear();updateSiteTable();}
  if(event.target.matches('[data-select]')){const id=event.target.dataset.select;if(event.target.checked)selected.add(id);else selected.delete(id);updateSiteTable();}
  if(event.target.id==='select-page'){for(const s of siteRows().slice((page-1)*pageSize,page*pageSize)){if(event.target.checked)selected.add(s.id);else selected.delete(s.id);}updateSiteTable();}
});
document.addEventListener('submit',async event=>{
  if(event.target.id==='settings-form'){event.preventDefault();if(busy)return;const form=new FormData(event.target);try{await mutate(d=>{d.settings={ad:validateAd({enabled:form.has('adEnabled'),title:String(form.get('adTitle')).trim(),text:String(form.get('adText')).trim(),image:String(form.get('adImage')).trim(),url:String(form.get('adUrl')).trim(),button:String(form.get('adButton')).trim()}),tagline:String(form.get('tagline')).trim(),announcement:String(form.get('announcement')).trim()};d.content.hot.title=String(form.get('hotTitle')).trim();d.content.featured.title=String(form.get('featuredTitle')).trim();},'站点设置已保存');}catch(error){$('#settings-error').textContent=error.message;}}
  if(event.target.id==='password-form'){event.preventDefault();if(busy)return;setBusy(true);try{const form=new FormData(event.target);await api('/api/admin/password',{method:'POST',body:JSON.stringify(Object.fromEntries(form))});event.target.reset();showToast('密码已更新，其他登录会话已失效');}catch(error){$('#password-error').textContent=error.message;}finally{setBusy(false);}}
});
$('#import-file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>8*1024*1024)throw new Error('备份文件不能超过 8 MB');const backup=JSON.parse(await file.text());validateNavigation(backup.navigation);validatePageContent(backup.content,backup.navigation.categories);if(!backup.settings||typeof backup.settings.tagline!=='string'||typeof backup.settings.announcement!=='string')throw new Error('请使用本站导出的完整备份文件');const groups=flattenCategories(backup.navigation.categories),total=groups.reduce((sum,c)=>sum+c.sites.length,0);
    showConfirm('恢复备份',`文件：${file.name}\n包含 ${total} 个网站、${groups.length} 个分类、${backup.content.featured.items.length} 个精选、${backup.content.friends.length} 个友链。\n\n确认后将替换当前全部目录与设置。`,async()=>save(backup,'备份已恢复，前台目录已更新'));
  }catch(error){showToast(`无法导入：${error.message}`);}
};
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
startClock();authenticate();
document.querySelectorAll('a[href="/admin"]').forEach(link=>{link.href=window.location.pathname;});
