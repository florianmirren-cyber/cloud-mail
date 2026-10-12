import { describe, expect, it } from 'vitest';
import { serveAssets } from '../src/utils/asset-response.js';

describe('SPA asset fallback caching', () => {
  it.each(['/assets/missing.js', '/assets/missing.css', '/tinymce/missing.js', '/image/missing.png'])(
    'rejects HTML fallback for %s without caching it', async path => {
      const assets = { fetch: async () => new Response('<html>SPA</html>', {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=31556952, immutable' },
      }) };
      const response = await serveAssets(new Request(`https://mail.example${path}`), assets);
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('Asset not found');
    },
  );

  it('revalidates SPA navigation HTML while preserving its body', async () => {
    const response = await serveAssets(new Request('https://mail.example/inbox'), {
      fetch: async () => new Response('<html>SPA</html>', { headers: { 'Content-Type': 'text/html' } }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.text()).toBe('<html>SPA</html>');
  });

  it('preserves immutable caching for real JavaScript assets', async () => {
    const asset = new Response('export default 1;', {
      headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=31556952, immutable' },
    });
    const response = await serveAssets(new Request('https://mail.example/assets/valid.js'), { fetch: async () => asset });
    expect(response).toBe(asset);
  });
});
