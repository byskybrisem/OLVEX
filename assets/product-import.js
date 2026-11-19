
import { editor } from "./editor.js";
import { lookup, lookupField } from "./orders.js";
import { csvDownload, h, toMinor } from "./ui.js";

const columns = {
  name: ["urun", "urunadi", "name", "product", "productname"],
  sku: ["barkod", "barcode", "sku", "urunkodu"],
  price: ["fiyat", "satisfiyati", "price"],
  cost: ["maliyet", "alisfiyati", "cost"],
  opening: ["stok", "acilisstogu", "opening", "stock"],
  reorder: ["kritik", "kritikstok", "reorder", "reorderat"],
  category: ["kategori", "category"]
};

function normalized(value) {
  return String(value).toLocaleLowerCase("tr-TR").replaceAll("ı", "i")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseCsv(content) {
  const first = content.split(/\r?\n/, 1)[0];
  const delimiter = (first.match(/;/g) || []).length >=
    (first.match(/,/g) || []).length ? ";" : ",";

  const rows = [];
  let row = [], cell = "", quoted = false;
  const source = content.replace(/^\uFEFF/, "");

  for (let i = 0; i < source.length; i++) {
    const c = source[i];

    if (c === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" && !quoted) {
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r" || quoted) {
      cell += c;
    }
  }

  if (quoted) throw new Error("CSV dosyasında kapatılmamış tırnak var.");

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function number(value, label, row) {
  const input = value.trim() || "0";
  if (!/^\d+$/.test(input) || Number(input) > 10000000) {
    throw new Error(
      `${row}. satır: ${label} 0 ile 10.000.000 arasında olmalı.`
    );
  }
  return Number(input);
}

function readProducts(content) {
  const rows = parseCsv(content);

  if (rows.length < 2) {
    throw new Error("Başlık satırı ve en az bir ürün gerekli.");
  }
  if (rows.length > 1001) {
    throw new Error("Bir dosyada en fazla 1.000 ürün yükleyin.");
  }

  const headers = rows.shift().map(normalized);
  const positions = Object.fromEntries(
    Object.entries(columns).map(([key, names]) => [
      key, headers.findIndex(header => names.includes(header))
    ])
  );

  if (positions.name < 0 || positions.price < 0) {
    throw new Error("CSV dosyasında 'Ürün' ve 'Fiyat' sütunları bulunmalı.");
  }

  const used = new Set();

  return rows.map((row, index) => {
    const line = index + 2;
    const get = key => positions[key] < 0
      ? "" : (row[positions[key]] || "").trim();

    const name = get("name");
    const sku = get("sku").toUpperCase();
    const category = get("category");

    if (!name || name.length > 120) {
      throw new Error(`${line}. satır: Geçerli ürün adı gerekli.`);
    }
    if (sku.length > 64 || category.length > 60) {
      throw new Error(`${line}. satır: Barkod veya kategori çok uzun.`);
    }
    if (sku && used.has(sku)) {
      throw new Error(`${line}. satır: ${sku} barkodu tekrar ediyor.`);
    }
    if (sku) used.add(sku);

    let price, cost;
    try {
      price = toMinor(get("price"));
      cost = toMinor(get("cost") || "0");
    } catch {
      throw new Error(
        `${line}. satır: Geçerli fiyat girin. Örnek: 35,50.`
      );
    }

    if (price > 100000000 || cost > 100000000) {
      throw new Error(`${line}. satır: Fiyat üst sınırı aşıldı.`);
    }

    return {
      name, sku, category, price, cost,
      opening: number(get("opening"), "Stok", line),
      reorder: number(get("reorder"), "Kritik stok", line)
    };
  });
}

export function importProducts(ctx) {
  let items = [];
  let batches = [];
  let completed = 0;
  let chosenBranch = "";

  editor(ctx, {
    title: "Toplu ürün ekle",
    label: "Ürünleri kaydet",
    html: `
      <p class="hint">
        CSV dosyası yükleyin. Excel'den CSV olarak kaydedebilirsiniz.
        Ürün ve Fiyat zorunludur; diğer sütunlar isteğe bağlıdır.
      </p>
      <button type="button" class="button secondary" data-template>
        Örnek CSV indir
      </button>
      <label class="field">
        CSV dosyası
        <input type="file" accept=".csv,text/csv" data-product-file>
      </label>
      ${lookupField(
        "Ürünlerin ekleneceği şube", "branchId", "Şube seçin", true
      )}
      <p class="hint" data-product-status role="status">
        Önce CSV dosyası seçin.
      </p>
      <div data-product-preview></div>
    `,

    init(root) {
      lookup(ctx, root, {
        section: "locations",
        field: "branchId",
        label: "şube",
        labelFor: branch => branch.name,
        selectOnlyOption: true
      });

      const fileInput = root.querySelector("[data-product-file]");
      const status = root.querySelector("[data-product-status]");
      const preview = root.querySelector("[data-product-preview]");
      const save = root.closest("form")
        .querySelector('[type="submit"]');

      save.disabled = true;

      root.querySelector("[data-template]").onclick = () => {
        csvDownload("olvex-urun-sablonu.csv", [
          ["Ürün", "Barkod", "Fiyat", "Maliyet",
            "Stok", "Kritik", "Kategori"],
          ["Kola 330 ml", "ORNEK-001", "35,50", "25,00",
            "24", "6", "İçecek"]
        ]);
      };

      fileInput.onchange = async () => {
        items = [];
        batches = [];
        completed = 0;
        save.disabled = true;
        preview.replaceChildren();

        const file = fileInput.files?.[0];

        if (!file) {
          status.textContent = "CSV dosyası seçin.";
          return;
        }
        if (file.size > 2000000) {
          status.textContent = "Dosya 2 MB'ı aşmamalı.";
          return;
        }

        try {
          items = readProducts(await file.text());
          status.textContent =
            `${items.length} ürün hazır. Kaydetmeden önce kontrol edin.`;

          preview.innerHTML = `
            <p class="hint">İlk 5 ürün:</p>
            <ol>${items.slice(0, 5).map(item =>
              `<li>${h(item.name)} ·
              ${h(item.sku || "Barkodsuz")} ·
              ${(item.price / 100).toFixed(2)} TL ·
              ${item.opening} adet</li>`
            ).join("")}</ol>
          `;

          save.disabled = false;
        } catch (error) {
          status.textContent = error.message;
        }
      };
    },

    async submit(_form, _send, root) {
      if (!items.length) {
        throw new Error("Önce geçerli bir CSV dosyası seçin.");
      }

      const status = root.querySelector("[data-product-status]");

      if (!batches.length) {
        chosenBranch = root.querySelector('[name="branchId"]').value;

        if (!chosenBranch) {
          throw new Error("Ürünlerin ekleneceği şubeyi seçin.");
        }

        for (let i = 0; i < items.length; i += 25) {
          batches.push({
            requestId: crypto.randomUUID(),
            items: items.slice(i, i + 25)
          });
        }

        root.querySelector("[data-product-file]").disabled = true;
        root.querySelector('[name="branchId"]').disabled = true;
      }

      for (; completed < batches.length;) {
        const batch = batches[completed];

        try {
          await ctx.post("products", "bulk", {
            ...batch,
            branchId: chosenBranch
          });
        } catch (error) {
          status.textContent =
            `${Math.min(completed * 25, items.length)} ürün kaydedildi. ` +
            "Hata giderilince aynı ekrandan tekrar deneyin.";
          throw error;
        }

        completed++;
        status.textContent =
          `${Math.min(completed * 25, items.length)} / ` +
          `${items.length} ürün kaydedildi.`;
      }

      return { count: items.length };
    },

    done: result => ctx.changed(
      `${result.count} ürün kaydedildi.`
    )
  });
}
