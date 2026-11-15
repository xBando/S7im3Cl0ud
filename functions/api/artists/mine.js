
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

    // Verify login session.
    const cookie = request.headers.get("Cookie") || "";

    const match = cookie.match(
      /(?:^|;\s*)__Host-s7im3cl0ud_session=([a-f0-9]{64})(?:;|$)/
    );

    if (!match) {
      return json({ error: "Authentication required." }, 401);
    }

    const tokenHash = await hashToken(match[1]);

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

    // Retrieve only this user's artist profiles.
    const result = await env.DB.prepare(`
      SELECT
        id,
        display_name,
        slug,
        bio,
        avatar_key,
        banner_key,
        created_at
      FROM artists
      WHERE user_id = ?
      ORDER BY created_at ASC
    `)
      .bind(user.id)
      .all();

    return json({
      ok: true,
      total: result.results.length,
      maximum: 3,
      artists: result.results
    });

  } catch (error) {
    console.error("Artist list error:", error);

    return json({
      error: "Unable to retrieve artist profiles."
    }, 500);
  }
}
