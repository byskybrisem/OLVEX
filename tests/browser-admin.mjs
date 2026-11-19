import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { randomToken, sha256 } from "../functions/_lib/session.js";
import { today } from "../functions/_lib/validate.js";
import { localPages } from "./local.mjs";

const adminId="11111111-1111-4111-8111-111111111111";
const tenantId="22222222-2222-4222-8222-222222222222";
const token=randomToken(), otherToken=randomToken();
const seed=`
 INSERT INTO users(id,email,full_name) VALUES
 ('${adminId}','admin-ui@example.test','Platform Yöneticisi'),
 ('${tenantId}','tenant-ui@example.test','İşletme Hesabı');
 INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES
 ('${crypto.randomUUID()}','${adminId}','${await sha256(token)}','2099-01-01T00:00:00.000Z'),
 ('${crypto.randomUUID()}','${tenantId}','${await sha256(otherToken)}','2099-01-01T00:00:00.000Z');
`;
const local=await localPages({seed,https:true,bindings:{OLVEX_SUPER_ADMIN_USER_ID:adminId}});
const executablePath=process.env.CHROMIUM_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
let browser;
try {
  browser=await chromium.launch({executablePath,args:["--enable-unsafe-swiftshader"]});
  const context=await browser.newContext({locale:"tr-TR",ignoreHTTPSErrors:true,viewport:{width:1366,height:860}});
  await context.route("**/*",route=>new URL(route.request().url()).origin===local.url ? route.continue():route.abort());
  await context.addCookies([{name:"olvex_session",value:token,url:local.url,secure:true,httpOnly:true,sameSite:"Lax"}]);
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(local.url+"/admin.html");
  await page.locator('#admin-content[aria-busy="false"]').waitFor();
  await page.getByRole("heading",{name:"Genel Bakış",level:1}).waitFor();
  await page.getByText("Toplam işletme").waitFor();
  assert.equal(await page.locator("#admin-content > .admin-kpis > .admin-kpi").count(),4);
  assert.equal(await page.locator(".admin-sidebar.glass").count(),1);
  const snapshots=process.env.OLVEX_SCREENSHOT_DIR;
  if(snapshots){await mkdir(snapshots,{recursive:true});await page.screenshot({path:join(snapshots,"admin-desktop.png"),fullPage:true,animations:"disabled"});}
  const fits=()=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);
  assert.equal(await fits(),true,"Desktop must not scroll horizontally");
  await page.setViewportSize({width:390,height:844});
  assert.equal(await fits(),true,"Mobile dashboard must not overflow");
  await page.getByRole("button",{name:"Menüyü aç"}).click();
  await page.locator('#admin-sidebar.open').waitFor();
  await page.locator('a[data-admin-view="finance"]').click();
  await page.locator('#admin-content[aria-busy="false"]').waitFor();
  await page.getByRole("heading",{name:"Gelir / Gider",level:1}).waitFor();
  assert.equal(await fits(),true,"Mobile finance must not overflow");
  await page.getByRole("button",{name:"+ Yeni gelir / gider"}).click();
  const dialog=page.locator("#admin-ledger-dialog");
  await dialog.waitFor({state:"visible"});
  await dialog.locator('[name="kind"]').selectOption("income");
  await dialog.locator('[name="occurredOn"]').fill(today());
  await dialog.locator('[name="amount"]').fill("1250,50");
  await dialog.locator('[name="category"]').fill("Danışmanlık");
  await dialog.locator('[name="description"]').fill("Yönetici arayüz testi");
  await dialog.getByRole("button",{name:"Kaydet"}).click();
  await dialog.waitFor({state:"hidden"});
  await page.locator('#admin-content[aria-busy="false"]').waitFor();
  await page.getByText("Yönetici arayüz testi").waitFor();
  assert.match(await page.locator("#admin-content").innerText(), /1\.250,50/);
  if(snapshots)await page.screenshot({path:join(snapshots,"admin-mobile-finance.png"),fullPage:true,animations:"disabled"});
  page.once("dialog",modal=>modal.accept());
  await page.locator('button[data-void-id]').click();
  await page.getByText("İptal edilmiş").waitFor();
  await page.setViewportSize({width:320,height:700});
  assert.equal(await fits(),true,"320px layout must not overflow");
  assert.deepEqual(errors,[],"No browser JavaScript exceptions");

  const unauthorized=await browser.newContext({locale:"tr-TR",ignoreHTTPSErrors:true});
  await unauthorized.addCookies([{name:"olvex_session",value:otherToken,url:local.url,secure:true,httpOnly:true,sameSite:"Lax"}]);
  const other=await unauthorized.newPage();
  await other.goto(local.url+"/admin.html");
  await other.getByText("Bu bölüme erişim yetkiniz yok.").first().waitFor();
  assert.equal(await other.locator(".admin-kpi").count(),0);
  await unauthorized.close();
  await context.close();
  console.log("OLVEX Control desktop/mobile/auth/finance browser tests passed");
} finally {
  await browser?.close();
  await local.close();
}
