const json = (data, status = 200, maxAge = 120) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${maxAge}` }
});

export async function onRequestGet({ env, request }) {
  const accessToken = (env.TIKTOK_ACCESS_TOKEN || "").trim();
  const fetchedAt = () => new Date().toISOString();
  if (!accessToken) return json({ status: "unconfigured", fetchedAt: fetchedAt(), videos: [] });

  const cache = caches.default;
  const cacheKey = new Request("https://senseifr-cache.invalid/tiktok/recent");
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const cached = forceRefresh ? null : await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const fields = "id,title,video_description,cover_image_url,share_url,create_time";
    const response = await fetch(`https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({ max_count: 20 }),
      cf: forceRefresh ? { cacheTtl: 0, cacheEverything: true } : { cacheTtl: 600, cacheEverything: true },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) {
      const result = json({
        status: response.status === 401 ? "auth_error" : "api_error",
        fetchedAt: fetchedAt(), videos: []
      }, 200, 120);
      await cache.put(cacheKey, result.clone());
      return result;
    }
    const payload = await response.json();
    if (payload.error?.code && payload.error.code !== "ok") {
      const result = json({ status: "api_error", fetchedAt: fetchedAt(), videos: [] }, 200, 120);
      await cache.put(cacheKey, result.clone());
      return result;
    }
    const videos = (Array.isArray(payload.data?.videos) ? payload.data.videos : [])
      .slice(0, 5)
      .filter((video) => typeof video.id === "string" && video.id)
      .map((video) => ({
        id: video.id,
        title: video.title || video.video_description || "",
        thumbnail: video.cover_image_url || "",
        shareUrl: video.share_url || "",
        createdAt: Number.isFinite(Number(video.create_time))
          ? new Date(Number(video.create_time) * 1000).toISOString()
          : ""
      }));
    const result = json({ status: "ok", fetchedAt: fetchedAt(), videos }, 200, 600);
    await cache.put(cacheKey, result.clone());
    return result;
  } catch {
    return json({ status: "unavailable", fetchedAt: fetchedAt(), videos: [] });
  }
}
