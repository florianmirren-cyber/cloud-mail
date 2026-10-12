import { Resend } from 'resend';

// Verification is local; this client never makes an API call.
const verifier = new Resend('webhook-verification-only');
const supportedEvents = new Set([
  'email.delivered', 'email.bounced', 'email.complained',
  'email.delivery_delayed', 'email.failed',
]);

export function createResendWebhookHandler(updateStatus) {
  return async (c) => {
    const webhookSecret = c.env.RESEND_WEBHOOK_SECRET;
    if (!webhookSecret) return c.text('Webhook not configured', 503);

    let event;
    try {
      event = verifier.webhooks.verify({
        payload: await c.req.text(),
        headers: {
          id: c.req.header('svix-id'),
          timestamp: c.req.header('svix-timestamp'),
          signature: c.req.header('svix-signature'),
        },
        webhookSecret,
      });
    } catch {
      return c.text('Invalid webhook signature', 400);
    }

    // Unrelated signed events must not reset an existing delivery status.
    if (!supportedEvents.has(event.type)) return c.text('success', 200);
    if (typeof event.data?.email_id !== 'string' || !event.data.email_id) {
      return c.text('Invalid webhook event', 400);
    }
    try {
      await updateStatus(c, event);
      return c.text('success', 200);
    } catch {
      return c.text('Webhook processing failed', 500);
    }
  };
}
