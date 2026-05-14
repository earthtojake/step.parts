export const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Content-Disposition, Content-Length, ETag, Last-Modified, Location",
  "Access-Control-Max-Age": "86400",
};

export function apiHeaders(init?: HeadersInit) {
  const headers = new Headers(init);

  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }

  return headers;
}

export function apiJson(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: apiHeaders(init.headers),
  });
}

export function apiOptions() {
  return new Response(null, {
    status: 204,
    headers: apiHeaders(),
  });
}
