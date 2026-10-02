const json = (data, status = 200, maxAge = 120) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${maxAge}` }
});

function xmlValue(entry, tag) {
  const escapedTag = tag.replace(":", "\\s*:");
  const match = entry.match(new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  if (!match) return "";
  return match[1].replace(/^\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*$/, "$1")
    .replace(/&#x([\\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export async function onRequestGet({ env, request }) {
  const channelId = (env?.YOUTUBE_CHANNEL_ID || "UCppj1XG4Mj_TXCpeJWxs_Gg").trim();
  if (!/^UC[a-zA-Z0-9_-]{22}$/.test(channelId)) {
    return json({ status: "unconfigured", fetchedAt: new Date().toISOString(), videos: [] });
  }
  const cache = caches.default;
  const cacheKey = new Request(`https://senseifr-cache.invalid/youtube/${encodeURIComponent(channelId)}`);
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const cached = forceRefresh ? null : await cache.match(cacheKey);
  if (cached) return cached;
  try {
    const feedUrl = new URL("https://www.youtube.com/feeds/videos.xml");
    feedUrl.searchParams.set("channel_id", channelId);
    const response = await fetch(feedUrl, { headers: { accept: "application/atom+xml, application/xml" } });
    if (!response.ok) return json({ status: "api_error", fetchedAt: new Date().toISOString(), videos: [] });
    const xml = await response.text();
    const videos = [...xml.matchAll(/<entry\\b[^>]*>([\\s\\S]*?)<\\/entry>/gi)]
      .map(([, entry]) => {
        const id = xmlValue(entry, "yt:videoId");
        return id ? { id, title: xmlValue(entry, "title"), publishedAt: xmlValue(entry, "published"), thumbnail: `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg` } : null;
      }).filter(Boolean).slice(0, 6);
    const result = json({ status: "ok", fetchedAt: new Date().toISOString(), videos }, 200, 1800);
    await cache.put(cacheKey, result.clone());
    return result;
  } catch {
    return json({ status: "unavailable", fetchedAt: new Date().toISOString(), videos: [] });
  }
}
