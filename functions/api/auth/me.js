
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

    const cookie = request.headers.get("Cookie") || "";

    const match = cookie.match(
      /(?:^|;\s*)__Host-s7im3cl0ud_session=([a-f0-9]{64})(?:;|$)/
    );

    if (!match) {
      return json({
        authenticated: false,
        user: null
      }, 200);
    }

    const tokenHash = await hashToken(match[1]);

    const session = await env.DB.prepare(
      `SELECT users.id, users.username, users.email
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?
         AND sessions.expires_at > ?
       LIMIT 1`
    )
      .bind(tokenHash, new Date().toISOString())
      .first();

    if (!session) {
      return json({
        authenticated: false,
        user: null
      }, 200);
    }

    return json({
      authenticated: true,
      user: {
        id: session.id,
        username: session.username,
        email: session.email
      }
    });

  } catch (error) {
    console.error("Session verification error:", error);

    return json({
      error: "Unable to verify session."
    }, 500);
  }
}
