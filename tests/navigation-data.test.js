import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { flattenCategories, normalizeUrl, selectGroups, validateNavigation, validatePageContent } from '../navigation-data.js';

const fixture = () => ({
  version: 1,
  source: { name: '测试来源', url: 'https://example.com/' },
  categories: [
    { id: 'popular', name: '热门', sites: [{ id: 'one', name: '共享站点', url: 'https://example.com', description: '常用入口' }], children: [] },
    { id: 'resources', name: '资源', sites: [], children: [
      { id: 'books', name: '电子书', sites: [{ id: 'two', name: '图书馆 Library', url: 'https://books.example.com/', description: '计算机与历史资料' }] },
      { id: 'images', name: '以图搜图', sites: [{ id: 'three', name: '共享站点', url: 'https://example.com/', description: '图片搜索工具' }] },
    ] },
  ],
});

test('production JSON files validate without third-party dependencies', async () => {
  const navigation = JSON.parse(await readFile(new URL('../data/navigation.json', import.meta.url), 'utf8'));
  const content = JSON.parse(await readFile(new URL('../data/page-content.json', import.meta.url), 'utf8'));
  assert.equal(validateNavigation(navigation), navigation);
  assert.equal(validatePageContent(content, navigation.categories), content);
});

test('flatten retains parent-child relationships and source order', () => {
  const flat = flattenCategories(fixture().categories);
  assert.deepEqual(flat.map(category => category.id), ['popular', 'resources', 'books', 'images']);
  assert.equal(flat[2].parentId, 'resources');
});

test('all, parent and leaf category filtering return the correct sites', () => {
  const categories = fixture().categories;
  assert.equal(selectGroups(categories).flatMap(group => group.sites).length, 3);
  assert.deepEqual(selectGroups(categories, 'resources').map(group => group.id), ['books', 'images']);
  assert.deepEqual(selectGroups(categories, 'books').map(group => group.id), ['books']);
  assert.deepEqual(selectGroups(categories, 'missing'), []);
});

test('search covers names, descriptions and URLs, with case-insensitive multi-word matching', () => {
  const categories = fixture().categories;
  for (const query of ['LIBRARY', '历史', 'books.example.com', 'library 计算机']) {
    assert.equal(selectGroups(categories, 'all', query)[0].sites[0].id, 'two');
  }
  assert.deepEqual(selectGroups(categories, 'all', 'no-such-site'), []);
});

test('favorites deduplicate normalized URLs and remain searchable', () => {
  const categories = fixture().categories;
  const favorites = ['https://example.com/'];
  assert.equal(selectGroups(categories, 'favorites', '', favorites).flatMap(group => group.sites).length, 1);
  assert.equal(selectGroups(categories, 'favorites', '图片', favorites)[0].sites[0].id, 'three');
});

test('pre-import favorites absent from the new directory are retained', () => {
  const groups = selectGroups(fixture().categories, 'favorites', '', ['https://old.example.org', 'javascript:alert(1)']);
  assert.equal(groups[0].id, 'retained-favorites');
  assert.equal(groups[0].sites[0].url, 'https://old.example.org/');
  assert.equal(groups[0].sites.length, 1);
});

test('empty directories are valid and produce empty states', () => {
  const data = fixture();
  data.categories = [];
  assert.equal(validateNavigation(data), data);
  assert.deepEqual(selectGroups(data.categories), []);
});

test('invalid or duplicate category and site IDs are rejected', () => {
  const category = fixture();
  category.categories[1].id = 'popular';
  assert.throws(() => validateNavigation(category), /分类 id/);
  const site = fixture();
  site.categories[1].children[0].sites[0].id = 'one';
  assert.throws(() => validateNavigation(site), /网站 id/);
});

test('unsafe protocols and missing site fields are rejected', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '/relative', 'file:///tmp/test']) {
    assert.equal(normalizeUrl(url), null);
    const data = fixture();
    data.categories[0].sites[0].url = url;
    assert.throws(() => validateNavigation(data), /url/);
  }
  const data = fixture();
  data.categories[0].sites[0].name = '';
  assert.throws(() => validateNavigation(data), /name/);
});

test('unknown highlight IDs fail validation instead of silently breaking the page', () => {
  assert.throws(() => validatePageContent({ hot: { title: '热门', siteIds: ['missing'] } }, fixture().categories), /不存在的网站/);
});

test('URL normalization preserves tracking parameters and anchors', () => {
  assert.equal(normalizeUrl('https://example.com?utm_source=qinight#docs'), 'https://example.com/?utm_source=qinight#docs');
});
