import test from 'node:test';
import assert from 'node:assert/strict';
import {createPodcastService,parsePodcastPage,parseFeed} from '../server/podcast-service.js';

const id='5e280fac418a84a0461fb129';
const html=p=>`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{podcast:p}}})}</script>`;
const fixture=html({pid:id,title:'无聊斋',episodeCount:3,episodes:[{eid:'one',title:'公开单集',duration:120,enclosure:{url:'https://media.xyzcdn.net/test.m4a'}},{eid:'private',title:'私人单集',isPrivateMedia:true,enclosure:{url:'https://media.xyzcdn.net/private.m4a'}},{eid:'unsafe',title:'无效地址',enclosure:{url:'javascript:alert(1)'}}]});
test('public podcast pages normalize playable episodes and exclude private/invalid media',()=>{
  const data=parsePodcastPage(fixture);assert.equal(data.title,'无聊斋');assert.equal(data.total,3);assert.equal(data.episodes.length,1);assert.equal(data.episodes[0].audio,'https://media.xyzcdn.net/test.m4a');assert.throws(()=>parsePodcastPage('<html>blocked</html>'),{status:502});
});
test('RSS handles CDATA, entities and durations without evaluating XML',()=>{
  const episodes=parseFeed('<rss><channel><item><guid>one</guid><title><![CDATA[聊聊 A & B]]></title><itunes:duration>1:02:03</itunes:duration><enclosure url="https://example.com/a.mp3?a=1&amp;b=2"/></item><item><guid>two</guid><title>&#x4E8C; &quot;期&quot;</title><enclosure url="file:///secret"/></item></channel></rss>');
  assert.equal(episodes.length,1);assert.equal(episodes[0].title,'聊聊 A & B');assert.equal(episodes[0].duration,3723);assert.equal(episodes[0].audio,'https://example.com/a.mp3?a=1&b=2');assert.throws(()=>parseFeed('<html>error</html>'),{status:502});
});
test('podcast service validates identifiers, coalesces loads and limits URL imports',async()=>{
  let calls=0;const service=createPodcastService({request:async()=>{calls++;return {statusCode:200,body:fixture};}});
  const url=new URL('http://localhost/api/podcasts/podcast');await Promise.all([service(url.pathname,url),service(url.pathname,url)]);assert.equal(calls,1);
  await assert.rejects(service(url.pathname,new URL('http://localhost/api/podcasts/podcast?id=../../private')),{status:400});
  await assert.rejects(service('/api/podcasts/search',new URL('http://localhost/?q=http://127.0.0.1/private')),{status:400});
  const imported=await service('/api/podcasts/search',new URL(`http://localhost/?q=${encodeURIComponent(`https://www.xiaoyuzhoufm.com/podcast/${id}`)}`));assert.equal(imported.podcasts[0].id,`xyz:${id}`);assert.equal(calls,1);
});
test('search maps real directory results and reports upstream failure',async()=>{
  const service=createPodcastService({request:async url=>{assert.match(url,/itunes.apple.com\/search/);return {statusCode:200,body:{results:[{kind:'podcast',collectionId:1433530822,collectionName:'无聊斋',artistName:'作者'}]}};}});
  const result=await service('/api/podcasts/search',new URL('http://localhost/?q=test'));assert.equal(result.podcasts[0].id,`xyz:${id}`);
  const broken=createPodcastService({request:async()=>({statusCode:503,body:{}})});await assert.rejects(broken('/api/podcasts/search',new URL('http://localhost/?q=test')),{status:502});
});
test('archive merges and deduplicates RSS while retaining public page audio',async()=>{
  const service=createPodcastService({request:async url=>({statusCode:200,body:url.includes('xiaoyuzhoufm.com')?fixture:url.includes('itunes.apple.com')?{results:[{kind:'podcast',collectionId:1433530822,collectionName:'无聊斋',feedUrl:'https://example.com/feed'}]}:'<rss><channel><item><guid>one</guid><title>重复</title><enclosure url="https://example.com/one.mp3"/></item><item><guid>old</guid><title>往期</title><enclosure url="https://example.com/old.mp3"/></item></channel></rss>'})});
  const data=await service('/api/podcasts/archive',new URL('http://localhost/'));assert.equal(data.episodes.length,2);assert.equal(data.episodes.find(e=>e.id==='one').audio,'https://media.xyzcdn.net/test.m4a');assert.equal(data.complete,true);
});
