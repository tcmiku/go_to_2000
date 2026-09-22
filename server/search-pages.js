import { flattenCategories, selectGroups } from '../public/navigation-data.js';

const origin = 'https://nav.tcmiku.cc.cd';
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const website = {'@type':'WebSite','@id':`${origin}/#website`,url:`${origin}/`,name:'千禧冲浪站',alternateName:'WEB SURFER 1999',inLanguage:'zh-CN'};
function cards(groups, limit = Infinity, offset = 0) {
  let position = 0;
  return groups.map(group => {
    const start = position; position += group.sites.length;
    const sites = group.sites.slice(Math.max(0, offset-start), Math.max(0, offset+limit-start));
    if (!sites.length) return '';
    return `<section class="link-group" id="category-${escape(group.id)}"><h3 class="group-heading">${escape(group.name)}</h3><div class="link-grid">${sites.map(site => `<article class="site-link"><a href="${escape(site.url)}" target="_blank" rel="noopener noreferrer">${escape(site.name)}</a><p>${escape(site.description || new URL(site.url).hostname)}</p></article>`).join('')}</div></section>`;
  }).join('');
}
export function renderSearchPage(template, data, {directory = false, params = new URLSearchParams()} = {}) {
  const categories = flattenCategories(data.navigation.categories).map(category => ({...category,sites:category.sites.filter(site => !site.hidden)}));
  if (directory) {
    const sections = categories.filter(category => category.sites.length);
    template = template.replace('<!-- DIRECTORY -->', `<nav aria-label="目录分类">${sections.map(category => `<a href="#category-${escape(category.id)}">${escape(category.name)}</a>`).join(' · ')}</nav>${cards(sections)}`);
  } else {
    const view = params.get('category') || 'all';
    const groups = selectGroups(data.navigation.categories, ['all','favorites',...categories.map(c=>c.id)].includes(view) ? view : 'all', params.get('q') || '', []);
    const pages = Math.max(1,Math.ceil(groups.reduce((sum,c)=>sum+c.sites.length,0)/36));
    const page = Math.min(pages,Math.max(1,Math.min(10000,parseInt(params.get('page'),10)||1)));
    template = template.replace('<div class="empty">正在载入你的小小互联网…</div>', cards(groups,36,(page-1)*36) || '<p>暂无网站，请浏览完整网站目录。</p>');
  }
  const url = `${origin}/${directory ? 'directory.html' : ''}`;
  const page = {'@type':'CollectionPage','@id':`${url}#page`,url,name:directory?'完整网站目录 · 千禧冲浪站':'千禧冲浪站',inLanguage:'zh-CN',isPartOf:{'@id':website['@id']}};
  return template.replace('</head>', `<script type="application/ld+json">${json({'@context':'https://schema.org','@graph':[website,page]})}</script></head>`);
}
