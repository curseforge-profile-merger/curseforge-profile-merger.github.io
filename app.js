/* global JSZip */
const $ = (id) => document.getElementById(id);
const state = { A: null, B: null, analysis: null, outputUrl: null, reportUrl: null };
const SHARE_RESOLVER_URL = String(window.CFPM_SHARE_RESOLVER || "").trim();
const MAX_SHARED_PROFILE_BYTES = 300 * 1024 * 1024;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function primaryLoader(manifest) {
  const loaders = manifest?.minecraft?.modLoaders || [];
  return loaders.find(x => x.primary)?.id || loaders[0]?.id || "—";
}

function loaderFamily(loaderId) {
  if (!loaderId || loaderId === "—") return "unknown";
  const s = loaderId.toLowerCase();
  if (s.startsWith("neoforge-")) return "neoforge";
  if (s.startsWith("forge-")) return "forge";
  if (s.startsWith("fabric-")) return "fabric";
  if (s.startsWith("quilt-")) return "quilt";
  return s.split("-")[0] || "unknown";
}

function normalizeZipPath(path) {
  const p = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (p.split("/").some(x => x === "..")) throw new Error(`Небезопасный путь в ZIP: ${path}`);
  return p;
}

function parseShareCode(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  let code = value;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    if ((host === "www.curseforge.com" || host === "curseforge.com") && parts[0] === "minecraft" && parts[1] === "share") {
      code = parts[2] || "";
    } else if (host === "api.curseforge.com" && parts[0] === "v1" && parts[1] === "shared-profile") {
      code = parts[2] || "";
    } else {
      throw new Error("Нужна CurseForge share-ссылка вида curseforge.com/minecraft/share/…");
    }
  } catch (e) {
    if (/^https?:\/\//i.test(value)) throw e;
  }

  code = code.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(code)) {
    throw new Error("Некорректный CurseForge share-код.");
  }
  return code;
}

function setSourceStatus(label, text, kind = "") {
  const el = $(`sourceStatus${label}`);
  el.textContent = text || "";
  el.className = `source-status ${kind}`.trim();
}

async function fetchSharedProfile(raw, label) {
  const code = parseShareCode(raw);
  if (!code) throw new Error(`Не указан share-код профиля ${label}.`);
  if (!SHARE_RESOLVER_URL) {
    setSourceStatus(label, "Автоимпорт share-ссылок ещё не настроен", "error");
    throw new Error(
      `Профиль ${label}: для share-ссылок нужен resolver. Пока можно экспортировать профиль из CurseForge в ZIP и выбрать его здесь.`
    );
  }

  setSourceStatus(label, `Получаю ссылку на профиль ${code}…`, "loading");
  const resolverUrl = new URL(SHARE_RESOLVER_URL, window.location.href);
  resolverUrl.searchParams.set("code", code);

  let resolved;
  try {
    const response = await fetch(resolverUrl, { cache: "no-store", credentials: "omit" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404 || response.status === 410) {
        throw new Error(data.error || `share-код ${code} не найден или уже истёк`);
      }
      throw new Error(data.error || `resolver вернул HTTP ${response.status}`);
    }
    if (!data.url) throw new Error("resolver не вернул CDN-адрес");
    resolved = new URL(data.url);
    if (resolved.protocol !== "https:" || !(resolved.hostname === "shared-profile-media.forgecdn.net" || resolved.hostname.endsWith(".forgecdn.net"))) {
      throw new Error("resolver вернул неожиданный адрес");
    }
  } catch (e) {
    setSourceStatus(label, "Не удалось разрешить share-ссылку", "error");
    throw new Error(`Профиль ${label}: ${e.message}. Можно использовать экспортированный ZIP.`);
  }

  setSourceStatus(label, `Скачиваю ZIP ${code} напрямую с CurseForge CDN…`, "loading");
  let response;
  try {
    response = await fetch(resolved.href, { cache: "no-store", credentials: "omit" });
  } catch (e) {
    setSourceStatus(label, "Не удалось скачать ZIP с CurseForge CDN", "error");
    throw new Error(`Профиль ${label}: не удалось скачать ZIP с CurseForge CDN (${e.message}).`);
  }

  if (!response.ok) {
    setSourceStatus(label, `CDN вернул HTTP ${response.status}`, "error");
    throw new Error(`Профиль ${label}: CurseForge CDN вернул HTTP ${response.status}.`);
  }

  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_SHARED_PROFILE_BYTES) {
    throw new Error(`Профиль ${label}: share-ZIP слишком большой (${Math.round(declaredSize / 1024 / 1024)} МБ).`);
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_SHARED_PROFILE_BYTES) {
    throw new Error(`Профиль ${label}: share-ZIP слишком большой (${Math.round(bytes.byteLength / 1024 / 1024)} МБ).`);
  }

  const file = new File([bytes], `curseforge-share-${code}.zip`, { type: "application/zip" });
  setSourceStatus(label, `Загружено · ${code} · ${(bytes.byteLength / 1024 / 1024).toFixed(1)} МБ`, "ok");
  return { file, sourceType: "share", sourceLabel: `CurseForge share ${code}`, shareCode: code };
}

