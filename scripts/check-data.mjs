import { readFile } from 'node:fs/promises';
import { validateStore } from '../server.js';
import { flattenCategories, validateNavigation, validatePageContent } from '../navigation-data.js';

try {
  const navigation = validateNavigation(JSON.parse(await readFile(new URL('../data/navigation.json', import.meta.url), 'utf8')));
  validatePageContent(JSON.parse(await readFile(new URL('../data/page-content.json', import.meta.url), 'utf8')), navigation.categories);
  const categories = flattenCategories(navigation.categories);
  const sites = categories.flatMap(category => category.sites);
  console.log(`JSON 数据校验通过：${navigation.categories.length} 个一级分类 / ${categories.length - navigation.categories.length} 个子分类 / ${sites.length} 条导航记录。`);
  console.log('分类 ID、网站 ID、URL 协议及热门推荐引用均有效。');
  try {
    const current = JSON.parse(await readFile(new URL('../data/store.json', import.meta.url), 'utf8'));
    validateStore(current);
    const total = flattenCategories(current.navigation.categories).reduce((sum, category) => sum + category.sites.length, 0);
    console.log(`当前后台数据校验通过：${total} 条导航记录 / 版本 ${current.revision}。`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
} catch (error) {
  console.error(`JSON 数据校验失败：${error.message}`);
  process.exitCode = 1;
}
