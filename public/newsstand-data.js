export const categoryNames={literature:'文学',novel:'小说',comic:'漫画',audio:'有声'};
export function safeWebUrl(value,base){
 try{const url=new URL(value,base);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;return url.href;}catch{return null;}
}
// Only literal HTTP GET templates are navigated. Legado Java/JS and request bodies
// remain untouched in downloadable source files; they are never evaluated here.
export function searchUrl(source,keyword){
 const key=String(keyword).trim();if(!key)return safeWebUrl(source.url);
 const rule=String(source.search||'').trim();
 if(!rule.includes('{{key}}')||/@js|<\/?js|javascript:|,\s*\{|\n|\r/i.test(rule))return null;
 if(/\.json(?:[?#]|$)|\/(?:api|m-revision|revision|get-search-book-list|search\/mini|comic22\/so)\/|\/novel\/i\.php/i.test(rule))return null;
 const expanded=rule.replaceAll('{{key}}',encodeURIComponent(key)).replaceAll('{{page}}','1');
 if(/[{}<>]/.test(expanded))return null;
 return safeWebUrl(expanded,source.url);
}
export function filterSources(sources,{category='all',query='',saved=[]}={}){
 const q=String(query).trim().toLocaleLowerCase();const savedIds=new Set(saved);
 return sources.filter(s=>(category==='all'||category==='saved'&&savedIds.has(s.id)||s.category===category)&&(!q||`${s.title} ${s.name} ${s.url}`.toLocaleLowerCase().includes(q)));
}
export function readSaved(storage){try{const value=JSON.parse(storage.getItem('newsstand:saved')||'[]');return Array.isArray(value)?value.filter(x=>typeof x==='string').slice(0,100):[];}catch{return [];}}
