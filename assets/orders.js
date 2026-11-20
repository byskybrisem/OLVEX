import { parseSalesCsv } from "./csv.js";
import { amount, check, editor, field, fields, intField, note } from "./editor.js";
import { button, count, day, empty, fromMinor, h, money, table, today, toMinor, whole } from "./ui.js";

export function lookup(ctx, root, { section, field: name, label, labelFor, query = {}, selectOnlyOption = false, hideSearchForShortList = false }) {
  const wrapper = root.querySelector(`[data-lookup="${name}"]`);
  const input = wrapper.querySelector("input");
  const select = wrapper.querySelector("select");
  const status = wrapper.querySelector("[data-lookup-status]");
  const first = select.options[0].textContent;
  let revision = 0;
  let timeout;
  const load = async () => {
    const token = ++revision;
    try {
      const data = await ctx.get(section, { ...query, q: input.value.trim() });
      if (token !== revision || !wrapper.isConnected) return;
      const previous = select.value;
      const remembered = select.selectedOptions[0]?.textContent;
      select.replaceChildren(new Option(first, ""));
      for (const row of data.rows) select.add(new Option(labelFor(row), row.id));
      if (previous && ![...select.options].some((item) => item.value === previous)) select.add(new Option(remembered, previous));
      select.value = previous;
      if (selectOnlyOption && !previous && !input.value && !data.hasMore && data.rows.length === 1) {
        select.value = data.rows[0].id;
        select.dispatchEvent(new Event("change"));
      }
      if (hideSearchForShortList && !input.value) input.closest("label").hidden = !data.hasMore;
      status.textContent = data.hasMore ? `Daha fazla ${label} için aramayı daraltın.` : "";
    } catch (error) {
      if (token === revision) status.textContent = error.message;
    }
  };
  input.addEventListener("input", () => {
    revision++;
    clearTimeout(timeout);
    timeout = setTimeout(load, 210);
  });
  load();
}

export function lookupField(label, name, placeholder, required = false) {
  return `<div class="lookup" data-lookup="${h(name)}">${field(`${label} ara`, "", "", { type: "search", required: false, max: 80 })}
    <label class="field">${h(label)}<select aria-label="${h(label)}" name="${h(name)}"${required ? " required" : ""}>
      <option value="">${h(placeholder)}</option></select></label><p class="hint" data-lookup-status role="status"></p>
  </div>`;
}

export function findRegister(ctx, root) {
  lookup(ctx, root, {
    section: "pos", field: "registerId", label: "kasa", query: { active: "1" },
    labelFor: row => `${row.name} · ${row.branch_name}`
  });
}

function orderLine(index) {
  return `<fieldset class="order-line"><legend>Ürün ${index + 1}</legend>
    ${field("SKU", "sku", "", { max: 64, extra: 'list="sku-list" autocomplete="off"' })}
    ${intField("Adet", "quantity", "1")}
    ${amount("Birim fiyat", "unit", "", { required: false })}
    <button type="button" class="icon-button" data-remove-line aria-label="Ürünü kaldır">×</button>
  </fieldset>`;
}

