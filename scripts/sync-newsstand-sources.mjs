import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const bundle='https://legado.aoaostar.com/sources/b778fe6b.json';
const specs=[
 ['duzhe','读者','www.52dzxy.com','literature','green','bold','读者'],
 ['qidian','起点中文','www.qidian.com','novel','red','vertical','起点中文'],
 ['douban','豆瓣阅读','read.douban.com','literature','cream','bold'],
 ['kehuan','科幻小说','www.kehuan.net.cn','novel','blue','bold'],
 ['jinjiang','晋江文学','m.jjwxc.net','novel','pink','vertical','🏷晋江文学'],
 ['kuaikan','快看漫画','m.kuaikanmanhua.com','comic','yellow','bold','快看漫画M'],
 ['hetushu','和图书','hetushu.com','literature','mint','vertical','和图书'],
 ['handian','汉典古籍','gj.zdic.net','literature','cream','vertical'],
 ['ximalaya','喜马拉雅','www.ximalaya.com','audio','red','bold','🎧喜马拉雅'],
 ['ttkan','天天看小说','cn.ttkan.co','novel','yellow','vertical','天天看小说'],
 ['bilibili','哔哩漫画','manga.bilibili.com','comic','blue','bold'],
 ['hongxiu','红袖添香','www.hongxiu.com','novel','pink','vertical','红袖添香'],
 ['kuaishu','快书网','www.kuaishu5.com','novel','green','bold','快书网'],
 ['manman','漫漫漫画','www.manmanapp.com','comic','purple','bold'],
 ['lrts','懒人听书','m.lrts.me','audio','cream','vertical'],
 ['ciweimao','刺猬猫','www.ciweimao.com','novel','yellow','bold','刺猬猫'],
 ['qianbi','铅笔小说','www.23qb.com','novel','mint','vertical','铅笔小说'],
 ['wangyi','网易云阅读','m.yuedu.163.com','literature','red','bold'],
 ['deqi','得奇小说','www.deqixs.com','novel','purple','vertical','得奇小说网'],
 ['iqiyi','爱奇艺漫画','www.iqiyi.com','comic','green','bold'],
 ['ysts','有声听书','m.ysts8.net','audio','blue','vertical'],
 ['shuqi','书旗小说','t.shuqi.com','novel','pink','bold'],
 ['dbxsd','独步小说','www.dbxsd.com','novel','cream','vertical','独步小说网'],
 ['haokan','好看漫画','www.9comic.cn','comic','yellow','bold','好看漫画'],
];
const data=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')):await (async()=>{const r=await fetch(bundle,{signal:AbortSignal.timeout(45000)});if(!r.ok)throw new Error(`Source HTTP ${r.status}`);return r.json();})();
if(!Array.isArray(data))throw new Error('Invalid source bundle');
const originOf=value=>{try{return new URL(String(value).trim()).hostname;}catch{return '';}};
const sources=specs.map(([id,title,host,category,theme,layout,exact],index)=>{
 const candidates=data.filter(s=>originOf(s.bookSourceUrl)===host);
 const source=candidates.find(s=>exact&&s.bookSourceName===exact)||candidates[0];
 if(!source)throw new Error(`Missing source: ${id}`);
 const url=new URL(source.bookSourceUrl.trim());url.hash='';
 return {id,title,name:source.bookSourceName,url:url.href,category,theme,layout,art:index%21,search:source.searchUrl||'',source};
});
await mkdir(new URL('public/newsstand-sources/',root),{recursive:true});
for(const entry of sources)await writeFile(new URL(`public/newsstand-sources/${entry.id}.json`,root),JSON.stringify([entry.source]));
await writeFile(new URL('public/newsstand-catalog.json',root),JSON.stringify({repository:'https://github.com/aoaostar/legado',bundle,syncedAt:new Date().toISOString(),upstreamCount:data.length,sources:sources.map(({source,...entry})=>entry)},null,2)+'\n');
console.log(`Matched ${sources.length} sources from ${data.length} records → ${fileURLToPath(new URL('public/newsstand-catalog.json',root))}`);
