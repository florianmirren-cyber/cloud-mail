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

## Completed acceptance — 2026-10-12

- Domain active; HTTPS, owner login and administrator settings verified. Public registration rejects requests.
- Resend → owner's Gmail delivered with a text attachment and inline image. Signed delivery callback set status to delivered. Gmail initially classified the test message as spam; the owner account marked it as not spam. Inbox placement for other recipients is not guaranteed.
- Gmail reply → owner mailbox received; text attachment download matched the original SHA-256 and inline image loaded. `florian+acceptance` received; nonexistent address returned `555 5.7.1 Recipient not found`.
- A forged bounce callback targeting the real test message returned 400 and left delivered status unchanged. Seven automated webhook tests passed.
- Manual deployment run `38203689949` preserved the password/salt, Resend setting, one user, three emails and four attachment records.
- Old SQL export restored successfully into a local verification database (two users, three accounts, one email). Private local backups are in ignored `.secrets/backups/`.
- Old `cloud-mail` Worker, `cloudmail` D1/KV, mail web binding and old Email Routing removed. Old zone's unrelated A record and other projects remain.

Merged implementation: https://github.com/florianmirren-cyber/cloud-mail/pull/1

The deployment also guards static-resource paths against cached SPA HTML fallbacks. Missing scripts/styles return 404 with no-store, navigation HTML revalidates, and real assets keep normal caching. Thirteen security/regression tests cover webhook validation and asset responses.
