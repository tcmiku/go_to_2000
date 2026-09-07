import http from 'node:http';
import { validateAd } from './retro-ad.js';
import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { validateNavigation, validatePageContent, flattenCategories } from './navigation-data.js';

const scrypt = promisify(scryptCallback);
const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const defaultSettings = { tagline: '互联网很大，一起慢慢冲浪。', announcement: '欢迎回来！这里总有一个值得收藏的好网站。' };
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.mp3':'audio/mpeg' };
const publicFiles = new Set(['index.html','admin.html','styles.css','admin.css','app.js','admin.js','ui.js','radio.js','start-menu.js','window-manager.js','retro-ad.js','minesweeper.js','snake.js','navigation-data.js','management-data.js']);
['cd-wall.html','cd-wall.css','cd-case.css','cd-wall.js','cd-sound.js'].forEach(file=>publicFiles.add(file));
publicFiles.add('pinball.js');
const httpError = (status,message) => Object.assign(new Error(message),{status});
const submissionStatuses = new Set(['pending','accepted','rejected']);
function cleanText(value,max,label,{required=false}={}) {
  if (typeof value!=='string') throw httpError(400,`${label}格式无效`);
  const text=value.trim();
  if (required&&!text) throw httpError(400,`请填写${label}`);
  if (text.length>max) throw httpError(400,`${label}过长`);
  return text;
}
function cleanWebUrl(value) {
  const text=cleanText(value,4000,'网站地址',{required:true});
  try {const url=new URL(text);if(!['http:','https:'].includes(url.protocol))throw new Error();return url.href;} catch {throw httpError(400,'网站地址必须是完整的 http:// 或 https:// 地址');}
}
function normalizeSubmissions(value) {
  if(!Array.isArray(value))throw new Error('投稿数据格式无效');
  for(const item of value)if(!item||typeof item.id!=='string'||!submissionStatuses.has(item.status)||typeof item.createdAt!=='string')throw new Error('投稿数据格式无效');
  return value;
}
function normalizeAdminPath(value='/admin') {
  const raw=String(value||'/admin').trim();
  const pathValue=raw.startsWith('/')?raw:`/${raw}`;
  return /^\/[A-Za-z0-9][A-Za-z0-9_-]{2,79}\/?$/.test(pathValue)?pathValue.replace(/\/$/,''):'/admin';
}
export function validateStore(data) {
  if (!data || typeof data !== 'object') throw new Error('备份内容格式无效');
  validateNavigation(data.navigation);
  validatePageContent(data.content,data.navigation.categories);
  if (!data.settings || typeof data.settings.tagline !== 'string' || typeof data.settings.announcement !== 'string') throw new Error('站点设置格式无效');
  if (data.settings.tagline.length>100 || data.settings.announcement.length>500) throw new Error('标语或公告过长');
  if (flattenCategories(data.navigation.categories).length>500) throw new Error('分类最多支持 500 个');
  const sites = flattenCategories(data.navigation.categories).flatMap(c=>c.sites);
  if (sites.length>20000) throw new Error('网站记录最多支持 20000 条');
  for (const item of [...sites,...data.content.featured.items,...data.content.friends]) {
    if(item.name.length>150 || item.url.length>4000 || (item.description || '').length>2000) throw new Error('网站名称、地址或简介过长');
    if(item.hidden !== undefined && typeof item.hidden !== 'boolean') throw new Error('网站显示状态无效');
  }
  for (const c of flattenCategories(data.navigation.categories)) if(c.name.length>80) throw new Error('分类名称过长');
  const ad = validateAd(data.settings.ad);
  return {navigation:data.navigation,content:data.content,settings:{tagline:data.settings.tagline,announcement:data.settings.announcement,ad}};
}
export async function createApp({dataDir = path.join(root,'data'), secureCookie = false, adminEnabled = true, adminPath = '/admin'} = {}) {
  adminEnabled=adminEnabled === true;
  adminPath=normalizeAdminPath(adminPath);
  const privateDir = path.join(dataDir,'.private');
  await mkdir(privateDir,{recursive:true,mode:0o700});
  const mp3Dir = path.join(dataDir,'mp3');
  async function getRadioTracks() {
    return (await readdir(mp3Dir,{withFileTypes:true}).catch(()=>[]))
      .filter(entry=>entry.isFile() && path.extname(entry.name).toLowerCase()==='.mp3')
      .sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}))
      .map(entry=>({name:entry.name.replace(/\.mp3$/i,''),src:`/data/mp3/${encodeURIComponent(entry.name)}`}));
  }
  async function readJSON(file) {return JSON.parse(await readFile(path.join(dataDir,file),'utf8'));}
  async function atomic(file,data) {const dest=path.join(dataDir,file),temp=dest+'.tmp';await writeFile(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});await rename(temp,dest);}
  let store;
  try {store=await readJSON('store.json');validateStore(store);} catch(error) {
    if(error.code!=='ENOENT') throw error;
    store={navigation:await readJSON('navigation.json'),content:await readJSON('page-content.json'),settings:defaultSettings,revision:1,updatedAt:new Date().toISOString()};
    validateStore(store);await atomic('store.json',store);
  }
  let visits={total:0,date:'',today:0};
  try {visits=await readJSON('.private/visits.json');if(!Number.isSafeInteger(visits.total)||visits.total<0||!Number.isSafeInteger(visits.today)||visits.today<0||typeof visits.date!=='string')throw new Error('访问统计数据无效');} catch(error) {if(error.code!=='ENOENT')throw error;}
  const visitDate=()=>new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10);
  const visitorIds=new Set(visits.visitorIds||[]);
  const visitSummary=()=>({total:visits.total,today:visits.date===visitDate()?visits.today:0,visitors:visitorIds.size});
  let submissions=[];
  try {submissions=normalizeSubmissions(await readJSON('.private/submissions.json'));} catch(error) {if(error.code!=='ENOENT')throw error;}
  let account=null;
  try {account=await readJSON('.private/account.json');} catch(error) {if(error.code!=='ENOENT')throw error;}
  const sessions=new Map(),attempts=new Map(),submissionAttempts=new Map();
  let queue=Promise.resolve();
  function locked(fn){const next=queue.then(fn);queue=next.catch(()=>{});return next;}
  function session(req){const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('surfer_session='))?.slice(15);const value=sessions.get(token);const now=Date.now();if(value && value.expires>now && value.absoluteExpires>now){value.expires=Math.min(now+30*60*1000,value.absoluteExpires);return{...value,token};}if(token)sessions.delete(token);return null;}
  function issue(res){for(const [key,s] of sessions)if(s.expires<Date.now()||s.absoluteExpires<Date.now())sessions.delete(key);const token=randomBytes(32).toString('hex');const now=Date.now();sessions.set(token,{username:account.username,expires:now+30*60*1000,absoluteExpires:now+8*60*60*1000});res.setHeader('Set-Cookie',`surfer_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secureCookie?'; Secure':''}`);}
  async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw httpError(413,'数据不能超过 8 MB');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw httpError(400,'JSON 数据格式无效');}}
  function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify(value));}
  function publicData(){const data=structuredClone(store);data.navigation.categories.forEach(c=>{c.sites=c.sites.filter(s=>!s.hidden);(c.children||[]).forEach(x=>x.sites=x.sites.filter(s=>!s.hidden));});const ids=new Set(flattenCategories(data.navigation.categories).flatMap(c=>c.sites.map(s=>s.id)));data.content.hot.siteIds=data.content.hot.siteIds.filter(id=>ids.has(id));data.content.featured.items=data.content.featured.items.filter(s=>!s.hidden);data.content.friends=data.content.friends.filter(s=>!s.hidden);return data;}
  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('X-Frame-Options','SAMEORIGIN');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
    try{
      const url=new URL(req.url,'http://localhost'),route=decodeURIComponent(url.pathname);
      const host=req.headers.host||'';
      // Prevent browser DNS rebinding and cross-origin writes on this local server.
      if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))throw httpError(403,'访问地址不受信任，请使用 localhost');
      const adminRoute=route===adminPath||route===`${adminPath}/`;
      const adminApi=route==='/api/auth'||route==='/api/setup'||route==='/api/login'||route==='/api/logout'||route.startsWith('/api/admin');
      if(!adminEnabled && (adminRoute||route==='/admin'||route==='/admin/'||route==='/admin.html'||route==='/admin.js'||route==='/admin.css'||adminApi))throw httpError(404,'页面不存在');
      if(!['GET','HEAD'].includes(req.method)){
        const origin=req.headers.origin;
        if((origin && ![`http://${host}`,`https://${host}`].includes(origin)) || req.headers['sec-fetch-site']==='cross-site')throw httpError(403,'不允许跨站修改');
        if(!String(req.headers['content-type']||'').startsWith('application/json'))throw httpError(415,'请使用 JSON 请求');
      }
      if(route==='/api/public' && req.method==='GET')return json(res,200,publicData());
      if(route==='/api/visits'&&req.method==='GET')return json(res,200,visitSummary());
      if(route==='/api/visits'&&req.method==='POST'){
        const result=await locked(async()=>{
          const cookie=(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith('surfer_visitor='))?.slice(15);
          const visitorId=visitorIds.has(cookie)?cookie:randomBytes(24).toString('hex');
          const nextIds=new Set(visitorIds);nextIds.add(visitorId);
          const date=visitDate(),next={total:visits.total+1,date,today:(visits.date===date?visits.today:0)+1,visitorIds:[...nextIds]};
          await atomic('.private/visits.json',next);visits=next;visitorIds.add(visitorId);
          res.setHeader('Set-Cookie',`surfer_visitor=${visitorId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000${secureCookie?'; Secure':''}`);
          return visitSummary();
        });return json(res,200,result);
      }
      if(route==='/api/radio' && req.method==='GET')return json(res,200,{tracks:await getRadioTracks()});
      if(route==='/api/submissions' && req.method==='POST'){
        const input=await body(req),key=req.socket.remoteAddress||'unknown',now=Date.now();
        if(!input||typeof input!=='object'||Array.isArray(input))throw httpError(400,'投稿数据格式无效');
        const recent=(submissionAttempts.get(key)||[]).filter(time=>time>now-60*60*1000);
        if(recent.length>=5)throw httpError(429,'投稿太频繁，请稍后再试');
        if(input.company) return json(res,200,{ok:true});
        const submission={id:`submission-${randomBytes(12).toString('hex')}`,name:cleanText(input.name,150,'网站名称',{required:true}),url:cleanWebUrl(input.url),description:cleanText(input.description||'',2000,'网站简介'),categoryId:cleanText(input.categoryId||'',200,'建议分类'),contact:cleanText(input.contact||'',200,'联系方式'),status:'pending',createdAt:new Date(now).toISOString()};
        await locked(async()=>{
          if(submissions.filter(item=>item.status==='pending').length>=1000)throw httpError(503,'待处理投稿已满，请稍后再试');
          if(submissions.some(item=>item.status==='pending'&&item.url===submission.url))throw httpError(409,'这个网站已经在等待审核');
          submissions=[submission,...submissions];await atomic('.private/submissions.json',submissions);
        });
        recent.push(now);submissionAttempts.set(key,recent);return json(res,201,{ok:true,id:submission.id});
      }
      if(route==='/api/auth' && req.method==='GET'){const current=session(req);return json(res,200,{setupRequired:!account,authenticated:!!current,username:current?.username});}
      if((route==='/api/setup' || route==='/api/login') && req.method==='POST'){
        const credentials=await body(req);
        await locked(async()=>{
          const {username,password}=credentials;
          if(typeof username!=='string'||typeof password!=='string'||username.length>80||password.length>200)throw httpError(400,'请输入有效的用户名和密码');
          if(route==='/api/setup'){
            if(account)throw httpError(409,'管理员已创建，请登录');
            if(!username.trim()||password.length<10)throw httpError(400,'用户名不能为空，密码至少 10 位');
            const salt=randomBytes(16).toString('hex'),hash=(await scrypt(password,salt,64)).toString('hex');
            const next={username:username.trim(),salt,hash};await atomic('.private/account.json',next);account=next;
          }else{
            if(!account)throw httpError(409,'请先创建管理员');
            const key=req.socket.remoteAddress,previous=attempts.get(key);
            const attempt=previous&&previous.until>Date.now()?previous:{count:0,until:Date.now()+15*60*1000};
            if(attempt.count>=8)throw httpError(429,'登录尝试过多，请 15 分钟后重试');
            const hash=await scrypt(password,account.salt,64);
            if(!timingSafeEqual(hash,Buffer.from(account.hash,'hex')) || username!==account.username){attempt.count++;attempts.set(key,attempt);throw httpError(401,'用户名或密码不正确');}
            attempts.delete(key);
          }
          issue(res);
        });return json(res,200,{ok:true,username:account.username});
      }
      if(route==='/api/logout'&&req.method==='POST'){const current=session(req);if(current)sessions.delete(current.token);res.setHeader('Set-Cookie','surfer_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
      if(route.startsWith('/api/admin')){
        const current=session(req);if(!current)throw httpError(401,'请登录站长后台');
        if(route==='/api/admin/submissions'&&req.method==='GET')return json(res,200,{items:submissions});
        const submissionMatch=route.match(/^\/api\/admin\/submissions\/([^/]+)$/);
        if(submissionMatch&&req.method==='PATCH'){
          const id=submissionMatch[1],input=await body(req);
          if(!input||typeof input!=='object'||Array.isArray(input))throw httpError(400,'处理数据格式无效');
          const saved=await locked(async()=>{
            const index=submissions.findIndex(item=>item.id===id);if(index<0)throw httpError(404,'投稿不存在');
            const item=submissions[index];if(item.status!=='pending')throw httpError(409,'这条投稿已经处理');
            if(input.action==='accept'){
              const categoryId=cleanText(input.categoryId||'',200,'收录分类',{required:true});
              const category=flattenCategories(store.navigation.categories).find(value=>value.id===categoryId);if(!category)throw httpError(400,'收录分类不存在');
              if(flattenCategories(store.navigation.categories).flatMap(value=>value.sites).some(site=>site.url===item.url))throw httpError(409,'目录中已经存在这个网站');
              const siteId=`site-${randomBytes(12).toString('hex')}`,next=structuredClone(store),destination=flattenCategories(next.navigation.categories).find(value=>value.id===categoryId);
              destination.sites.push({id:siteId,name:item.name,url:item.url,description:item.description,isNew:true,hidden:false});
              let valid;try{valid=validateStore(next);}catch(error){throw httpError(400,error.message);}
              const nextStore={...valid,revision:store.revision+1,updatedAt:new Date().toISOString()};
              await atomic('.private/previous-store.json',store);await atomic('store.json',nextStore);store=nextStore;
              submissions[index]={...item,status:'accepted',categoryId,siteId,reviewedAt:new Date().toISOString()};
            }else if(input.action==='reject')submissions[index]={...item,status:'rejected',reviewedAt:new Date().toISOString()};
            else throw httpError(400,'不支持的处理操作');
            await atomic('.private/submissions.json',submissions);return submissions[index];
          });return json(res,200,{item:saved});
        }
        if(submissionMatch&&req.method==='DELETE'){
          await locked(async()=>{const index=submissions.findIndex(item=>item.id===submissionMatch[1]);if(index<0)throw httpError(404,'投稿不存在');submissions.splice(index,1);await atomic('.private/submissions.json',submissions);});
          return json(res,200,{ok:true});
        }
        if(route==='/api/admin/data'&&req.method==='GET')return json(res,200,store);
        if(route==='/api/admin/data'&&req.method==='PUT'){
          const input=await body(req);
          const saved=await locked(async()=>{
            if(input.revision!==store.revision)throw httpError(409,'其他窗口已更新数据，请重新加载后再修改');
            let valid;try{valid=validateStore(input);}catch(error){throw httpError(400,error.message);}
            const next={...valid,revision:store.revision+1,updatedAt:new Date().toISOString()};
            await atomic('.private/previous-store.json',store);await atomic('store.json',next);store=next;return store;
          });return json(res,200,saved);
        }
        if(route==='/api/admin/backup'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="web-surfer-backup.json"');return json(res,200,store);}
        if(route==='/api/admin/password'&&req.method==='POST'){
          const input=await body(req);
          await locked(async()=>{if(typeof input.current!=='string'||input.current.length>200||typeof input.password!=='string'||input.password.length<10||input.password.length>200)throw httpError(400,'新密码须为 10—200 位');
            const hash=await scrypt(input.current,account.salt,64);if(!timingSafeEqual(hash,Buffer.from(account.hash,'hex')))throw httpError(400,'原密码不正确');
            const salt=randomBytes(16).toString('hex');const next={...account,salt,hash:(await scrypt(input.password,salt,64)).toString('hex')};await atomic('.private/account.json',next);account=next;sessions.clear();issue(res);});return json(res,200,{ok:true});
        }
        throw httpError(404,'接口不存在');
      }
      if(route.startsWith('/api/'))throw httpError(404,'接口不存在');
      if(!['GET','HEAD'].includes(req.method))throw httpError(405,'请求方式不支持');
      if(route.startsWith('/data/mp3/')){
        const filename=route.slice('/data/mp3/'.length);
        const radioNames=new Set((await getRadioTracks()).map(track=>decodeURIComponent(track.src.slice('/data/mp3/'.length))));
        if(!filename || filename!==path.basename(filename) || !radioNames.has(filename))throw httpError(404,'页面不存在');
        const bytes=await readFile(path.join(mp3Dir,filename));
        return res.writeHead(200,{'Content-Type':'audio/mpeg','Cache-Control':'public, max-age=3600'}).end(req.method==='HEAD'?undefined:bytes);
      }
      const filename=route==='/'?'index.html':adminRoute?'admin.html':route.slice(1);
      if(!adminEnabled && (filename==='admin.html'||filename==='admin.js'||filename==='admin.css'))throw httpError(404,'页面不存在');
      if(!publicFiles.has(filename)&&!/^assets\/(?:[\w-]+\/)*[\w.-]+\.(?:png|svg)$/.test(filename))throw httpError(404,'页面不存在');
      const target=path.resolve(root,filename);if(!target.startsWith(root+path.sep))throw httpError(404,'页面不存在');
      const bytes=await readFile(target);res.writeHead(200,{'Content-Type':types[path.extname(filename)],'Cache-Control':'no-cache'}).end(req.method==='HEAD'?undefined:bytes);
    }catch(error){if(!res.headersSent)json(res,error.status || (error.code==='ENOENT'?404:500),{error:error.status?error.message:error.code==='ENOENT'?'页面不存在':'服务暂时不可用，请重试'});else res.end();}
  });
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const adminEnabled=process.env.ADMIN_ENABLED==='1' || process.env.ADMIN_ENABLED==='true';
  const adminPath=normalizeAdminPath(process.env.ADMIN_PATH || '/admin');
  const server=await createApp({adminEnabled,adminPath,secureCookie:process.env.SECURE_COOKIE==='1'});
  const port=Number(process.env.PORT || 3000);
  server.listen(port,'127.0.0.1',()=>{
    const baseUrl=`http://localhost:${port}`;
    console.log(`WEB SURFER ready at ${baseUrl}`);
    console.log(adminEnabled?`ADMIN URL: ${baseUrl}${adminPath}/`:'ADMIN DISABLED: run npm run dev:admin to enable');
  });
}
