
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

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ error: "Database unavailable." }, 503);
    }

    const cookie = request.headers.get("Cookie") || "";

    const match = cookie.match(
      /(?:^|;\s*)__Host-s7im3cl0ud_session=([a-f0-9]{64})(?:;|$)/
    );

    if (!match) {
      return json({ error: "You must be logged in." }, 401);
    }

    const tokenHash = await hashToken(match[1]);

    const user = await env.DB.prepare(
      `SELECT users.id, users.username
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?
       AND sessions.expires_at > ?
       LIMIT 1`
    )
      .bind(tokenHash, new Date().toISOString())
      .first();

    if (!user) {
      return json({ error: "Your session is invalid or expired." }, 401);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON request." }, 400);
    }

    const displayName = String(body.display_name || "").trim();
    const slug = String(body.slug || "").trim().toLowerCase();
    const bio = String(body.bio || "").trim();

    if (displayName.length < 2 || displayName.length > 50) {
      return json({
        error: "Display name must be 2–50 characters."
      }, 400);
    }

    if (!/^[a-z0-9_-]{3,30}$/.test(slug)) {
      return json({
        error: "Artist URL must be 3–30 characters using lowercase letters, numbers, hyphens, or underscores."
      }, 400);
    }

    if (bio.length > 500) {
      return json({
        error: "Bio cannot exceed 500 characters."
      }, 400);
    }

    const profileCount = await env.DB.prepare(
  "SELECT COUNT(*) AS total FROM artists WHERE user_id = ?"
)
  .bind(user.id)
  .first();

if (profileCount.total >= 3) {
  return json({
    error: "You can create a maximum of 3 artist profiles per account."
  }, 403);
}

const existingSlug = await env.DB.prepare(
  "SELECT id FROM artists WHERE slug = ? COLLATE NOCASE LIMIT 1"
)
  .bind(slug)
  .first();

if (existingSlug) {
  return json({
    error: "That artist URL is already taken."
  }, 409);
}

    const id = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO artists (id, user_id, display_name, slug, bio)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(id, user.id, displayName, slug, bio)
      .run();

    return json({
      ok: true,
      message: "Artist profile created.",
      artist: {
        id,
        display_name: displayName,
        slug,
        bio
      }
    }, 201);

  } catch (error) {
    console.error("Artist creation error:", error);

    if (
      error?.message?.includes("UNIQUE constraint failed")
    ) {
      return json({
        error: "That artist URL is already taken."
      }, 409);
    }

    return json({
      error: "Unable to create artist profile."
    }, 500);
  }
}
