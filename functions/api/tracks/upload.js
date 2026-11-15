
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

    // Authenticate the uploader.
    const user = await getUser(request, env);

    if (!user) {
      return json({ error: "You must be logged in to upload." }, 401);
    }

    // Read the submitted upload form.
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

    // Initial upload limit: 50 MB.
    const MAX_SIZE = 50 * 1024 * 1024;

    if (audio.size === 0 || audio.size > MAX_SIZE) {
      return json({
        error: "Audio must be larger than 0 bytes and no larger than 50 MB."
      }, 400);
    }

    // Only accept recognized audio formats.
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

    // Confirm the artist belongs to the logged-in user.
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

    // Generate a private, unpredictable R2 storage key.
    storageKey =
      `tracks/${user.id}/${crypto.randomUUID()}.${extension}`;

    const contentType = audio.type || "application/octet-stream";

    // Upload the actual audio file to R2.
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

    // Save track information in D1 after the R2 upload succeeds.
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
      VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?)`
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
        status: "published"
      }
    }, 201);

  } catch (error) {
    console.error("Track upload error:", error);

    // Remove the R2 object if saving its database record failed.
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

