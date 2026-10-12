# rxkflo.tech mailbox

Webmail: https://mail.rxkflo.tech. Owner: florian@rxkflo.tech. Worker, D1 and KV: cloud-mail-rxkflo. Previous code is kept on `codex/pre-rxkflo-20261012`.

Receiving uses Cloudflare Email Routing catch-all → cloud-mail-rxkflo. Sending uses Resend; its receiving service remains off. Attachments use KV without R2/S3.

## Deployment credentials

Repository secrets: `RXKFLO_CLOUDFLARE_API_TOKEN`, `RXKFLO_JWT_SECRET`, and `RXKFLO_RESEND_WEBHOOK_SECRET` once the webhook exists. Repository variable: `RXKFLO_CLOUDFLARE_ACCOUNT_ID`.

The dedicated Wrangler configuration fixes domain, administrator and new database IDs. No legacy secret fallbacks are used. Pull requests validate without deploying; main pushes and manual runs deploy and initialize/upgrade without resetting mail, passwords or settings.

## Application settings

After owner registration, set `register=1` (closed), `receive=0`, `send=0`, `no_recipient=1`. Third-party login, forwarding, Telegram, outbound webhooks and AI stay off. Auto-clean days stay zero to preserve mail. Store the domain-scoped Resend sending key under `resend_tokens["rxkflo.tech"]` through administrator settings.

Resend callback: `https://mail.rxkflo.tech/api/webhooks`. Subscribe to `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`, and `email.failed`. Its signing secret is the Worker secret `RESEND_WEBHOOK_SECRET`. Raw-body/Svix verification runs before status updates. Unsupported signed events are acknowledged without changing status.

## Cleanup gate

Before cleanup verify HTTPS, owner access, closed registration, round-trip email, attachments, unknown-recipient rejection, plus-address delivery, authenticated callbacks and persistence after redeployment. Backup the old D1 and configuration first. Only old mailbox resources are in the cleanup scope.
