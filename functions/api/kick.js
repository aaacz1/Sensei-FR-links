const KICK_URL = "https://kick.com/api/v2/channels/sensei_fr";
const GITHUB_STATUS_URL = "https://api.github.com/repos/aaacz1/Sensei-FR-links/commits/main/status";
const STATUS_TTL = 60;
const MAX_STATUS_AGE = 12 * 60 * 1000;

function jsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": status === 200
        ? "public, max-age=60, s-maxage=60, stale-while-revalidate=120"
        : "no-store"
    }
  });
}

async function readKick() {
  const upstream = await fetch(KICK_URL, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
      origin: "https://kick.com",
      referer: "https://kick.com/"
    },
    cf: { cacheTtl: STATUS_TTL, cacheEverything: true },
    signal: AbortSignal.timeout(7000)
  });
  if (!upstream.ok) throw new Error(`Kick returned ${upstream.status}`);
  const data = await upstream.json();
  if (!data || typeof data !== "object" || !Object.prototype.hasOwnProperty.call(data, "livestream")) {
    throw new Error("Unexpected Kick response");
  }
  const stream = data.livestream;
  if (stream !== null && (typeof stream !== "object" || typeof stream.is_live !== "boolean")) {
    throw new Error("Unexpected livestream response");
  }
  return { available: true, live: stream?.is_live === true, checkedAt: new Date().toISOString(), source: "kick" };
}

async function readGithubFallback() {
  const response = await fetch(GITHUB_STATUS_URL, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "Sensei-FR status monitor"
    },
    cf: { cacheTtl: 30, cacheEverything: true },
    signal: AbortSignal.timeout(6000)
  });
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  const result = await response.json();
  const status = (Array.isArray(result.statuses) ? result.statuses : [])
    .filter((item) => item.context === "kick/live-status")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!status?.created_at || !status.description) throw new Error("No GitHub status found");
  const statusCreatedAt = Date.parse(status.created_at);
  if (!Number.isFinite(statusCreatedAt) || Date.now() - statusCreatedAt > MAX_STATUS_AGE || statusCreatedAt > Date.now() + 60_000) {
    throw new Error("GitHub status is stale");
  }
  const match = /^(LIVE|OFFLINE|UNAVAILABLE)\\|(.+)$/.exec(status.description);
  if (!match || match[1] === "UNAVAILABLE" || status.state !== "success") {
    throw new Error("GitHub status is unavailable");
  }
  const checkedAt = Date.parse(match[2]);
  if (!Number.isFinite(checkedAt) || Math.abs(statusCreatedAt - checkedAt) > 2 * 60 * 1000) {
    throw new Error("GitHub status timestamp is invalid");
  }
  return { available: true, live: match[1] === "LIVE", checkedAt: new Date(checkedAt).toISOString(), source: "github" };
}

export async function onRequestGet() {
  try {
    return jsonResponse(await readKick());
  } catch (kickError) {
    console.warn("[api/kick] Kick check failed; trying GitHub status fallback:", kickError instanceof Error ? kickError.message : String(kickError));
  }

  try {
    return jsonResponse(await readGithubFallback());
  } catch (fallbackError) {
    console.error("[api/kick] Kick and GitHub checks failed:", fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
    return jsonResponse({
      available: false,
      live: null,
      checkedAt: new Date().toISOString(),
      source: "unavailable",
      url: "https://kick.com/sensei_fr"
    }, 503);
  }
}
