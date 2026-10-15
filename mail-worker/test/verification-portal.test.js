import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyVerificationEmail, verificationBody } from '../src/utils/verification-email.js';
import { ensureVerificationSchema, backfillRecentVerification } from '../src/init/verify-schema.js';
import { createVerificationApp } from '../src/api/verify-api.js';

function d1(sqlite) {
  return {
    prepare(sql) {
      let params = [];
      const statement = {
        bind(...values) { params = values; return statement; },
        async all() { return { results: sqlite.prepare(sql).all(...params), success: true }; },
        async first() { return sqlite.prepare(sql).get(...params) || null; },
        async run() { return sqlite.prepare(sql).run(...params); },
      };
      return statement;
    },
    async batch(statements) { return Promise.all(statements.map(statement => statement.run())); },
  };
}

describe('conservative verification classification and text rendering', () => {
  it.each([
    ['验证码：846291，有效期5分钟', '846291'],
    ['Your verification code is 842196', '842196'],
    ['A7B9C2 is your security code', 'A7B9C2'],
    ['您的验证码为 ８４６２９１', '846291'],
    ['登录码\n\n846291', '846291'],
    ['846291 是您的登录验证码', '846291'],
  ])('recognizes %s', (text, code) => {
    expect(classifyVerificationEmail({ text })).toEqual({ isVerification: 1, code });
  });
  it.each([
    'Your order number is 846291',
    'Your verification code settings were updated in 2026',
    'Your verification code: https://example.com/846291',
    'Verify your account: https://example.com/verify?code=846291',
    'Verification code: 20261015',
    'Verification code: EXPIRED',
    'Verification code: 846291 or 739184',
    'Security code settings updated. Order: 846291',
    'Verification code settings: $846291',
    'Verification code settings: 846291 USD',
    'Verification code settings: 12.846291',
    '验证码设置已更新。订单号：846291',
    'Security code settings changed\nYour order number is 846291',
    'Verification code preferences\nAccount number 846291',
    'Security code guidelines\nCall customer support at 846291',
  ])('withholds unrelated or ambiguous mail: %s', text => {
    expect(classifyVerificationEmail({ text }).isVerification).toBe(0);
  });
  it('extracts HTML-only codes while removing non-body content and URLs', () => {
    const mail = { html: '<style>.code{color:red}</style><script>BAD()</script><div>验证码</div><div>846291</div><p>请勿分享</p><img src="https://tracker.example/pixel"><iframe>BAD</iframe>' };
    expect(classifyVerificationEmail(mail).code).toBe('846291');
    const body = verificationBody(mail);
    expect(body).toContain('验证码');
    expect(body).toContain('\n');
    expect(body).not.toMatch(/BAD|tracker|<img|<script|color:red/);
  });
  it('keeps complete plain text and removes public attachment URLs', () => {
    const body = verificationBody({ text: '第一行\n第二行\nhttps://mail.rxkflo.tech/attachments/secret.pdf\n/api/oss/key' });
    expect(body).toContain('第一行\n第二行');
    expect(body).not.toMatch(/secret|\/api\/oss/);
  });
});

