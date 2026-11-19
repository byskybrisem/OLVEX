import { confirm, editor, field } from "./editor.js";
import { lookup, lookupField } from "./orders.js";
import { h } from "./ui.js";
import { aiOverview, proposalLabel } from "./views.js";

const emblem = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 2.5 27.5 9v14L16 29.5 4.5 23V9L16 2.5Z" stroke="currentColor" stroke-width="1.5"/><path d="m16 8 1.8 5.9L24 16l-6.2 2.1L16 24l-1.8-5.9L8 16l6.2-2.1L16 8Z" fill="currentColor"/></svg>';
const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const glyph = path => `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${path}"
  stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const suggestions = [
  ["Satışlarımı analiz et", "Son 7 günlük satışlarımı önceki dönemle karşılaştır.", "M4 17l6-6 4 4 6-8m-5 0h5v5"],
  ["Kritik stokları göster", "Bu şubede veya seçili kapsamda hangi ürünler kritik stok eşiğinde?", "M4 7l8-4 8 4v10l-8 4-8-4zm0 0 8 4 8-4m-8 4v10"],
  ["Finansal durumum", "Bu ay nakit akışım ve giderlerim nasıl?", "M5 5h14v14H5zM8 9h8m-8 4h8m-8 3h4"],
  ["Bana öneriler ver", "İşletmemi son 7 günün verilerine göre nasıl geliştirebilirim?", "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"]
];

function draftCard(proposal, mode) {
  const labels = { applied: "Uygulandı", discarded: "Reddedildi", expired: "Süresi doldu" };
  const actions = proposal.state === "pending" ? `<div class="actions">
    ${mode !== "off" ? `<button type="button" class="button small primary" data-ai-approve="${h(proposal.id)}">Onayla</button>` : ""}
    <button type="button" class="button small" data-ai-discard="${h(proposal.id)}">Reddet</button>
  </div>` : `<p class="ai-draft-status">${h(labels[proposal.state] || "")}</p>`;
  return `<div class="ai-draft"><strong>${proposal.kind === "stock" ? "Stok güncelleme önerisi" : "Gider önerisi"}</strong>
    <p>${h(proposalLabel(proposal))}</p>${actions}</div>`;
}

function turnMarkup(turn, mode) {
  return `<div class="ai-turn">
    <article class="ai-message ai-user"><span class="visually-hidden">Siz</span><p>${h(turn.prompt)}</p></article>
    ${turn.answer ? `<article class="ai-message ai-assistant"><span class="ai-avatar">${emblem}</span>
      <div><strong>OLVEX AI</strong><p>${h(turn.answer)}</p>
      ${turn.evidence ? `<div class="ai-evidence"><strong>OLVEX kayıtları</strong><p>${h(turn.evidence)}</p></div>` : ""}
      ${turn.proposal ? draftCard(turn.proposal, mode) : ""}</div></article>` : ""}
    ${turn.state !== "complete" ? `<div class="ai-turn-status">
      ${turn.state === "pending" && !turn.retryable ? '<span class="ai-dots" aria-hidden="true"><i></i><i></i><i></i></span>' : ""}
      ${h(turn.error || "OLVEX AI yazıyor…")}
      ${turn.retryable ? `<button type="button" class="button small" data-ai-retry="${h(turn.requestId)}">Yeniden gönder</button>`
        : turn.state === "pending" ? '<button type="button" class="button small" data-ai-check>Durumu kontrol et</button>' : ""}
    </div>` : ""}</div>`;
}

const errorMessage = error => error.status ? error.message : "Bağlantı kurulamadı. Tekrar deneyin.";

const dialog = (kind, title) => `<dialog class="ai-drawer" data-ai-drawer="${kind}" aria-labelledby="ai-${kind}-title">
  <header><h2 id="ai-${kind}-title">${title}</h2><button type="button" class="icon-button" data-ai-close aria-label="Kapat">×</button></header>
  <div data-ai-drawer-content></div></dialog>`;

export function mountAI(container, ctx, mode, actorId) {
  container.innerHTML = `<section class="ai-studio" aria-label="OLVEX AI sohbeti">
    <header class="ai-studio-header"><div><span class="ai-kicker">İşletme asistanın</span><div class="ai-thread-title" data-ai-title></div></div>
      <div class="actions"><button type="button" class="button" data-ai-new>＋ Yeni sohbet</button>
        <button type="button" class="button" data-ai-open="history" aria-haspopup="dialog">Geçmiş</button>
        <button type="button" class="button" data-ai-open="summary" aria-haspopup="dialog">İşletme Özeti</button></div></header>
    <div class="ai-scroll"><div class="ai-welcome">
      <span class="ai-emblem">${emblem}</span><h2>İşletmen için ne yapabilirim?</h2>
      <p>Satışlarını analiz edebilir, stoklarını inceleyebilir ve kararlarında yardımcı olabilirim.</p>
      <div class="ai-suggestions">${suggestions.map(([label, prompt, icon]) =>
        `<button type="button" data-ai-prompt="${h(prompt)}"><span>${glyph(icon)}</span>${h(label)}<b>${glyph("M6 18 18 6m-8 0h8v8")}</b></button>`).join("")}</div></div>
      <div class="ai-log" role="log" aria-label="Sohbet mesajları" aria-live="off"></div></div>
    <footer class="ai-composer">
      <div class="ai-feedback" role="status" aria-live="polite"></div>
      ${mode === "off" ? '<p class="ai-off">Sohbet bu ortamda kapalı. İşletme Özeti’ni açabilir ve geçmiş sohbetlerini okuyabilirsin.</p>' :
        `<form id="ai-form"><label class="visually-hidden" for="ai-prompt">Mesaj</label>
          <textarea id="ai-prompt" name="prompt" rows="2" required maxlength="2000" placeholder="OLVEX AI’ya bir şey sor…"></textarea>
          <div class="ai-composer-actions"><div data-ai-branch>${lookupField("Şube", "branchId", "Tüm işletme")}</div>
            <button type="submit" class="button primary" aria-label="Gönder">${arrow}<span>Gönder</span></button></div>
          <p class="ai-composer-note">Shift + Enter ile yeni satır. ${mode === "mock" ? "Test modu." : "Kişisel bilgi veya parola yazmayın."}</p></form>`}
    </footer>${dialog("history", "Sohbet geçmişi")}${dialog("summary", "İşletme Özeti")}
    </section>`;
  const root = container.firstElementChild;
  const $ = selector => root.querySelector(selector);
  const scroll = $(".ai-scroll");
  const composer = $("#ai-form");
  const selection = composer?.elements.branchId;
  const feedback = $(".ai-feedback");
  const storageKey = `olvex:ai-outbox:${actorId}:${ctx.business.id}`;
  const selectionKey = `${actorId}:${ctx.business.id}`;
  const sessionDraft = () => {
    try { return JSON.parse(sessionStorage.getItem(storageKey)); } catch { return null; }
  };
  const saveOutbox = value => {
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {}
  };
  const rememberChat = id => history.replaceState({ ...history.state, olvexChat: { key: selectionKey, id } }, "");
  let outbox = sessionDraft();
  let chat = null;
  let turns = [];
  let before = null;
  let busy = false;
  let switching = false;
  let olderPending = false;
  let revision = 0;
  let historyRows = [];
  let historyCursor = null;
  let historyDirty = true;
  let historyPending = false;
  let summary = null;
  let summaryPending = false;

  const status = message => { feedback.textContent = message || ""; };
  const atBottom = () => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 72;
  function render(jump = false) {
    const scrollTop = scroll.scrollTop;
    $("[data-ai-title]").textContent = chat ? `${chat.title} · ${chat.branch_name || "Tüm işletme"}` : "";
    $(".ai-welcome").hidden = turns.length > 0;
    $(".ai-log").innerHTML = (before
      ? '<button class="button small" type="button" data-ai-older>Önceki mesajları yükle</button>' : "") +
      turns.map(turn => turnMarkup(turn, mode)).join("");
    root.querySelectorAll("[data-ai-new], [data-ai-prompt], [data-ai-retry], [data-ai-check]").forEach(node => {
      node.disabled = busy || switching || (mode === "off" && node.matches("[data-ai-prompt], [data-ai-retry]"));
    });
    if (composer) {
      composer.querySelector("[type=submit]").disabled = busy || switching || Boolean(outbox);
      selection.disabled = busy || switching || Boolean(outbox);
    }
    scroll.scrollTop = jump ? scroll.scrollHeight : scrollTop;
  }

  function setBranch(id, name) {
    if (!selection) return;
    if (id && !Array.from(selection.options).some(option => option.value === id)) selection.add(new Option(name || "Şube", id));
    selection.value = id || "";
  }

  async function openChat(id, { older = false } = {}) {
    if (older && (!before || olderPending)) return;
    const serial = ++revision;
    if (older) olderPending = true;
    else {
      switching = true;
      status("Sohbet yükleniyor…");
      render();
    }
    const oldHeight = scroll.scrollHeight;
    const oldTop = scroll.scrollTop;
    try {
      const result = await ctx.get("ai", { conversation: id, ...(older && { before }) });
      if (!root.isConnected || serial !== revision) return;
      const follow = atBottom();
      chat = result.chat;
      turns = older ? [...result.turns, ...turns] : result.turns;
      before = result.before;
      if (!older) {
        setBranch(chat.branch_id, chat.branch_name);
        rememberChat(id);
      }
      status("");
      return { follow, oldHeight, oldTop };
    } catch (error) {
      if (root.isConnected && serial === revision) status(errorMessage(error));
      return null;
    } finally {
      if (older) olderPending = false;
      if (root.isConnected && serial === revision) {
        switching = false;
        render();
        if (older) scroll.scrollTop = oldTop + scroll.scrollHeight - oldHeight;
      }
    }
  }

  function newChat(keepBranch = true) {
    ++revision;
    chat = null;
    turns = [];
    before = null;
    outbox = null;
    saveOutbox(null);
    rememberChat(null);
    if (!keepBranch) setBranch(null);
    if (composer) composer.elements.prompt.value = "";
    status("");
    render(true);
  }

  async function send(payload) {
    if (busy || switching || mode === "off") return;
    busy = true;
    outbox = payload;
    saveOutbox(payload);
    if (!turns.some(turn => turn.requestId === payload.requestId)) {
      turns = [...turns, { prompt: payload.prompt, requestId: payload.requestId, state: "pending" }];
    } else {
      turns = turns.map(turn => turn.requestId === payload.requestId
        ? { ...turn, state: "pending", retryable: false, error: null } : turn);
    }
    status("Yanıt bekleniyor…");
    render(atBottom());
    historyDirty = true;
    let errorText;
    let needsBranch = false;
    try {
      const result = await ctx.post("ai", "send", payload);
      needsBranch = result.needsBranch === true;
      if (result.state !== "complete") errorText = "Mesaj işleniyor. Durumu yeniden kontrol edebilirsiniz.";
    } catch (error) {
      errorText = errorMessage(error);
    }
    if (!root.isConnected) return;
    const loaded = await openChat(payload.id);
    const saved = loaded && turns.find(turn => turn.requestId === payload.requestId);
    if (saved?.state === "complete" || saved?.state === "failed") {
      outbox = null;
      saveOutbox(null);
    } else {
      const message = errorText || "Bağlantı kesildi. Mesajı aynı istekle yeniden kontrol edin.";
      turns = turns.some(turn => turn.requestId === payload.requestId)
        ? turns.map(turn => turn.requestId === payload.requestId ? { ...turn, retryable: true, error: message } : turn)
        : [...turns, { prompt: payload.prompt, requestId: payload.requestId, state: "failed", retryable: true, error: message }];
    }
    busy = false;
    status(saved?.state === "complete" ? "Yanıt hazır." : errorText);
    render(loaded?.follow);
    if (needsBranch && selection && !composer.elements.prompt.value) {
      composer.elements.prompt.value = payload.prompt;
      selection.focus({ preventScroll: true });
    }
  }

  function submit(prompt) {
    const value = prompt.trim();
    if (!value || !composer || outbox || busy || switching) return;
    const payload = { id: chat?.id || crypto.randomUUID(), newChat: !chat, requestId: crypto.randomUUID(),
      prompt: value, branchId: selection.value || null, branchName: selection.selectedOptions[0]?.textContent };
    composer.elements.prompt.value = "";
    send(payload);
  }

  function drawer(kind) {
    return $(`[data-ai-drawer="${kind}"]`);
  }

  async function showHistory(more = false) {
    const area = drawer("history").querySelector("[data-ai-drawer-content]");
    if (historyPending) return;
    historyPending = true;
    try {
      if (historyDirty || more) {
        if (!more) area.textContent = "Sohbetler yükleniyor…";
        const result = await ctx.get("ai", { conversations: 1, ...(more && { cursor: historyCursor }) });
        historyRows = more ? [...new Map([...historyRows, ...result.rows].map(row => [row.id, row])).values()] : result.rows;
        historyCursor = result.cursor;
        historyDirty = false;
      }
      area.innerHTML = historyRows.length ? historyRows.map(row => `<article class="ai-history-row">
        <button type="button" class="ai-history-open" data-ai-chat="${h(row.id)}">
          <strong>${h(row.title)}</strong><small>${h(row.branch_name || "Tüm işletme")}</small></button>
        <div class="actions"><button class="button small" type="button" data-ai-rename="${h(row.id)}">Yeniden adlandır</button>
        <button class="button small" type="button" data-ai-remove="${h(row.id)}">Sil</button></div></article>`).join("") +
        (historyCursor ? '<button type="button" class="button" data-ai-more>Daha fazla sohbet</button>' : "")
        : '<p class="empty">Henüz kayıtlı sohbet yok.</p>';
    } catch (error) {
      area.innerHTML = `<p role="alert">${h(errorMessage(error))}</p><button class="button" type="button" data-ai-history-retry>Yeniden dene</button>`;
    } finally { historyPending = false; }
  }

  async function showSummary() {
    const area = drawer("summary").querySelector("[data-ai-drawer-content]");
    if (summaryPending) return;
    summaryPending = true;
    try {
      if (!summary) {
        area.textContent = "İşletme özeti yükleniyor…";
        summary = await ctx.get("ai", { summary: 1 });
      }
      area.innerHTML = aiOverview(summary, { demo: false });
    } catch (error) {
      area.innerHTML = `<p role="alert">${h(errorMessage(error))}</p><button class="button" type="button" data-ai-summary-retry>Yeniden dene</button>`;
    } finally { summaryPending = false; }
  }

  root.addEventListener("click", event => {
    const btn = event.target.closest("button");
    if (!btn) return;
    const key = btn.dataset;
    if (key.aiClose !== undefined) return btn.closest("dialog").close();
    if (key.aiOpen || key.aiMore !== undefined || key.aiHistoryRetry !== undefined || key.aiSummaryRetry !== undefined) {
      if (key.aiOpen) drawer(key.aiOpen).showModal();
      return key.aiOpen === "summary" || key.aiSummaryRetry !== undefined ? showSummary() : showHistory(key.aiMore !== undefined);
    }
    if (busy || switching) return;
    if (key.aiNew !== undefined) return newChat();
    if (key.aiPrompt) return submit(key.aiPrompt);
    if (key.aiCheck !== undefined && chat) return openChat(chat.id);
    if (key.aiOlder !== undefined) return openChat(chat.id, { older: true });
    if (key.aiChat) {
      if (outbox) return;
      drawer("history").close();
      return openChat(key.aiChat).then(opened => { if (opened) render(true); });
    }
    if (key.aiRetry) {
      const turn = turns.find(item => item.requestId === key.aiRetry);
      return send({ ...(outbox?.requestId === key.aiRetry ? outbox : {
        id: chat.id, requestId: turn.requestId, prompt: turn.prompt, branchId: chat.branch_id
      }), retry: true });
    }
    if (key.aiRename || key.aiRemove) {
      const row = historyRows.find(item => item.id === (key.aiRename || key.aiRemove));
      const done = () => { historyDirty = true; showHistory(); };
      if (key.aiRename) return editor(ctx, { title: "Sohbeti yeniden adlandır",
        html: field("Sohbet adı", "title", row.title, { max: 100 }),
        submit: (form, save) => save("ai", "rename", { id: row.id, title: form.get("title") }),
        done: result => { if (chat?.id === result.id) { chat.title = result.title; render(); } done(); } });
      return confirm(ctx, { title: "Sohbeti sil", message: `“${row.title}” ve mesajları silinecek.`,
        section: "ai", action: "remove", label: "Sohbeti sil", data: { id: row.id },
        after: () => { if (chat?.id === row.id) newChat(); summary = null; done(); } });
    }
    const legacyId = ["apply-proposal", "discard-proposal"].includes(key.cmd) ? key.id : null;
    const proposal = legacyId ? summary?.proposals.find(row => row.id === legacyId)
      : turns.find(row => row.proposal?.id === (key.aiApprove || key.aiDiscard))?.proposal;
    const apply = Boolean(key.aiApprove || key.cmd === "apply-proposal");
    if (proposal) return confirm(ctx, {
      title: apply ? "OLVEX AI işlemi onayı" : "OLVEX AI taslağını reddet",
      message: proposalLabel(proposal), section: "ai", action: apply ? "apply" : "discard",
      label: apply ? "Onayla ve uygula" : "Reddet", data: { id: proposal.id, branchId: proposal.branchId },
      after: () => { proposal.state = apply ? "applied" : "discarded"; summary = null; render(); if (drawer("summary").open) showSummary(); }
    });
  });

  if (composer) {
    lookup(ctx, composer, { section: "locations", field: "branchId", label: "şube", labelFor: row => row.name, hideSearchForShortList: true });
    selection.addEventListener("change", () => {
      if (chat || turns.length) {
        const unsent = composer.elements.prompt.value;
        newChat();
        composer.elements.prompt.value = unsent;
        status("Şube değişti. Yeni sohbet açıldı.");
      }
    });
    composer.addEventListener("submit", event => { event.preventDefault(); submit(composer.elements.prompt.value); });
    composer.elements.prompt.addEventListener("keydown", event => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (!matchMedia("(pointer: coarse)").matches || event.ctrlKey || event.metaKey) composer.requestSubmit();
      else composer.elements.prompt.setRangeText("\n", composer.elements.prompt.selectionStart, composer.elements.prompt.selectionEnd, "end");
    });
  }
  const controller = new AbortController();
  const fit = () => {
    if (!root.isConnected) return;
    const viewport = window.visualViewport;
    const focused = composer?.contains(document.activeElement);
    const keyboard = focused && viewport?.scale === 1 &&
      viewport.height < document.documentElement.clientHeight - 90;
    root.style.setProperty("--ai-top", `${Math.max(0, root.getBoundingClientRect().top + scrollY)}px`);
    if (keyboard) root.style.setProperty("--ai-viewport", `${viewport.height}px`);
    else root.style.removeProperty("--ai-viewport");
    if (keyboard && document.activeElement === composer.elements.prompt) {
      const box = composer.getBoundingClientRect();
      const bottom = viewport.offsetTop + viewport.height;
      if (box.bottom > bottom) window.scrollBy(0, box.bottom - bottom + 4);
    }
  };
  window.visualViewport?.addEventListener("resize", fit, { signal: controller.signal });
  window.addEventListener("resize", fit, { signal: controller.signal });
  fit();
  const remembered = history.state?.olvexChat;
  const initial = outbox?.id || (remembered?.key === selectionKey ? remembered.id : null);
  if (initial) {
    openChat(initial).then(result => {
      if (!root.isConnected) return;
      if (outbox) {
        const saved = turns.find(turn => turn.requestId === outbox.requestId);
        if (saved?.state === "complete" || saved?.state === "failed") {
          outbox = null;
          saveOutbox(null);
        } else {
          setBranch(outbox.branchId, outbox.branchName);
          const message = "Gönderim doğrulanamadı. Mesajı yeniden kontrol edebilirsiniz.";
          if (saved) Object.assign(saved, { retryable: true, error: message });
          else turns.push({ ...outbox, state: "failed", retryable: true, error: message });
        }
      }
      if (!result && !outbox) rememberChat(null);
      render(true);
    });
  } else render();
  return () => controller.abort();
}
