import { load } from 'cheerio';
import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';
import { JSONPath } from 'jsonpath-plus';
import { getQuickJS } from 'quickjs-emscripten';
import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';

const QuickJS = await getQuickJS();
export const ruleError = message => Object.assign(new Error(message), {status:422});
const array = value => Array.isArray(value) ? value : value == null ? [] : [value];
const stringify = value => typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');

// Split only at rule boundaries, never inside XPath predicates / quoted strings.
function split(rule, separator) {
 const parts=[]; let start=0, depth=0, quote='';
 for(let i=0;i<rule.length;i++) {
  const ch=rule[i];
  if(quote){if(ch===quote&&rule[i-1]!=='\\')quote='';continue;}
  if(ch==='"'||ch==="'"){quote=ch;continue;}
  if('[({'.includes(ch))depth++;
  if('])}'.includes(ch))depth--;
  if(!depth&&rule.startsWith(separator,i)){parts.push(rule.slice(start,i));start=i+separator.length;i+=separator.length-1;}
 }
 return [...parts,rule.slice(start)];
}
function jsonValue(input) {
 if(typeof input!=='string')return input;
 try{return JSON.parse(input);}catch{return null;}
}
function htmlText(html) {
 const $=load(String(html));$('script,style,noscript').remove();$('br').replaceWith('\n');
 $('p,div,section,h1,h2,li').append('\n');return $.root().text().replace(/\u00a0/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n\s*\n\s*\n/g,'\n\n').trim();
}
export { htmlText };

