
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

  return await env.DB.prepare(`
    SELECT users.id
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
    LIMIT 1
  `)
    .bind(tokenHash, new Date().toISOString())
    .first();
}

function contentType(key) {
  const extension = key.split(".").pop().toLowerCase();

  const types = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    flac: "audio/flac",
    webm: "audio/webm"
  };

  return types[extension] || "application/octet-stream";
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB || !env.MUSIC_BUCKET) {
      return json({ error: "Storage unavailable." }, 503);
    }

    const url = new URL(request.url);
    const trackId = url.searchParams.get("id");

    if (!trackId) {
      return json({ error: "Track ID is required." }, 400);
    }

    const track = await env.DB.prepare(`
      SELECT
        id,
        owner_id,
        storage_key,
        visibility,
        status
      FROM tracks
      WHERE id = ?
      LIMIT 1
    `)
      .bind(trackId)
      .first();

    if (!track || track.status !== "ready") {
      return json({ error: "Track not found." }, 404);
    }

    let authorized = track.visibility === "public";

    if (!authorized) {
      const user = await getUser(request, env);
      authorized = !!user && user.id === track.owner_id;
    }

    if (!authorized) {
      return json({ error: "You are not authorized to play this track." }, 403);
    }

    const rangeHeader = request.headers.get("Range");
    let range = undefined;
    let start = 0;
    let end = null;

    if (rangeHeader) {
      const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);

      if (!match) {
        return new Response(null, {
          status: 416,
          headers: { "Accept-Ranges": "bytes" }
        });
      }

      if (match[1] === "" && match[2] === "") {
        return json({ error: "Invalid byte range." }, 416);
      }

      if (match[1] === "") {
        range = { suffix: Number(match[2]) };
      } else {
        start = Number(match[1]);
        end = match[2] === "" ? undefined : Number(match[2]);

        range = {
          offset: start,
          ...(end !== undefined ? { length: end - start + 1 } : {})
        };
      }
    }

    const object = await env.MUSIC_BUCKET.get(
      track.storage_key,
      range ? { range } : {}
    );

    if (!object) {
      return json({ error: "Audio file not found." }, 404);
    }

    const totalSize = object.size;

    if (rangeHeader && range && range.offset !== undefined) {
      if (
        start >= totalSize ||
        (end !== null && end < start)
      ) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${totalSize}`,
            "Accept-Ranges": "bytes"
          }
        });
      }

      end = end === null
        ? totalSize - 1
        : Math.min(end, totalSize - 1);
    }

    const headers = new Headers();

    object.writeHttpMetadata(headers);

    headers.set("Content-Type", headers.get("Content-Type") || contentType(track.storage_key));
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "private, no-store");
    headers.set("Content-Disposition", "inline");

    if (object.httpEtag) {
      headers.set("ETag", object.httpEtag);
    }

    if (rangeHeader) {
      let responseStart;
      let responseEnd;

      if (range.suffix !== undefined) {
        responseStart = Math.max(0, totalSize - range.suffix);
        responseEnd = totalSize - 1;
      } else {
        responseStart = start;
        responseEnd = end;
      }

      const length = responseEnd - responseStart + 1;

      headers.set("Content-Length", String(length));
      headers.set(
        "Content-Range",
        `bytes ${responseStart}-${responseEnd}/${totalSize}`
      );

      return new Response(object.body, {
        status: 206,
        headers
      });
    }

    headers.set("Content-Length", String(totalSize));

    return new Response(object.body, {
      status: 200,
      headers
    });

  } catch (error) {
    console.error("Track streaming error:", error);

    return json({
      error: "Unable to stream this track."
    }, 500);
  }
}

