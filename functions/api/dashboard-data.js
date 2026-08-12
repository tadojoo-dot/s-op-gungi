// 업로드된 엑셀 파싱 결과(대시보드 데이터)를 모든 열람자가 공유하도록 저장한다.
// shared-state.js는 회의록/PSI 조정 같은 작은 입력값 전용이라 256KB 제한이 걸려 있어서,
// 수 MB짜리 파싱 결과는 이 엔드포인트에 별도 키로 보관한다.
const DATA_ID = 'dashboard:live';
const MAX_BODY_BYTES = 20 * 1024 * 1024; // KV 값 상한 25MB 아래로 여유를 둔 값

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function requireAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return;
  const raw = String(request.headers.get('x-admin-password') || '');
  let provided = raw;
  try { provided = decodeURIComponent(raw); } catch (e) { provided = raw; }
  if (!provided || provided !== String(env.ADMIN_PASSWORD)) {
    const error = new Error('Admin password required.');
    error.status = 403;
    throw error;
  }
}

async function ensureD1(env) {
  if (!env.DB) return false;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS dashboard_data (id TEXT PRIMARY KEY, meta TEXT NOT NULL, data TEXT NOT NULL)'
  ).run();
  return true;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// 메타는 헤더로 오간다. 기준일 라벨에 한글이 들어갈 수 있어 전 구간 URI 인코딩.
function readMetaFromHeaders(request) {
  const get = name => {
    const raw = request.headers.get(name);
    if (!raw) return '';
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  };
  return {
    enc: request.headers.get('x-sop-enc') === 'gzip' ? 'gzip' : 'raw',
    uploaded_ts: Number(request.headers.get('x-sop-uploaded-ts')) || 0,
    uploaded_at: get('x-sop-uploaded-at'),
    base_label: get('x-sop-base-label'),
    saved_at: new Date().toISOString()
  };
}

function metaToHeaders(meta) {
  return {
    'x-sop-enc': meta.enc === 'gzip' ? 'gzip' : 'raw',
    'x-sop-uploaded-ts': String(meta.uploaded_ts || 0),
    'x-sop-uploaded-at': encodeURIComponent(meta.uploaded_at || ''),
    'x-sop-base-label': encodeURIComponent(meta.base_label || ''),
    'x-sop-saved-at': encodeURIComponent(meta.saved_at || '')
  };
}

async function readData(env) {
  if (env.SOP_STATE) {
    const hit = await env.SOP_STATE.getWithMetadata(DATA_ID, { type: 'arrayBuffer' });
    if (!hit || !hit.value) return null;
    return { bytes: new Uint8Array(hit.value), meta: hit.metadata || {} };
  }
  if (await ensureD1(env)) {
    const row = await env.DB.prepare('SELECT meta, data FROM dashboard_data WHERE id = ?').bind(DATA_ID).first();
    if (!row?.data) return null;
    let meta = {};
    try { meta = JSON.parse(row.meta); } catch (e) { meta = {}; }
    return { bytes: base64ToBytes(row.data), meta };
  }
  throw new Error('Missing Cloudflare binding: add KV binding SOP_STATE or D1 binding DB.');
}

async function writeData(env, bytes, meta) {
  if (env.SOP_STATE) {
    await env.SOP_STATE.put(DATA_ID, bytes, { metadata: meta });
    return;
  }
  if (await ensureD1(env)) {
    await env.DB.prepare(
      'INSERT INTO dashboard_data (id, meta, data) VALUES (?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET meta = excluded.meta, data = excluded.data'
    ).bind(DATA_ID, JSON.stringify(meta), bytesToBase64(bytes)).run();
    return;
  }
  throw new Error('Missing Cloudflare binding: add KV binding SOP_STATE or D1 binding DB.');
}

async function deleteData(env) {
  if (env.SOP_STATE) {
    await env.SOP_STATE.delete(DATA_ID);
    return;
  }
  if (await ensureD1(env)) {
    await env.DB.prepare('DELETE FROM dashboard_data WHERE id = ?').bind(DATA_ID).run();
    return;
  }
  throw new Error('Missing Cloudflare binding: add KV binding SOP_STATE or D1 binding DB.');
}

// GET ?meta=1 → 메타만(가벼운 최신본 확인용), GET → 페이로드 본문
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const metaOnly = url.searchParams.get('meta') === '1';
    const hit = await readData(env);
    if (!hit) {
      return metaOnly
        ? json({ has: false })
        : json({ has: false }, 404);
    }
    if (metaOnly) {
      return json({ has: true, size: hit.bytes.length, ...hit.meta });
    }
    return new Response(hit.bytes, {
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
        ...metaToHeaders(hit.meta)
      }
    });
  } catch (error) {
    return json({ error: error.message || 'dashboard-data read failed' }, error.status || 500);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    requireAdmin(request, env);
    const buf = await request.arrayBuffer();
    if (buf.byteLength === 0) return json({ error: 'Empty body.' }, 400);
    if (buf.byteLength > MAX_BODY_BYTES) {
      return json({ error: `Dashboard data is too large (${buf.byteLength} bytes).` }, 413);
    }
    const meta = readMetaFromHeaders(request);
    await writeData(env, new Uint8Array(buf), meta);
    return json({ ok: true, size: buf.byteLength, ...meta });
  } catch (error) {
    return json({ error: error.message || 'dashboard-data write failed' }, error.status || 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    requireAdmin(request, env);
    await deleteData(env);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message || 'dashboard-data delete failed' }, error.status || 500);
  }
}
