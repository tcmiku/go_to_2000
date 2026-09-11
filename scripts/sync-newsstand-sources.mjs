import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildSourceCatalog} from '../server/newsstand-catalog.js';
const repository='https://github.com/aoaostar/legado';
const bundle='https://legado.aoaostar.com/sources/b778fe6b.json';
const rawBundle='https://raw.githubusercontent.com/aoaostar/legado/release/sources/b778fe6b.json';
const root=new URL('../',import.meta.url),temporary=new URL('data/newsstand-download.tmp',root),target=new URL('data/newsstand-sources.json.gz',root),staged=new URL('data/newsstand-sources.json.gz.tmp',root);
let sources;
try{
 if(process.argv[2])sources=JSON.parse(await readFile(process.argv[2],'utf8'));
 else {
  // curl honors the user's HTTP(S)_PROXY and waits for the complete response.
  execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','120',rawBundle,'--output',fileURLToPath(temporary)],{stdio:'inherit',windowsHide:true});
  sources=JSON.parse(await readFile(temporary,'utf8'));
 }
 const snapshot={version:1,repository,bundle,syncedAt:new Date().toISOString(),sources};
 const catalog=buildSourceCatalog(snapshot);
 await writeFile(staged,gzipSync(JSON.stringify(snapshot),{level:9}));await rename(staged,target);
 console.log(`Imported ${sources.length} records, ${catalog.info.uniqueCount} unique sources, ${catalog.info.searchableCount} searchable text sources.`);
} finally {await unlink(temporary).catch(()=>{});await unlink(staged).catch(()=>{});}
