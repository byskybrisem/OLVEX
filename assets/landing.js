const $=s=>document.querySelector(s),RM=matchMedia("(prefers-reduced-motion: reduce)").matches;
const I=p=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${p}"/></svg>`;
const R=a=>a.map(([t,d,p])=>`<div class="mr">${p?`<span class="ic">${I(p)}</span>`:""}<h3>${t}</h3><p>${d}</p></div>`).join("");
const M=[
["Genel Bakış","İşletmenizin bütün önemli verileri tek ekranda.","M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"],
["Satış Yönetimi","Günlük satışlar, ürün performansı ve satış kanalları.","M4 19V5M4 19h16M8 15l3-4 3 2 5-6"],
["Ürün Yönetimi","Ürünler, kategoriler, fiyatlar ve maliyetler.","M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"],
["Stok ve Depo","Stok hareketleri, sayım düzeltmeleri ve kritik stok uyarıları.","M3 9l9-5 9 5-9 5zM3 14l9 5 9-5"],
["Satın Alma","Tedarikçi ve sipariş yönetimi.","M3 4h2l2 11h11l2-8H7M9 20h.01M17 20h.01"],
["Müşteri Yönetimi","CRM, müşteri geçmişi ve ilişkileri.","M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6"],
["Finans","Gelir, gider, nakit akışı, kâr ve zarar.","M12 21a9 9 0 100-18 9 9 0 000 18zM12 6v2M12 16v2M14.5 9.5C14 8.5 13 8 12 8c-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5"],
["Fatura ve Belgeler","Belge ve fatura takibi.","M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6"],
["Personel","Çalışanlar, görevler ve vardiyalar.","M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20c0-3.5 3-5 7-5s7 1.5 7 5M17 4.5a3.5 3.5 0 010 6.5M19 15c2 .6 3 2 3 5"],
["Görev ve Takvim","İş planlama ve tekrarlayan görevler.","M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15l2 2 4-4"],
["Şube Yönetimi","Birden fazla işletme veya şubeyi birlikte yönetin.","M4 21V8l8-4 8 4v13M9 21v-6h6v6M4 21h16"],
["Raporlar","İşletme performansı ve finansal analiz.","M5 20V10M12 20V4M19 20v-7"],
["OLVEX AI","Akıllı işletme danışmanı.","M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"],
["Ayarlar","İşletme, kullanıcı, yetki ve abonelik yönetimi.","M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M8 15v4"]];
const A=[
["Stok uyarısı","Depoda 86 adet simit kaldı. Son 7 günlük satış hızına göre stok yaklaşık 2 gün yetecek. Tükenmeden yeni sipariş vermeni öneriyorum.","stok kaydı ve son 7 günlük satışlar"],
["Kâr analizi","Simit satışlarından brüt kârın 8.400 TL. Un ve enerji maliyeti arttığı için ürün başına kârın geçen aya göre %7 azaldı.","satışlar ve ürün maliyetleri (bu ay, geçen ay)"],
["Satış fırsatı","En çok simit sattığın saatlerde poğaça satışların düşük kalıyor. Ürünleri birlikte sunarak sepet başına geliri artırmayı deneyebilirsin.","saatlik satış dağılımı ve ürün bazlı satışlar"],
["Gider kontrolü","Elektrik giderin son üç ayda %22 arttı. Bu artışın kârlılığa etkisini incelemeni öneriyorum.","gider kayıtları (son 3 ay)"],
["Tahmin","Son haftalardaki satış eğilimine göre hafta sonu talebinin artması bekleniyor. Bu bir tahmindir, kesin sonuç değildir.","haftalık satış eğilimi",1],
["Eksik veri","Poğaçanın maliyetini girmediğin için bu ürünün kârlılığını hesaplayamıyorum. Maliyeti eklersen analiz ederim.","poğaça maliyet kaydı",2]];
const S=[
["İşletmenizi tanımlayın","Ürünlerinizi, stoklarınızı ve işletme bilgilerinizi ekleyin; satış ve giderlerinizi kaydetmeye başlayın."],
["OLVEX verinizi analiz eder","Satış, stok, maliyet ve gider kayıtları birlikte değerlendirilir; trendler ve sorunlar tespit edilir."],
["Önerileri uygulayın","Her öneri dayandığı verilerle sunulur. Neyi neden yapmanız gerektiğini net görürsünüz."]];
const W=[
["Esnaf ve mahalle işletmeleri","Bakkal, market veya fırın: günlük satışı, stoğu ve gelir-gideri sade ekranlarla takip edin, kritik stok uyarılarını alın."],
["Mağazalar ve e-ticaret","Ürün, fiyat ve maliyetleri tek yerde tutun; hangi ürünün gerçekten kâr getirdiğini görün."],
["Restoran ve kafeler","Malzeme stoğunu, tedarikçi alışlarını ve vardiyaları birlikte yönetin; yoğun saatleri analiz edin."],
["Şirketler ve çok şubeli yapılar","Şubeleri karşılaştırın, ekiplere yetki verin; finansı ve performansı tek merkezden izleyin."]];
const G=[
["Rol bazlı yetkilendirme","Kimin neyi görüp değiştirebileceğini siz belirlersiniz.","M6 11h12v9H6zM9 11V8a3 3 0 016 0v3"],
["Veri sahipliği","İşletme verileri işletmeye aittir; gizlilik ilkeleri açık ve anlaşılır yazılır.","M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"],
["Verinin korunması","Hassas verilerin korunması tasarımın merkezindedir; yaklaşımımız ürün geliştikçe şeffaf biçimde paylaşılır.","M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"],
["Dürüst iletişim","Sahip olmadığımız hiçbir sertifikayı veya güvenlik standardını varmış gibi göstermeyiz.","M5 12l4 4 10-10"]];
const Q=[
["OLVEX kimler için?","Mahalle esnafından çok şubeli şirketlere kadar her ölçekteki işletme için tasarlanıyor. Teknik bilgi gerektirmeyen sade bir deneyim hedefliyoruz."],
["OLVEX AI veri uydurur mu?","Yanıtlar işletme özetine dayanır ve eksik veya hatalı olabilir. İşlem taslakları yetkili kullanıcı onayıyla kaydedilir."],
["Ücretsiz plan var mı?","Evet. Başlangıç planı ücretsizdir: temel işletme profili, sınırlı ürün ve kayıt yönetimi ile temel gösterge paneli içerir. Tam AI danışmanlığı ücretli planlarda sunulur."],
["Yıllık ödemede indirim var mı?","Lansman planlarında yıllık ödeme için %20 indirim öngörülüyor."],
["Birden fazla şubeyi yönetebilir miyim?","Erişiminiz olan işletmeleri panelden açabilir ve satış toplamlarını karşılaştırabilirsiniz."],
["Mobil uygulama olacak mı?","Evet. Web sitesiyle aynı marka kimliğine sahip bir mobil uygulama planlıyoruz."],
["Fiyatlar kesin mi?","Gösterilen fiyatlar önerilen lansman fiyatlarıdır ve yayına alınmadan önce güncellenebilir."]];
const P=[
{n:"Başlangıç",p:0,d:"Yeni başlayan işletmeler için.",f:["Temel işletme profili","Sınırlı ürün ve kayıt yönetimi","Temel gösterge paneli"],ai:"Tam AI danışmanlığı yok",b:"Ücretsiz Başla"},
{n:"Esnaf",p:499,d:"Günlük işini düzene sokan esnaf için.",f:["Satış, stok ve gelir-gider","Müşteri yönetimi","Temel raporlama"],ai:"Sınırlı OLVEX AI",b:"Esnaf’ı Seç"},
{n:"Profesyonel",p:999,d:"Büyüyen işletmeler için.",f:["Tüm temel modüller","Gelişmiş raporlar","Otomatik analiz ve öneriler"],ai:"Daha yüksek AI kullanım hakkı",b:"Profesyonel’i Seç",hot:1},
{n:"Business",p:2499,d:"Çok şubeli ve kurumsal yapılar için.",f:["Çoklu şube yönetimi","Gelişmiş yetkilendirme","Personel ve gelişmiş işletme raporları"],ai:"Kapsamlı AI analizleri",b:"Business’ı Seç"}];
const L=["AI kullanım limiti","Kullanıcı sayısı","Şube sayısı"];

