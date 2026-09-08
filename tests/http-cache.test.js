import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { representation, sendRepresentation } from '../http-cache.js';

test('public representations compress, negotiate, revalidate and support HEAD', async t => {
  const body = JSON.stringify({ title: '网站收藏'.repeat(1500) });
  const value = representation(body, 'application/json; charset=utf-8');
  const server = http.createServer((req, res) => sendRepresentation(req, res, value));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, headers, method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject); req.end();
  });
  const plain = await request();
  assert.equal(plain.body.toString(), body);
  assert.equal(plain.headers['cache-control'], 'no-cache');
  const compressed = await request({ 'Accept-Encoding': 'gzip' });
  assert.equal(compressed.headers['content-encoding'], 'gzip');
  assert.equal(compressed.headers.vary, 'Accept-Encoding');
  assert.equal(gunzipSync(compressed.body).toString(), body);
  assert.ok(compressed.body.length < plain.body.length / 2);
  assert.equal(Number(compressed.headers['content-length']), compressed.body.length);
  for (const encoding of ['gzip;q=0', '*;q=1, gzip;q=0', 'br']) {
    const result = await request({ 'Accept-Encoding': encoding });
    assert.equal(result.headers['content-encoding'], undefined);
    assert.equal(result.body.toString(), body);
  }
  for (const tag of [value.etag, `"unrelated", ${value.etag.replace(/^W\//, '')}`, '*']) {
    const result = await request({ 'If-None-Match': tag, 'Accept-Encoding': 'gzip' });
    assert.equal(result.status, 304); assert.equal(result.body.length, 0);
  }
  assert.equal((await request({ 'If-None-Match': '"old"' })).status, 200);
  const head = await request({ 'Accept-Encoding': 'gzip' }, 'HEAD');
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-length'], compressed.headers['content-length']);
  assert.notEqual(representation(body + ' ', value.type).etag, value.etag);
});