function productLines(ctx, root, purchase = false) {
  const branch = root.querySelector('[name="branchId"]');
  const lines = root.querySelector(".lines");
  const dataList = root.querySelector("#sku-list");
  const add = root.querySelector("[data-add-line]");
  const status = root.querySelector("[data-sku-status]");
  const total = root.querySelector("[data-order-total]");
  const knownProducts = new Map();
  const refreshPickers = new WeakMap();
  let revision = 0;
  let timeout;

  const refreshLines = () => {
    const fieldsets = [...lines.children];
    for (const [index, item] of fieldsets.entries()) {
      item.querySelector("legend").textContent = "Ürün " + (index + 1);
      item.querySelector("[data-remove-line]").disabled = fieldsets.length === 1;
    }
    add.disabled = !branch.value || fieldsets.length >= 25;
  };

  const updateTotal = () => {
    if (!total) return;
    let amountMinor = 0;
    let incomplete = 0;
    for (const line of lines.children) {
      const code = line.querySelector('[name="sku"]').value.trim();
      const quantity = Number(line.querySelector('[name="quantity"]').value);
      const typedPrice = line.querySelector('[name="unit"]').value.trim();
      let priceMinor = null;
      if (typedPrice) {
        try { priceMinor = toMinor(typedPrice); } catch { /* Form validation displays the error. */ }
      } else if (code && knownProducts.has(code)) {
        priceMinor = knownProducts.get(code).price_minor;
      }
      if (!code || !Number.isSafeInteger(quantity) || quantity < 1 ||
          !Number.isSafeInteger(priceMinor) || priceMinor < 0) {
        incomplete++;
        continue;
      }
      amountMinor += priceMinor * quantity;
    }
    if (incomplete || !Number.isSafeInteger(amountMinor)) {
      total.textContent = "Tahmini toplam için tüm ürünleri seçin, adetleri ve fiyatları kontrol edin.";
    } else {
      total.textContent = "Tahmini satış toplamı: " + money(amountMinor) +
        " · Son tutar kaydedilirken hesaplanır.";
    }
  };

  const load = async (query = "") => {
    const token = ++revision;
    if (!branch.value) return;
    try {
      const data = await ctx.get("catalog", { q: query, branchId: branch.value });
      if (token !== revision || !lines.isConnected) return;
      for (const row of data.rows) knownProducts.set(row.sku, row);
      dataList.replaceChildren(...data.rows.map((row) =>
        new Option(row.name + " · " + row.stock + " adet", row.sku)));
      status.textContent = data.hasMore
        ? "Daha fazla ürün için SKU veya ürün adıyla arama yapın."
        : data.rows.length || query ? "" : "Önce Ürünler ve Stok bölümünde ürün ekleyin.";
      updateTotal();
    } catch (error) {
      if (token === revision) status.textContent = error.message;
    }
  };

  function enhanceLine(line) {
    if (line.querySelector("[data-product-picker]")) return;
    const skuInput = line.querySelector('[name="sku"]');
    if (!skuInput) return;

    const picker = document.createElement("div");
    picker.className = "lookup";
    picker.dataset.productPicker = "";
    picker.style.gridColumn = "1 / -1";
    picker.innerHTML = [
      '<label class="field">Ürün ara<input type="search" data-product-search maxlength="80"',
      ' placeholder="Ürün adı veya SKU" autocomplete="off"></label>',
      '<label class="field">Kayıtlı ürünü seç<select data-product-choice>',
      '<option value="">Ürün seçin...</option></select></label>',
      '<p class="hint" data-product-info role="status"></p>'
    ].join("");
    line.insertBefore(picker, skuInput.closest("label"));

    const search = picker.querySelector("[data-product-search]");
    const choice = picker.querySelector("[data-product-choice]");
    const info = picker.querySelector("[data-product-info]");
    let requestNumber = 0;
    let timer;

    const fetchProducts = async () => {
      const token = ++requestNumber;
      if (!branch.value) return;
      info.textContent = "Ürünler aranıyor...";
      try {
        const result = await ctx.get("catalog", { q: search.value.trim(), branchId: branch.value });
        if (token !== requestNumber || !picker.isConnected) return;
        for (const row of result.rows) knownProducts.set(row.sku, row);
        choice.replaceChildren(
          new Option("Ürün seçin...", ""),
          ...result.rows.map((row) => new Option(
            row.name + " · " + row.sku +
              (purchase ? "" : " · " + money(row.price_minor)) +
              " · şube stoku: " + row.stock,
            row.sku
          ))
        );
        if ([...choice.options].some((option) => option.value === skuInput.value)) {
          choice.value = skuInput.value;
        }
        info.textContent = result.hasMore
          ? "Daha fazla ürün için aramayı daraltın."
          : result.rows.length + " kayıtlı ürün bulundu.";
        updateTotal();
      } catch (error) {
        if (token === requestNumber) info.textContent = error.message || "Ürünler alınamadı.";
      }
    };

    search.addEventListener("input", () => {
      clearTimeout(timer);
      requestNumber++;
      timer = setTimeout(fetchProducts, 250);
    });

    choice.addEventListener("change", () => {
      const product = knownProducts.get(choice.value);
      if (!product) return;
      skuInput.value = product.sku;
      line.querySelector('[name="unit"]').value = "";
      const price = purchase
        ? "Alış maliyeti boş bırakılırsa ürün kartındaki maliyet kullanılır."
        : "Kayıtlı satış fiyatı: " + money(product.price_minor) +
          ". Farklı fiyat için birim fiyat alanını doldurun.";
      const warning = !purchase && product.stock < 1 ? " Stok bulunmuyor." : "";
      info.textContent = product.name + " · Stok: " + product.stock + ". " + price + warning;
      updateTotal();
    });

    skuInput.addEventListener("input", () => {
      if (choice.value !== skuInput.value) choice.value = "";
      updateTotal();
    });
    refreshPickers.set(line, () => {
      line.disabled = !branch.value;
      choice.replaceChildren(new Option("Ürün seçin...", ""));
      info.textContent = "";
      return fetchProducts();
    });
    refreshPickers.get(line)();
  }

  lines.addEventListener("input", (event) => {
    if (event.target.name === "sku") {
      clearTimeout(timeout);
      timeout = setTimeout(() => load(event.target.value.trim()), 140);
    }
    if (event.target.name === "quantity" || event.target.name === "unit") updateTotal();
  });
  lines.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-line]");
    if (!remove || remove.disabled) return;
    remove.closest("fieldset").remove();
    refreshLines();
    updateTotal();
  });
  add.addEventListener("click", () => {
    lines.insertAdjacentHTML("beforeend", orderLine(lines.children.length));
    refreshLines();
    const newest = lines.lastElementChild;
    enhanceLine(newest);
    newest.querySelector("[data-product-search]")?.focus();
    updateTotal();
  });
  for (const line of lines.children) enhanceLine(line);
  branch.addEventListener("change", () => {
    clearTimeout(timeout);
    knownProducts.clear();
    dataList.replaceChildren();
    status.textContent = branch.value ? "" : "Ürünleri görmek için şube seçin.";
    for (const line of lines.children) refreshPickers.get(line)();
    refreshLines();
    updateTotal();
    load();
  });
  status.textContent = "Ürünleri görmek için şube seçin.";
  refreshLines();
  updateTotal();
  load();
}

