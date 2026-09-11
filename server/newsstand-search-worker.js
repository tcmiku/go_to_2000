import { parentPort } from 'node:worker_threads';
import { createNewsstandService } from './newsstand-service.js';

parentPort.on('message',async({source,definition,query,page})=>{
 try{
  const search=createNewsstandService({sources:new Map([[source.id,definition]]),metadata:[source],searchTimeout:6000});
  parentPort.postMessage({result:await search('search',{sourceId:source.id,query,page})});
 }catch(error){parentPort.postMessage({error:{message:error.message,status:error.status||422}});}
});