async function resolveSource(label) {
  const share = $(`share${label}`).value.trim();
  const localFile = $(`file${label}`).files[0];
  if (share) return fetchSharedProfile(share, label);
  if (localFile) {
    setSourceStatus(label, `Локальный ZIP · ${localFile.name}`, "ok");
    return { file: localFile, sourceType: "local", sourceLabel: localFile.name, shareCode: null };
  }
  throw new Error(`Не выбран профиль ${label}: вставьте share-ссылку или выберите ZIP.`);
}

async function readProfile(source, label) {
  if (!source?.file) throw new Error(`Не выбран профиль ${label}`);
  const file = source.file;
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    throw new Error(`Профиль ${label}: полученный файл не удалось открыть как ZIP: ${e.message}`);
  }

  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  let manifestPath = names.find(n => normalizeZipPath(n) === "manifest.json");
  let prefix = "";

  if (!manifestPath) {
    const candidates = names.filter(n => normalizeZipPath(n).endsWith("/manifest.json"));
    if (candidates.length !== 1) throw new Error(`В профиле ${label} не найден однозначный manifest.json.`);
    manifestPath = candidates[0];
    prefix = normalizeZipPath(manifestPath).slice(0, -"manifest.json".length);
  }

  let manifest;
  try {
    manifest = JSON.parse(await zip.file(manifestPath).async("string"));
  } catch (e) {
    throw new Error(`Профиль ${label}: manifest.json не удалось прочитать: ${e.message}`);
  }

  if (!Array.isArray(manifest.files)) throw new Error(`Профиль ${label}: manifest.files отсутствует или не является массивом.`);
  if (!manifest.minecraft?.version) throw new Error(`Профиль ${label}: отсутствует minecraft.version.`);

  const seen = new Set();
  for (const entry of manifest.files) {
    if (entry.projectID == null || entry.fileID == null) throw new Error(`Профиль ${label}: в manifest.files есть запись без projectID/fileID.`);
    const key = String(entry.projectID);
    if (seen.has(key)) throw new Error(`Профиль ${label}: projectID ${entry.projectID} встречается несколько раз.`);
    seen.add(key);
  }

  return { label, ...source, zip, manifest, manifestPath, prefix };
}

function profileSummary(p) {
  return {
    name: p.manifest.name || p.sourceLabel || p.file.name,
    source: p.sourceType === "share" ? `share:${p.shareCode}` : p.file.name,
    mc: p.manifest.minecraft.version,
    loader: primaryLoader(p.manifest),
    loaderFamily: loaderFamily(primaryLoader(p.manifest)),
    mods: p.manifest.files.length
  };
}

function analyzeProfiles(A, B) {
  const sa = profileSummary(A);
  const sb = profileSummary(B);
  const mapA = new Map(A.manifest.files.map(x => [String(x.projectID), x]));
  const mapB = new Map(B.manifest.files.map(x => [String(x.projectID), x]));

  const onlyA = [...mapA.keys()].filter(k => !mapB.has(k));
  const onlyB = [...mapB.keys()].filter(k => !mapA.has(k));
  const same = [];
  const conflicts = [];
  for (const [projectID, a] of mapA) {
    const b = mapB.get(projectID);
    if (!b) continue;
    if (String(a.fileID) === String(b.fileID)) same.push({ projectID, fileID: a.fileID });
    else conflicts.push({ projectID, fileA: a.fileID, fileB: b.fileID });
  }

  const mcCompatible = sa.mc === sb.mc;
  const loaderCompatible = sa.loaderFamily === sb.loaderFamily;
  return { sa, sb, mapA, mapB, onlyA, onlyB, same, conflicts, mcCompatible, loaderCompatible };
}

