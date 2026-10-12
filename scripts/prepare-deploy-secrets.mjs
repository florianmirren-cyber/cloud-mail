import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const jwtSecret = process.env.RXKFLO_JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  console.error('RXKFLO_JWT_SECRET is missing or too short.');
  process.exit(1);
}
const secrets = { jwt_secret: jwtSecret };
if (process.env.RXKFLO_RESEND_WEBHOOK_SECRET) {
  secrets.RESEND_WEBHOOK_SECRET = process.env.RXKFLO_RESEND_WEBHOOK_SECRET;
}
await mkdir('.secrets', { recursive: true });
await writeFile(resolve('.secrets/deploy.json'), JSON.stringify(secrets), { mode: 0o600 });
console.log('Prepared private Worker secrets file.');
