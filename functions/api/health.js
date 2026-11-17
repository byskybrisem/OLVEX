
export async function onRequest({ env }) {
  try {
    if (!env.DB) {
      return Response.json(
        { status: "unavailable" },
        {
          status: 503,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    await env.DB.prepare("SELECT 1").first();

    return Response.json(
      { status: "ok" },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
