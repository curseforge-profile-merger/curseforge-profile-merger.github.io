/* global JSZip */
const $ = (id) => document.getElementById(id);
const state = { A: null, B: null, analysis: null, outputUrl: null };

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

async function readProfile(file, label) {
  if (!file) throw new Error(`Не выбран профиль ${label}`);
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  let manifestPath = names.find(n => normalizeZipPath(n) === "manifest.json");
  let prefix = "";

  if (!manifestPath) {
    const candidates = names.filter(n => normalizeZipPath(n).endsWith("/manifest.json"));
    if (candidates.length !== 1) throw new Error(`В профиле ${label} не найден однозначный manifest.json в корне ZIP.`);
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

  return { label, file, zip, manifest, manifestPath, prefix };
}

function profileSummary(p) {
  return {
    name: p.manifest.name || p.file.name,
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
      <div class="stat"><small>Профиль A</small><strong>${esc(x.sa.name)}</strong><br>${esc(x.sa.mc)} · ${esc(x.sa.loader)} · ${x.sa.mods} модов</div>
      <div class="stat"><small>Профиль B</small><strong>${esc(x.sb.name)}</strong><br>${esc(x.sb.mc)} · ${esc(x.sb.loader)} · ${x.sb.mods} модов</div>
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
  $("mergeBtn").disabled = true;
  $("result").classList.remove("hidden");
  $("result").innerHTML = "Проверяю ZIP…";
  try {
    state.A = await readProfile($("fileA").files[0], "A");
    state.B = await readProfile($("fileB").files[0], "B");
    state.analysis = analyzeProfiles(state.A, state.B);
    renderAnalysis(state.analysis);
  } catch (e) {
    state.analysis = null;
    $("result").innerHTML = `<p class="error"><strong>Ошибка:</strong> ${esc(e.message)}</p>`;
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
    const relative = name.slice(prefix.length); // overrides/...
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
  // Ensure folder exists even when empty.
  if (![...existing].some(x => x.startsWith("overrides/"))) out.folder("overrides");

  const report = {
    createdAt: new Date().toISOString(),
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
  const reportBlob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const reportUrl = URL.createObjectURL(reportBlob);

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
      <a id="downloadLink" href="${state.outputUrl}" download="${esc(safeName)}.zip"><button>Скачать ${esc(safeName)}.zip</button></a>
      <a href="${reportUrl}" download="${esc(safeName)}-merge-report.json"><button class="secondary">Скачать отчёт</button></a>
    </div>
    <p class="notice">Импортируемый ZIP содержит только <code>manifest.json</code> и <code>overrides/</code>. Перед импортом CurseForge может показать предупреждение, если в overrides есть сторонние файлы.</p>
  `;
}

function bindFile(inputId, nameId, dropId) {
  const input = $(inputId);
  const name = $(nameId);
  const drop = $(dropId);
  input.addEventListener("change", () => {
    name.textContent = input.files[0]?.name || "Выберите ZIP";
    state.analysis = null;
    $("mergeBtn").disabled = true;
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

bindFile("fileA", "nameA", "dropA");
bindFile("fileB", "nameB", "dropB");
$("analyzeBtn").addEventListener("click", analyze);
$("mergeBtn").addEventListener("click", merge);
$("forceIncompatible").addEventListener("change", () => {
  if (state.analysis) renderAnalysis(state.analysis);
});
