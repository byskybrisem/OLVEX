import { bindBrowserPreferences } from "./browser-preferences.js";

// The landing and account pages did not mount the preference banner.
// The authenticated app and policy page already share this same decision.
const banner = document.createElement("section");
banner.id = "site-cookie-banner";
banner.className = "site-cookie-banner";
banner.setAttribute("data-preference-banner", "");
banner.setAttribute("aria-labelledby", "site-cookie-title");
banner.hidden = true;
banner.innerHTML = `
  <h2 id="site-cookie-title">Çerez ve tarayıcı tercihleri</h2>
  <p>Oturumunuz için gerekli çerezleri kullanıyoruz. Son işletmenizi ve menü görünümünü yalnızca izin verirseniz hatırlarız.</p>
  <div class="site-cookie-actions">
    <button type="button" data-preference-choice="allow">Tümünü kabul et</button>
    <button type="button" data-preference-choice="deny">Tümünü reddet</button>
    <a href="/cookies.html#browser-preferences">Tercihleri yönet</a>
  </div>
  <p class="site-cookie-status" role="status" data-preference-status></p>`;
document.body.append(banner);
bindBrowserPreferences(banner);
