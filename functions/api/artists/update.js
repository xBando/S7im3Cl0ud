
export async function onRequest(context) {
  const { request, env } = context;

  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    });

  if (request.method !== "PATCH") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    
    // 1. Read and verify the login session.
    const cookie = request.headers.get("Cookie") || "";

    const match = cookie.match(
      /(?:^|;\s*)__Host-s7im3cl0ud_session=([a-f0-9]{64})(?:;|$)/
    );

    if (!match) {
      return json({ error: "Authentication required." }, 401);
    }

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(match[1])
    );

    const bytes = new Uint8Array(digest);

    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    const tokenHash = btoa(binary);

    const user = await env.DB.prepare(`
      SELECT users.id
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
        AND sessions.expires_at > ?
      LIMIT 1
    `)
      .bind(tokenHash, new Date().toISOString())
      .first();

    if (!user) {
      return json({ error: "Invalid or expired session." }, 401);
    }


    // 2. Read the requested changes.
    let body;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const { artist_id } = body;

    if (
      typeof artist_id !== "string" ||
      artist_id.length < 1 ||
      artist_id.length > 100
    ) {
      return json({ error: "A valid artist_id is required." }, 400);
    }

    // 3. Confirm the profile belongs to this user.
    const artist = await env.DB.prepare(`
      SELECT id, display_name, slug, bio
      FROM artists
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `)
      .bind(artist_id, user.id)
      .first();

    if (!artist) {
      return json({
        error: "Artist profile not found or access denied."
      }, 404);
    }

    // 4. Preserve fields that were not submitted.
    const display_name =
      body.display_name === undefined
        ? artist.display_name
        : body.display_name;

    const slug =
      body.slug === undefined
        ? artist.slug
        : body.slug;

    const bio =
      body.bio === undefined
        ? artist.bio
        : body.bio;

    // 5. Validate the updated values.
    if (
      typeof display_name !== "string" ||
      display_name.trim().length < 2 ||
      display_name.trim().length > 50
    ) {
      return json({
        error: "Display name must be between 2 and 50 characters."
      }, 400);
    }

    if (
      typeof slug !== "string" ||
      !/^[a-z0-9_-]{3,30}$/.test(slug)
    ) {
      return json({
        error: "Slug must be 3–30 characters using lowercase letters, numbers, hyphens, or underscores."
      }, 400);
    }

    if (
      typeof bio !== "string" ||
      bio.length > 500
    ) {
      return json({
        error: "Bio must be 500 characters or fewer."
      }, 400);
    }

    // 6. Check whether another artist already uses this slug.
    const existingSlug = await env.DB.prepare(`
      SELECT id
      FROM artists
      WHERE slug = ? COLLATE NOCASE
        AND id != ?
      LIMIT 1
    `)
      .bind(slug, artist_id)
      .first();

    if (existingSlug) {
      return json({
        error: "That artist URL is already taken."
      }, 409);
    }

    // 7. Save the updated profile.
    await env.DB.prepare(`
      UPDATE artists
      SET display_name = ?,
          slug = ?,
          bio = ?
      WHERE id = ? AND user_id = ?
    `)
      .bind(
        display_name.trim(),
        slug,
        bio.trim(),
        artist_id,
        user.id
      )
      .run();

    // 8. Return the updated profile.
    const updatedArtist = await env.DB.prepare(`
      SELECT id, display_name, slug, bio, created_at
      FROM artists
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `)
      .bind(artist_id, user.id)
      .first();

    return json({
      ok: true,
      message: "Artist profile updated successfully.",
      artist: updatedArtist
    });

  } catch (error) {
    console.error("Artist update error:", error);

    return json({
      error: "Unable to update artist profile."
    }, 500);
  }
}