export class LegadoRules {
 constructor({baseUrl='',key='',page=1,book={},variables={}}={}) {
  this.baseUrl=baseUrl;this.key=key;this.page=page;this.book=book;this.variables={...variables};
  this.deadline=Date.now()+8000;
 }
 js(code,result) {
  if(Date.now()>this.deadline)throw ruleError('书源解析超时');
  const vm=QuickJS.newContext();vm.runtime.setMemoryLimit(24*1024*1024);
  const deadline=Math.min(this.deadline,Date.now()+300);
  vm.runtime.setInterruptHandler(()=>Date.now()>deadline);
  const toHandle=value=>vm.unwrapResult(vm.evalCode(`(${JSON.stringify(value??null)})`));
  const bind=(name,fn)=>{const handle=vm.newFunction(name,(...args)=>toHandle(fn(...args.map(arg=>vm.dump(arg)))));vm.setProp(vm.global,name,handle);handle.dispose();};
  try {
   for(const [name,value] of Object.entries({baseUrl:this.baseUrl,key:this.key,page:this.page,book:this.book,result})) {
    const h=toHandle(value);vm.setProp(vm.global,name,h);h.dispose();
   }
   bind('__get',key=>this.variables[key]??'');bind('__put',(key,value)=>{this.variables[key]=stringify(value).slice(0,16000);return value;});
   bind('__string',rule=>this.text(result,rule));bind('__list',rule=>this.values(result,rule));
   bind('__md5',value=>createHash('md5').update(String(value)).digest('hex'));
   bind('__decode',value=>Buffer.from(String(value),'base64').toString('utf8'));
   const setup=vm.evalCode(`var java={get:__get,put:__put,getString:__string,getStringList:__list,md5Encode:__md5,base64Decode:__decode}; var source={getVariable:()=>''};`);
   vm.unwrapResult(setup).dispose();
   const evaluated=vm.evalCode(code);
   if(evaluated.error){const err=vm.dump(evaluated.error);evaluated.error.dispose();throw ruleError(`此书源脚本暂不兼容：${String(err.message||'脚本执行失败').slice(0,160)}`);}
   const value=vm.dump(evaluated.value);evaluated.value.dispose();return value;
  } finally {vm.dispose();}
 }
 template(rule,input,{encode=false,charset='utf-8'}={}) {
  return rule.replace(/@get:\{([^}]+)\}/g,(_,key)=>this.variables[key]??'').replace(/\{\{([\s\S]*?)\}\}/g,(_,expression)=>{
   let value;
   if(expression.startsWith('$.')||expression.startsWith('@@'))value=this.text(input,expression.replace(/^@@/,''));
   else value=this.js(expression,input);
   if(encode&&expression.trim()==='key')return [...iconv.encode(String(value),charset)].map(byte=>/[A-Za-z0-9_.~-]/.test(String.fromCharCode(byte))?String.fromCharCode(byte):`%${byte.toString(16).padStart(2,'0').toUpperCase()}`).join('');
   return stringify(value);
  });
 }
 values(input,rule,{elements=false}={}) {
  rule=String(rule??'').trim();if(!rule)return [];
  if(Date.now()>this.deadline)throw ruleError('书源解析超时');
  // JavaScript is evaluated in a memory/time bounded WASM interpreter, not Node.
  const script=rule.match(/<js>([\s\S]*?)<\/js>|@js:([\s\S]*)/i);
  if(script){const prefix=rule.slice(0,script.index).trim();const before=prefix?this.values(input,prefix,{elements}):input;
   const result=this.js(this.template(script[1]??script[2],input),Array.isArray(before)&&!elements?before.map(stringify).join('\n'):before);
   const tail=rule.slice(script.index+script[0].length).trim();return tail?this.values(result,tail,{elements}):array(result);
  }
  const alternatives=split(rule,'||');if(alternatives.length>1){for(const part of alternatives){const value=this.values(input,part,{elements});if(value.some(v=>stringify(v).trim()))return value;}return [];}
  const combined=split(rule,'&&');if(combined.length>1)return combined.flatMap(part=>this.values(input,part,{elements}));
  const replacement=rule.split('##');rule=replacement.shift();
  let result;
  if(rule.includes('{{')||rule.includes('@get:{'))result=[this.template(rule,input)];
  else if(/^https?:\/\//.test(rule))result=[rule];
  else if(/^\$\d+$/.test(rule)&&Array.isArray(input))result=[input[Number(rule.slice(1))]??''];
  else if(elements&&rule.startsWith(':'))result=Array.from(stringify(input).matchAll(new RegExp(rule.slice(1),'gs')),match=>Array.from(match));
  else if(rule.startsWith('//')||rule.startsWith('@XPath:')) {
   const $=load(stringify(input));const xml=$.xml().replace(/ xmlns="[^"]*"/g,'');
   const doc=new DOMParser({onError:()=>{}}).parseFromString(xml,'text/xml');
   const found=xpath.select(rule.replace(/^@XPath:/,''),doc);
   result=array(found).map(node=>elements&&node.nodeType===1?node.toString():node.nodeValue??node.textContent??node);
  } else {
   const json=jsonValue(input);
   if(json!==null&&typeof json==='object') {
    let path=rule.replace(/^@Json:/,'');if(!path.startsWith('$'))path=`$.${path}`;
    result=JSONPath({path:path.replace(/^\$\.\[/,'$['),json,wrap:true,eval:'safe'});
    if(elements)result=result.flatMap(array);
   } else result=this.css(stringify(input),rule,elements);
  }
  if(replacement.length){const [pattern,repl='']=replacement;result=result.map(value=>stringify(value).replace(new RegExp(pattern,'g'),repl));}
  return result;
 }
 css(input,rule,elements) {
  const $=load(input);let nodes=$.root();
  const steps=split(rule.replace(/^@css:/,''),'@').filter(Boolean);
  const terminal=/^(text|textNodes|ownText|html|all|href|src|content|title|alt|value|data-[\w-]+)$/;
  let attr=!elements&&terminal.test(steps.at(-1))?steps.pop():null;
  // In Legado the last @ segment is an attribute, including arbitrary attributes.
  if(!elements&&!attr&&steps.length>1)attr=steps.pop();
  for(let step of steps) {
   let index=step.match(/\[(-?\d+)(?::(-?\d+))?\]$/)||step.match(/\.(-?\d+)$/);
   if(index)step=step.slice(0,-index[0].length);
   if(step==='children')nodes=nodes.children();
   else if(step.startsWith('text.'))nodes=nodes.find('*').filter((_,el)=>$(el).text().includes(step.slice(5)));
   else {
    let selector=step.replace(/^class\.(.*)$/,(all,name)=>'.'+name.trim().split(/\s+/).join('.')).replace(/^id\./,'#').replace(/^tag\./,'');
    selector=selector.replace(/\[([\w:-]+)=([^\]"']*:[^\]"']*)\]/g,'[$1="$2"]');
    nodes=nodes.find(selector);
   }
   if(index)nodes=index[2]===undefined?nodes.eq(Number(index[1])):nodes.slice(Number(index[1]),Number(index[2])+1);
  }
  if(elements)return nodes.toArray().map(el=>$.html(el));
  // A row fragment is represented as HTML; bare text / href operate on its root.
  if(!steps.length)nodes=$('body').children().length?$('body').children():$.root();
  return nodes.toArray().map(el=>{
   const node=$(el);
   if(attr==='html')return node.html()||'';
   if(attr==='all')return $.html(el);
   if(attr==='ownText'||attr==='textNodes')return node.contents().filter((_,child)=>child.type==='text').toArray().map(child=>child.data.trim()).filter(Boolean).join('\n');
   if(!attr||attr==='text')return node.text().trim();
   return node.attr(attr)||'';
  });
 }
 text(input,rule) {return this.values(input,rule).map(stringify).join('\n').trim();}
 request(rule,input='') {
  let value=String(rule).trim();
  const charset=value.match(/["']charset["']\s*:\s*["']([^"']+)/i)?.[1]||'utf-8';
  value=this.template(value,input,{encode:true,charset});
  if(/<js>|@js:/i.test(value))value=this.text(input,value);
  const cut=value.search(/,\s*\{/);let options={};
  if(cut>=0){options=this.js(`(${value.slice(cut+1)})`,input);value=value.slice(0,cut);}
  if(!options||typeof options!=='object'||Array.isArray(options))throw ruleError('书源请求配置无效');
  if(options.webJs||options.js)throw ruleError('此书源需要阅读 App 的 WebView 脚本，当前网页暂不支持');
  const url=new URL(value,this.baseUrl);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw ruleError('书源返回了无效地址');
  url.hash='';
  let headers=options.headers??{};if(typeof headers==='string')headers=JSON.parse(headers);
  // webView is a fetching hint. Try public HTML; never execute page scripts.
  return {url:url.href,options:{method:options.method||'GET',body:options.body,headers,...(options.webView?{webView:true}:{}),...(options.charset?{charset:options.charset}:{})},charset:options.charset};
 }
}
