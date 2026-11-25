// Cloudflare Worker entry. Serves the Room server API; the Vue app itself is
// served as static assets (see wrangler.jsonc). Room Durable Objects arrive in #7.
export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler;
