/* Compact filtering for the single-profile mod list. */
(() => {
  const LABELS = ["A", "B"];
  const filterState = new Map();

  function getFingerprint(label) {
    return state?.[label]?.inspectFingerprint || "";
  }

  function blankState(label) {
    return {
      fingerprint: getFingerprint(label),
      query: "",
      author: "",
      category: "",
      projectType: "",
      releaseType: ""
    };
  }

  function stateFor(label) {
    const fingerprint = getFingerprint(label);
    let current = filterState.get(label);
    if (!current || current.fingerprint !== fingerprint) {
      current = blankState(label);
      filterState.set(label, current);
    }
    return current;
  }

  function profileItems(label) {
    return state?.[label]?.inspectItems || [];
  }

  function itemKey(projectID, fileID) {
    return `${projectID}:${fileID}`;
  }

  function itemForRow(label, row) {
    const projectID = String(row.dataset.projectId || "");
    const fileID = String(row.dataset.fileId || "");
    return profileItems(label).find(item =>
      String(item.projectID) === projectID && String(item.fileID) === fileID
    ) || null;
  }

  function metaForRow(label, row) {
    const profile = state?.[label];
    if (!profile?.inspectFileMeta) return null;
    return profile.inspectFileMeta.get(itemKey(row.dataset.projectId, row.dataset.fileId)) || null;
  }

  function authorsFor(label, row) {
    const item = itemForRow(label, row);
    const meta = metaForRow(label, row);
    const values = [item?.author, ...(meta?.authors || [])]
      .map(value => String(value || "").replace(/^by\s+/i, "").trim())
      .filter(Boolean);
    return [...new Set(values)];
  }

  function categoriesFor(label, row) {
    const meta = metaForRow(label, row);
    return Array.isArray(meta?.categories) ? meta.categories.filter(Boolean) : [];
  }

  function projectTypeFor(label, row) {
    return String(metaForRow(label, row)?.projectType || "").trim();
  }

  function releaseTypeFor(label, row) {
    return String(metaForRow(label, row)?.type || "").trim().toLowerCase();
  }

  function rowsFor(label) {
    const panel = $(`inspectPanel${label}`);
    return panel ? [...panel.querySelectorAll(".profile-mod-item")] : [];
  }

  function optionCounts(values) {
    const counts = new Map();
    for (const value of values) {
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return counts;
  }

  function fillSelect(select, counts, allLabel, selected, sort = "alpha") {
    if (!select) return "";
    const entries = [...counts.entries()];
    if (sort === "release") {
      const order = new Map([["release", 0], ["beta", 1], ["alpha", 2]]);
      entries.sort((a, b) => (order.get(a[0]) ?? 50) - (order.get(b[0]) ?? 50) || a[0].localeCompare(b[0]));
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0], "ru", { sensitivity: "base" }));
    }

    select.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = allLabel;
    select.append(all);

    for (const [value, count] of entries) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${displayValue(value, select.dataset.kind)} (${count})`;
      select.append(option);
    }

    if (selected && counts.has(selected)) select.value = selected;
    else select.value = "";
    return select.value;
  }

  function displayValue(value, kind) {
    if (kind === "release") {
      if (value === "release") return "Release";
      if (value === "beta") return "Beta";
      if (value === "alpha") return "Alpha";
    }
    return value;
  }

  function refreshFilterOptions(label) {
    const panel = $(`inspectPanel${label}`);
    const toolbar = $(`profileFilters${label}`);
    if (!panel || !toolbar) return;
    const rows = rowsFor(label);
    const current = stateFor(label);

    const authorCounts = optionCounts(rows.flatMap(row => authorsFor(label, row)));
    const categoryCounts = optionCounts(rows.flatMap(row => categoriesFor(label, row)));
    const typeCounts = optionCounts(rows.map(row => projectTypeFor(label, row)));
    const releaseCounts = optionCounts(rows.map(row => releaseTypeFor(label, row)));

    current.author = fillSelect($(`filterAuthor${label}`), authorCounts, "Все авторы", current.author);
    current.category = fillSelect($(`filterCategory${label}`), categoryCounts, "Все категории", current.category);
    current.projectType = fillSelect($(`filterType${label}`), typeCounts, "Все типы", current.projectType);
    current.releaseType = fillSelect($(`filterRelease${label}`), releaseCounts, "Все каналы", current.releaseType, "release");

    const authorWrap = toolbar.querySelector('[data-filter-wrap="author"]');
    const categoryWrap = toolbar.querySelector('[data-filter-wrap="category"]');
    const typeWrap = toolbar.querySelector('[data-filter-wrap="type"]');
    const releaseWrap = toolbar.querySelector('[data-filter-wrap="release"]');

    // Author and category are primary filters. Keep them visible even while metadata
    // is still arriving; the options fill progressively.
    if (authorWrap) authorWrap.hidden = authorCounts.size === 0;
    if (categoryWrap) categoryWrap.hidden = false;
    if ($(`filterCategory${label}`)) $(`filterCategory${label}`).disabled = categoryCounts.size === 0;

    // Project type (usually just "Mods") and release channel are only useful when
    // they actually divide the current profile into more than one group.
    if (typeWrap) typeWrap.hidden = typeCounts.size <= 1;
    if (releaseWrap) releaseWrap.hidden = releaseCounts.size <= 1;

    applyFilters(label);
  }

  function rowSearchText(label, row) {
    const item = itemForRow(label, row);
    const meta = metaForRow(label, row);
    return [item?.name, meta?.projectName, meta?.display, meta?.name]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("ru");
  }

  function applyFilters(label) {
    const panel = $(`inspectPanel${label}`);
    const toolbar = $(`profileFilters${label}`);
    if (!panel || !toolbar) return;
    const current = stateFor(label);
    const rows = rowsFor(label);
    const query = current.query.trim().toLocaleLowerCase("ru");
    let visible = 0;

    for (const row of rows) {
      const matchesQuery = !query || rowSearchText(label, row).includes(query);
      const matchesAuthor = !current.author || authorsFor(label, row).includes(current.author);
      const matchesCategory = !current.category || categoriesFor(label, row).includes(current.category);
      const matchesType = !current.projectType || projectTypeFor(label, row) === current.projectType;
      const matchesRelease = !current.releaseType || releaseTypeFor(label, row) === current.releaseType;
      const show = matchesQuery && matchesAuthor && matchesCategory && matchesType && matchesRelease;
      row.hidden = !show;
      if (show) visible += 1;
    }

    const count = $(`filterCount${label}`);
    if (count) count.textContent = `Показано ${visible} из ${rows.length}`;

    const details = panel.querySelector(".profile-mod-list");
    const summary = details?.querySelector(":scope > summary");
    if (summary) summary.textContent = visible === rows.length ? `Моды (${rows.length})` : `Моды (${visible} из ${rows.length})`;

    let empty = $(`filterEmpty${label}`);
    if (!empty) {
      empty = document.createElement("div");
      empty.id = `filterEmpty${label}`;
      empty.className = "profile-filter-empty";
      empty.textContent = "По этим фильтрам ничего не найдено.";
      panel.querySelector(".profile-mod-list-body")?.append(empty);
    }
    empty.hidden = visible !== 0 || rows.length === 0;

    const active = Boolean(current.query || current.author || current.category || current.projectType || current.releaseType);
    const reset = $(`filterReset${label}`);
    if (reset) reset.disabled = !active;
  }

  function resetFilters(label) {
    const current = stateFor(label);
    current.query = "";
    current.author = "";
    current.category = "";
    current.projectType = "";
    current.releaseType = "";

    const search = $(`filterSearch${label}`);
    if (search) search.value = "";
    for (const id of [`filterAuthor${label}`, `filterCategory${label}`, `filterType${label}`, `filterRelease${label}`]) {
      if ($(id)) $(id).value = "";
    }
    applyFilters(label);
  }

  function bindFilterControls(label) {
    const current = stateFor(label);
    const search = $(`filterSearch${label}`);
    const author = $(`filterAuthor${label}`);
    const category = $(`filterCategory${label}`);
    const type = $(`filterType${label}`);
    const release = $(`filterRelease${label}`);
    const reset = $(`filterReset${label}`);

    search?.addEventListener("input", () => {
      current.query = search.value;
      applyFilters(label);
    });
    author?.addEventListener("change", () => {
      current.author = author.value;
      applyFilters(label);
    });
    category?.addEventListener("change", () => {
      current.category = category.value;
      applyFilters(label);
    });
    type?.addEventListener("change", () => {
      current.projectType = type.value;
      applyFilters(label);
    });
    release?.addEventListener("change", () => {
      current.releaseType = release.value;
      applyFilters(label);
    });
    reset?.addEventListener("click", () => resetFilters(label));
  }

  function ensureFilters(label) {
    const panel = $(`inspectPanel${label}`);
    const details = panel?.querySelector(".profile-mod-list");
    const body = details?.querySelector(".profile-mod-list-body");
    if (!panel || !details || !body || $(`profileFilters${label}`)) return;

    const current = stateFor(label);
    const toolbar = document.createElement("div");
    toolbar.id = `profileFilters${label}`;
    toolbar.className = "profile-filter-toolbar";
    toolbar.innerHTML = `
      <div class="profile-filter-search">
        <label for="filterSearch${label}">Найти мод</label>
        <input id="filterSearch${label}" type="search" autocomplete="off" placeholder="Например, Entity Culling" value="">
      </div>
      <div class="profile-filter-selects">
        <label data-filter-wrap="author">Автор
          <select id="filterAuthor${label}" data-kind="author"><option value="">Все авторы</option></select>
        </label>
        <label data-filter-wrap="category">Категория
          <select id="filterCategory${label}" data-kind="category"><option value="">Все категории</option></select>
        </label>
        <label data-filter-wrap="type" hidden>Тип
          <select id="filterType${label}" data-kind="type"><option value="">Все типы</option></select>
        </label>
        <label data-filter-wrap="release" hidden>Канал
          <select id="filterRelease${label}" data-kind="release"><option value="">Все каналы</option></select>
        </label>
      </div>
      <div class="profile-filter-footer">
        <span id="filterCount${label}">Показано 0 из 0</span>
        <button type="button" id="filterReset${label}" class="secondary profile-filter-reset" disabled>Сбросить фильтры</button>
      </div>
    `;
    details.insertBefore(toolbar, body);

    const search = $(`filterSearch${label}`);
    if (search) search.value = current.query;
    bindFilterControls(label);
    refreshFilterOptions(label);
  }

  function setupVisiblePanels() {
    for (const label of LABELS) ensureFilters(label);
  }

  const host = $("profileInspectorHost");
  if (host) {
    const observer = new MutationObserver(() => setupVisiblePanels());
    observer.observe(host, { childList: true, subtree: true });
  }

  window.addEventListener("cfpm:filemeta", event => {
    const detail = event.detail || {};
    for (const label of LABELS) {
      const profile = state?.[label];
      const panel = $(`inspectPanel${label}`);
      if (!profile || !panel || panel.classList.contains("hidden")) continue;
      const row = [...panel.querySelectorAll(".profile-mod-item")].find(candidate =>
        String(candidate.dataset.projectId) === String(detail.projectID) &&
        String(candidate.dataset.fileId) === String(detail.fileID)
      );
      if (!row) continue;
      profile.inspectFileMeta = profile.inspectFileMeta || new Map();
      profile.inspectFileMeta.set(itemKey(detail.projectID, detail.fileID), detail.meta);
      refreshFilterOptions(label);
    }
  });

  setupVisiblePanels();
})();