const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") {
      return json({ ok: true, service: "our-website-preview" });
    }

    if (pathname === "/") {
      return new Response(
        "<!doctype html><html lang=\"vi\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Our Website</title><body><main><h1>Our Website</h1><p>Preview is healthy.</p><a href=\"/health\">Health check</a></main></body></html>",
        { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
      );
    }

    return json({ error: "Not found" }, 404);
  },
};
