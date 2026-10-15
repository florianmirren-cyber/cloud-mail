import { classifyVerificationEmail } from '../utils/verification-email.js';

export async function ensureVerificationSchema(db) {
  const { results } = await db.prepare('PRAGMA table_info(email)').all();
  if (!results.some(column => column.name === 'is_verification')) {
    try {
      await db.prepare('ALTER TABLE email ADD COLUMN is_verification INTEGER NOT NULL DEFAULT 0').run();
    } catch (error) {
      if (!/duplicate column name: is_verification/i.test(error.message)) throw error;
    }
  }
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_email_verification_lookup
    ON email(to_email COLLATE NOCASE, account_id, user_id, create_time DESC, email_id DESC)
    WHERE is_verification = 1 AND type = 0 AND status = 0 AND is_del = 0`).run();
}

export async function backfillRecentVerification(db) {
  let cursor = 0;
  // Only the current public window is relevant; never scan historical mail.
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  while (true) {
    const { results } = await db.prepare(`SELECT email_id, subject, text, content FROM email
      WHERE type = 0 AND status = 0 AND is_del = 0 AND email_id > ? AND julianday(create_time) > julianday(?)
      ORDER BY email_id LIMIT 100`).bind(cursor, cutoff).all();
    if (!results.length) break;
    const updates = results.map(row => {
      const verdict = classifyVerificationEmail(row);
      return verdict.isVerification
        ? db.prepare('UPDATE email SET is_verification = 1, code = ? WHERE email_id = ?').bind(verdict.code, row.email_id)
        : db.prepare('UPDATE email SET is_verification = 0 WHERE email_id = ?').bind(row.email_id);
    });
    await db.batch(updates);
    cursor = results.at(-1).email_id;
  }
}
