import { readFile } from 'node:fs/promises';
const { jwt_secret: secret } = JSON.parse(await readFile('.secrets/deploy.json', 'utf8'));
const baseUrl = process.env.MAIL_BASE_URL || 'https://mail.rxkflo.tech';
const url = new URL(`/api/init/${encodeURIComponent(secret)}`, baseUrl);
for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (response.ok && (await response.text()).trim() === 'success') {
      console.log('Mailbox database initialized. Existing accounts and settings are preserved.');
      process.exit(0);
    }
  } catch {
    // Never log the URL, response or request exception: initialization contains a secret.
  }
  console.log(`Initialization attempt ${attempt} did not complete.`);
  if (attempt < 6) await new Promise(resolve => setTimeout(resolve, 10_000));
}
console.error('Mailbox initialization failed. Check deployment and DNS status.');
process.exit(1);
