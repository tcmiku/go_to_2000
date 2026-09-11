import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import iconv from 'iconv-lite';
import {LegadoRules,htmlText} from '../server/legado-rules.js';
import {createNewsstandService} from '../server/newsstand-service.js';
import {readBooks,addBook,bookId,filterBooks} from '../public/newsstand-data.js';

test('Legado HTML chains, relative attributes, XPath, JSONPath and replacements',()=>{
 const engine=new LegadoRules({baseUrl:'https://books.example'});
 const html='<html><head><meta property="og:novel:book_name" content="山海记"></head><body><div class="book wide"><h1>山海记</h1><p>简介</p><p>下段</p><a href="/book/1">第一章</a></div></body></html>';
 assert.equal(engine.text(html,'class.book wide@tag.h1@text'),'山海记');
 assert.equal(engine.text(html,'//meta[@property="og:novel:book_name"]/@content'),'山海记');
 assert.equal(engine.text(html,'class.book.0@tag.p.-1@text'),'下段');
 assert.equal(engine.text(html,'class.book@tag.p[0:1]@text'),'简介\n下段');
 const [row]=engine.values(html,'class.book@tag.a',{elements:true});assert.equal(engine.text(row,'href'),'/book/1');assert.equal(engine.text(row,'text##第一##第壹'),'第壹章');
 assert.equal(engine.text(html,'#missing@text||h1@text'),'山海记');
 assert.equal(engine.text({data:[{title:'山海记'}]},'$.data[0].title'),'山海记');
 assert.deepEqual(engine.values({data:[{grade:1},{grade:2}]},'data[?(@.grade > 1)]',{elements:true}),[{grade:2}]);
 assert.deepEqual(engine.values('{"data":[{"name":"A"},{"name":"B"}]}','$.data',{elements:true}),[{name:'A'},{name:'B'}]);
 assert.equal(htmlText('<p>一<br>二</p><script>bad()</script><p>三</p>'),'一\n二\n三');
});
test('URL templates encode queries, handle POST and keep JavaScript isolated and bounded',()=>{
 const engine=new LegadoRules({baseUrl:'https://books.example/',key:'山海 & #记',page:3});
 const get=engine.request('/search?q={{key}}&start={{(page-1)*10}}');assert.equal(new URL(get.url).searchParams.get('q'),'山海 & #记');assert.equal(new URL(get.url).searchParams.get('start'),'20');
 const post=engine.request(`<js>var opts={method:'POST',body:JSON.stringify({q:key,page:page})}; '/search,'+JSON.stringify(opts)</js>`);
 assert.equal(post.options.method,'POST');assert.deepEqual(JSON.parse(post.options.body),{q:'山海 & #记',page:3});
 assert.equal(engine.text('abc',`@js:java.put('id','7');result.toUpperCase()`),'ABC');assert.equal(engine.variables.id,'7');
 assert.equal(engine.js('typeof process + ":" + typeof require',''),'undefined:undefined');
 assert.throws(()=>engine.js('while(true){}',''),/脚本/);
 assert.equal(engine.request(`/book,{'webView':true}`).options.webView,true);
 assert.throws(()=>engine.request(`/book,{'webJs':'document.body'}`),/WebView/);
 assert.throws(()=>engine.request('file:///etc/passwd'),/无效地址/);
});
test('the actual kuaishu source parses search, metadata, paginated TOC and readable content',async()=>{
 const source=JSON.parse(await readFile(new URL('../public/newsstand-sources/kuaishu.json',import.meta.url),'utf8'))[0];
 const requests=[];
 const info='<meta property="og:novel:book_name" content="山海记"><meta property="og:novel:author" content="林舟"><meta property="og:description" content="山海之间">';
 const pages={
  '/search/':'<div class="item"><h3><a href="/book/1">山海记</a></h3><p>小说</p><p><a>作者：林舟</a></p></div>',
  '/book/1':`${info}<div id="content_1"><a href="/chapter/1">第一章</a></div><a class="index-container-btn" href="/book/1">首页</a><a class="index-container-btn" href="/toc/2">下页</a>`,
  '/toc/2':'<div id="content_1"><a href="/chapter/1">第一章</a><a href="/chapter/2">第二章</a></div><a class="index-container-btn">上页</a><a class="index-container-btn" href="/book/1">首页</a>',
  '/chapter/1':'<div id="booktxt"><p>风从山间吹来。</p><p>他推开门。</p></div>',
 };
 const service=createNewsstandService({sources:new Map([['kuaishu',source]]),metadata:[{id:'kuaishu',title:'快书网',category:'novel'}],request:async(url,options)=>{requests.push({url,options});return{statusCode:200,body:pages[new URL(url).pathname]||'',headers:{},url};}});
 const result=await service('search',{sourceId:'kuaishu',query:'山海'});assert.equal(result.books[0].name,'山海记');assert.equal(result.books[0].author,'林舟');assert.equal(result.books[0].bookUrl,'https://www.kuaishu5.com/book/1');
 const {book}=await service('book',{sourceId:'kuaishu',book:result.books[0]});assert.equal(book.name,'山海记');assert.equal(book.intro,'山海之间');
 const {chapters,nextUrl}=await service('toc',{sourceId:'kuaishu',book});assert.deepEqual(chapters.map(ch=>ch.name),['第一章','第二章']);assert.equal(nextUrl,'');
 const chapter=await service('content',{sourceId:'kuaishu',book,chapterUrl:chapters[0].url});assert.equal(chapter.content,'风从山间吹来。\n他推开门。');
 assert.ok(requests.every(req=>req.options.raw));
});
test('JSON/POST sources and GBK responses are parsed rather than opened as websites',async()=>{
 const source={bookSourceUrl:'https://books.example',bookSourceType:0,searchUrl:`/find,{'method':'POST','body':'q={{key}}','charset':'gbk'}`,ruleSearch:{bookList:'$.books',name:'$.name',author:'$.author',bookUrl:'$.url'}};
 const service=createNewsstandService({sources:new Map([['fixture',source]]),metadata:[],request:async(url,options)=>{assert.equal(options.body,'q=%C9%BD%BA%A3');return{statusCode:200,bytes:iconv.encode(JSON.stringify({books:[{name:'山海',author:'林舟',url:'/1'}]}),'gbk'),headers:{},url};}});
 const result=await service('search',{sourceId:'fixture',query:'山海'});assert.equal(result.books[0].name,'山海');assert.equal(result.books[0].bookUrl,'https://books.example/1');
});
test('chapter continuations are joined, repeated links cannot loop',async()=>{
 const source={bookSourceUrl:'https://books.example',ruleContent:{content:'.content@html',nextContentUrl:'a@href',replaceRegex:'##广告'}};
 const service=createNewsstandService({sources:new Map([['test',source]]),metadata:[],request:async(url)=>({statusCode:200,headers:{},url,body:new URL(url).pathname==='/1'?'<div class="content"><p>一广告</p></div><a href="/2">下一页</a>':'<div class="content"><p>二</p></div><a href="/1">返回</a>'})});
 const result=await service('content',{sourceId:'test',bookUrl:'https://books.example/book',chapterUrl:'https://books.example/1'});assert.equal(result.content,'一\n\n二');
});
test('missing rules, network failures, unknown sources and unsupported media fail explicitly',async()=>{
 const service=createNewsstandService({sources:new Map([['empty',{bookSourceUrl:'https://books.example'}],['comic',{bookSourceUrl:'https://books.example',bookSourceType:1}]]),metadata:[]});
 await assert.rejects(service('search',{sourceId:'bad',query:'书'}),/有效/);await assert.rejects(service('search',{sourceId:'empty',query:'书'}),/没有搜索规则/);await assert.rejects(service('search',{sourceId:'comic',query:'书'}),/漫画/);
 await assert.rejects(service('search',null),/JSON 对象/);
 const offline=createNewsstandService({sources:new Map([['test',{bookSourceUrl:'https://books.example',searchUrl:'/find',ruleSearch:{bookList:'.book'}}]]),metadata:[],request:async()=>{throw Object.assign(new Error('音源连接超时'),{status:504});}});
 await assert.rejects(offline('search',{sourceId:'test',query:'书'}),error=>error.status===504&&error.message==='书源连接超时');
});
test('only explicit books enter the shelf; old source favorites never migrate',()=>{
 assert.deepEqual(readBooks({getItem:key=>key==='newsstand:saved'?'["qidian"]':null}),[]);
 const book={name:'山海记',sourceId:'kuaishu',bookUrl:'https://books.example/1',author:'林舟',category:'novel'};
 const saved=addBook([],book);assert.equal(saved.length,1);assert.equal(addBook(saved,book).length,1);
 assert.equal(readBooks({getItem:()=>JSON.stringify(saved)})[0].name,book.name);
 assert.deepEqual(filterBooks(saved,{query:'林舟'}),saved);assert.deepEqual(filterBooks(saved,{category:'literature'}),[]);
 assert.equal(bookId(saved[0]),'kuaishu:https://books.example/1');
 assert.deepEqual(readBooks({getItem:()=>'{broken'}),[]);
});
