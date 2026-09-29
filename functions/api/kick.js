const URL = "https://kick.com/api/v2/channels/sensei_fr";
export async function onRequestGet() {
  const checkedAt = new Date().toISOString();
  try {
    const upstream = await fetch(URL, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0",
        origin: "https://kick.com",
        referer: "https://kick.com/"
      },
      cf: { cacheTtl: 20, cacheEverything: true },
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
    return Response.json({
      available: true,
      live: stream?.is_live === true,
      checkedAt,
      url: "https://kick.com/sensei_fr"
    }, { headers: { "cache-control": "public, max-age=15, s-maxage=20" } });
  } catch {
    return Response.json({
      available: false, live: null, checkedAt, url: "https://kick.com/sensei_fr"
    }, { status:503, headers: { "cache-control":"no-store" } });
  }
}
