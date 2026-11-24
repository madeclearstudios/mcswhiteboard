// Shared board storage, backed by Netlify Blobs.
// Requests only reach this function after passing the password gate
// in netlify/edge-functions/auth.js.
//
//   GET    /api/boards        → [{ id, name, updatedAt }]  (newest first)
//   GET    /api/boards/:id    → { id, name, updatedAt, data }
//   PUT    /api/boards/:id    ← { name, data }  → { id, name, updatedAt }
//   DELETE /api/boards/:id

import { getStore } from '@netlify/blobs';

const ID = /^[a-z0-9]{4,40}$/;
const MAX_BYTES = 4 * 1024 * 1024;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const cleanName = (n) => (typeof n === 'string' && n.trim() ? n.trim().slice(0, 80) : 'Untitled board');

function validData(d) {
  return d && typeof d === 'object' && d.canvas && Number.isFinite(d.canvas.w) && Number.isFinite(d.canvas.h) &&
    Array.isArray(d.shapes) && Array.isArray(d.connectors);
}

export default async (req, context) => {
  const store = getStore({ name: 'boards', consistency: 'strong' });
  const id = context.params?.id;

  if (!id) {
    if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405);
    const { blobs } = await store.list();
    const metas = await Promise.all(
      blobs.map(async ({ key }) => {
        const m = await store.getMetadata(key);
        return m ? { id: key, name: m.metadata?.name || 'Untitled board', updatedAt: m.metadata?.updatedAt || 0 } : null;
      }),
    );
    return json(metas.filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt));
  }

  if (!ID.test(id)) return json({ error: 'bad id' }, 400);

  if (req.method === 'GET') {
    const board = await store.get(id, { type: 'json' });
    return board ? json(board) : json({ error: 'not found' }, 404);
  }

  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: 'board too large' }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
    if (!validData(body.data)) return json({ error: 'bad board data' }, 400);
    const board = { id, name: cleanName(body.name), updatedAt: Date.now(), data: body.data };
    await store.setJSON(id, board, { metadata: { name: board.name, updatedAt: board.updatedAt } });
    return json({ id, name: board.name, updatedAt: board.updatedAt });
  }

  if (req.method === 'DELETE') {
    await store.delete(id);
    return json({ ok: true });
  }

  return json({ error: 'method not allowed' }, 405);
};

export const config = {
  path: ['/api/boards', '/api/boards/:id'],
};
