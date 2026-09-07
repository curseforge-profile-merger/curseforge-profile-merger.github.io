/* Single-profile viewer: inspect one CurseForge share/ZIP without requiring a merge partner. */
(() => {
  const LABELS = ["A", "B"];
  const CONCURRENCY = 4;
  const REQUEST_GAP_MS = 120;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function currentFingerprint(label) {
    const share = $(`share${label}`)?.value.trim();
    if (share) return `share:${parseShareCode(share)}`;

    const file = $(`file${label}`)?.files?.[0];
    if (file) return `local:${file.name}:${file.size}:${file.lastModified}`;
    throw new Error(`В профиле ${label} укажите CurseForge share-ссылку или выберите ZIP.`);
  }

  function projectMeta(profile, projectID) {
    return profile?.modMetaByProject?.get(String(projectID)) || null;
  }

  function modItems(profile) {
    return (profile?.manifest?.files || []).map(entry => {
      const meta = projectMeta(profile, entry.projectID);
      return {
        projectID: String(entry.projectID),
        fileID: String(entry.fileID),
        name: meta?.name || `CurseForge project ${entry.projectID}`,
        author: meta?.author || "",
        projectUrl: meta?.href || ""
      };
    }).sort((a, b) => a.name.localeCompare(b.name, "ru", { sensitivity: "base" }));
  }

  function shareUrl(profile) {
    return profile?.shareCode
      ? `https://www.curseforge.com/minecraft/share/${encodeURIComponent(profile.shareCode)}`
      : "";
  }

  function ensureInspectorHost(sourceCard) {
    let host = $("profileInspectorHost");
    if (host) return host;

    const sources = sourceCard.closest(".sources");
    if (!sources) return sourceCard;

    host = document.createElement("section");
    host.id = "profileInspectorHost";
    host.className = "profile-inspector-host";
    sources.insertAdjacentElement("afterend", host);
    return host;
  }

  function ensureInspectorUi(label) {
    const sourceCard = $(`share${label}`)?.closest(".source-card");
    if (!sourceCard) return null;

    let actions = $(`inspectActions${label}`);
    if (!actions) {
      actions = document.createElement("div");
      actions.id = `inspectActions${label}`;
      actions.className = "profile-inspect-actions";
      actions.innerHTML = `<button type="button" id="inspectBtn${label}" class="secondary profile-inspect-button">Посмотреть состав</button>`;
      sourceCard.append(actions);
    }

    let panel = $(`inspectPanel${label}`);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = `inspectPanel${label}`;
      panel.className = "profile-inspector hidden";
      ensureInspectorHost(sourceCard).append(panel);
    }

    return { actions, panel, button: $(`inspectBtn${label}`) };
  }

  function sourceLabel(profile) {
    if (profile?.shareCode) return `share:${profile.shareCode}`;
    return profile?.file?.name || profile?.sourceLabel || "—";
  }

  function renderInspector(label, profile) {
    const ui = ensureInspectorUi(label);
    if (!ui) return;

    const summary = profileSummary(profile);
    const items = modItems(profile);
    const directShare = shareUrl(profile);

    ui.panel.classList.remove("hidden");
    ui.panel.innerHTML = `
      <div class="profile-inspector-head">
        <div>
          <small>Профиль ${escapeHtml(label)}</small>
          <strong>${escapeHtml(summary.name)}</strong>
        </div>
        <button type="button" id="copyProfile${escapeHtml(label)}" class="secondary inspect-copy-button">Скопировать информацию</button>
      </div>

      <div class="profile-inspector-summary">
        <div><small>Minecraft</small><strong>${escapeHtml(summary.mc)}</strong></div>
        <div><small>Loader</small><strong>${escapeHtml(summary.loader)}</strong></div>
        <div><small>Моды</small><strong>${items.length}</strong></div>
      </div>

      <div class="profile-inspector-source">
        <span>Источник: ${directShare
          ? `<a href="${escapeHtml(directShare)}" target="_blank" rel="noopener noreferrer">${escapeHtml(sourceLabel(profile))}</a>`
          : escapeHtml(sourceLabel(profile))}</span>
        <span id="inspectProgress${escapeHtml(label)}" class="inspect-progress">Подгружаю версии модов…</span>
      </div>

      <details class="profile-mod-list" open>
        <summary>Моды (${items.length})</summary>
        <div class="profile-mod-list-body">
          <ol class="profile-mod-items">
            ${items.map(item => `
              <li class="profile-mod-item" data-project-id="${escapeHtml(item.projectID)}" data-file-id="${escapeHtml(item.fileID)}">
                <div class="profile-mod-title">
                  ${item.projectUrl
                    ? `<a href="${escapeHtml(item.projectUrl)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(item.name)}</strong></a>`
                    : `<strong>${escapeHtml(item.name)}</strong>`}
                  ${item.author ? `<small>by ${escapeHtml(item.author)}</small>` : ""}
                </div>
                <a class="profile-mod-version${item.projectUrl ? "" : " no-link"}" ${item.projectUrl
                  ? `href="${escapeHtml(item.projectUrl)}/files/${escapeHtml(item.fileID)}" target="_blank" rel="noopener noreferrer"`
                  : ""}>
                  <span class="profile-mod-version-main">#${escapeHtml(item.fileID)}</span>
                  <small class="profile-mod-version-file"></small>
                  <small class="profile-mod-version-id">fileID ${escapeHtml(item.fileID)}</small>
                </a>
              </li>
            `).join("")}
          </ol>
        </div>
      </details>
    `;

    const copyButton = $(`copyProfile${label}`);
    copyButton?.addEventListener("click", () => copyProfileInfo(label, profile));

    profile.inspectItems = items;
    profile.inspectFileMeta = profile.inspectFileMeta || new Map();
    profile.inspectHydration = hydrateProfileVersions(label, profile, items);
  }

  function updateModRow(label, projectID, fileID, meta) {
    const panel = $(`inspectPanel${label}`);
    if (!panel || !meta) return;
    const row = [...panel.querySelectorAll(".profile-mod-item")]
      .find(el => el.dataset.projectId === String(projectID) && el.dataset.fileId === String(fileID));
    if (!row) return;

    const link = row.querySelector(".profile-mod-version");
    const main = row.querySelector(".profile-mod-version-main");
    const file = row.querySelector(".profile-mod-version-file");

    if (main) main.textContent = meta.display || meta.name || `#${fileID}`;
    if (file) file.textContent = meta.name && meta.name !== meta.display ? meta.name : "";
    if (link && meta.url && /^https:\/\/www\.curseforge\.com\//i.test(meta.url)) {
      link.href = meta.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.classList.remove("no-link");
    }
  }

  async function runPool(items, worker, limit = CONCURRENCY) {
    let cursor = 0;
    async function runner() {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index], index);
        await sleep(REQUEST_GAP_MS);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, runner));
  }

  async function hydrateProfileVersions(label, profile, items) {
    const resolver = window.CFPMFileMeta?.resolveFileMeta;
    const progress = $(`inspectProgress${label}`);
    if (!resolver || !items.length) {
      if (progress) progress.textContent = items.length ? "Версии: показываю fileID" : "Модов нет";
      return;
    }

    let done = 0;
    let resolved = 0;
    const updateProgress = () => {
      if (!progress) return;
      progress.textContent = done < items.length
        ? `Версии: ${done}/${items.length}`
        : `Версии загружены: ${resolved}/${items.length}`;
    };
    updateProgress();

    await runPool(items, async item => {
      let meta = profile.inspectFileMeta.get(`${item.projectID}:${item.fileID}`) || null;
      if (!meta) meta = await resolver(item.projectID, item.fileID);
      if (meta) {
        profile.inspectFileMeta.set(`${item.projectID}:${item.fileID}`, meta);
        resolved += 1;
        updateModRow(label, item.projectID, item.fileID, meta);
      }
      done += 1;
      updateProgress();
    });
  }

  async function clipboardWrite(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    if (!ok) throw new Error("Браузер не разрешил копирование в буфер обмена.");
  }

  function copiedProfileText(profile) {
    const summary = profileSummary(profile);
    const items = profile.inspectItems || modItems(profile);
    const metaMap = profile.inspectFileMeta || new Map();
    const lines = [
      summary.name,
      `Minecraft: ${summary.mc}`,
      `Loader: ${summary.loader}`,
      `Моды: ${items.length}`
    ];

    const directShare = shareUrl(profile);
    if (directShare) lines.push(`CurseForge share: ${directShare}`);

    lines.push("", "Список модов:");
    for (const item of items) {
      const meta = metaMap.get(`${item.projectID}:${item.fileID}`);
      const version = meta?.display || meta?.name || `file #${item.fileID}`;
      const author = item.author ? ` · by ${item.author}` : "";
      lines.push(`- ${item.name} — ${version}${author}`);
    }
    return lines.join("\n");
  }

  async function copyProfileInfo(label, profile) {
    const button = $(`copyProfile${label}`);
    const original = button?.textContent || "Скопировать информацию";
    if (button) {
      button.disabled = true;
      button.textContent = "Подготавливаю…";
    }

    try {
      await profile.inspectHydration;
      await clipboardWrite(copiedProfileText(profile));
      if (button) button.textContent = "✓ Скопировано";
      setTimeout(() => {
        if (button?.isConnected) {
          button.disabled = false;
          button.textContent = original;
        }
      }, 1600);
    } catch (error) {
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
      setSourceStatus(label, `Не удалось скопировать: ${error.message}`, "error");
    }
  }

  async function inspectProfile(label) {
    const ui = ensureInspectorUi(label);
    if (!ui) return;
    const button = ui.button;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Загружаю…";

    try {
      const fingerprint = currentFingerprint(label);
      let profile = state[label];
      if (!profile || profile.inspectFingerprint !== fingerprint) {
        const source = await resolveSource(label);
        profile = await readProfile(source, label);
        profile.inspectFingerprint = fingerprint;
        state[label] = profile;
      }
      renderInspector(label, profile);
      button.textContent = "Обновить состав";
    } catch (error) {
      ui.panel.classList.remove("hidden");
      ui.panel.innerHTML = `<p class="error"><strong>Ошибка:</strong> ${escapeHtml(error.message)}</p>`;
      button.textContent = original;
    } finally {
      button.disabled = false;
    }
  }

  function markInspectorStale(label) {
    const panel = $(`inspectPanel${label}`);
    if (panel && !panel.classList.contains("hidden")) panel.classList.add("hidden");
    const button = $(`inspectBtn${label}`);
    if (button) button.textContent = "Посмотреть состав";
  }

  for (const label of LABELS) {
    const ui = ensureInspectorUi(label);
    ui?.button?.addEventListener("click", () => inspectProfile(label));
    $(`share${label}`)?.addEventListener("input", () => markInspectorStale(label));
    $(`share${label}`)?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        inspectProfile(label);
      }
    });
    $(`file${label}`)?.addEventListener("change", () => markInspectorStale(label));
  }
})();
