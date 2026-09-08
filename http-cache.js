import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const compress = promisify(gzip);
export function representation(bytes, type, etag) {
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return { bytes, type, etag: etag || `W/"${createHash('sha256').update(bytes).digest('hex')}"` };
}

export function notModified(req, res, etag) {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('ETag', etag);
  res.setHeader('Vary', 'Accept-Encoding');
  const tags = String(req.headers['if-none-match'] || '').split(',').map(tag => tag.trim().replace(/^W\//, ''));
  if (tags.includes('*') || tags.includes(etag.replace(/^W\//, ''))) {
    res.writeHead(304).end();
    return true;
  }
  return false;
}

function acceptsGzip(header = '') {
  const encodings = String(header).toLowerCase().split(',').map(item => {
    const [name, ...params] = item.trim().split(';');
    const quality = params.find(param => param.trim().startsWith('q='));
    return { name: name.trim(), q: quality ? Number(quality.trim().slice(2)) : 1 };
  });
  const encoding = encodings.find(item => item.name === 'gzip') || encodings.find(item => item.name === '*');
  return encoding?.q > 0;
}

export async function sendRepresentation(req, res, value) {
  if (notModified(req, res, value.etag)) return;
  let bytes = value.bytes;
  if (bytes.length >= 1024 && /^(text\/|application\/json|image\/svg\+xml)/.test(value.type) && acceptsGzip(req.headers['accept-encoding'])) {
    // Reuse the compressed public catalog, including concurrent requests.
    value.compressed ||= compress(bytes);
    bytes = await value.compressed;
    res.setHeader('Content-Encoding', 'gzip');
  }
  res.writeHead(200, { 'Content-Type': value.type, 'Content-Length': bytes.length });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}
