const STATE_ID = 'live';
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

async function ensureD1(env) {
  if (!env.DB) return false;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS shared_state (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)'
  ).run();
  return true;
}

async function readState(env) {
  if (env.SOP_STATE) {
    return (await env.SOP_STATE.get(STATE_ID, 'json')) || {};
  }
  if (await ensureD1(env)) {
    const row = await env.DB.prepare('SELECT data FROM shared_state WHERE id = ?').bind(STATE_ID).first();
    return row?.data ? JSON.parse(row.data) : {};
  }
  throw new Error('Missing Cloudflare binding: add KV binding SOP_STATE or D1 binding DB.');
}

async function writeState(env, state) {
  const data = JSON.stringify(state || {});
  if (data.length > MAX_BODY_BYTES) throw new Error('Shared state is too large.');

  if (env.SOP_STATE) {
    await env.SOP_STATE.put(STATE_ID, data);
    return;
  }
  if (await ensureD1(env)) {
    await env.DB.prepare(
      'INSERT INTO shared_state (id, data, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
    ).bind(STATE_ID, data, new Date().toISOString()).run();
    return;
  }
  throw new Error('Missing Cloudflare binding: add KV binding SOP_STATE or D1 binding DB.');
}

export async function onRequestGet({ env }) {
  try {
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
    await writeState(env, body.state);
    return json({ ok: true });
  } catch (error) {
    return json({ error: error.message || 'shared-state write failed' }, 500);
  }
}

export const onRequestPost = onRequestPut;
