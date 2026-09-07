/* Auto-generate merged profile names from the base profile loader and local date. */
(() => {
  const output = document.getElementById("outputName");
  const baseSelect = document.getElementById("baseProfile");
  if (!output || !baseSelect) return;

  let lastAutoName = "";

  function localDateStamp(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function neoforgeVersion(profile) {
    const loaders = profile?.manifest?.minecraft?.modLoaders || [];
    const primary = loaders.find(x => x.primary) || loaders[0];
    const id = String(primary?.id || "");
    const match = id.match(/^neoforge-(.+)$/i);
    return match ? match[1] : null;
  }

  function generatedName() {
    const profile = state?.[baseSelect.value];
    if (!profile) return null;

    const version = neoforgeVersion(profile);
    if (!version) return null;

    return `NeoForge-${version}-${localDateStamp()}`;
  }

  function refreshAutoName(force = false) {
    const next = generatedName();
    if (!next) return;

    const current = output.value.trim();
    const mayReplace = force || !current || current === lastAutoName;
    if (!mayReplace) return;

    output.value = next;
    lastAutoName = next;
  }

  // renderAnalysis() is called after profiles have been parsed successfully.
  const originalRenderAnalysis = renderAnalysis;
  renderAnalysis = function (...args) {
    const result = originalRenderAnalysis.apply(this, args);
    refreshAutoName();
    return result;
  };

  baseSelect.addEventListener("change", () => refreshAutoName());

  output.addEventListener("input", () => {
    if (!output.value.trim()) lastAutoName = "";
  });
})();
