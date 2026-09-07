// Shared by the browser and the zero-dependency data checks.
export function normalizeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function flattenCategories(categories) {
  return categories.flatMap(category => [
    { ...category, parentId: null },
    ...(category.children || []).map(child => ({ ...child, parentId: category.id })),
  ]);
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function validateSite(site, location) {
  requireValue(site && typeof site.name === 'string' && site.name.trim(), `${location}: name 不能为空`);
  requireValue(typeof site.url === 'string' && normalizeUrl(site.url), `${location}: url 必须是 http/https 地址`);
  requireValue(typeof site.description === 'string', `${location}: description 必须是字符串`);
  requireValue(site.isNew === undefined || typeof site.isNew === 'boolean', `${location}: isNew 必须是布尔值`);
}

export function validateNavigation(data) {
  requireValue(data?.version === 1 && Array.isArray(data.categories), 'navigation.json: version 必须为 1，categories 必须是数组');
  requireValue(data.source && normalizeUrl(data.source.url) && typeof data.source.name === 'string', 'navigation.json: source 数据来源格式无效');
  const categoryIds = new Set(['all', 'favorites']);
  const siteIds = new Set();
  function checkCategory(category, child = false) {
    requireValue(category && typeof category.id === 'string' && /^[a-zA-Z0-9_-]+$/.test(category.id), '分类 id 只能使用字母、数字、短横线和下划线');
    requireValue(!categoryIds.has(category.id), `分类 id 重复或保留: ${category.id}`);
    categoryIds.add(category.id);
    requireValue(typeof category.name === 'string' && category.name.trim(), `${category.id}: 分类名称不能为空`);
    requireValue(Array.isArray(category.sites), `${category.id}: sites 必须是数组`);
    requireValue(category.children === undefined || Array.isArray(category.children), `${category.id}: children 必须是数组`);
    requireValue(!child || !category.children?.length, `${category.id}: 仅支持两级分类`);
    for (const site of category.sites) {
      validateSite(site, category.id);
      requireValue(typeof site.id === 'string' && site.id.trim() && !siteIds.has(site.id), `${category.id}: 网站 id 缺失或重复 (${site.id})`);
      siteIds.add(site.id);
    }
    for (const next of category.children || []) checkCategory(next, true);
  }
  data.categories.forEach(category => checkCategory(category));
  return data;
}

export function validatePageContent(content, categories) {
  const ids = new Set(flattenCategories(categories).flatMap(category => category.sites.map(site => site.id)));
  requireValue(typeof content?.hot?.title === 'string' && Array.isArray(content.hot.siteIds), 'page-content.json: hot 格式无效');
  for (const id of content.hot.siteIds) requireValue(ids.has(id), `热门推荐引用了不存在的网站: ${id}`);
  requireValue(typeof content.featured?.title === 'string' && Array.isArray(content.featured.items), 'page-content.json: featured 格式无效');
  for (const site of content.featured.items) {
    validateSite(site, 'featured');
    const artPath = site.artPath;
    requireValue(!artPath || (typeof artPath === 'string' && /^assets\/layers\/[\w./-]+\.png$/.test(artPath)), `featured: ${site.name} 的 artPath 必须是 assets/layers 下的 PNG`);
  }
  requireValue(Array.isArray(content.friends), 'page-content.json: friends 必须是数组');
  for (const site of content.friends) requireValue(typeof site.name === 'string' && normalizeUrl(site.url), '友情链接名称或地址无效');
  return content;
}

export function selectGroups(categories, view = 'all', query = '', favorites = []) {
  const flat = flattenCategories(categories);
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const favoriteUrls = new Set(favorites.map(normalizeUrl).filter(Boolean));
  const seen = new Set();
  const matches = site => tokens.every(token => `${site.name} ${site.description} ${site.url}`.toLocaleLowerCase().includes(token));
  const groups = flat.filter(category => view === 'all' || view === 'favorites' || category.id === view || category.parentId === view).map(category => ({
    ...category,
    sites: category.sites.filter(site => {
      if (!matches(site)) return false;
      if (view !== 'favorites') return true;
      const url = normalizeUrl(site.url);
      if (!favoriteUrls.has(url) || seen.has(url)) return false;
      seen.add(url);
      return true;
    }),
  })).filter(category => category.sites.length);
  // Keep pre-import bookmarks accessible even if the new directory omits them.
  if (view === 'favorites') {
    const known = new Set(flat.flatMap(category => category.sites.map(site => normalizeUrl(site.url))));
    const retained = [...favoriteUrls].filter(url => !known.has(url)).map((url, index) => ({
      id: `saved-${index}`, name: new URL(url).hostname, url, description: '原收藏链接 · 不在当前目录中',
    })).filter(matches);
    if (retained.length) groups.push({ id: 'retained-favorites', name: '原有收藏', parentId: null, sites: retained });
  }
  return groups;
}
