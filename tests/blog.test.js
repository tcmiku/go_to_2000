import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateBlog} from '../public/blog-data.js';
test('migrated archive contains all 44 unique articles with full content and source attribution',async()=>{
 const blog=JSON.parse(await readFile(new URL('../data/blog-seed.json',import.meta.url),'utf8'));
 validateBlog(blog);assert.equal(blog.posts.length,44);
 assert.equal(new Set(blog.posts.map(p=>p.sourceUrl)).size,44);
 assert.ok(blog.posts.every(p=>p.body.length>50&&p.sourceUrl.startsWith('https://tcmiku.github.io/')));
 assert.ok(blog.posts.reduce((n,p)=>n+p.body.length,0)>200000);
});
