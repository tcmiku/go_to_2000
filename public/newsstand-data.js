export const categoryNames={literature:'文学',novel:'小说',comic:'漫画',audio:'有声'};
export function safeWebUrl(value,base){
 try{const url=new URL(value,base);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;return url.href;}catch{return null;}
}
export function bookId(book){return `${book.sourceId}:${book.bookUrl}`;}
export function readBooks(storage){
 try{const books=JSON.parse(storage.getItem('newsstand:books:v1')||'[]');return Array.isArray(books)?books.filter(book=>book&&typeof book.name==='string'&&book.name.trim()&&typeof book.sourceId==='string'&&safeWebUrl(String(book.bookUrl).split(/,\s*\{/)[0])).slice(0,500):[];}catch{return [];}
}
export function addBook(books,book){const id=bookId(book);return books.some(entry=>bookId(entry)===id)?books: [...books,{...book,addedAt:new Date().toISOString()}];}
export function filterBooks(books,{category='all',query=''}={}){const q=query.trim().toLocaleLowerCase();return books.filter(book=>(category==='all'||book.category===category)&&(!q||`${book.name} ${book.author||''}`.toLocaleLowerCase().includes(q)));}

const matchText=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu,'');
export function mergeBookMatches(groups,books){
 for(const book of books){const id=`${matchText(book.name)}\u0000${matchText(book.author)}`;let group=groups.get(id);if(!group){group={id,name:book.name,author:book.author,books:[]};groups.set(id,group);}if(!group.books.some(item=>bookId(item)===bookId(book)))group.books.push(book);}
 return groups;
}
export function rankBookMatches(groups,query){
 const key=matchText(query),score=group=>{const title=matchText(group.name),author=matchText(group.author);return title===key?100:title.startsWith(key)?90:author===key?80:title.includes(key)?70:50;};
 return [...groups.values()].sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name,'zh-CN')||a.id.localeCompare(b.id));
}
export async function readSearchStream(response,onEvent){
 if(!response.ok){const body=await response.json();throw new Error(body.error||'搜索失败');}
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',finished=false;
 function consume(line){if(!line.trim())return;const event=JSON.parse(line);if(event.type==='error')throw new Error(event.error);if(event.type==='done')finished=true;onEvent(event);}
 try{while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let newline;while((newline=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,newline));buffer=buffer.slice(newline+1);}if(buffer.length>8*1024*1024)throw new Error('书源返回的数据过大');if(done){if(buffer.trim())consume(buffer);break;}}if(!finished)throw new Error('搜索连接已中断，已保留找到的书，请重试');}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
