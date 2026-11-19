const choiceKey = "olvex:browser-preferences";
const lifetime = 180 * 86400000;
const optionalKey = key => key === "olvex:collapsed" || key.startsWith("olvex:business:");

function clearOptional() {
  for (const key of Object.keys(localStorage)) {
    if (optionalKey(key)) localStorage.removeItem(key);
  }
}

function decision() {
  try {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(choiceKey)); } catch {}
    if (["allow", "deny"].includes(saved?.choice) && saved.expires > Date.now()) return saved.choice;
    localStorage.removeItem(choiceKey);
    clearOptional();
  } catch {}
  return null;
}

export function browserPreference(key, value) {
  if (!optionalKey(key) || decision() !== "allow") return null;
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function bindBrowserPreferences(root, onAllow = () => {}) {
  if (!root) return;
  const status = root.querySelector("[data-preference-status]");
  const banner = root.hasAttribute("data-preference-banner");
  const sync = () => {
    const current = decision();
    root.hidden = banner && current !== null;
    if (status) status.textContent = current === "allow" ? "Panel tercihleri açık."
      : current === "deny" ? "Panel tercihleri kapalı." : "Panel tercihleri varsayılan olarak kapalı.";
  };
  for (const button of root.querySelectorAll("[data-preference-choice]")) {
    button.addEventListener("click", () => {
      const choice = button.dataset.preferenceChoice;
      try {
        if (choice === "deny") clearOptional();
        localStorage.setItem(choiceKey, JSON.stringify({ choice, expires: Date.now() + lifetime }));
      } catch {
        if (status) status.textContent = "Tarayıcı tercihinizi saklamaya izin vermedi.";
        return;
      }
      if (choice === "allow") onAllow();
      sync();
      if (banner) document.querySelector("#title")?.focus({ preventScroll: true });
    });
  }
  window.addEventListener("storage", event => {
    if (event.key === choiceKey || event.key === null) sync();
  });
  sync();
}
