
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );

  const bytes = new Uint8Array(digest);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) {
      return json({ error: "Database unavailable." }, 503);
    }

    const url = new URL(request.url);
    const slug = url.searchParams.get("slug");

    if (
      !slug ||
      !/^[a-z0-9_-]{3,30}$/.test(slug)
    ) {
      return json({ error: "A valid artist slug is required." }, 400);
    }

    const artist = await env.DB.prepare(`
      SELECT id, display_name, slug, bio, avatar_key, banner_key
      FROM artists
      WHERE slug = ? COLLATE NOCASE
      LIMIT 1
    `)
      .bind(slug)
      .first();

    if (!artist) {
      return json({ error: "Artist not found." }, 404);
    }

    // Check whether the visitor owns this artist profile.
    const cookie = request.headers.get("Cookie") || "";

    const match = cookie.match(
      /(?:^|;\s*)__Host-s7im3cl0ud_session=([a-f0-9]{64})(?:;|$)/
    );

    let isOwner = false;

    if (match) {
      const tokenHash = await hashToken(match[1]);

      const session = await env.DB.prepare(`
        SELECT users.id
        FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ?
          AND sessions.expires_at > ?
        LIMIT 1
      `)
        .bind(tokenHash, new Date().toISOString())
        .first();

      isOwner = !!session && session.id === artist.user_id;
    }

    // Public visitors only see published tracks.
    // Owners can also see unpublished tracks.
    const tracks = await env.DB.prepare(`
      SELECT
        id,
        title,
        description,
        duration_seconds,
        cover_key,
        audio_key,
        created_at,
        published
      FROM tracks
      WHERE artist_id = ?
        AND (published = 1 OR ? = 1)
      ORDER BY created_at DESC
    `)
      .bind(artist.id, isOwner ? 1 : 0)
      .all();

    return json({
      ok: true,
      artist: {
        id: artist.id,
        display_name: artist.display_name,
        slug: artist.slug,
        bio: artist.bio,
        avatar_key: artist.avatar_key,
        banner_key: artist.banner_key
      },
      is_owner: isOwner,
      total_tracks: tracks.results.length,
      tracks: tracks.results
    });

  } catch (error) {
    console.error("Artist tracks error:", error);

    return json({
      error: "Unable to retrieve artist catalog."
    }, 500);
  }
}
