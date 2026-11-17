import { amount, confirm, editor, field, fields, intField, note, readAmount, readInt, select } from "./editor.js";
import { lookup, lookupField } from "./orders.js";
import { copyText, fromMinor, h, randomSecret, today } from "./ui.js";
import { proposalLabel, repeats } from "./views.js";

function saveForm(ctx, { title, html, section, action = "save", fields: values, message, init, after, label }) {
  editor(ctx, {
    title, html, init, label: label || "Kaydet",
    submit: (form, send) => send(section, action, values(form)),
    done: after || (() => ctx.changed(message))
  });
}

function archive(ctx, row, section, label) {
  confirm(ctx, {
    title: row.active ? `${label} arşivlensin mi?` : `${label} yeniden açılsın mı?`,
    message: row.active ? `“${row.name}” arşivlenecek. Önceki işlem kayıtları erişilebilir.` : `“${row.name}” aktif kayıtlara eklenecek.`,
    section, action: "archive", data: { id: row.id, active: !row.active }
  });
}

function product(ctx, row = {}) {
  saveForm(ctx, {
    title: row.id ? "Ürünü düzenle" : "Ürün ekle", section: "products",
    html: fields(field("Ürün adı", "name", row.name), field("SKU", "sku", row.sku, { max: 64 })) +
      fields(amount("Satış fiyatı (TL)", "price", fromMinor(row.price_minor ?? 0)),
        amount("Birim maliyet (TL)", "cost", fromMinor(row.cost_minor ?? 0))) +
      fields(field("Kategori", "category", row.category, { max: 60, required: false }),
        intField("Kritik stok eşiği", "reorder", row.reorder_at ?? 0)) +
      (row.id ? "" : intField("Açılış stoğu", "opening", 0)),
    fields: (form) => ({
      id: row.id, name: form.get("name"), sku: form.get("sku"), category: form.get("category"),
      price: readAmount(form, "price"), cost: readAmount(form, "cost"), reorder: readInt(form, "reorder", "Kritik stok eşiği"),
      opening: row.id ? 0 : readInt(form, "opening", "Açılış stoğu")
    }),
    message: "Ürün kaydedildi."
  });
}

function stock(ctx, row) {
  saveForm(ctx, {
    title: "Stok düzeltmesi", section: "stock", action: "adjust",
    html: `<p><strong>${h(row.name)}</strong> · Mevcut stok ${h(row.stock)} adet</p>` +
      intField("Adet farkı", "delta") + field("Düzeltme nedeni", "note", "", { max: 180 }) +
      '<p class="hint">Bir adet düşürmek için −1, eklemek için 1 girin.</p>',
    fields: (form) => ({ productId: row.id, delta: readInt(form, "delta", "Stok farkı"), note: form.get("note") }),
    message: "Stok hareketi kaydedildi."
  });
}

function customer(ctx, row = {}) {
  saveForm(ctx, {
    title: row.id ? "Müşteriyi düzenle" : "Müşteri ekle", section: "customers",
    html: field("Müşteri adı", "name", row.name) +
      fields(field("E-posta", "email", row.email, { type: "email", max: 254, required: false }),
        field("Telefon", "phone", row.phone, { type: "tel", max: 40, required: false })) +
      note("Not", "notes", row.notes),
    fields: (form) => ({ id: row.id, ...Object.fromEntries(form) }),
    message: "Müşteri kaydedildi."
  });
}

function cash(ctx) {
  saveForm(ctx, {
    title: "Gelir / gider kaydı", section: "finance", action: "create",
    html: fields(select("Tür", "kind", [["expense", "Gider"], ["income", "Gelir"]]),
      field("Tarih", "date", today(), { type: "date", extra: `max="${today()}"` })) +
      field("Açıklama", "description", "", { max: 180 }) +
      fields(amount("Tutar (TL)", "amount"), field("Kategori", "category", "", { max: 80, required: false })) +
      '<p class="hint">Satış ve satın alma ödemeleri kendi kayıtlarından nakit akışına eklenir. Bu formu diğer gelir ve giderler için kullanın.</p>',
    fields: (form) => ({ ...Object.fromEntries(form), amount: readAmount(form, "amount") }),
    message: "Nakit kaydı eklendi."
  });
}

