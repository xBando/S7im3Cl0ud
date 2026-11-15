
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function encodeBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function verifyPassword(password, storedHash) {
  const combined = decodeBase64(storedHash);

  if (combined.length !== 48) {
    return false;
  }

  const salt = combined.slice(0, 16);
  const expectedHash = combined.slice(16);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    key,
    256
  );

  const actualHash = new Uint8Array(bits);

  let difference = 0;

  for (let i = 0; i < expectedHash.length; i++) {
    difference |= actualHash[i] ^ expectedHash[i];
  }

  return difference === 0;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return encodeBase64(new Uint8Array(digest));
}

function createSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ error: "Database unavailable." }, 503);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }

    const identifier = String(body.identifier || "").trim();
    const password = String(body.password || "");

    if (
      !identifier ||
      identifier.length > 254 ||
      !password ||
      new TextEncoder().encode(password).length > 128
    ) {
      return json({ error: "Invalid username, email, or password." }, 400);
    }

    const user = await env.DB.prepare(
      `SELECT id, username, email, password_hash
       FROM users
       WHERE username = ? COLLATE NOCASE
          OR email = ? COLLATE NOCASE
       LIMIT 1`
    )
      .bind(identifier, identifier)
      .first();

    if (!user) {
      return json({ error: "Invalid username, email, or password." }, 401);
    }

    const valid = await verifyPassword(password, user.password_hash);

    if (!valid) {
      return json({ error: "Invalid username, email, or password." }, 401);
    }

    const token = createSessionToken();
    const tokenHash = await sha256(token);

    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        tokenHash,
        expiresAt
      )
      .run();

    return json(
      {
        ok: true,
        message: "Login successful.",
        user: {
          id: user.id,
          username: user.username,
          email: user.email
        }
      },
      200,
      {
        "Set-Cookie":
          `__Host-s7im3cl0ud_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`
      }
    );

  } catch (error) {
    console.error("Login error:", error);

    return json({
      error: "Login failed. Please try again."
    }, 500);
  }
}
