export async function onRequestGet() {
  try {
    const upstream = await fetch("https://kick.com/api/v2/channels/sensei_fr", {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0", origin: "https://kick.com", referer: "https://kick.com/" },
      cf: { cacheTtl: 60, cacheEverything: true },
      signal: AbortSignal.timeout(8000)
    });
    if (!upstream.ok) throw new Error(`Kick returned ${upstream.status}`);
    const data = await upstream.json();
    if (!data || typeof data !== "object" || !("livestream" in data)) throw new Error("Kick response shape changed");
    const livestream = data.livestream;
    return Response.json({
      available: true,
      live: Boolean(livestream && typeof livestream === "object" && livestream.is_live === true),
      checkedAt: new Date().toISOString(),
      url: livestream?.is_live === true ? "https://kick.com/sensei_fr" : "https://kick.com/sensei_fr"
    }, { headers: { "cache-control": "public, max-age=60" } });
  } catch {
    return Response.json({ available: false, live: null, checkedAt: new Date().toISOString() }, {
      status: 503,
      headers: { "cache-control": "no-store" }
    });
  }
}