function invoice(ctx, row = {}) {
  saveForm(ctx, {
    title: row.id ? "Fatura kaydını düzenle" : "Fatura kaydı ekle", section: "invoices",
    html: fields(select("Belge yönü", "direction", [["outgoing", "Giden"], ["incoming", "Gelen"]], row.direction),
      select("Durum", "status", [["open", "Açık"], ["paid", "Ödendi"], ["cancelled", "İptal"]], row.status)) +
      fields(field("Belge numarası", "number", row.number, { max: 64 }), field("Karşı taraf", "counterparty", row.counterparty)) +
      fields(field("Belge tarihi", "issuedOn", row.issued_on || today(), { type: "date" }),
        field("Vade", "dueOn", row.due_on, { type: "date", required: false })) +
      amount("Belge tutarı (TL)", "amount", fromMinor(row.amount_minor)) + note("Not", "note", row.note),
    fields: (form) => ({ id: row.id, ...Object.fromEntries(form), amount: readAmount(form, "amount") }),
    message: "Fatura kaydı güncellendi."
  });
}

function employee(ctx, row = {}) {
  saveForm(ctx, {
    title: row.id ? "Çalışanı düzenle" : "Çalışan ekle", section: "employees",
    html: field("Ad soyad", "name", row.name) + field("Görev", "title", row.job_title, { max: 80, required: false }),
    fields: (form) => ({ id: row.id, ...Object.fromEntries(form) }),
    message: "Çalışan kaydedildi."
  });
}

function shift(ctx) {
  saveForm(ctx, {
    title: "Vardiya planla", section: "shifts", action: "create",
    html: lookupField("Çalışan", "employeeId", "Çalışan seçin", true) +
      field("Tarih", "date", today(), { type: "date" }) +
      fields(field("Başlangıç saati", "start", "09:00", { type: "time" }), field("Bitiş saati", "end", "18:00", { type: "time" })) +
      '<p class="hint">Bitiş saati başlangıçtan önceyse vardiya ertesi gün biter.</p>',
    init: (root) => lookup(ctx, root, {
      section: "employees", field: "employeeId", label: "çalışan", labelFor: (row) => row.name
    }),
    fields: (form) => Object.fromEntries([...form].filter(([key]) => key)),
    message: "Vardiya kaydedildi."
  });
}

function task(ctx, row = {}) {
  saveForm(ctx, {
    title: row.id ? "Görevi düzenle" : "Görev ekle", section: "tasks",
    html: field("Görev", "title", row.title, { max: 180 }) +
      fields(field("Tarih", "date", row.due_on || ctx.taskDay || today(), { type: "date" }),
        select("Tekrar", "repeat", Object.entries(repeats), row.repeat_rule || "none")) +
      note("Not", "notes", row.notes),
    fields: (form) => ({ id: row.id, ...Object.fromEntries(form) }),
    message: "Görev kaydedildi."
  });
}

function showSecret(ctx, title, message, value) {
  editor(ctx, {
    title, html: `<p>${h(message)}</p><input class="secret" readonly aria-label="Kopyalanacak değer" value="${h(value)}">
      <div class="inline"><button type="button" class="button primary" data-copy>Kopyala</button>
      <span class="hint" role="status" data-copy-status></span></div>`,
    init: (root) => {
      const input = root.querySelector("input");
      const status = root.querySelector("[data-copy-status]");
      root.querySelector("[data-copy]").addEventListener("click", async () => {
        if (await copyText(value)) status.textContent = "Kopyalandı.";
        else {
          input.select();
          status.textContent = "Değeri seçtim. Cihazınızın kopyalama komutunu kullanın.";
        }
      });
      input.focus();
      input.select();
    }
  });
}

function invite(ctx) {
  const secret = randomSecret();
  saveForm(ctx, {
    title: "Ekip daveti oluştur", section: "settings", action: "invite",
    html: field("Davetlinin e-postası", "email", "", { type: "email", max: 254 }) +
      select("Rol", "role", [["member", "Ekip üyesi"], ["admin", "Yönetici"]]) +
      '<p class="hint">Davet bağlantısı 7 gün geçerlidir. Davetli bu e-posta adresine bağlı hesapla giriş yapar.</p>',
    fields: (form) => ({ ...Object.fromEntries(form), secret }),
    after: async () => {
      showSecret(ctx, "Davet bağlantısı", "Bu bağlantıyı davetliyle paylaşın.", `${location.origin}/join.html#${secret}`);
      await ctx.changed("Davet oluşturuldu.");
    }
  });
}

function createPos(ctx) {
  const secret = randomSecret();
  saveForm(ctx, {
    title: "Kasa bağlantısı oluştur", section: "pos", action: "create",
    html: field("Bağlantı adı", "name", "", { max: 80 }) +
      '<p class="hint">Oluşturulan anahtarı kasa entegrasyonunun sunucu ayarlarında saklayın.</p>',
    fields: (form) => ({ name: form.get("name"), secret }),
    after: async () => {
      showSecret(ctx, "Kasa bağlantı anahtarı", "Anahtar yalnızca bu ekranda gösterilir. Kasa sağlayıcınızın sunucusunda saklayın.",
        `olvex_pos_${secret}`);
      await ctx.changed("Kasa anahtarı oluşturuldu.");
    }
  });
}