const fm=n=>Math.round(n).toLocaleString("tr-TR");
function cnt(e,a,b,ms=1400){
  const p=e.dataset.p||"",s=e.dataset.s||"",put=v=>{e.textContent=p+fm(v)+s};
  if(RM||a==b){put(b);return}
  const t0=performance.now();
  (function f(t){const k=Math.min((t-t0)/ms,1);put(a+(b-a)*(1-Math.pow(1-k,3)));if(k<1)requestAnimationFrame(f)})(t0);
}
let y=0;const pv=P.map(x=>x.p);
function pr(){
  $("#plans").innerHTML=P.map(x=>{const v=Math.round(x.p*(y?.8:1));return `<article class="pl${x.hot?" hot":""}"><h3>${x.n}</h3><div class="pp"><b>${fm(v)}</b> TL<span> /ay</span></div><small>${x.p?(y?"Planlanan yıllık ücret, %20 indirimli":"Planlanan aylık ücret"):"Ücretsiz plan"}</small><p class="pd">${x.d}</p><ul>${x.f.map(f=>`<li>${f}</li>`).join("")}<li class="ai">${x.ai}</li></ul><div class="lm">${L.map(l=>`<span>${l}: <b>Belirlenecek</b></span>`).join("")}</div><a class="btn" href="${x.p ? "/contact.html" : "/register.html"}">${x.p ? "Paket bilgisi" : x.b}</a></article>`}).join("");
  $("#plans").querySelectorAll(".pp b").forEach((e,i)=>{const v=Math.round(P[i].p*(y?.8:1));cnt(e,pv[i],v,650);pv[i]=v});
}
/* hero chart */
const cd=[38,50,44,58,52,68,60,76,66,84,72,92],CW=600,CH=170,
pt=a=>a.map((v,i)=>[i*CW/11,CH-8-v/100*(CH-16)]),
sm=p=>p.reduce((d,[x,y],i,a)=>i?d+`C${(a[i-1][0]+x)/2},${a[i-1][1]} ${(a[i-1][0]+x)/2},${y} ${x},${y}`:`M${x},${y}`,""),
p1=pt(cd),d1=sm(p1),d2=sm(pt(cd.map(v=>v*.5+6)));
$("#ch").innerHTML=`<svg viewBox="0 0 ${CW} ${CH}" aria-hidden="true"><defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#635BFF" stop-opacity=".3"/><stop offset="1" stop-color="#635BFF" stop-opacity="0"/></linearGradient></defs>${[.25,.5,.75].map(f=>`<line x1="0" x2="${CW}" y1="${CH*f}" y2="${CH*f}" stroke="var(--l)"/>`).join("")}<path class="da" d="${d1}L${CW},${CH}L0,${CH}Z" fill="url(#ga)"/><path class="dl" pathLength="1" d="${d2}" fill="none" stroke="#12B8A6" stroke-width="2.5" stroke-linecap="round"/><path class="dl" pathLength="1" d="${d1}" fill="none" stroke="#635BFF" stroke-width="3" stroke-linecap="round"/><circle class="dd" cx="${p1[11][0]}" cy="${p1[11][1]}" r="5" fill="#635BFF" stroke="var(--s)" stroke-width="2.5"/></svg>`;
$("#sb").innerHTML=`<div class="sl"><svg aria-hidden="true"><use href="#lm"/></svg>OLVEX</div>`+[0,1,2,3,6,11].map(i=>`<div${i?"":' class="on"'}>${I(M[i][2])}${M[i][0]}</div>`).join("");
document.querySelectorAll("[data-i]").forEach(e=>{e.innerHTML=I(M[+e.dataset.i][2])});
/* sections */
$("#mods").innerHTML=R(M);
$("#who").innerHTML=R(W.map((w,i)=>[w[0],w[1],M[[3,2,4,10][i]][2]]));
$("#sec").innerHTML=R(G);
$("#ais").innerHTML=A.map(([t,x,b,f])=>`<div class="ar"><span${f?` class="${f==1?"f":"g"}"`:""}>${t}</span><p>${x}</p><small>${f==2?"Eksik veri":"Dayandığı veri"}: ${b}</small></div>`).join("");
$("#steps").innerHTML=S.map(([t,x],i)=>`<div><b>${i+1}</b><h3>${t}</h3><p>${x}</p></div>`).join("");
$("#faq").innerHTML=Q.map(([q,a])=>`<details><summary>${q}</summary><p>${a}</p></details>`).join("");
const tg=$("#tg"),tb=tg.querySelectorAll("button");tg.dataset.y=0;
tb.forEach((b,i)=>{b.onclick=()=>{if(y==i)return;y=i;tg.dataset.y=i;tb.forEach((c,j)=>c.setAttribute("aria-pressed",j==i));pr()}});
pr();
/* scroll reveal and counters */
if("IntersectionObserver" in window){
 const io=new IntersectionObserver(es=>es.forEach(x=>{if(x.isIntersecting){x.target.classList.add("in");io.unobserve(x.target)}}),{threshold:.12,rootMargin:"0px 0px -5% 0px"});
 function rv(e,i=0){e.style.setProperty("--d",Math.min(i,8)*70+"ms");e.classList.add("rv");io.observe(e)}
 if(!RM){
  document.documentElement.classList.add("js");
  ["#mods","#who","#sec","#ais","#steps","#plans","#faq"].forEach(s=>[...$(s).children].forEach((e,i)=>rv(e,i)));
  document.querySelectorAll(".sh,.tg,.pr,.nt,.fin").forEach(e=>rv(e));
 }
}
setTimeout(()=>document.querySelectorAll(".dash [data-n]").forEach(n=>cnt(n,0,+n.dataset.n)),500);
