
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) {
      return json({ error: "Database unavailable." }, 503);
    }

    const url = new URL(request.url);
    const slug = (url.searchParams.get("slug") || "")
      .trim()
      .toLowerCase();

    if (!/^[a-z0-9_-]{3,30}$/.test(slug)) {
      return json({
        error: "Enter a valid artist URL."
      }, 400);
    }

    const artist = await env.DB.prepare(
      `SELECT
        id,
        display_name,
        slug,
        bio,
        created_at
       FROM artists
       WHERE slug = ? COLLATE NOCASE
       LIMIT 1`
    )
      .bind(slug)
      .first();

    if (!artist) {
      return json({
        error: "Artist profile not found."
      }, 404);
    }

    return json({
      ok: true,
      artist
    });

  } catch (error) {
    console.error("Artist profile lookup error:", error);

    return json({
      error: "Unable to retrieve artist profile."
    }, 500);
  }
}
