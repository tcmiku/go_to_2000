// Mutation helpers use actual category objects, not flattened display copies.
export const categoryNodes = data => data.navigation.categories.flatMap(category => [category, ...(category.children || [])]);
export const categoryById = (data, id) => categoryNodes(data).find(category => category.id === id);

export function deleteSites(data, ids) {
  for (const category of categoryNodes(data)) category.sites = category.sites.filter(site => !ids.has(site.id));
  data.content.hot.siteIds = data.content.hot.siteIds.filter(id => !ids.has(id));
}

export function moveSites(data, ids, destinationId) {
  const destination = categoryById(data, destinationId);
  if (!destination) throw new Error('请选择有效的目标分类');
  const moving = categoryNodes(data).flatMap(category => category.sites).filter(site => ids.has(site.id));
  for (const category of categoryNodes(data)) category.sites = category.sites.filter(site => !ids.has(site.id));
  destination.sites.push(...moving);
}

export function upsertSite(data, site, destinationId) {
  const destination = categoryById(data, destinationId);
  if (!destination) throw new Error('分类已不存在，请关闭后重试');
  const owner = categoryNodes(data).find(category => category.sites.some(item => item.id === site.id));
  if (owner && owner.id !== destinationId) owner.sites = owner.sites.filter(item => item.id !== site.id);
  const index = destination.sites.findIndex(item => item.id === site.id);
  if (index >= 0) destination.sites[index] = site;
  else destination.sites.push(site);
}

export function deleteCategory(data, id) {
  const category = categoryById(data, id);
  if (!category) throw new Error('分类不存在，请刷新后重试');
  const ids = new Set([category, ...(category.children || [])].flatMap(item => item.sites.map(site => site.id)));
  deleteSites(data, ids);
  data.navigation.categories = data.navigation.categories.filter(item => item.id !== id);
  for (const parent of data.navigation.categories) parent.children = (parent.children || []).filter(item => item.id !== id);
}