function posHelp(ctx) {
  const example = JSON.stringify({
    action: "sale", reference: "KASA-001", date: today(), paid: true,
    lines: [{ sku: "URUN-01", quantity: 2, unit: 12550 }]
  }, null, 2);
  editor(ctx, {
    title: "Kasa aktarım biçimi",
    html: `<p><code>POST ${h(location.origin)}/api/pos</code></p>
      <p><code>Authorization: Bearer olvex_pos_…</code></p>
      <pre>${h(example)}</pre>
      <p class="hint">Birim fiyat kuruş cinsinden bir tam sayıdır. SKU ürün kartıyla aynı olmalı. Bir fişi yeniden gönderirken aynı referansı kullanın.</p>
      <p>Tam iade için aynı referansla <code>{"action":"void","reference":"KASA-001"}</code> gönderin.</p>`
  });
}

function editMember(ctx, row) {
  saveForm(ctx, {
    title: "Ekip yetkisini düzenle", section: "settings", action: "member",
    html: `<p>${h(row.name || row.email)}</p>` +
      select("Rol", "role", [["member", "Ekip üyesi"], ["admin", "Yönetici"], ["remove", "İşletmeden çıkar"]], row.role),
    fields: (form) => ({ userId: row.id, role: form.get("role") }),
    message: "Ekip yetkisi güncellendi."
  });
}

function rename(ctx) {
  saveForm(ctx, {
    title: "İşletme adını düzenle", section: "settings", action: "rename",
    html: field("İşletme adı", "name", ctx.business.name, { max: 100 }),
    fields: (form) => ({ name: form.get("name") }),
    after: () => ctx.refreshBusinesses("İşletme adı güncellendi.")
  });
}

export function formCommand(ctx, cmd, row, id) {
  switch (cmd) {
    case "edit-product": return product(ctx, row);
    case "adjust-stock": return stock(ctx, row);
    case "archive-product": return archive(ctx, row, "products", "Ürün");
    case "edit-customer": return customer(ctx, row);
    case "archive-customer": return archive(ctx, row, "customers", "Müşteri");
    case "add-cash": return cash(ctx);
    case "edit-invoice": return invoice(ctx, row);
    case "edit-employee": return employee(ctx, row);
    case "archive-employee": return archive(ctx, row, "employees", "Çalışan");
    case "add-shift": return shift(ctx);
    case "edit-task": return task(ctx, row);
    case "rename-business": return rename(ctx);
    case "invite": return invite(ctx);
    case "edit-member": return editMember(ctx, row);
    case "create-pos": return createPos(ctx);
    case "pos-help": return posHelp(ctx);
    case "void-cash": return confirm(ctx, {
      title: "Nakit kaydı iptal edilsin mi?", message: `“${row.description}” kasa toplamlarından çıkarılacak.`,
      section: "finance", action: "void", data: { id }
    });
    case "remove-shift": return confirm(ctx, {
      title: "Vardiya kaldırılsın mı?", message: `“${row.name}” için planlanan bu vardiya takvimden kaldırılacak.`,
      section: "shifts", action: "remove", data: { id }
    });
    case "complete-task": return confirm(ctx, {
      title: "Görev tamamlansın mı?", message: row.repeat_rule === "none" ? row.title : `“${row.title}” tamamlanınca bir sonraki görev takvime eklenecek.`,
      section: "tasks", action: "complete", data: { id }, label: "Tamamla"
    });
    case "remove-task": return confirm(ctx, {
      title: "Görev kaldırılsın mı?", message: row.title, section: "tasks", action: "remove", data: { id }
    });
    case "revoke-invite": return confirm(ctx, {
      title: "Davet iptal edilsin mi?", message: "Bağlantı bu işlemden sonra kullanılamaz.",
      section: "settings", action: "revoke-invite", data: { id }
    });
    case "revoke-pos": return confirm(ctx, {
      title: "Kasa bağlantısı iptal edilsin mi?", message: `“${row.name}” anahtarından gelen yeni aktarımlar durur.`,
      section: "pos", action: "revoke", data: { id }
    });
    case "apply-proposal": return confirm(ctx, {
      title: "OLVEX AI işlemi onayı", message: proposalLabel(row),
      section: "ai", action: "apply", data: { id }, label: "Onayla ve uygula"
    });
    case "discard-proposal": return confirm(ctx, {
      title: "OLVEX AI taslağı reddedilsin mi?", message: proposalLabel(row),
      section: "ai", action: "discard", data: { id }, label: "Reddet"
    });
    default: return undefined;
  }
}
