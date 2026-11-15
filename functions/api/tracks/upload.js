
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

async function getUser(request, env) {
  const cookie = request.headers.get("Cookie") || "";

  const match = cookie.match(
    /(?:^|;\s*)__Host-s7im3cl0ud_session=([a-f0-9]{64})(?:;|$)/
  );

  if (!match) return null;

  const tokenHash = await hashToken(match[1]);

  return await env.DB.prepare(
    `SELECT users.id, users.username
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?
       AND sessions.expires_at > ?
     LIMIT 1`
  )
    .bind(tokenHash, new Date().toISOString())
    .first();
}

export async function onRequestPost({ request, env }) {
  let storageKey = null;

  try {
    if (!env.DB || !env.MUSIC_BUCKET) {
      return json({ error: "Storage or database unavailable." }, 503);
    }

    const user = await getUser(request, env);

    if (!user) {
      return json({ error: "You must be logged in to upload." }, 401);
    }

    const form = await request.formData();

    const artistId = String(form.get("artist_id") || "").trim();
    const title = String(form.get("title") || "").trim();
    const description = String(form.get("description") || "").trim();
    const visibility = String(form.get("visibility") || "public");
    const downloadEnabled = form.get("download_enabled") === "true" ? 1 : 0;
    const audio = form.get("audio");

    if (!artistId || !title || !audio || typeof audio === "string") {
      return json({
        error: "Artist, title, and audio file are required."
      }, 400);
    }

    if (title.length > 120 || description.length > 2000) {
      return json({ error: "Title or description is too long." }, 400);
    }

    if (!["public", "private"].includes(visibility)) {
      return json({ error: "Invalid track visibility." }, 400);
    }

    const MAX_SIZE = 50 * 1024 * 1024;

    if (audio.size === 0 || audio.size > MAX_SIZE) {
      return json({
        error: "Audio must be larger than 0 bytes and no larger than 50 MB."
      }, 400);
    }

    const allowedExtensions = [
      "mp3", "m4a", "aac", "wav", "ogg", "flac", "webm"
    ];

    const filename = audio.name || "";
    const extension = filename.split(".").pop().toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      return json({
        error: "Unsupported audio format. Use MP3, M4A, AAC, WAV, OGG, FLAC, or WEBM."
      }, 400);
    }

    if (audio.type && !audio.type.startsWith("audio/")) {
      return json({ error: "The uploaded file must be audio." }, 400);
    }

    const artist = await env.DB.prepare(
      `SELECT id, display_name
       FROM artists
       WHERE id = ? AND user_id = ?
       LIMIT 1`
    )
      .bind(artistId, user.id)
      .first();

    if (!artist) {
      return json({
        error: "Artist not found or you do not own this artist profile."
      }, 403);
    }

    storageKey =
      `tracks/${user.id}/${crypto.randomUUID()}.${extension}`;

    const contentType = audio.type || "application/octet-stream";

    await env.MUSIC_BUCKET.put(
      storageKey,
      audio.stream(),
      {
        httpMetadata: {
          contentType,
          cacheControl: "private, no-store"
        },
        customMetadata: {
          ownerId: user.id,
          artistId: artist.id
        }
      }
    );

    const trackId = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO tracks (
        id,
        owner_id,
        artist_id,
        title,
        description,
        storage_key,
        visibility,
        status,
        download_enabled
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)`
    )
      .bind(
        trackId,
        user.id,
        artist.id,
        title,
        description,
        storageKey,
        visibility,
        downloadEnabled
      )
      .run();

    return json({
      ok: true,
      message: "Track uploaded successfully.",
      track: {
        id: trackId,
        artist: artist.display_name,
        title,
        visibility,
        status: "ready"
      }
    }, 201);

  } catch (error) {
    console.error("Track upload error:", error);

    if (storageKey && env.MUSIC_BUCKET) {
      try {
        await env.MUSIC_BUCKET.delete(storageKey);
      } catch (cleanupError) {
        console.error("R2 cleanup error:", cleanupError);
      }
    }

    return json({
      error: "Unable to upload track. Please try again."
    }, 500);
  }
}