export function newOrder(ctx, purchase) {
  const section = purchase ? "purchases" : "sales";
  editor(ctx, {
    title: purchase ? "Satın alma kaydı" : "Yeni satış",
    html: lookupField(purchase ? "Teslim alan şube" : "Satış şubesi", "branchId", "Şube seçin", true) +
      fields(field("Tarih", "date", today(), { type: "date", extra: `max="${today()}"` }),
      field("Referans", "reference", "", { required: false, max: 100 })) +
      (purchase ? field("Tedarikçi", "supplier") : lookupField("Müşteri", "customerId", "Perakende satışı")) +
      `<div class="lines">${orderLine(0)}</div><datalist id="sku-list"></datalist>
        <p class="hint" data-sku-status role="status"></p>
        <div class="inline"><button type="button" class="button small" data-add-line>+ Satır ekle</button></div>
        <p class="hint">Birim fiyat boşsa ürün kartındaki ${purchase ? "maliyet" : "satış fiyatı"} kullanılır.</p>` +
      (purchase ? "" : '<p class="notice" data-order-total role="status"></p>') +
      check(purchase ? "Ödendi" : "Tahsil edildi", "paid", true) + note("Not", "note"),
    init: (root) => {
      productLines(ctx, root, purchase);
      lookup(ctx, root, {
        section: "locations", field: "branchId", label: "şube", labelFor: row => row.name,
        selectOnlyOption: true
      });
      if (!purchase) lookup(ctx, root, {
        section: "catalog", field: "customerId", label: "müşteri", query: { type: "customers" },
        labelFor: (row) => row.email ? `${row.name} · ${row.email}` : row.name
      });
    },
    submit: (form, send, root) => send(section, "create", {
      branchId: form.get("branchId"), date: form.get("date"), reference: form.get("reference"), supplier: form.get("supplier"),
      customerId: form.get("customerId"), paid: form.get("paid") === "on", note: form.get("note"),
      lines: [...root.querySelectorAll(".order-line")].map((item) => ({
        sku: item.querySelector('[name="sku"]').value,
        quantity: whole(item.querySelector('[name="quantity"]').value, "Adet"),
        unit: toMinor(item.querySelector('[name="unit"]').value, { optional: true })
      }))
    }),
    done: () => ctx.changed(purchase ? "Satın alma kaydedildi. Stok güncellendi." : "Satış kaydedildi. Stok güncellendi.")
  });
}

