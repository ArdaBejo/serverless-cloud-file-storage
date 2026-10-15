export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        message: "Cloud File Storage API is running",
      });
    }

    if (url.pathname === "/api/r2-test") {
      await env.MY_BUCKET.put(
        "test.txt",
        "Hello from my Cloud File Storage project!",
      );

      return Response.json({
        success: true,
        message: "test.txt was written to R2",
      });
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "API route not found" }, { status: 404 });
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
