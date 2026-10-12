import { createHmac, randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { describe, expect, it, vi } from 'vitest';
import { createResendWebhookHandler } from '../src/utils/resend-webhook';

const secretBytes = randomBytes(32);
const secret = `whsec_${secretBytes.toString('base64')}`;
const event = { type: 'email.delivered', data: { email_id: 'test-email-id' } };

function signedRequest(payload = JSON.stringify(event), secondsAgo = 0) {
  const id = 'msg_webhook_test';
  const timestamp = String(Math.floor(Date.now() / 1000) - secondsAgo);
  const signature = createHmac('sha256', secretBytes)
    .update(`${id}.${timestamp}.${payload}`).digest('base64');
  return new Request('https://mail.rxkflo.tech/webhooks', {
    method: 'POST', body: payload,
    headers: { 'content-type': 'application/json', 'svix-id': id,
      'svix-timestamp': timestamp, 'svix-signature': `v1,${signature}` },
  });
}

function fixture() {
  const updateStatus = vi.fn();
  const app = new Hono();
  app.post('/webhooks', bodyLimit({ maxSize: 1024 * 1024 }),
    createResendWebhookHandler(updateStatus));
  return { app, updateStatus };
}

describe('Resend webhook authentication', () => {
  it('verifies the exact raw body before updating status', async () => {
    const { app, updateStatus } = fixture();
    const response = await app.fetch(signedRequest(JSON.stringify(event, null, 2)),
      { RESEND_WEBHOOK_SECRET: secret });
    expect(response.status).toBe(200);
    expect(updateStatus).toHaveBeenCalledTimes(1);
    expect(updateStatus.mock.calls[0][1]).toEqual(event);
  });
  it('rejects a tampered body without updating status', async () => {
    const { app, updateStatus } = fixture();
    const original = signedRequest();
    const tampered = new Request(original.url, { method: 'POST',
      headers: original.headers, body: JSON.stringify({ ...event, type: 'email.bounced' }) });
    expect((await app.fetch(tampered, { RESEND_WEBHOOK_SECRET: secret })).status).toBe(400);
    expect(updateStatus).not.toHaveBeenCalled();
  });
  it('rejects expired signatures', async () => {
    const { app, updateStatus } = fixture();
    expect((await app.fetch(signedRequest(undefined, 600),
      { RESEND_WEBHOOK_SECRET: secret })).status).toBe(400);
    expect(updateStatus).not.toHaveBeenCalled();
  });
  it('rejects missing headers or a missing configured secret', async () => {
    const { app, updateStatus } = fixture();
    const unsigned = new Request('https://mail.rxkflo.tech/webhooks',
      { method: 'POST', body: JSON.stringify(event) });
    expect((await app.fetch(unsigned, { RESEND_WEBHOOK_SECRET: secret })).status).toBe(400);
    expect((await app.fetch(signedRequest(), {})).status).toBe(503);
    expect(updateStatus).not.toHaveBeenCalled();
  });
  it('acknowledges unrelated signed events without changing status', async () => {
    const { app, updateStatus } = fixture();
    expect((await app.fetch(signedRequest(JSON.stringify({ ...event, type: 'email.opened' })),
      { RESEND_WEBHOOK_SECRET: secret })).status).toBe(200);
    expect(updateStatus).not.toHaveBeenCalled();
  });
  it('rejects an invalid signed event and oversized bodies', async () => {
    const { app, updateStatus } = fixture();
    expect((await app.fetch(signedRequest(JSON.stringify({ type: 'email.delivered', data: {} })),
      { RESEND_WEBHOOK_SECRET: secret })).status).toBe(400);
    expect((await app.fetch(signedRequest('x'.repeat(1024 * 1024 + 1)),
      { RESEND_WEBHOOK_SECRET: secret })).status).toBe(413);
    expect(updateStatus).not.toHaveBeenCalled();
  });
  it('returns a retryable error without exposing internal details', async () => {
    const { app, updateStatus } = fixture();
    updateStatus.mockRejectedValue(new Error('internal database details'));
    const response = await app.fetch(signedRequest(), { RESEND_WEBHOOK_SECRET: secret });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Webhook processing failed');
  });
});
