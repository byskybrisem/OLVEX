import { day, h, money } from "./ui.js";

export function salesChart(days) {
  if (!days.length || !days.some(row => row.sales > 0)) {
    return '<div class="chart-empty"><strong>Seçilen dönemde satış tutarı yok</strong><p>Satış kaydedildiğinde tutarı burada görebilirsiniz.</p></div>';
  }
  const buckets = [];
  const size = Math.ceil(days.length / 8);
  for (let start = 0; start < days.length; start += size) {
    const group = days.slice(start, start + size);
    const first = day(group[0].day);
    const range = group.length === 1 ? first : first + " – " + day(group.at(-1).day);
    const total = group.reduce((sum, row) => sum + row.sales, 0);
    buckets.push({ total, label: range + " · " + money(total) });
  }
  const peak = Math.max(...buckets.map(bucket => bucket.total));
  const points = buckets.map(({total}, index) => ({
    x: buckets.length === 1 ? 50 : 4 + 92 * index / (buckets.length - 1),
    y: 92 - 82 * total / peak
  }));
  const path = points.map(({x,y}, i) => (i ? "L" : "M") + x + " " + y).join(" ");
  const last = points.at(-1);
  return `<figure class="sales-chart">
    <figcaption><span>Dönem toplamları</span><output>${h(buckets.at(-1).label)}</output></figcaption>
    <div class="plot"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path class="area" d="${path} L ${last.x} 92 L ${points[0].x} 92 Z"/>
      <path class="trend" d="${path}"/></svg>
      ${points.map(({x,y}, i) => `<button type="button" class="chart-point" style="left:${x}%;top:${y}%" aria-label="${h(buckets[i].label)}" aria-pressed="${i === points.length - 1}"></button>`).join("")}
    </div><div class="chart-axis"><span>${h(day(days[0].day))}</span>${days.length > 1 ? h(day(days.at(-1).day)) : ""}</div>
  </figure>`;
}

export function bindSalesChart(container) {
  container.addEventListener("click", event => {
    const point = event.target.closest(".chart-point");
    if (!point) return;
    const chart = point.closest("figure");
    for (const other of chart.querySelectorAll(".chart-point")) {
      other.setAttribute("aria-pressed", String(other === point));
    }
    chart.querySelector("output").textContent = point.getAttribute("aria-label");
  });
}
