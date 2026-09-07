/* Human-readable CurseForge file versions via CFWidget's public JSON API. */
(() => {
  const CACHE_KEY = "cfpm-file-meta-v2";
  const MAX_CACHE_ENTRIES = 800;
  const CONCURRENCY = 3;
  const REQUEST_GAP_MS = 180;
  const memoryCache = new Map();

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function readPersistentCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      for (const [key, value] of Object.entries(parsed)) {
        if (value && typeof value === "object") memoryCache.set(key, value);
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

  async function resolveFileMeta(projectID, fileID) {
    const key = keyFor(projectID, fileID);
    if (memoryCache.has(key)) return memoryCache.get(key);

    const endpoint = `https://api.cfwidget.com/${encodeURIComponent(projectID)}?version=${encodeURIComponent(fileID)}`;
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        credentials: "omit",
        cache: "default"
      });
      if (!response.ok) return null;

      const data = await response.json();
      const download = data?.download;

      // CFWidget may fall back to another file when a requested version cannot be resolved.
      // Never show such a fallback as if it were the requested manifest file.
      if (!download || String(download.id) !== String(fileID)) return null;

      const meta = {
        display: String(download.display || "").trim(),
        name: String(download.name || "").trim(),
        url: String(download.url || "").trim(),
        type: String(download.type || "").trim(),
        versions: Array.isArray(download.versions) ? download.versions.map(String) : []
      };

      if (!meta.display && !meta.name) return null;
      memoryCache.set(key, meta);
      persistCache();
      return meta;
    } catch {
      // Exact fileID remains visible as a graceful fallback.
      return null;
    }
  }

  function renderFileMeta(anchor, meta, fileID) {
    if (!anchor?.isConnected || !meta) return;
    anchor.replaceChildren();

    const version = document.createElement("span");
    version.className = "human-file-version";
    version.textContent = meta.display || meta.name;
    anchor.append(version);

    if (meta.name && meta.name !== meta.display) {
      const filename = document.createElement("small");
      filename.className = "human-file-name";
      filename.textContent = meta.name;
      anchor.append(filename);
    }

    const id = document.createElement("small");
    id.className = "human-file-id";
    id.textContent = `#${fileID} ↗`;
    anchor.append(id);

    if (meta.url && /^https:\/\/www\.curseforge\.com\//i.test(meta.url)) anchor.href = meta.url;
    anchor.title = `CurseForge file #${fileID}${meta.name ? ` · ${meta.name}` : ""}`;
    anchor.dataset.filemeta = "ready";
  }

  async function hydrateAnchor(anchor, fileProjects) {
    if (!anchor?.isConnected || ["ready", "loading", "failed"].includes(anchor.dataset.filemeta)) return;
    const fileID = parseFileID(anchor);
    const projectID = fileID ? fileProjects.get(String(fileID)) : null;
    if (!fileID || !projectID) return;

    anchor.dataset.filemeta = "loading";
    anchor.classList.add("version-loading");
    const meta = await resolveFileMeta(projectID, fileID);
    anchor.classList.remove("version-loading");

    if (meta) renderFileMeta(anchor, meta, fileID);
    else anchor.dataset.filemeta = "failed";
  }

  async function runPool(items, worker, limit = CONCURRENCY) {
    let cursor = 0;
    async function runner() {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index]);
        await sleep(REQUEST_GAP_MS);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  }

  async function hydrateContainer(container, analysis = state?.analysis) {
    if (!container || !analysis) return;
    const anchors = [...container.querySelectorAll("a.version-link")];
    if (!anchors.length) return;
    const fileProjects = fileToProjectMap(analysis);
    await runPool(anchors, anchor => hydrateAnchor(anchor, fileProjects));
  }

  function bindLazyMetadata(analysis = state?.analysis) {
    const comparison = document.querySelector(".mod-comparison");
    if (!comparison || !analysis) return;

    for (const details of comparison.querySelectorAll("details.result-details")) {
      if (details.dataset.filemetaBound) continue;
      details.dataset.filemetaBound = "1";
      details.addEventListener("toggle", () => {
        if (details.open) hydrateContainer(details, analysis);
      });
      if (details.open) hydrateContainer(details, analysis);
    }
  }

  readPersistentCache();

  const previousRenderAnalysis = renderAnalysis;
  renderAnalysis = function (...args) {
    const value = previousRenderAnalysis.apply(this, args);
    const analysis = args[0] || state?.analysis;
    queueMicrotask(() => bindLazyMetadata(analysis));
    return value;
  };
})();
