import { editor, select, field } from "./editor.js";
import { h } from "./ui.js";

const deviceTypes = {
  ynokc: "Yeni nesil yazarkasa POS (YN ÖKC)",
  computer: "Bilgisayarlı barkodlu satış kasası",
  other: "Diğer / emin değilim"
};
const vendors = {
  beko: "Beko / Token",
  worldline: "Worldline / Ingenico",
  profilo: "Profilo / Propay",
  hugin: "Hugin",
  paygo: "Paygo",
  other: "Diğer marka",
  unknown: "Markayı bilmiyorum"
};
const programs = {
  wolvox_fast: "AKINSOFT WOLVOX Hızlı Satış",
  wolvox_restaurant: "AKINSOFT WOLVOX Restoran",
  wolvox_other: "AKINSOFT WOLVOX (diğer modül)",
  other: "Başka bir satış yazılımı",
  builtin: "Kasanın kendi yazılımı / ayrıca program yok",
  unknown: "Yazılımı bilmiyorum"
};
const akins = new Set(["wolvox_fast", "wolvox_restaurant", "wolvox_other"]);
const official = (label, url) =>
  `<a href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(label)}</a>`;

export function posGuideData({ kind, vendor, program, model = "" }) {
  if (!Object.hasOwn(deviceTypes, kind) || !Object.hasOwn(programs, program)) return null;
  if (kind === "ynokc" && !Object.hasOwn(vendors, vendor)) return null;
  const vendorName = kind === "ynokc" ? vendors[vendor] : deviceTypes[kind];
  const programName = programs[program];
  const wolvox = akins.has(program);
  const steps = [];
  if (kind === "ynokc") {
    steps.push("Yazarkasa POS'un marka ve modelini, kasanın kullanıldığı şubeyi ve varsa teknik servis bilgilerini doğrulayın.");
    if (wolvox) {
      steps.push("AKINSOFT yetkili destek ekibinden bu cihaz ve WOLVOX sürümü için YN ÖKC / GMP-3 bağlantı desteğini teyit edin. WOLVOX'un cihaza bağlanması, OLVEX'e otomatik veri aktarımı kurulduğu anlamına gelmez.");
    } else {
      steps.push("Cihaz üreticisi veya yetkili servisinden satış kayıtlarını API, izinli rapor/dışa aktarım ya da desteklenen bir entegrasyon üzerinden alıp alamayacağınızı öğrenin.");
    }
  } else if (wolvox) {
    steps.push("AKINSOFT WOLVOX satışların kaydedildiği programı, sürümünü ve şubenizi doğrulayın.");
  } else {
    steps.push("Satış kayıtlarının bulunduğu programı ve şubeyi belirleyin. Yazılımı bilmiyorsanız kasayı kuran firma veya servisle görüşün.");
  }
  if (wolvox) {
    steps.push("AKINSOFT yetkili destek veya bayinizden fiş bazında kalıcı işlem kimliği, tarih, SKU, miktar ve fiyat içeren izinli bir dışa aktarım veya belgeli API olanağı isteyin. OLVEX için hazır bir WOLVOX bağlayıcısı henüz sunulmuyor.");
  } else {
    steps.push("Sağlayıcıdan değişmeyen fiş kimliği, tarih, ürün SKU'su, miktar ve fiyat bilgilerini alabileceğiniz bir dosya/API yöntemi olup olmadığını sorun.");
  }
  steps.push("CSV aktarımı mümkünse veriyi OLVEX'in örnek şablonuyla eşleştirip Satışlar → CSV içe aktar bölümünü kullanın. Kaynak kasa kaydı, şube ve fiş kimliğini kontrol edin.");
  steps.push("Doğrulanmış bir entegrasyon yazılımı satışları OLVEX API'sine gönderebiliyorsa her fiziksel kasa için ayrı bağlantı anahtarı oluşturun. Anahtar tek başına kasa bağlantısını başlatmaz; denemeyi ayrı test işletmesinde yapın.");
  const links = [];
  if (wolvox) {
    links.push(["AKINSOFT WOLVOX Yazarkasa Otomasyonu", "https://www.akinsoft.com.tr/programlar/detay/wolvox-yazarkasa-otomasyonu--wyz9"]);
    if (vendor === "worldline") links.push(["AKINSOFT Worldline ÖKC bilgisi", "https://www.akinsoft.com.tr/okc-entegrasyonu/worldline"]);
    if (vendor === "profilo") links.push(["AKINSOFT Profilo ÖKC bilgisi", "https://www.akinsoft.com.tr/okc-entegrasyonu/profilo"]);
  }
  if (kind === "ynokc") links.push(["GİB – Yeni Nesil ÖKC sık sorulan sorular", "https://ynokc.gib.gov.tr/Home/SSS"]);
  const name = [kind === "ynokc" ? vendorName : "Kasa", wolvox ? programName.replace("AKINSOFT ", "") : program === "builtin" ? "Satış" : programName].join(" · ").slice(0, 76);
  return { vendorName, programName, wolvox, name, steps, links, model: model.trim().slice(0, 80) };
}

