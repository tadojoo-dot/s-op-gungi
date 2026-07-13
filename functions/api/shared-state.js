const STATE_ID = 'live';
const ARCHIVE_PREFIX = 'archive:';
const ARCHIVE_INDEX_ID = 'archive:index';
const MAX_BODY_BYTES = 256 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function requireAdmin(body, env) {
  if (!env.ADMIN_PASSWORD) return;
  const provided = String(body?.adminPassword || '');
  if (!provided || provided !== String(env.ADMIN_PASSWORD)) {
    const error = new Error('Admin password required.');
    error.status = 403;
    throw error;
  }
}

async function ensureD1(env) {
  if (!env.DB) return false;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS shared_state (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)'
  ).run();
  return true;
}

function archiveId(period) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) {
    throw new Error('Expected archive period format YYYY-MM.');
  }
  return `${ARCHIVE_PREFIX}${period}`;
}

async function readRaw(env, id) {
  if (env.SOP_STATE) {
    return (await env.SOP_STATE.get(id, 'json')) || null;
  }
  if (await ensureD1(env)) {
    const row = await env.DB.prepare('SELECT data FROM shared_state WHERE id = ?').bind(id).first();
    return row?.data ? JSON.parse(row.data) : null;
  }
  throw new Error('Missing Cloudflare binding: add KV binding SOP_STATE or D1 binding DB.');
}

async function writeRaw(env, id, value) {
  const data = JSON.stringify(value || {});
  if (data.length > MAX_BODY_BYTES) throw new Error('Shared state is too large.');

  if (env.SOP_STATE) {
    await env.SOP_STATE.put(id, data);
    return;
  }
  if (await ensureD1(env)) {
    await env.DB.prepare(
      'INSERT INTO shared_state (id, data, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
    ).bind(id, data, new Date().toISOString()).run();
    return;
  }
  throw new Error('Missing Cloudflare binding: add KV binding SOP_STATE or D1 binding DB.');
}

async function readState(env, id = STATE_ID) {
  return (await readRaw(env, id)) || {};
}

async function writeState(env, state, id = STATE_ID) {
  await writeRaw(env, id, state);
}

async function listArchives(env) {
  const fromIndex = (await readRaw(env, ARCHIVE_INDEX_ID)) || [];
  if (Array.isArray(fromIndex) && fromIndex.length) {
    return fromIndex.sort((a, b) => String(b.period).localeCompare(String(a.period)));
  }
  if (env.SOP_STATE) {
    const listed = await env.SOP_STATE.list({ prefix: ARCHIVE_PREFIX });
    return (listed.keys || [])
      .map(key => ({ period: key.name.replace(ARCHIVE_PREFIX, ''), label: key.metadata?.label || key.name.replace(ARCHIVE_PREFIX, '') }))
      .filter(item => /^\d{4}-\d{2}$/.test(item.period))
      .sort((a, b) => b.period.localeCompare(a.period));
  }
  return [];
}

async function upsertArchiveIndex(env, item) {
  const list = await listArchives(env);
  const next = [item, ...list.filter(row => row.period !== item.period)]
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))
    .slice(0, 36);
  await writeRaw(env, ARCHIVE_INDEX_ID, next);
  return next;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get('archives') === '1') {
      return json({ archives: await listArchives(env) });
    }
    const period = url.searchParams.get('period');
    if (period) {
      return json({ period, state: await readState(env, archiveId(period)) });
    }
    return json({ state: await readState(env) });
  } catch (error) {
    return json({ error: error.message || 'shared-state read failed' }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'Request body is too large.' }, 413);
    const body = raw ? JSON.parse(raw) : {};
    if (!body || typeof body.state !== 'object' || Array.isArray(body.state)) {
      return json({ error: 'Expected JSON body: { "state": { ... } }' }, 400);
    }
    requireAdmin(body, env);
    await writeState(env, body.state);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message || 'shared-state write failed' }, error.status || 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: 'Request body is too large.' }, 413);
    const body = raw ? JSON.parse(raw) : {};
    requireAdmin(body, env);
    if (body?.action === 'verify') {
      return json({ ok: true });
    }
    if (body?.action === 'archive') {
      const period = String(body.period || '');
      const id = archiveId(period);
      const state = body.state && typeof body.state === 'object' && !Array.isArray(body.state)
        ? body.state
        : await readState(env);
      const item = {
        period,
        label: String(body.label || `${period} S&OP`),
        archived_at: new Date().toISOString()
      };
      await writeRaw(env, id, { ...state, __archive_meta: item });
      await upsertArchiveIndex(env, item);
      return json({ ok: true, archive: item });
    }
    return onRequestPut({ request: new Request(request.url, { method: 'PUT', body: raw }), env });
  } catch (error) {
    return json({ error: error.message || 'shared-state archive failed' }, error.status || 500);
  }
}