function renderAnalysis(x) {
  const compatible = x.mcCompatible && x.loaderCompatible;
  const conflictRows = x.conflicts.slice(0, 50).map(c =>
    `<tr><td>${esc(c.projectID)}</td><td>${esc(c.fileA)}</td><td>${esc(c.fileB)}</td></tr>`
  ).join("");

  $("result").classList.remove("hidden");
  $("result").innerHTML = `
    <div class="status ${compatible ? "ok" : "bad"}">${compatible ? "✓ Базовая совместимость профилей совпадает" : "⚠ Профили различаются по Minecraft или modloader"}</div>
    <div class="summary">
      <div class="stat"><small>Профиль A · ${esc(x.sa.source)}</small><strong>${esc(x.sa.name)}</strong><br>${esc(x.sa.mc)} · ${esc(x.sa.loader)} · ${x.sa.mods} модов</div>
      <div class="stat"><small>Профиль B · ${esc(x.sb.source)}</small><strong>${esc(x.sb.name)}</strong><br>${esc(x.sb.mc)} · ${esc(x.sb.loader)} · ${x.sb.mods} модов</div>
      <div class="stat"><small>Только в A / только в B</small><strong>${x.onlyA.length} / ${x.onlyB.length}</strong></div>
      <div class="stat"><small>Общие / конфликт версий</small><strong>${x.same.length} / ${x.conflicts.length}</strong></div>
    </div>
    ${!x.mcCompatible ? `<p class="error">Minecraft: A=${esc(x.sa.mc)}, B=${esc(x.sb.mc)}</p>` : ""}
    ${!x.loaderCompatible ? `<p class="error">Modloader: A=${esc(x.sa.loader)}, B=${esc(x.sb.loader)}</p>` : ""}
    ${x.conflicts.length ? `
      <details>
        <summary>Конфликты версий (${x.conflicts.length})</summary>
        <table><thead><tr><th>projectID</th><th>fileID A</th><th>fileID B</th></tr></thead><tbody>${conflictRows}</tbody></table>
        ${x.conflicts.length > 50 ? `<p class="notice">Показаны первые 50 конфликтов.</p>` : ""}
      </details>` : ""}
    <p class="notice">При сборке запись базового профиля выигрывает любой конфликт одного и того же <code>projectID</code>.</p>
  `;

  $("mergeBtn").disabled = !compatible && !$("forceIncompatible").checked;
}

async function analyze() {
  $("analyzeBtn").disabled = true;
  $("mergeBtn").disabled = true;
  $("result").classList.remove("hidden");
  $("result").innerHTML = "Загружаю и проверяю профили…";
  try {
    const [sourceA, sourceB] = await Promise.all([resolveSource("A"), resolveSource("B")]);
    [state.A, state.B] = await Promise.all([readProfile(sourceA, "A"), readProfile(sourceB, "B")]);
    state.analysis = analyzeProfiles(state.A, state.B);
    renderAnalysis(state.analysis);
  } catch (e) {
    state.analysis = null;
    $("result").innerHTML = `<p class="error"><strong>Ошибка:</strong> ${esc(e.message)}</p>`;
  } finally {
    $("analyzeBtn").disabled = false;
  }
}

function filesMap(profile) {
  return new Map(profile.manifest.files.map(x => [String(x.projectID), { ...x }]));
}

async function addOverrides(targetZip, profile, existing, collisions, sourceLabel) {
  const prefix = profile.prefix || "";
  const root = `${prefix}overrides/`;
  for (const [rawName, entry] of Object.entries(profile.zip.files)) {
    if (entry.dir) continue;
    const name = normalizeZipPath(rawName);
    if (!name.startsWith(root)) continue;
    const relative = name.slice(prefix.length);
    if (!relative.startsWith("overrides/") || relative === "overrides/") continue;
    if (existing.has(relative)) {
      collisions.push({ path: relative, source: sourceLabel });
      continue;
    }
    const bytes = await entry.async("uint8array");
    targetZip.file(relative, bytes);
    existing.add(relative);
  }
}

