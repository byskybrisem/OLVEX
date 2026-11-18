import { h } from "./ui.js";
import { views } from "./views.js";

const fold = (value) => value.toLocaleLowerCase("tr").normalize("NFD").replace(/\p{M}/gu, "").replaceAll("ı", "i");

export function bindModuleSearch(allowed) {
  const trigger = document.querySelector("#module-search-open");
  const dialog = document.querySelector("#module-search");
  const query = document.querySelector("#module-query");
  const results = document.querySelector("#module-results");
  const status = document.querySelector("#module-count");

  function update() {
    const needle = fold(query.value.trim());
    const matches = Object.entries(views).filter(([route, [title, hint]]) =>
      allowed(route) && fold(title + " " + hint).includes(needle));
    if (needle) {
      const rank = ([, [title]]) => {
        const name = fold(title);
        if (name.startsWith(needle)) return 0;
        return name.includes(needle) ? 1 : 2;
      };
      matches.sort((a, b) => rank(a) - rank(b));
    }
    results.innerHTML = matches.map(([route, [title, hint]]) =>
      '<a href="#' + route + '"><strong>' + h(title) + '</strong><small>' + h(hint) + '</small></a>').join("");
    status.textContent = matches.length ? matches.length + " modül bulundu." : "Eşleşen modül yok.";
  }
  function open() {
    if (trigger.disabled || document.querySelector("dialog[open], .sidebar.open")) return;
    query.value = "";
    update();
    dialog.showModal();
    query.focus();
  }
  trigger.addEventListener("click", open);
  document.querySelector("#module-search-close").addEventListener("click", () => dialog.close());
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !trigger.disabled) {
      if (document.querySelector("#editor[open], .sidebar.open")) return;
      event.preventDefault();
      if (dialog.open) query.focus();
      else open();
    }
  });
  query.addEventListener("input", update);
  query.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    const first = results.querySelector("a");
    if (event.key === "Enter" && first) {
      event.preventDefault();
      first.click();
    } else if (event.key === "ArrowDown" && first) {
      event.preventDefault();
      first.focus();
    }
  });
  results.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    dialog.close();
    if (link.hash === location.hash) document.querySelector("#title").focus();
  });
}

export function bindDrawer() {
  const sidebar = document.querySelector("#sidebar");
  const menu = document.querySelector("#menu");
  const backdrop = document.querySelector("#backdrop");
  const main = document.querySelector("#main");
  function close(restoreFocus = false) {
    if (!sidebar.classList.contains("open")) return;
    main.inert = false;
    sidebar.classList.remove("open");
    sidebar.removeAttribute("aria-modal");
    sidebar.removeAttribute("role");
    document.body.classList.remove("menuopen");
    backdrop.hidden = true;
    menu.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-label", "Menüyü aç");
    if (restoreFocus) menu.focus();
  }
  menu.addEventListener("click", () => {
    main.inert = true;
    document.body.classList.add("menuopen");
    sidebar.classList.add("open");
    sidebar.setAttribute("role", "dialog");
    sidebar.setAttribute("aria-modal", "true");
    backdrop.hidden = false;
    menu.setAttribute("aria-expanded", "true");
    menu.setAttribute("aria-label", "Menüyü kapat");
    (sidebar.querySelector('nav a[aria-current="page"]') || sidebar.querySelector("#close-menu")).focus();
  });
  document.querySelector("#close-menu").addEventListener("click", () => close(true));
  backdrop.addEventListener("click", () => close(true));
  sidebar.addEventListener("click", (event) => {
    if (event.target.closest("a")?.hash === location.hash) close(true);
  });
  sidebar.addEventListener("keydown", (event) => {
    if (!sidebar.classList.contains("open")) return;
    if (event.key === "Escape") close(true);
    if (event.key !== "Tab") return;
    const items = [...sidebar.querySelectorAll("a[href], button:enabled, select:enabled")].filter(item => item.getClientRects().length);
    const end = event.shiftKey ? items[0] : items.at(-1);
    if (document.activeElement === end) {
      event.preventDefault();
      (event.shiftKey ? items.at(-1) : items[0]).focus();
    }
  });
  matchMedia("(max-width:760px)").addEventListener("change", () => close());
  return close;
}