function orderSummary(row, purchase) {
  const party = purchase ? row.supplier : row.customer || "Perakende";
  return `<div class="panel">
    <strong>${h(money(row.total_minor))}</strong>
    <span class="row-sub">${h(party)} · ${h(day(row.occurred_on))}</span>
    ${row.branch_name ? `<span class="row-sub">Şube · ${h(row.branch_name)}</span>` : ""}
    ${row.register_name ? `<span class="row-sub">Kasa · ${h(row.register_name)}</span>` : ""}
    <span class="row-sub">Referans · ${h(row.reference || "Belirtilmedi")}</span>
  </div>`;
}

export function orderDetail(ctx, row, purchase) {
  const items = JSON.parse(row.items_json);
  const hasReturns = items.some(item => item.returned > 0);
  const columns = ["Ürün", ...(hasReturns ? ["Satılan", "İade", "Kalan adet"] : ["Adet"]), "Birim fiyat", "Toplam"];
  if (ctx.manager && !purchase) columns.push("Birim maliyet");
  const history = ctx.manager && !purchase && row.revision > 0;
  editor(ctx, {
    title: purchase ? "Satın alma ayrıntısı" : "Satış ayrıntısı",
    html: orderSummary(row, purchase) +
      (row.note ? `<p class="muted">${h(row.note)}</p>` : "") +
      table(columns, items.map((item) => [
        `<strong>${h(item.name)}</strong><small class="row-sub">${h(item.sku)}</small>`,
        ...(hasReturns ? [h(count(item.sold)), h(count(item.returned))] : []),
        h(count(item.quantity)), h(money(item.unit)), h(money(item.unit * item.quantity)),
        ...(ctx.manager && !purchase ? [h(money(item.cost))] : [])
      ])) +
      (history ? '<section><h3>Düzeltme geçmişi</h3><div data-edits></div><button class="button" type="button" data-more>Düzeltmeleri göster</button><p class="hint" role="status" data-feedback></p></section>' : ""),
    init(root) {
      if (history) bindSaleHistory(ctx, row.id, root);
    }
  });
}

function bindSaleHistory(ctx, id, root) {
  const entries = root.querySelector("[data-edits]");
  const more = root.querySelector("[data-more]");
  const status = root.querySelector("[data-feedback]");
  let page = 1;
  more.addEventListener("click", async () => {
    more.disabled = true;
    status.textContent = "Geçmiş yükleniyor…";
    try {
      const data = await ctx.get("sale-edits", { id, page });
      const cards = data.rows.map(edit => {
        const details = [];
        if (edit.old_reference !== edit.new_reference) details.push(`Referans · ${edit.old_reference || "—"} → ${edit.new_reference || "—"}`);
        if (edit.old_note !== edit.new_note) details.push(`Not · ${edit.old_note || "—"} → ${edit.new_note || "—"}`);
        for (const line of JSON.parse(edit.line_changes)) {
          details.push(`${line.sku} · ${count(line.oldQuantity)} × ${money(line.oldUnit)} → ${count(line.newQuantity)} × ${money(line.newUnit)}`);
        }
        return `<article class="panel"><strong>${h(edit.reason)}</strong><small class="row-sub">${h(day(edit.created_at))} · ${h(edit.actor || "Kullanıcı")} · Sürüm ${h(edit.revision)}</small>${details.map(detail => `<p>${h(detail)}</p>`).join("")}</article>`;
      });
      entries.insertAdjacentHTML("beforeend", cards.join(""));
      page++;
      more.hidden = !data.hasMore;
      more.textContent = "Daha eski düzeltmeleri göster";
      status.textContent = data.rows.length + " düzeltme gösterildi.";
    } catch (error) {
      status.textContent = error.message;
    } finally { more.disabled = false; }
  });
}

