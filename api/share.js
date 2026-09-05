const ALLOWED_ORIGINS = new Set([
  "https://curseforge-profile-merger.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080"
]);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  const code = String(req.query.code || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(code)) {
    return res.status(400).json({ error: "Invalid CurseForge share code" });
  }

  try {
    const upstream = await fetch(`https://api.curseforge.com/v1/shared-profile/${encodeURIComponent(code)}`, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "curseforge-profile-merger/1.0" }
    });

    if (upstream.status === 404 || upstream.status === 410) {
      return res.status(upstream.status).json({ error: "Shared profile not found or expired" });
    }

    if (upstream.status < 300 || upstream.status >= 400) {
      return res.status(502).json({ error: `Unexpected CurseForge response: HTTP ${upstream.status}` });
    }

    const location = upstream.headers.get("location");
    if (!location) return res.status(502).json({ error: "CurseForge did not return a download location" });

    const target = new URL(location);
    if (target.protocol !== "https:" || !(target.hostname === "shared-profile-media.forgecdn.net" || target.hostname.endsWith(".forgecdn.net"))) {
      return res.status(502).json({ error: "Unexpected CurseForge download host" });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ url: target.href });
  } catch (error) {
    return res.status(502).json({ error: `Failed to resolve CurseForge profile: ${error.message}` });
  }
}