async function merge() {
  if (!state.analysis) await analyze();
  if (!state.analysis) return;

  const force = $("forceIncompatible").checked;
  if ((!state.analysis.mcCompatible || !state.analysis.loaderCompatible) && !force) {
    renderAnalysis(state.analysis);
    return;
  }

  $("mergeBtn").disabled = true;
  try {
    const baseLabel = $("baseProfile").value;
    const addonLabel = baseLabel === "A" ? "B" : "A";
    const base = state[baseLabel];
    const addon = state[addonLabel];
    const baseMap = filesMap(base);
    const addonMap = filesMap(addon);
    const added = [];
    const keptConflicts = [];

    for (const [projectID, entry] of addonMap) {
      if (!baseMap.has(projectID)) {
        baseMap.set(projectID, { ...entry });
        added.push({ projectID, fileID: entry.fileID });
      } else {
        const current = baseMap.get(projectID);
        if (String(current.fileID) !== String(entry.fileID)) {
          keptConflicts.push({ projectID, kept: current.fileID, ignored: entry.fileID });
        }
      }
    }

    const manifest = structuredClone(base.manifest);
    manifest.files = [...baseMap.values()];
    const chosenName = $("outputName").value.trim();
    manifest.name = chosenName || `${manifest.name || "CurseForge profile"} + merged`;

    const out = new JSZip();
    out.file("manifest.json", JSON.stringify(manifest, null, 2));

    const existing = new Set();
    const collisions = [];
    await addOverrides(out, base, existing, collisions, baseLabel);
    if ($("mergeOverrides").checked) {
      await addOverrides(out, addon, existing, collisions, addonLabel);
    }
    if (![...existing].some(x => x.startsWith("overrides/"))) out.folder("overrides");

    const report = {
      createdAt: new Date().toISOString(),
      sources: {
        A: { type: state.A.sourceType, label: state.A.sourceLabel, shareCode: state.A.shareCode },
        B: { type: state.B.sourceType, label: state.B.sourceLabel, shareCode: state.B.shareCode }
      },
      baseProfile: baseLabel,
      addonProfile: addonLabel,
      minecraft: manifest.minecraft,
      totalMods: manifest.files.length,
      addedMods: added,
      conflictsKeptFromBase: keptConflicts,
      overrideStrategy: $("mergeOverrides").checked ? "base + missing files from addon" : "base only",
      overrideCollisionsSkipped: collisions,
      warning: force && (!state.analysis.mcCompatible || !state.analysis.loaderCompatible)
        ? "Merged despite different Minecraft/modloader compatibility."
        : null
    };

    if (state.reportUrl) URL.revokeObjectURL(state.reportUrl);
    const reportBlob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    state.reportUrl = URL.createObjectURL(reportBlob);

    const blob = await out.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
    state.outputUrl = URL.createObjectURL(blob);

    const safeName = manifest.name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "merged-profile";
    $("result").classList.remove("hidden");
    $("result").innerHTML = `
      <div class="status ok">✓ ZIP собран</div>
      <div class="summary">
        <div class="stat"><small>Основа</small><strong>${esc(baseLabel)}</strong></div>
        <div class="stat"><small>Всего модов</small><strong>${manifest.files.length}</strong></div>
        <div class="stat"><small>Добавлено из ${esc(addonLabel)}</small><strong>${added.length}</strong></div>
        <div class="stat"><small>Конфликтов оставлено из ${esc(baseLabel)}</small><strong>${keptConflicts.length}</strong></div>
      </div>
      <div class="actions">
        <a href="${state.outputUrl}" download="${esc(safeName)}.zip"><button>Скачать ${esc(safeName)}.zip</button></a>
        <a href="${state.reportUrl}" download="${esc(safeName)}-merge-report.json"><button class="secondary">Скачать отчёт</button></a>
      </div>
      <p class="notice">Импортируемый ZIP содержит <code>manifest.json</code> и <code>overrides/</code>. Затем его можно импортировать в CurseForge как профиль.</p>
    `;
  } finally {
    $("mergeBtn").disabled = false;
  }
}

function invalidate() {
  state.analysis = null;
  $("mergeBtn").disabled = true;
}

function bindSource(label) {
  const input = $(`file${label}`);
  const share = $(`share${label}`);
  const name = $(`name${label}`);
  const drop = $(`drop${label}`);

  input.addEventListener("change", () => {
    if (input.files[0]) share.value = "";
    name.textContent = input.files[0]?.name || "Выберите ZIP";
    setSourceStatus(label, input.files[0] ? `Локальный ZIP · ${input.files[0].name}` : "");
    invalidate();
  });

  share.addEventListener("input", () => {
    if (share.value.trim() && input.files.length) {
      input.value = "";
      name.textContent = "Выберите ZIP";
    }
    setSourceStatus(label, share.value.trim() ? "Share-ссылка будет загружена при проверке" : "");
    invalidate();
  });

  for (const evt of ["dragenter", "dragover"]) {
    drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.add("drag"); });
  }
  for (const evt of ["dragleave", "drop"]) {
    drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.remove("drag"); });
  }
  drop.addEventListener("drop", e => {
    const file = [...e.dataTransfer.files].find(f => f.name.toLowerCase().endsWith(".zip"));
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change"));
  });
}

bindSource("A");
bindSource("B");
$("analyzeBtn").addEventListener("click", analyze);
$("mergeBtn").addEventListener("click", merge);
$("forceIncompatible").addEventListener("change", () => {
  if (state.analysis) renderAnalysis(state.analysis);
});