export function showPosSetupGuide(ctx, { onCreate }) {
  editor(ctx, {
    title: "Kasanızı ve yazılımınızı seçin",
    html: `<div class="pos-picker">
      <p class="muted">Kasa veya satış programını seçin. Size uygun, doğrulanabilir bir kurulum rehberi göstereceğiz.</p>
      ${select("1. Kasa türü", "deviceKind", [["", "Kasa türünü seçin"], ...Object.entries(deviceTypes)], "", true)}
      <div data-vendor-group hidden>
        ${select("2. Yazarkasa POS markası", "deviceVendor", [["", "Markayı seçin"], ...Object.entries(vendors)])}
        ${field("Model (isteğe bağlı)", "deviceModel", "", { required: false, max: 80 })}
      </div>
      ${select("3. Satış / kasa yazılımı", "deviceProgram", [["", "Yazılımı seçin"], ...Object.entries(programs)], "", true)}
      <button type="button" class="button primary" data-pos-show-guide>Kurulum rehberini göster</button>
      <p class="hint" role="status" data-pos-validation></p>
      <section class="pos-guide-result" data-pos-result hidden aria-labelledby="pos-guide-heading">
        <h3 id="pos-guide-heading" tabindex="-1">Size uygun bağlantı rehberi</h3>
        <p class="pos-guide-selection" data-pos-summary></p>
        <p class="pos-guide-caution">Bu seçim henüz kasa bağlantısı kurmaz. OLVEX'te bu markalar için tak-çalıştır entegrasyon bulunmuyor.</p>
        <ol data-pos-steps></ol>
        <p class="hint">Yazarkasa POS'un mali fiş veya ödeme işlevlerini OLVEX değiştirmez. Yetkili servis ve GİB uyum kuralları geçerlidir.</p>
        <div class="pos-guide-links" data-pos-links></div>
        <div class="pos-guide-actions">
          <a class="button secondary" href="/assets/olvex-kasa-ornek.csv" download>CSV örneği indir</a>
          <button class="button secondary" type="button" data-pos-create-key>API anahtarı oluştur</button>
        </div>
        <p class="hint">API anahtarı yalnızca satışları OLVEX'e gönderebilen bir bağlayıcı mevcutsa kullanılabilir. CSV veya manuel aktarım için önce bu rehberi uygulayın.</p>
      </section>
    </div>`,
    init(root) {
      const kind = root.querySelector('[name="deviceKind"]');
      const vendor = root.querySelector('[name="deviceVendor"]');
      const program = root.querySelector('[name="deviceProgram"]');
      const model = root.querySelector('[name="deviceModel"]');
      const group = root.querySelector("[data-vendor-group]");
      const result = root.querySelector("[data-pos-result]");
      const status = root.querySelector("[data-pos-validation]");
      const renderVendor = () => {
        group.hidden = kind.value !== "ynokc";
        vendor.required = kind.value === "ynokc";
        if (group.hidden) vendor.value = "";
        result.hidden = true;
        status.textContent = "";
      };
      kind.addEventListener("change", renderVendor);
      for (const node of [vendor, program, model]) node.addEventListener("input", () => { result.hidden = true; status.textContent = ""; });
      renderVendor();
      let current = null;
      root.querySelector("[data-pos-show-guide]").addEventListener("click", () => {
        const invalid = !kind.value ? kind : kind.value === "ynokc" && !vendor.value ? vendor : !program.value ? program : null;
        if (invalid) {
          status.textContent = "Önce kasa türünü, markasını (varsa) ve satış yazılımını seçin.";
          invalid.focus();
          return;
        }
        current = posGuideData({ kind: kind.value, vendor: vendor.value, program: program.value, model: model.value });
        if (!current) return;
        root.querySelector("[data-pos-summary]").textContent = [current.vendorName, current.model, current.programName].filter(Boolean).join(" · ");
        root.querySelector("[data-pos-steps]").innerHTML = current.steps.map(step => `<li>${h(step)}</li>`).join("");
        root.querySelector("[data-pos-links]").innerHTML = current.links.length
          ? "<strong>Resmî kaynaklar</strong>" + current.links.map(([label, url]) => official(label, url)).join("")
          : "";
        result.hidden = false;
        status.textContent = "";
        root.querySelector("#pos-guide-heading").focus({ preventScroll: true });
        result.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      root.querySelector("[data-pos-create-key]").addEventListener("click", () => {
        if (result.hidden || !current) return;
        onCreate(current);
      });
    }
  });
}
