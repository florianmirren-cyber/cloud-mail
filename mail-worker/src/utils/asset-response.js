const resourcePrefixes = ['/assets/', '/tinymce/', '/image/'];

export async function serveAssets(request, assets) {
  const response = await assets.fetch(request);
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
    return response;
  }

  // SPA fallback must never become an immutable cached JavaScript/CSS response.
  const pathname = new URL(request.url).pathname;
  if (resourcePrefixes.some(prefix => pathname.startsWith(prefix))) {
    return new Response('Asset not found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-cache');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
