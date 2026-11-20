import { day, request } from "./ui.js";

const form = document.querySelector("#rights-form");
const confirmation = form.elements.confirmed;
const submit = form.querySelector("button");
const message = document.querySelector("#rights-message");
const list = document.querySelector("#rights-list");
const labels = new Map([...form.querySelectorAll('[name="kind"]')].map(input => [input.value, input.labels[0].textContent.trim()]));

function feedback(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}

function showError(error) {
  feedback(error.message, true);
  if (error.status === 401) {
    form.hidden = true;
    document.querySelector("#rights-history").hidden = true;
    document.querySelector("#rights-login").hidden = false;
  }
}

function render(rows) {
  list.replaceChildren(...rows.map(item => {
    const node = document.createElement("li");
    const status = item.processed_at ? "Yanıt kaydedildi" : "İnceleme bekliyor";
    node.textContent = [labels.get(item.kind), day(item.created_at.slice(0, 10)), status, item.id].join(" · ");
    return node;
  }));
  if (!rows.length) {
    const empty = document.createElement("li");
    empty.textContent = "Henüz talep oluşturmadınız.";
    list.append(empty);
  }
}

function syncConfirmation() {
  const closing = form.elements.kind.value === "close";
  confirmation.closest("label").hidden = !closing;
  confirmation.disabled = !closing;
  confirmation.required = closing;
}

form.addEventListener("change", syncConfirmation);
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (submit.disabled) return;
  submit.disabled = true;
  try {
    const { item } = await request("/api/account-rights", "POST", {
      kind: form.elements.kind.value, confirmed: confirmation.checked
    });
    form.reset();
    syncConfirmation();
    feedback("Talebiniz inceleme sırasında. Başvuru referansı " + item.id + ".");
    try { render((await request("/api/account-rights")).rows); }
    catch { feedback("Talebiniz kaydedildi. Listeyi güncellemek için sayfayı yenileyin. Başvuru referansı " + item.id + "."); }
  } catch (error) {
    showError(error);
  } finally {
    submit.disabled = false;
  }
});

request("/api/account-rights").then(({ rows }) => {
  render(rows);
  syncConfirmation();
  form.hidden = false;
  document.querySelector("#rights-history").hidden = false;
  feedback("");
}).catch(showError);
