import { Hono } from 'hono';
import { verificationBody } from '../utils/verification-email.js';

export const VERIFICATION_DOMAIN = 'rxkflo.tech';
export const VERIFICATION_WINDOW_MS = 30 * 60 * 1000;
const PAGE_SIZE = 20;

function addressFor(name) {
  if (typeof name !== 'string') throw new Error('请输入邮箱名称');
  const local = name.trim().toLowerCase();
  if (local.length > 64 || !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) throw new Error('邮箱名称格式不正确');
  return `${local}@${VERIFICATION_DOMAIN}`;
}

function encodeCursor(row) {
  return btoa(JSON.stringify([row.createTime, row.emailId]));
}

function decodeCursor(cursor) {
  if (cursor === undefined || cursor === null) return null;
  if (typeof cursor !== 'string' || cursor.length > 200) throw new Error('分页参数不正确');
  try {
    const [time, id] = JSON.parse(atob(cursor));
    if (typeof time !== 'string' || !Number.isFinite(Date.parse(time)) || !Number.isSafeInteger(id) || id <= 0) throw new Error();
    return { time, id };
  } catch { throw new Error('分页参数不正确'); }
}

export function createVerificationApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
    if (c.env.VERIFY_PORTAL_ENABLED !== true && c.env.VERIFY_PORTAL_ENABLED !== 'true') return c.json({ error: '验证码查询暂未开放' }, 503);
    if (!c.env.VERIFY_RATE_LIMITER) return c.json({ error: '验证码查询暂不可用' }, 503);
    const ip = c.req.header('CF-Connecting-IP');
    if (!ip) return c.json({ error: '无法验证请求来源' }, 403);
    const { success } = await c.env.VERIFY_RATE_LIMITER.limit({ key: `verify:${ip}` });
    if (!success) {
      c.header('Retry-After', '60');
      return c.json({ error: '查询过于频繁，请稍后重试' }, 429);
    }
    await next();
  });

  app.post('/api/verify/:action', async c => {
    const action = c.req.param('action');
    if (!['list', 'detail'].includes(action)) return c.json({ error: '接口不存在' }, 404);
    const length = Number(c.req.header('Content-Length') || 0);
    if (length > 2048) return c.json({ error: '请求过大' }, 413);
    let input, address, cursor;
    try {
      // Bound streamed bodies too; Content-Length alone is not authoritative.
      const reader = c.req.raw.body?.getReader();
      let size = 0;
      const chunks = [];
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 2048) { await reader.cancel(); return c.json({ error: '请求过大' }, 413); }
          chunks.push(value);
        }
      }
      input = JSON.parse(await new Response(new Blob(chunks)).text());
      address = addressFor(input?.name);
      cursor = action === 'list' ? decodeCursor(input.cursor) : null;
      if (action === 'detail' && (!Number.isSafeInteger(input.emailId) || input.emailId <= 0)) throw new Error('邮件参数不正确');
    } catch (error) { return c.json({ error: error instanceof SyntaxError ? '请求格式不正确' : error.message }, 400); }

    const now = new Date();
    const cutoff = new Date(now.getTime() - VERIFICATION_WINDOW_MS).toISOString();
    // Exact address AND account ownership are checked in the same SQL statement
    // for list/detail, including + addresses. No catch-all or base-address fallback.
    const where = `FROM email e JOIN account a ON a.account_id = e.account_id AND a.user_id = e.user_id
      JOIN user u ON u.user_id = a.user_id
      WHERE a.email = ? COLLATE NOCASE AND a.is_del = 0 AND u.is_del = 0
      AND e.to_email = ? COLLATE NOCASE AND e.is_verification = 1
      AND e.type = 0 AND e.status = 0 AND e.is_del = 0
      AND e.create_time > strftime('%Y-%m-%d %H:%M:%S', ?)
      AND julianday(e.create_time) > julianday(?) AND julianday(e.create_time) <= julianday(?)`;
    const params = [address, address, cutoff, cutoff, now.toISOString()];
    const fields = `e.email_id AS emailId, e.subject, e.send_email AS sender,
      e.name AS senderName, e.create_time AS createTime, e.code`;
    if (action === 'detail') {
      const row = await c.env.db.prepare(`SELECT ${fields}, e.text, e.content ${where} AND e.email_id = ? LIMIT 1`)
        .bind(...params, input.emailId).first();
      if (!row) return c.json({ error: '暂无可用邮件' }, 404);
      const { text, content, ...summary } = row;
      return c.json({ email: address, message: { ...summary, body: verificationBody({ text, content }) }, serverTime: now.toISOString() });
    }
    const paging = cursor ? ' AND (e.create_time < ? OR (e.create_time = ? AND e.email_id < ?))' : '';
    const { results } = await c.env.db.prepare(`SELECT ${fields} ${where}${paging}
      ORDER BY e.create_time DESC, e.email_id DESC LIMIT ${PAGE_SIZE + 1}`)
      .bind(...params, ...(cursor ? [cursor.time, cursor.time, cursor.id] : [])).all();
    const messages = results.slice(0, PAGE_SIZE);
    return c.json({ email: address, messages, nextCursor: results.length > PAGE_SIZE ? encodeCursor(messages.at(-1)) : null, serverTime: now.toISOString() });
  });
  app.notFound(c => c.json({ error: '接口不存在' }, 404));
  app.onError((error, c) => {
    console.error(JSON.stringify({ event: 'verification_query_failed', name: error.name }));
    return c.json({ error: '查询暂不可用，请稍后重试' }, 503);
  });
  return app;
}

export default createVerificationApp();
