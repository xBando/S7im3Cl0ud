
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie":
        "__Host-s7im3cl0ud_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
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

    if (match) {
      const tokenHash = await hashToken(match[1]);

      await env.DB.prepare(
        "DELETE FROM sessions WHERE token_hash = ?"
      )
        .bind(tokenHash)
        .run();
    }

    return json({
      ok: true,
      message: "Logged out successfully."
    });

  } catch (error) {
    console.error("Logout error:", error);

    return json({
      error: "Unable to log out."
    }, 500);
  }
}
