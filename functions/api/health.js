export async function onRequest({ env }) {
  try {
    const result = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).all();

    return Response.json({
      status: "ok",
      database: "connected",
      tables: result.results
    });
  } catch (error) {
    return Response.json({
      status: "error",
      message: error.message
    }, { status: 500 });
  }
}
