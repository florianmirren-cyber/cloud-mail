import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['test/resend-webhook.test.js', 'test/asset-response.test.js'] },
});