function editSale(ctx, row) {
  const items = JSON.parse(row.items_json);
  const lines = row.paid_on ? '<p class="hint">Tahsil edilmiş satışın referansını ve notunu düzenleyebilirsiniz. Tutar düzeltmesi için iade işlemini kullanın.</p>' :
    items.map((item, index) => `<fieldset class="order-line"><legend>${h(item.name)} · ${h(item.sku)}</legend>${
      intField("Adet", "quantity-" + index, String(item.quantity))}${
      amount("Birim fiyat", "unit-" + index, fromMinor(item.unit))}</fieldset>`).join("");
  const values = form => items.map((item, index) => ({
    id: item.id, quantity: whole(form.get("quantity-" + index), "Adet"), unit: toMinor(form.get("unit-" + index))
  }));
  editor(ctx, {
    title: "Satışı düzenle", label: "Düzeltmeyi kaydet",
    html: orderSummary(row, false) +
      field("Referans", "reference", row.reference || "", { required: false, max: 100 }) +
      note("Satış notu", "note", row.note) + lines +
      (row.paid_on ? "" : `<p class="hint">Düzeltilmiş satış tutarı · <output data-edited-total>${h(money(row.total_minor))}</output></p>`) +
      field("Düzeltme nedeni", "reason", "", { max: 180 }),
    init(root) {
      const total = root.querySelector("[data-edited-total]");
      if (!total) return;
      const form = root.closest("form");
      root.querySelectorAll(".order-line").forEach(fieldset => fieldset.addEventListener("input", () => {
        try {
          const rows = values(new FormData(form));
          const sum = rows.reduce((amount, item) => amount + item.unit * item.quantity, 0);
          total.value = rows.every(item => item.quantity > 0) && Number.isSafeInteger(sum) ? money(sum) : "—";
        } catch { total.value = "—"; }
      }));
    },
    submit: (form, send) => {
      const changed = row.paid_on ? [] : values(form).filter((line, index) =>
        line.quantity !== items[index].quantity || line.unit !== items[index].unit);
      return send("sales", "edit", { id: row.id, revision: row.revision, lines: changed,
        reference: form.get("reference"), note: form.get("note"), reason: form.get("reason") });
    },
    done: () => ctx.changed("Satış ve düzeltme geçmişi güncellendi.")
  });
}

export function orderCommand(ctx, row, command, purchase) {
  const section = purchase ? "purchases" : "sales";
  if (command === "edit-sale") return editSale(ctx, row);
  if (command === "order-detail") {
    orderDetail(ctx, row, purchase);
    return;
  }
  if (command === "void-order") {
    editor(ctx, {
      title: purchase ? "Satın almayı iptal et" : "Tam iade / iptal",
      label: "İptali onayla",
      html: orderSummary(row, purchase) +
        `<p>${purchase ? "İptal edildiğinde bu alımdaki ürünler stoktan düşer." : "İptal edildiğinde satışın kalan ürünleri şube stokuna döner."}</p>` +
        (row.paid_on ? '<p class="hint">Tam iadenin tamamlandığı tarihi girin. İade bu tarihte nakit akışına eklenir.</p>' : '') +
        field("İptal / iade tarihi", "date", today(), { type: "date", extra: `min="${h(row.paid_on || row.occurred_on)}" max="${today()}"` }),
      submit: (form, send) => send(section, "void", { id: row.id, revision: row.revision, expectedPaidOn: row.paid_on, date: form.get("date") }),
      done: () => ctx.changed("Kayıt iptal edildi. Stok güncellendi.")
    });
    return;
  }
  editor(ctx, {
    title: purchase ? "Ödeme kaydet" : "Tahsilat kaydet",
    label: purchase ? "Ödemeyi kaydet" : "Tahsilatı kaydet",
    html: orderSummary(row, purchase) +
      field("Tarih", "date", today(), { type: "date", extra: `min="${h(row.occurred_on)}" max="${today()}"` }),
    submit: (form, send) => send(section, "settle", { id: row.id, revision: row.revision, date: form.get("date") }),
    done: () => ctx.changed(purchase ? "Ödeme kaydedildi." : "Tahsilat kaydedildi.")
  });
}

