/*
 * Minimal HTTP helpers shared by every route: body reading with a hard size
 * cap, JSON responses, and a dependency-free multipart/form-data parser.
 *
 * The parser works on raw Buffers (never strings) so binary uploads such as
 * scanned PDFs and JPEGs survive intact — decoding to utf8 would corrupt them.
 */
'use strict';

const MAX_BODY = Number(process.env.MS_MAX_BODY_BYTES || 12 * 1024 * 1024); // 12 MB

function readBody(req, max) {
  const limit = max || MAX_BODY;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, headers) {
  const h = Object.assign({ 'Cache-Control': 'no-store' }, headers || {});
  res.writeHead(status, h);
  res.end(body);
}

function json(res, status, obj, headers) {
  send(res, status, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers || {}));
}

function boundaryOf(contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  return m ? (m[1] || m[2]).trim() : null;
}

function parseDisposition(line) {
  const name = /name="([^"]*)"/i.exec(line);
  const filename = /filename="([^"]*)"/i.exec(line);
  return {
    name: name ? name[1] : null,
    filename: filename ? filename[1] : null,
  };
}

/**
 * Parse a multipart/form-data body.
 * @returns {{fields: Object<string,string>, files: Array}}
 */
function parseMultipart(buffer, contentType) {
  const boundary = boundaryOf(contentType);
  if (!boundary) throw Object.assign(new Error('missing multipart boundary'), { statusCode: 400 });

  const delim = Buffer.from('--' + boundary);
  const fields = {};
  const files = [];

  let pos = buffer.indexOf(delim);
  if (pos === -1) return { fields, files };

  while (pos !== -1) {
    let start = pos + delim.length;
    // terminal boundary is "--boundary--"
    if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break;
    if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;

    const headerEnd = buffer.indexOf('\r\n\r\n', start, 'utf8');
    if (headerEnd === -1) break;

    const rawHeaders = buffer.slice(start, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;

    const next = buffer.indexOf(delim, bodyStart);
    if (next === -1) break;
    let bodyEnd = next;
    // strip the CRLF that precedes the next boundary
    if (buffer[bodyEnd - 2] === 0x0d && buffer[bodyEnd - 1] === 0x0a) bodyEnd -= 2;

    let disposition = '';
    let partType = '';
    for (const line of rawHeaders.split('\r\n')) {
      if (/^content-disposition:/i.test(line)) disposition = line;
      else if (/^content-type:/i.test(line)) partType = line.split(':')[1].trim();
    }

    const { name, filename } = parseDisposition(disposition);
    if (name) {
      const slice = buffer.slice(bodyStart, bodyEnd);
      if (filename !== null) {
        if (filename !== '' && slice.length > 0) {
          files.push({ field: name, filename, contentType: partType || 'application/octet-stream', buffer: slice });
        }
      } else {
        const value = slice.toString('utf8');
        // repeated names (checkbox-style) collapse to a comma list
        fields[name] = fields[name] === undefined ? value : fields[name] + ', ' + value;
      }
    }
    pos = next;
  }

  return { fields, files };
}

async function parseRequest(req) {
  const ct = req.headers['content-type'] || '';

  // Some serverless platforms (Vercel included) consume the stream and expose a
  // pre-parsed body. Reading the stream again would then hang or yield nothing,
  // so honour req.body when it is already populated.
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (Buffer.isBuffer(req.body)) {
      if (ct.includes('multipart/form-data')) return parseMultipart(req.body, ct);
      try { return { fields: JSON.parse(req.body.toString('utf8')), files: [] }; }
      catch (e) { return { fields: {}, files: [] }; }
    }
    if (typeof req.body === 'object') return { fields: req.body, files: [] };
    if (typeof req.body === 'string') {
      if (ct.includes('multipart/form-data')) return parseMultipart(Buffer.from(req.body, 'binary'), ct);
      try { return { fields: JSON.parse(req.body), files: [] }; }
      catch (e) { return { fields: Object.fromEntries(new URLSearchParams(req.body)), files: [] }; }
    }
  }

  const raw = await readBody(req);
  if (ct.includes('multipart/form-data')) return parseMultipart(raw, ct);
  if (ct.includes('application/json')) {
    try { return { fields: JSON.parse(raw.toString('utf8') || '{}'), files: [] }; }
    catch (e) { throw Object.assign(new Error('invalid JSON'), { statusCode: 400 }); }
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(raw.toString('utf8'));
    return { fields: Object.fromEntries(params), files: [] };
  }
  return { fields: {}, files: [] };
}

module.exports = { readBody, send, json, parseMultipart, parseRequest, boundaryOf, MAX_BODY };
