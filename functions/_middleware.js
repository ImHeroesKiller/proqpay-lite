export async function onRequest({ request, env, next }) {
  const canonical = String(env.CANONICAL_ORIGIN || '').replace(/\/+$/, '');
  if (!canonical) return next();

  const url = new URL(request.url);
  const canonicalUrl = new URL(canonical);
  if (url.host === canonicalUrl.host) {
    const response = await next();
    if (!url.pathname.startsWith('/api/')) {
      response.headers.set('Access-Control-Allow-Origin', canonicalUrl.origin);
      response.headers.set('Vary', 'Origin');
    }
    return response;
  }

  // Keep the low-risk health probe available on the Pages hostname for
  // deployment convergence checks and disaster diagnostics.
  if (url.pathname === '/api/health') return next();

  if (request.method === 'GET' || request.method === 'HEAD') {
    const target = new URL(url.pathname + url.search, canonicalUrl.origin);
    return Response.redirect(target.toString(), 308);
  }

  return new Response(JSON.stringify({
    error: 'Canonical ProQPay origin required',
    code: 'CANONICAL_ORIGIN_REQUIRED',
    canonicalOrigin: canonicalUrl.origin,
  }), {
    status: 421,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
