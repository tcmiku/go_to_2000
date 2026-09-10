export function validateBlog(blog={posts:[]}) {
  if(!blog || !Array.isArray(blog.posts) || blog.posts.length>2000) throw new Error('博客最多支持 2000 篇文章');
  const ids=new Set();
  for(const p of blog.posts){
    if(!p || typeof p.id!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id) || ids.has(p.id)) throw new Error('文章 ID 无效或重复');
    ids.add(p.id);
    for(const [key,max] of Object.entries({title:200,date:10,category:100,summary:500,body:500000,sourceUrl:4000})){
      if(typeof p[key]!=='string'||p[key].length>max) throw new Error(`文章 ${key} 无效或过长`);
    }
    if(!p.title.trim()||!p.body.trim())throw new Error('请填写文章标题和正文');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p.date)||!Number.isFinite(Date.parse(p.date))||new Date(p.date).toISOString().slice(0,10)!==p.date)throw new Error('文章日期无效');
    if(!['draft','published'].includes(p.status))throw new Error('文章状态无效');
    if(!Array.isArray(p.tags)||p.tags.length>30||p.tags.some(t=>typeof t!=='string'||t.length>60))throw new Error('文章标签无效');
    if(p.sourceUrl&&!/^https?:\/\//i.test(p.sourceUrl))throw new Error('原文地址无效');
  }
  return blog;
}
