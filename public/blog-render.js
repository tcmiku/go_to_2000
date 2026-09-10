import { marked } from './vendor/marked.js';
// Parse Markdown in an inert document, then rebuild only safe article elements.
// Neither raw HTML attributes nor active elements reach the live document.
export function renderMarkdown(markdown,target){
  const source=new DOMParser().parseFromString(marked.parse(markdown),'text/html');
  const allowed=new Set('P BR HR H1 H2 H3 H4 H5 H6 STRONG EM DEL BLOCKQUOTE PRE CODE UL OL LI TABLE THEAD TBODY TR TH TD A IMG'.split(' '));
  const blocked=new Set('SCRIPT STYLE IFRAME OBJECT EMBED FORM INPUT BUTTON SVG MATH TEMPLATE'.split(' '));
  function copy(node){
    if(node.nodeType===3)return document.createTextNode(node.textContent);
    const fragment=document.createDocumentFragment();
    if(node.nodeType!==1||blocked.has(node.tagName))return fragment;
    const result=allowed.has(node.tagName)?document.createElement(node.tagName.toLowerCase()):fragment;
    if(node.tagName==='A'||node.tagName==='IMG'){
      const attr=node.tagName==='A'?'href':'src',value=node.getAttribute(attr)||'';
      try{const url=new URL(value,location.origin);if(['http:','https:'].includes(url.protocol))result.setAttribute(attr,url.href);}catch{}
      if(node.tagName==='A')result.rel='noopener noreferrer';
      else {result.alt=node.getAttribute('alt')||'';result.loading='lazy';}
    }
    for(const child of node.childNodes)result.append(copy(child));
    return result;
  }
  target.replaceChildren(...[...source.body.childNodes].map(copy));
}
