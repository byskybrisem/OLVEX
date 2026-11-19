import { day, h, money } from "./ui.js";

export function salesChart(days) {
  if (!days.some(row => row.sales > 0 || row.sales < 0)) {
    if (days.some(row => row.grossSales > 0 || (row.saleActivity && !row.receipts))) {
      return '<div class="chart-empty"><strong>Net satış toplamı ₺0,00</strong><p>Bu dönemdeki satış, iade ve iptal hareketlerinin net tutarı sıfır.</p></div>';
    }
    if (days.some(row => row.receipts > 0 || row.saleCount > 0)) {
      return '<div class="chart-empty"><strong>Satış toplamı ₺0,00</strong><p>Bu dönemde kaydedilen satışların tutarı sıfır.</p></div>';
    }
    return '<div class="chart-empty"><strong>Seçilen dönemde satış tutarı yok</strong><p>Satış kaydedildiğinde tutarı burada görebilirsiniz.</p></div>';
  }
  const buckets = [];
  const size = Math.ceil(days.length / 8);
  for (let start = 0; start < days.length; start += size) {
    const group = days.slice(start, start + size);
    const first = day(group[0].day);
    const range = group.length === 1 ? first : first + " – " + day(group.at(-1).day);
    const total = group.reduce((sum, row) => sum + row.sales, 0);
    buckets.push({ total, range, label: range + " · " + money(total) });
  }
  const amounts = buckets.map(bucket => bucket.total);
  const peak = Math.max(0, ...amounts);
  const floor = Math.min(0, ...amounts);
  const height = value => peak === floor ? 51 : 10 + 82 * (peak - value) / (peak - floor);
  const zero = height(0);
  const ticks = [...new Set([peak, (peak + floor) / 2, floor])];
  const points = buckets.map(({total}, index) => ({
    x: buckets.length === 1 ? 50 : 4 + 92 * index / (buckets.length - 1),
    y: height(total)
  }));
  const path = points.map(({x,y}, index) => {
    if (!index) return `M ${x} ${y}`;
    const previous = points[index - 1];
    const middle = (previous.x + x) / 2;
    return `C ${middle} ${previous.y}, ${middle} ${y}, ${x} ${y}`;
  }).join(" ");
  const axisMoney = new Intl.NumberFormat("tr-TR", {
    style: "currency", currency: "TRY", notation: "compact", maximumFractionDigits: 1
  });
  const last = points.at(-1);
  return `<figure class="sales-chart">
    <figcaption><span class="series-key">Net satış seyri</span><output>${h(buckets.at(-1).label)}</output></figcaption>
    <div class="plot-wrap"><div class="plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#9b8cff" stop-opacity=".38"/><stop offset="1" stop-color="#9b8cff" stop-opacity=".015"/></linearGradient></defs>
      ${ticks.map(value => `<path class="guide" d="M0 ${height(value)} H100"/>`).join("")}
      ${floor < 0 && peak > 0 && !ticks.includes(0) ? `<path class="guide" d="M0 ${zero} H100"/>` : ""}
      <path class="area" d="${path} L ${last.x} ${zero} L ${points[0].x} ${zero} Z"/>
      <path class="trend" d="${path}"/></svg>
      ${points.map(({x,y}, i) => `<button type="button" class="chart-point" style="left:${x}%;top:${y}%" aria-label="${h(buckets[i].label)}" aria-pressed="${i === points.length - 1}"></button>`).join("")}
    </div><div class="plot-labels" aria-hidden="true">${ticks.map(v =>
        `<small style="top:${height(v)}%">${h(axisMoney.format(v/100))}</small>`).join("")}</div></div><div class="chart-axis"><span>${h(day(days[0].day))}</span>${days.length > 1 ? h(day(days.at(-1).day)) : ""}</div>
    <details class="chart-data"><summary>Grafik verilerini göster</summary>
      <table aria-label="Dönemlere göre net satış tutarları"><thead><tr><th scope="col">Tarih aralığı</th><th scope="col">Net satış tutarı</th></tr></thead>
      <tbody>${buckets.map(({range, total}) => `<tr><th scope="row">${h(range)}</th><td>${h(money(total))}</td></tr>`).join("")}</tbody></table>
    </details>
  </figure>`;
}

export function bindSalesChart(container) {
  function inspect(event) {
    const point = event.target.closest(".chart-point");
    if (!point) return;
    const chart = point.closest("figure");
    for (const other of chart.querySelectorAll(".chart-point")) {
      other.setAttribute("aria-pressed", String(other === point));
    }
    chart.querySelector("output").textContent = point.getAttribute("aria-label");
  }
  container.addEventListener("click", inspect);
  container.addEventListener("focusin", inspect);
  container.addEventListener("pointerover", inspect);
}
