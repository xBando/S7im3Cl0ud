
export async function onRequest(context) {
  const { request, env, params } = context;

  // The double-bracket route captures path segments as an array.
  const slugParts = params.slug || [];
  const slug = slugParts[0] || "";

  // Only accept /artist/:slug, not deeper nested paths.
  if (!slug || slugParts.length !== 1) {
    return new Response("Artist not found", { status: 404 });
  }

  // Serve the existing artist profile HTML for this clean URL.
  const assetUrl = new URL("/artist/index.html", request.url);

  const assetRequest = new Request(assetUrl.toString(), {
    method: request.method,
    headers: request.headers,
  });

  return env.ASSETS.fetch(assetRequest);
}
