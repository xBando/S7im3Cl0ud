export async function onRequest({ env }) {
  return Response.json({
    ok: true,
    service: "$7im3Cl0ud API",
    message: "Your Pages Function is running!",
    bindings: {
      musicBucket: Boolean(env.MUSIC_BUCKET),
      database: Boolean(env.DB)
    }
  });
}
