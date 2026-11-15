
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 600000,
      hash: "SHA-256"
    },
    key,
    256
  );

  const hash = new Uint8Array(bits);
  const combined = new Uint8Array(salt.length + hash.length);

  combined.set(salt, 0);
  combined.set(hash, salt.length);

  let binary = "";
  for (const byte of combined) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ error: "Database binding unavailable." }, 503);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON request." }, 400);
    }

    const username = String(body.username || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      return json({
        error: "Username must be 3–24 characters using letters, numbers, or underscores."
      }, 400);
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254
    ) {
      return json({ error: "Enter a valid email address." }, 400);
    }

    if (
      password.length < 12 ||
      new TextEncoder().encode(password).length > 128
    ) {
      return json({
        error: "Password must be at least 12 characters and no more than 128 bytes."
      }, 400);
    }

    const existing = await env.DB.prepare(
      "SELECT id FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1"
    )
      .bind(username, email)
      .first();

    if (existing) {
      return json({
        error: "That username or email is already registered."
      }, 409);
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);

    await env.DB.prepare(
      "INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)"
    )
      .bind(id, username, email, passwordHash)
      .run();

    return json({
      ok: true,
      message: "Account created successfully.",
      user: {
        id: id,
        username: username,
        email: email
      }
    }, 201);


  } catch (error) {
    console.error("Registration error:", error);

    return json({
      error: "Registration diagnostic",
      details: String(error?.message || error)
    }, 500);
  }
}
