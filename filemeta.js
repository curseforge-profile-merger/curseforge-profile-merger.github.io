/* Resolve CurseForge file IDs to human-readable filenames using the public download redirect. */
(() => {
  const CACHE_KEY = "cfpm-file-names-v1";
  const MAX_CACHE_ENTRIES = 800;
  const CONCURRENCY = 6;
  const memoryCache = new Map();

  function readPersistentCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string" && value) memoryCache.set(key, value);
      }
    } catch {
      // Cache is optional.
    }
  }

  function persistCache() {
    try {
      const entries = [...memoryCache.entries()].slice(-MAX_CACHE_ENTRIES);
      localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch {
      // Ignore storage quota/privacy mode failures.
    }
  }

  function keyFor(projectID, fileID) {
    return `${projectID}:${fileID}`;
  }

  function fileToProjectMap(analysis) {
    const map = new Map();
    for (const source of [analysis?.mapA, analysis?.mapB]) {
      if (!source) continue;
      for (const [projectID, entry] of source.entries()) {
        if (entry?.fileID != null) map.set(String(entry.fileID), String(projectID));
      }
    }
    return map;
  }

  function parseFileID(anchor) {
    const href = anchor.getAttribute("href") || "";
    const match = href.match(/\/files\/(\d+)(?:[/?#]|$)/);
    if (match) return match[1];
    const textMatch = anchor.textContent.match(/#(\d+)/);
    return textMatch?.[1] || null;
  }

  function filenameFromUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const last = url.pathname.split("/").filter(Boolean).at(-1) || "";
      const decoded = decodeURIComponent(last);
      if (!decoded || /^download$/i.test(decoded) || /^\d+$/.test(decoded)) return null;
      return decoded;
    } catch {
      return null;
    }
  }

  async function resolveFilename(projectID, fileID) {
    const key = keyFor(projectID, fileID);
    if (memoryCache.has(key)) return memoryCache.get(key);

    const endpoint = `https://www.curseforge.com/api/v1/mods/${encodeURIComponent(projectID)}/files/${encodeURIComponent(fileID)}/download`;
    try {
      const response = await fetch(endpoint, {
        method: "HEAD",
        redirect: "follow",
        credentials: "omit",
        cache: "force-cache"
      });
      const filename = filenameFromUrl(response.url);
      if (filename) {
        memoryCache.set(key, filename);
        persistCache();
        return filename;
      }
    } catch {
      // Keep the exact fileID link as a graceful fallback.
    }
    return null;
  }

  function renderFilename(anchor, filename, fileID) {
    if (!anchor?.isConnected || !filename) return;
    anchor.replaceChildren();

    const name = document.createElement("span");
    name.className = "human-file-name";
    name.textContent = filename;

    const id = document.createElement("small");
    id.className = "human-file-id";
    id.textContent = `#${fileID} ↗`;

    anchor.append(name, id);
    anchor.title = `CurseForge file #${fileID}: ${filename}`;
    anchor.dataset.filemeta = "ready";
  }

  async function hydrateAnchor(anchor, fileProjects) {
    if (!anchor?.isConnected || anchor.dataset.filemeta === "ready" || anchor.dataset.filemeta === "loading") return;
    const fileID = parseFileID(anchor);
    const projectID = fileID ? fileProjects.get(String(fileID)) : null;
    if (!fileID || !projectID) return;

    anchor.dataset.filemeta = "loading";
    anchor.classList.add("version-loading");
    const filename = await resolveFilename(projectID, fileID);
    anchor.classList.remove("version-loading");

    if (filename) renderFilename(anchor, filename, fileID);
    else anchor.dataset.filemeta = "failed";
  }

  async function runPool(items, worker, limit = CONCURRENCY) {
    let cursor = 0;
    async function runner() {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  }

  async function hydrateVersionNames(analysis = state?.analysis) {
    if (!analysis) return;
    const anchors = [...document.querySelectorAll(".mod-comparison a.version-link")];
    if (!anchors.length) return;
    const fileProjects = fileToProjectMap(analysis);
    await runPool(anchors, anchor => hydrateAnchor(anchor, fileProjects));
  }

  readPersistentCache();

  const previousRenderAnalysis = renderAnalysis;
  renderAnalysis = function (...args) {
    const value = previousRenderAnalysis.apply(this, args);
    const analysis = args[0] || state?.analysis;
    queueMicrotask(() => hydrateVersionNames(analysis));
    return value;
  };
})();