export function importSales(ctx) {
  editor(ctx, {
    title: "Kasa satışlarını CSV ile içe aktar",
    label: "Satışları aktar",
    html: `<p>Başlık sırası <code>referans;tarih;sku;adet;birim_fiyat</code>. Tarih biçimi YYYY-AA-GG. Aynı fişin ürünleri aynı referansı kullanır.</p>
      ${lookupField("Kaynak kasa", "registerId", "Bağlantısız CSV dosyası")}
      ${lookupField("Dosya şubesi", "branchId", "Varsayılan şube")}
      <p class="hint">Kaynak işlem kimliği kullanan kasalarda referans sütununa kalıcı işlem kimliğini girin. Uzlaştırma kullanan kasalarda bu sütuna onaylı kaynak kayıt konumunu girin.</p>
      <label class="field">CSV dosyası<input name="file" type="file" accept=".csv,text/csv" required></label>
      ${check("Dosyadaki satışlar tahsil edildi", "paid")}
      <p class="hint" role="status" data-progress></p>`,
    init: root => {
      lookup(ctx, root, { section: "csv-sources", field: "registerId", label: "kasa",
        labelFor: row => row.name + " · " + row.branch_name });
      lookup(ctx, root, { section: "locations", field: "branchId", label: "şube", labelFor: row => row.name,
        selectOnlyOption: true, hideSearchForShortList: true });
      const register = root.querySelector('[name="registerId"]');
      const branch = root.querySelector('[data-lookup="branchId"]');
      register.addEventListener("change", () => { branch.hidden = Boolean(register.value); });
    },
    submit: async (form, _send, root) => {
      const file = form.get("file");
      if (!file?.size || file.size > 512 * 1024) throw new Error("En fazla 512 KB boyutunda bir CSV dosyası seçin.");
      const sales = parseSalesCsv(await file.text());
      const paid = form.get("paid") === "on";
      const registerId = form.get("registerId");
      const source = registerId ? { registerId } : { csvMode: "file", branchId: form.get("branchId") || null };
      const progress = root.querySelector("[data-progress]");
      let created = 0;
      let repeated = 0;
      for (const [index, sale] of sales.entries()) {
        progress.textContent = `${index + 1} / ${sales.length} satış aktarılıyor`;
        try {
          const result = await ctx.post("sales", "import", { ...sale, paid, ...source });
          if (result.repeated) repeated++;
          else created++;
        } catch (error) {
          throw new Error(`${created} yeni satış kaydedildi, ${repeated} satış zaten vardı. ${sale.reference} referansında işlem durdu. ${error.message}`);
        }
      }
      return { created, repeated };
    },
    done: ({ created, repeated }) => ctx.changed(`${created} satış aktarıldı. ${repeated} satış zaten kayıtlıydı.`)
  });
}

export async function customerHistory(ctx, row) {
  let page = 1;
  const markup = (data) => {
    if (!data.rows.length && page <= 1) return empty("Bu müşteriye bağlı satış bulunamadı.");
    return table(["Tarih", "Referans", "Durum", "Tutar"], data.rows.map((sale) => [
      h(day(sale.occurred_on)), h(sale.reference || "—"), h(sale.status === "void" ? "İptal" : sale.paid_on ? "Tahsil edildi" : "Açık"), h(money(sale.total_minor))
    ])) + `<div class="inline">${button("Önceki", "history-page", { id: page - 1, disabled: page <= 1 })}${
      button("Sonraki", "history-page", { id: page + 1, disabled: !data.hasMore })}</div>`;
  };

  editor(ctx, {
    title: `${row.name} · Satış geçmişi`,
    html: '<div data-history-content role="status">Yükleniyor…</div>',
    init: (root) => {
      const content = root.querySelector("[data-history-content]");
      const load = async () => {
        try { content.innerHTML = markup(await ctx.get("customer-history", { id: row.id, page })); }
        catch (error) { content.textContent = error.message; }
      };
      content.addEventListener("click", (event) => {
        const target = event.target.closest('[data-cmd="history-page"]');
        if (target) {
          page = Number(target.dataset.id);
          load();
        }
      });
      load();
    }
  });
}
