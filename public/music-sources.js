export const defaultMusicSources=['huibq','sixyin','flower','lx','ikun','grass','juhe','qdy'].map(id=>({
  id,name:{huibq:'Huibq',sixyin:'SixYin',flower:'Flower',lx:'LX',ikun:'ikun',grass:'Grass',juhe:'Juhe API',qdy:'QDY'}[id],
  url:`https://raw.githubusercontent.com/pdone/lx-music-source/main/${id}/latest.js`,enabled:true,
}));
export function validateMusicSources(value=defaultMusicSources){
  if(!Array.isArray(value)||value.length>32)throw new Error('音源目录最多支持 32 项');
  const ids=new Set();
  return value.map(item=>{
    if(!item||typeof item.id!=='string'||!/^[a-zA-Z0-9][\w-]{0,63}$/.test(item.id)||ids.has(item.id))throw new Error('音源标识无效或重复');ids.add(item.id);
    if(typeof item.name!=='string'||!item.name.trim()||item.name.trim().length>80)throw new Error('音源名称应为 1—80 个字');
    if(typeof item.url!=='string'||item.url.length>4000)throw new Error('音源脚本地址无效');
    let url;try{url=new URL(item.url);}catch{throw new Error('请填写完整的音源脚本地址');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port)))throw new Error('脚本地址需为不含账号密码的 HTTP / HTTPS 地址（80 或 443 端口）');
    if(/(^|\.)(localhost|local)$/.test(url.hostname))throw new Error('音源不能使用本机或内网地址');
    if(item.enabled!==undefined&&typeof item.enabled!=='boolean')throw new Error('音源启用状态无效');
    return {id:item.id,name:item.name.trim(),url:url.href,enabled:item.enabled!==false};
  });
}
