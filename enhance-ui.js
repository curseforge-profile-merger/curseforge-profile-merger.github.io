/* UI enhancements: merge direction + readable mod comparison from CurseForge modlist.html. */
(() => {
  const baseSelect = document.getElementById("baseProfile");
  const result = document.getElementById("result");
  if (!baseSelect || !result) return;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function profileDisplayName(label) {
    const profile = state?.[label];
    return profile?.manifest?.name || `Профиль ${label}`;
  }

  function sourceRoleElement(label) {
    return document.getElementById(`sourceRole${label}`)
      || document.querySelector(`#drop${label} small`);
  }

  function ensureDirectionBox() {
    let box = document.getElementById("mergeDirection");
    if (box) return box;

    box = document.createElement("div");
    box.id = "mergeDirection";
    box.className = "merge-direction";
    baseSelect.closest(".field")?.insertAdjacentElement("afterend", box);
    return box;
  }

  function updateMergeDirection() {
    const base = baseSelect.value;
    const addon = base === "A" ? "B" : "A";

    const baseRole = sourceRoleElement(base);
    const addonRole = sourceRoleElement(addon);
    if (baseRole) baseRole.textContent = "Основа — сохраняются manifest и overrides";
    if (addonRole) addonRole.textContent = `Добавляем моды в профиль ${base}`;

    const box = ensureDirectionBox();
    box.innerHTML = `
      <div class="merge-node addon-node">
        <small>Добавляем</small>
        <strong>${escapeHtml(addon)} · ${escapeHtml(profileDisplayName(addon))}</strong>
      </div>
      <div class="merge-arrow" aria-hidden="true">→</div>
      <div class="merge-node base-node">
        <small>Основа</small>
        <strong>${escapeHtml(base)} · ${escapeHtml(profileDisplayName(base))}</strong>
        <span>его manifest / overrides сохраняются</span>
      </div>
    `;
  }

  function parseProjectLink(rawHref) {
    if (!rawHref) return null;
    try {
      const url = new URL(rawHref, window.location.href);
      const host = url.hostname.toLowerCase();
      const parts = url.pathname.split("/").filter(Boolean);
      let type = null;
      let slug = null;

      if (host === "www.curseforge.com" || host === "curseforge.com") {
        const mc = parts.indexOf("minecraft");
        if (mc >= 0) {
          type = parts[mc + 1] || null;
          slug = parts[mc + 2] || null;
        }
      } else if (host === "minecraft.curseforge.com") {
        type = parts[0] || null;
        slug = parts[1] || null;
      }

      if (!type || !slug) return null;
      if (!["mc-mods", "texture-packs", "modpacks", "worlds", "customization", "data-packs", "shaders", "shader-packs"].includes(type)) {
        return null;
      }

      return {
        type,
        slug,
        projectID: /^\d+$/.test(slug) ? slug : null,
        href: `https://www.curseforge.com/minecraft/${type}/${slug}`
      };
    } catch {
      return null;
    }
  }

  function splitModListLabel(text) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    const match = clean.match(/^(.*?)\s+\(by\s+(.+)\)$/i);
    return match
      ? { name: match[1].trim(), author: match[2].trim() }
      : { name: clean, author: "" };
  }

  async function readModList(profile) {
    const allPaths = Object.keys(profile.zip.files).filter(path => !profile.zip.files[path].dir);
    const preferred = `${profile.prefix || ""}modlist.html`;
    let path = allPaths.find(p => normalizeZipPath(p) === normalizeZipPath(preferred));
    if (!path) {
      const candidates = allPaths.filter(p => normalizeZipPath(p).endsWith("/modlist.html") || normalizeZipPath(p) === "modlist.html");
      if (candidates.length === 1) path = candidates[0];
    }
    if (!path) return [];

    try {
      const html = await profile.zip.file(path).async("string");
      const doc = new DOMParser().parseFromString(html, "text/html");
      return [...doc.querySelectorAll("a[href]")]
        .map(anchor => {
          const project = parseProjectLink(anchor.getAttribute("href"));
          if (!project) return null;
          const label = splitModListLabel(anchor.textContent);
          return { ...project, ...label };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function attachNamesToManifest(profile, modList) {
    const map = new Map();
    const files = profile.manifest.files || [];

    // Older exports sometimes put a numeric project id directly in modlist links.
    for (const item of modList) {
      if (item.projectID) map.set(String(item.projectID), { ...item, mapping: "projectID" });
    }

    // Modern CurseForge exports use slugs. modlist.html and manifest.json are generated
    // from the same profile list; when counts match, their order gives us the association.
    if (modList.length === files.length) {
      for (let i = 0; i < files.length; i += 1) {
        const projectID = String(files[i].projectID);
        if (!map.has(projectID)) map.set(projectID, { ...modList[i], mapping: "order" });
      }
      profile.modListMapping = "complete";
    } else {
      profile.modListMapping = map.size ? "partial" : "unavailable";
    }

    profile.modList = modList;
    profile.modMetaByProject = map;
    profile.modNamesMapped = map.size;
    return profile;
  }

  const previousReadProfile = readProfile;
  readProfile = async function (...args) {
    const profile = await previousReadProfile.apply(this, args);
    const modList = await readModList(profile);
    return attachNamesToManifest(profile, modList);
  };

  const previousAnalyzeProfiles = analyzeProfiles;
  analyzeProfiles = function (A, B) {
    const analysis = previousAnalyzeProfiles(A, B);
    analysis.metaA = A.modMetaByProject || new Map();
    analysis.metaB = B.modMetaByProject || new Map();
    analysis.namesMappedA = A.modNamesMapped || 0;
    analysis.namesMappedB = B.modNamesMapped || 0;
    return analysis;
  };

  function metadataFor(analysis, projectID) {
    const id = String(projectID);
    return analysis.metaA?.get(id) || analysis.metaB?.get(id) || null;
  }

  function displayName(analysis, projectID) {
    return metadataFor(analysis, projectID)?.name || `CurseForge project ${projectID}`;
  }

  function projectLink(meta, label) {
    if (!meta?.href) return escapeHtml(label);
    return `<a class="mod-link" href="${escapeHtml(meta.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }

  function versionCell(meta, fileID, isBase = false) {
    if (fileID == null) return '<span class="muted">—</span>';
    const text = `#${fileID}`;
    if (!meta?.href) return `<code class="version-id ${isBase ? "chosen-version" : ""}">${escapeHtml(text)}</code>`;
    return `<a class="version-link ${isBase ? "chosen-version" : ""}" href="${escapeHtml(meta.href)}/files/${escapeHtml(fileID)}" target="_blank" rel="noopener noreferrer" title="Открыть эту версию на CurseForge">${escapeHtml(text)} ↗</a>`;
  }

  function namedRow(analysis, projectID, fileA, fileB, status) {
    const meta = metadataFor(analysis, projectID);
    const name = displayName(analysis, projectID);
    const base = baseSelect.value;
    return `
      <tr>
        <td class="mod-name-cell">
          ${projectLink(meta, name)}
          ${meta?.author ? `<small>${escapeHtml(meta.author)}</small>` : ""}
        </td>
        <td>${versionCell(meta, fileA, base === "A")}</td>
        <td>${versionCell(meta, fileB, base === "B")}</td>
        <td><span class="mod-status status-${escapeHtml(status.key)}">${escapeHtml(status.label)}</span></td>
      </tr>
    `;
  }

  function sortProjectIDs(ids, analysis) {
    return [...ids].sort((a, b) => displayName(analysis, a).localeCompare(displayName(analysis, b), "ru", { sensitivity: "base" }));
  }

  function comparisonTable(analysis, ids, status) {
    if (!ids.length) return '<p class="details-empty">Нет модов в этой группе.</p>';
    const rows = sortProjectIDs(ids, analysis).map(projectID => {
      const a = analysis.mapA.get(String(projectID));
      const b = analysis.mapB.get(String(projectID));
      return namedRow(analysis, projectID, a?.fileID, b?.fileID, status);
    }).join("");

    return `
      <div class="details-scroll mod-table-scroll">
        <table class="mod-compare-table">
          <thead><tr><th>Мод</th><th>Профиль A</th><th>Профиль B</th><th>Статус</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderNamedComparison(analysis) {
    const conflictIDs = analysis.conflicts.map(x => String(x.projectID));
    const sameIDs = analysis.same.map(x => String(x.projectID));
    const mappedA = analysis.namesMappedA;
    const mappedB = analysis.namesMappedB;
    const totalA = analysis.sa.mods;
    const totalB = analysis.sb.mods;

    return `
      <div class="mod-comparison">
        <div class="comparison-heading">
          <div>
            <strong>Сравнение модов</strong>
            <small>Одинаковый fileID = одна и та же версия файла CurseForge. Нажми на #fileID, чтобы открыть точную версию.</small>
          </div>
          <span class="mapping-info">Имена: A ${mappedA}/${totalA} · B ${mappedB}/${totalB}</span>
        </div>

        <details class="result-details mods-different" ${conflictIDs.length ? "open" : ""}>
          <summary>⚠ Разные версии (${conflictIDs.length})</summary>
          ${comparisonTable(analysis, conflictIDs, { key: "different", label: "разные версии" })}
        </details>

        <details class="result-details">
          <summary>✓ Совпадают (${sameIDs.length})</summary>
          ${comparisonTable(analysis, sameIDs, { key: "same", label: "совпадает" })}
        </details>

        <details class="result-details">
          <summary>Только в профиле A (${analysis.onlyA.length})</summary>
          ${comparisonTable(analysis, analysis.onlyA, { key: "only-a", label: "только A" })}
        </details>

        <details class="result-details">
          <summary>Только в профиле B (${analysis.onlyB.length})</summary>
          ${comparisonTable(analysis, analysis.onlyB, { key: "only-b", label: "только B" })}
        </details>

        ${(mappedA < totalA || mappedB < totalB) ? `
          <p class="notice">Для части записей имя не удалось сопоставить с manifest: в таком случае показывается projectID. Обычно это бывает у нестандартных или старых экспортов.</p>
        ` : ""}
      </div>
    `;
  }

  const previousRenderAnalysis = renderAnalysis;
  renderAnalysis = function (analysis) {
    const value = previousRenderAnalysis.apply(this, arguments);

    // The original block contains raw projectID-only conflict rows. Replace it with
    // the readable four-way comparison below.
    result.querySelectorAll(":scope > .result-details").forEach(el => el.remove());
    result.insertAdjacentHTML("beforeend", renderNamedComparison(analysis));
    updateMergeDirection();
    return value;
  };

  baseSelect.addEventListener("change", () => {
    updateMergeDirection();
    if (state.analysis) renderAnalysis(state.analysis);
  });

  updateMergeDirection();
})();