describe('verification portal with real SQLite queries', () => {
  let sqlite, db, app, env;
  const now = new Date('2026-10-15T08:30:00.000Z');
  const recent = '2026-10-15 08:29:00';
  const expired = '2026-10-15 07:59:59';
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`CREATE TABLE user(user_id INTEGER PRIMARY KEY, is_del INTEGER DEFAULT 0);
      CREATE TABLE account(account_id INTEGER PRIMARY KEY, user_id INTEGER, email TEXT, is_del INTEGER DEFAULT 0);
      CREATE TABLE email(email_id INTEGER PRIMARY KEY, account_id INTEGER, user_id INTEGER, to_email TEXT,
        type INTEGER DEFAULT 0, status INTEGER DEFAULT 0, is_del INTEGER DEFAULT 0,
        subject TEXT, code TEXT DEFAULT '', send_email TEXT, name TEXT, create_time TEXT, text TEXT, content TEXT);
      INSERT INTO user(user_id) VALUES(1),(2);
      INSERT INTO account(account_id,user_id,email) VALUES(1,1,'alice@rxkflo.tech'),(2,2,'bob@rxkflo.tech'),
        (3,1,'alice+tag@rxkflo.tech'),(4,1,'florian@rxkflo.tech');`);
    db = d1(sqlite);
    await ensureVerificationSchema(db);
    app = createVerificationApp();
    env = { db, VERIFY_PORTAL_ENABLED: 'true', VERIFY_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) } };
  });
  afterEach(() => { sqlite.close(); vi.useRealTimers(); });
  function mail(id, options = {}) {
    const row = { email_id: id, account_id: 1, user_id: 1, to_email: 'alice@rxkflo.tech',
      type: 0, status: 0, is_del: 0, is_verification: 1, subject: 'Verification code', code: '846291',
      send_email: 'no-reply@example.com', name: 'Example', create_time: recent, text: 'Your verification code is 846291\nDo not share.',
      content: '<script>alert(1)</script>', ...options };
    const keys = Object.keys(row);
    sqlite.prepare(`INSERT INTO email(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`).run(...Object.values(row));
  }
  async function request(action, input, headers = {}) {
    const response = await app.request(`/api/verify/${action}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...headers }, body: JSON.stringify(input) }, env);
    return { response, result: await response.json() };
  }

  it('publishes only completed, undeleted, recent classified mail and whitelists fields', async () => {
    mail(1);
    mail(2, { is_verification: 0 });
    mail(3, { create_time: expired });
    mail(4, { status: 6 });
    mail(5, { is_del: 1 });
    mail(6, { type: 1 });
    mail(7, { create_time: '2026-10-15 08:00:00' });
    mail(8, { create_time: '2026-10-15 09:00:00' });
    const { response, result } = await request('list', { name: ' ALICE ', accountId: 2, allReceive: 1, full: 1 });
    expect(response.status).toBe(200);
    expect(result.messages.map(row => row.emailId)).toEqual([1]);
    expect(Object.keys(result.messages[0]).sort()).toEqual(['code','createTime','emailId','sender','senderName','subject'].sort());
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('allows administrator mail under exactly the same public rules', async () => {
    mail(1, { account_id: 4, to_email: 'florian@rxkflo.tech' });
    expect((await request('list', { name: 'florian' })).result.messages).toHaveLength(1);
  });
  it('enforces address and account ownership for both lists and guessed detail IDs', async () => {
    mail(1);
    mail(2, { account_id: 2, user_id: 2, to_email: 'bob@rxkflo.tech' });
    mail(3, { to_email: 'bob@rxkflo.tech' });
    expect((await request('list', { name: 'bob' })).result.messages.map(row => row.emailId)).toEqual([2]);
    expect((await request('detail', { name: 'alice', emailId: 2 })).response.status).toBe(404);
    expect((await request('detail', { name: 'bob', emailId: 3 })).response.status).toBe(404);
    const detail = await request('detail', { name: 'alice', emailId: 1 });
    expect(detail.result.message.body).toContain('Do not share.');
    expect(detail.result.message).not.toHaveProperty('content');
    expect(detail.result.message).not.toHaveProperty('accountId');
  });
  it('does not inherit base account access for plus aliases or expose unknown catch-all mail', async () => {
    mail(1, { to_email: 'alice+other@rxkflo.tech' });
    mail(2, { to_email: 'alice+tag@rxkflo.tech' });
    mail(3, { account_id: 3, to_email: 'alice+tag@rxkflo.tech' });
    mail(4, { account_id: 0, user_id: 0, to_email: 'unknown@rxkflo.tech', status: 7 });
    expect((await request('list', { name: 'alice' })).result.messages).toEqual([]);
    expect((await request('list', { name: 'alice+other' })).result.messages).toEqual([]);
    expect((await request('list', { name: 'alice+tag' })).result.messages.map(row => row.emailId)).toEqual([3]);
    expect((await request('list', { name: 'unknown' })).result.messages).toEqual([]);
  });
  it('hides deleted accounts and users immediately, including detail', async () => {
    mail(1);
    sqlite.exec('UPDATE account SET is_del=1 WHERE account_id=1');
    expect((await request('list', { name: 'alice' })).result.messages).toEqual([]);
    sqlite.exec('UPDATE account SET is_del=0; UPDATE user SET is_del=1 WHERE user_id=1');
    expect((await request('detail', { name: 'alice', emailId: 1 })).response.status).toBe(404);
  });
  it('rechecks the moving 30-minute boundary for details', async () => {
    mail(1, { create_time: '2026-10-15 08:00:01' });
    expect((await request('detail', { name: 'alice', emailId: 1 })).response.status).toBe(200);
    vi.setSystemTime(new Date(now.getTime() + 1001));
    expect((await request('detail', { name: 'alice', emailId: 1 })).response.status).toBe(404);
  });
  it('paginates tied timestamps without duplicates and rejects malformed inputs', async () => {
    for (let id = 1; id <= 23; id++) mail(id);
    const first = (await request('list', { name: 'alice' })).result;
    const second = (await request('list', { name: 'alice', cursor: first.nextCursor })).result;
    expect(first.messages).toHaveLength(20);
    expect(second.messages.map(row => row.emailId)).toEqual([3,2,1]);
    expect(second.nextCursor).toBeNull();
    expect((await request('list', { name: 'alice', cursor: 'bad' })).response.status).toBe(400);
    expect((await request('list', { name: "alice' OR 1=1 --" })).response.status).toBe(400);
    expect((await request('list', { name: 'alice@other.example' })).response.status).toBe(400);
  });
  it('fails closed when disabled, limiter unavailable, or missing trusted IP', async () => {
    env.VERIFY_PORTAL_ENABLED = 'false';
    expect((await request('list', { name: 'alice' })).response.status).toBe(503);
    env.VERIFY_PORTAL_ENABLED = 'true';
    env.VERIFY_RATE_LIMITER = null;
    expect((await request('list', { name: 'alice' })).response.status).toBe(503);
    env.VERIFY_RATE_LIMITER = { limit: vi.fn(async () => ({ success: false })) };
    const limited = await request('list', { name: 'alice' });
    expect(limited.response.status).toBe(429);
    expect(limited.response.headers.get('retry-after')).toBe('60');
    expect(limited.response.headers.get('cache-control')).toBe('no-store');
    expect((await request('list', { name: 'alice' }, { 'CF-Connecting-IP': '' })).response.status).toBe(403);
  });
  it('bounds streamed request bodies and hides internal database errors', async () => {
    expect((await request('list', { name: 'a'.repeat(3000) })).response.status).toBe(413);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sqlite.exec('DROP TABLE email');
    const failed = await request('list', { name: 'alice' });
    expect(failed.response.status).toBe(503);
    expect(JSON.stringify(failed.result)).not.toMatch(/SQLite|table|SELECT/);
    spy.mockRestore();
  });
  it('runs schema upgrades idempotently and backfills only recent incoming mail', async () => {
    await ensureVerificationSchema(db);
    mail(1, { code: '', is_verification: 0 });
    mail(2, { code: '', is_verification: 0, create_time: expired });
    mail(3, { code: 'AI-ONLY', is_verification: 0, subject: 'Order confirmation', text: 'Order 846291', content: null });
    await backfillRecentVerification(db);
    expect(sqlite.prepare('SELECT code,is_verification FROM email WHERE email_id=1').get()).toMatchObject({ code: '846291', is_verification: 1 });
    expect(sqlite.prepare('SELECT is_verification FROM email WHERE email_id=2').get().is_verification).toBe(0);
    expect(sqlite.prepare('SELECT is_verification FROM email WHERE email_id=3').get().is_verification).toBe(0);
  });
});
