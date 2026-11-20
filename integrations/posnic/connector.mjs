import { setTimeout as delay } from "node:timers/promises";
import { branchDay, isoTime, objectId, requireValue, returnBlocks, returnPayload, salePayload } from "./mapping.mjs";
import { openState } from "./state.mjs";

const PAGE_SIZE = 100;
const FULL_SCAN_INTERVAL = 24 * 60 * 60 * 1000;
const MAX_PAGES_PER_CYCLE = 5;

class RequestError extends Error {
  constructor(endpoint, response, body) {
    super(`${endpoint} HTTP ${response.status}`);
    this.status = response.status;
    this.code = body?.error?.code;
    const retryAfter = response.headers.get("Retry-After");
    const seconds = /^\d+$/.test(retryAfter || "") ? Number(retryAfter) : (Date.parse(retryAfter) - Date.now()) / 1000;
    this.retryMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
  }
}

async function request(endpoint, url, token, { headers, payload } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: payload ? "POST" : "GET", signal: AbortSignal.timeout(12_000), redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`, Accept: "application/json", ...headers,
        ...(payload && { "Content-Type": "application/json" }),
      },
      ...(payload && { body: JSON.stringify(payload) }),
    });
  } catch {
    throw new Error(`${endpoint} bağlantısı kurulamadı veya zaman aşımına uğradı.`);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new RequestError(endpoint, response, body);
  requireValue(body && typeof body === "object", `${endpoint} geçerli JSON dönmedi.`);
  return body;
}

export function openConnector(config) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const db = openState(config);
  const settings = db.prepare("SELECT value FROM settings WHERE key = ?");
  const write = db.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)");
  const saved = (key) => settings.get(key)?.value || "";
  const event = db.prepare("SELECT * FROM events WHERE action = ? AND reference = ?");
  const saleEvent = db.prepare("SELECT * FROM events WHERE action = 'sale' AND sale_id = ?");
  const stage = db.prepare("INSERT INTO events(action, reference, sale_id, physical, session, payload) VALUES (?, ?, ?, ?, ?, ?)");
  const pending = db.prepare("SELECT * FROM events WHERE sent = 0 ORDER BY sequence LIMIT 1");
  const acknowledged = db.prepare("UPDATE events SET sent = 1 WHERE sequence = ?");
  const addDeletion = db.prepare("INSERT OR IGNORE INTO deletions(sale_id, at) VALUES (?, ?)");
  const removeDeletion = db.prepare("DELETE FROM deletions WHERE sale_id = ?");
  const sessions = new Map();

  function transaction(callback) {
    db.exec("BEGIN");
    try {
      callback();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async function get(label, path, query) {
    const url = new URL(path, config.posnicOrigin);
    url.search = new URLSearchParams(query);
    return request(label, url, config.posnicToken, { headers: { "x-branch-id": config.sourceBranch } });
  }

  async function registerFor(session) {
    requireValue(objectId(session), "Satışta geçerli Posnic kasa oturumu bulunamadı.");
    if (sessions.has(session)) return sessions.get(session);
    const { data } = await get("Posnic kasa oturumu", "/api/registers/getCashRegister", { id: session });
    requireValue(data?._id === session && objectId(data.register_id), "Posnic fiziksel kasa kimliği doğrulanamadı.");
    if (sessions.size === 2048) sessions.delete(sessions.keys().next().value);
    sessions.set(session, data.register_id);
    return data.register_id;
  }

  function stageEvent(body, id, physical, session) {
    const previous = event.get(body.action, body.reference);
    const payload = JSON.stringify(body);
    if (previous) {
      requireValue(previous.sale_id === id && previous.physical === physical && previous.session === session &&
        previous.payload === payload, "Daha önce görülen Posnic işleminin içeriği veya kasa eşlemesi değişti.");
      return;
    }
    stage.run(body.action, body.reference, id, physical, session, payload);
  }

  async function deliverPending() {
    for (let next = pending.get(); next; next = pending.get()) {
      const { businessId, branchId, registerId, token } = config.routes.get(next.physical);
      try {
        const result = await request("OLVEX /api/pos", new URL("/api/pos", config.olvexOrigin), token, {
          payload: { ...JSON.parse(next.payload), businessId, branchId, registerId },
        });
        requireValue(result.success === true && typeof result.id === "string", "OLVEX işlem onayı eksik.");
        acknowledged.run(next.sequence);
      } catch (error) {
        error.message = `${next.action} ${next.reference}: ${error.message}`;
        throw error;
      }
    }
  }

  async function stageSale(sale) {
    requireValue(objectId(sale?._id), "Posnic satış kimliği geçersiz.");
    const known = saleEvent.get(sale._id);
    if (sale.branch_id !== config.sourceBranch || sale.license !== config.sourceLicense) {
      requireValue(!known && sale.branch_id !== config.sourceBranch, "Posnic işleminin lisans veya şube kapsamı değişti.");
      return;
    }
    if (sale.status === "cancelled" && !known) return;
    if (!known && (["Hold", "Quote", "Estimate", "Draft"].includes(sale.sale_process) ||
      ["draft", "pending"].includes(sale.status) ||
      (sale.sale_process === "KOT" && sale.payment_status === "Unpaid"))) return;

    const day = branchDay(sale.date, formatter);
    if (!known && day < config.startOn) return;
    requireValue(!sale.return_refund_lock, "Posnic iade işlemi henüz tamamlanmadı.");
    const session = sale.cashregister_id;
    requireValue(!known || known.session === session, "Posnic satışının kasa oturumu değişti.");
    const physical = known?.physical ?? await registerFor(session);
    requireValue(config.routes.has(physical), "Posnic fiziksel kasasının OLVEX eşlemesi eksik.");
    const prior = known && JSON.parse(known.payload);
    const cancelled = sale.status === "cancelled";
    const priorVoid = prior && event.get("void", prior.reference);
    if (priorVoid) {
      requireValue(cancelled, "İptal edilmiş Posnic satışı yeniden açıldı.");
      return;
    }
    requireValue(cancelled || ["Add", "Edit", "PartialReturn", "FullReturn", "KOT"].includes(sale.sale_process),
      "Posnic satış türü desteklenmiyor.");
    const blocks = returnBlocks(sale);
    requireValue(blocks.length > 0 || cancelled || !["PartialReturn", "FullReturn"].includes(sale.sale_process),
      "İade durumundaki Posnic satışında iade kaydı bulunamadı.");
    const usePrior = prior && (cancelled || (blocks.length && !sale.business_item_origin));
    const original = usePrior ? prior : salePayload(sale, blocks, formatter);
    const returns = blocks.map(block => returnPayload(original, block, formatter));
    const returnIds = new Set(returns.map(entry => entry.reference));
    requireValue(returnIds.size === returns.length, "Posnic satışı yinelenen iade kimlikleri içeriyor.");
    const previousReturns = db.prepare("SELECT reference FROM events WHERE sale_id = ? AND action = 'return'").all(sale._id);
    requireValue(previousReturns.every(row => returnIds.has(row.reference)), "Posnic satışındaki önceki iade kayıtları değişti.");
    const remaining = new Map(original.lines.map(({ sku, quantity }) => [sku, quantity]));
    for (const refund of returns) {
      for (const line of refund.lines) {
        const quantity = remaining.get(line.sku) - line.quantity;
        requireValue(quantity >= 0, "Posnic iade toplamı özgün satış miktarını aşıyor.");
        remaining.set(line.sku, quantity);
      }
    }
    transaction(() => {
      stageEvent(original, sale._id, physical, session);
      for (const refund of returns) stageEvent(refund, sale._id, physical, session);
      if (cancelled) stageEvent({
        action: "void", reference: original.reference, date: branchDay(sale.updated_date, formatter),
      }, sale._id, physical, session);
    });
  }

  async function scanSales() {
    if (!saved("scan-active") && Date.now() - Number(saved("last-full")) >= FULL_SCAN_INTERVAL) {
      transaction(() => {
        write.run("sales-cursor", "");
        write.run("delete-cursor", "");
        write.run("scan-active", "1");
      });
    }
    for (let page = 0; page < MAX_PAGES_PER_CYCLE; page++) {
      let cursor = saved("sales-cursor");
      const { data, meta } = await get("Posnic satış listesi", "/api/v1/sales",
        { limit: PAGE_SIZE, ...(cursor && { cursor }) });
      requireValue(Array.isArray(data) && meta?.count === data.length && data.length <= PAGE_SIZE &&
        (meta.next_cursor === null || typeof meta.next_cursor === "string"), "Posnic satış listesi veya sayfalama geçersiz.");
      for (const sale of data) {
        requireValue(objectId(sale?._id), "Posnic satış kimliği geçersiz.");
        let next = "";
        if (sale.updated_date != null) {
          next = Buffer.from(`${isoTime(sale.updated_date)}|${sale._id}`).toString("base64url");
          const previous = Buffer.from(cursor, "base64url").toString();
          requireValue(Buffer.from(next, "base64url").toString() > previous,
            "Posnic satış imleci ileri gitmedi.");
        } else {
          // v1 cannot continue through a page boundary containing old rows
          // with missing update times. Never skip such a page silently.
          requireValue(!cursor, "Posnic satış listesinde sırasız veya eksik güncelleme tarihi bulundu.");
        }
        try {
          await stageSale(sale);
        } catch (error) {
          error.message = `Posnic satış ${sale._id}: ${error.message}`;
          throw error;
        }
        await deliverPending();
        if (next) {
          write.run("sales-cursor", next);
          cursor = next;
        }
      }
      if (meta.next_cursor === null) {
        if (saved("scan-active")) transaction(() => {
          write.run("last-full", String(Date.now()));
          write.run("scan-active", "");
        });
        return false;
      }
      requireValue(data.length === PAGE_SIZE && cursor && meta.next_cursor === cursor,
        "Posnic sonraki sayfa imleci doğrulanamadı.");
    }
    return true;
  }

  async function readDeletions() {
    for (let page = 0; page < MAX_PAGES_PER_CYCLE; page++) {
      let from = saved("delete-cursor");
      const { data } = await get("Posnic satış değişiklik günlüğü", "/api/sales/getDataChanges", from ? { from } : {});
      requireValue(Array.isArray(data) && data.length <= PAGE_SIZE, "Posnic değişiklik listesi geçersiz.");
      transaction(() => {
        for (const change of data) {
          requireValue(objectId(change?._id) && change._id > from, "Posnic değişiklik günlüğü imleci geçersiz.");
          from = change._id;
          if (change.operation !== "delete" || change.module !== "sales" ||
              change.license !== config.sourceLicense || change.branch_id !== config.sourceBranch) continue;
          requireValue(objectId(change.docId), "Posnic silme kaydında satış kimliği eksik.");
          addDeletion.run(change.docId, isoTime(change.time));
        }
        if (from) write.run("delete-cursor", from);
      });
      if (data.length < PAGE_SIZE) return false;
    }
    return true;
  }

  async function confirmDeletions() {
    // Unknown historical deletions have no imported sale to reverse. Retain
    // their log markers in case a later API scan discovers the original sale.
    const rows = db.prepare(`SELECT d.at, e.* FROM deletions d
      JOIN events e ON e.sale_id = d.sale_id AND e.action = 'sale'
      WHERE d.checked_at <= ? ORDER BY d.checked_at, d.sale_id LIMIT 50`).all(Date.now() - 60_000);
    for (const row of rows) {
      try {
        await get("Posnic satış ayrıntısı", `/api/v1/sales/${row.sale_id}`);
        // Posnic writes the log before deleting the sale. It can also abort.
        db.prepare("UPDATE deletions SET checked_at = ? WHERE sale_id = ?").run(Date.now(), row.sale_id);
      } catch (error) {
        if (error.status !== 404 || error.code !== "not_found") throw error;
        transaction(() => {
          if (!event.get("void", row.reference)) stageEvent(
            { action: "void", reference: row.reference, date: branchDay(row.at, formatter) },
            row.sale_id, row.physical, row.session,
          );
          removeDeletion.run(row.sale_id);
        });
        await deliverPending();
      }
    }
  }

  async function sync() {
    await deliverPending();
    // Prefer processing the current sale snapshot (including returns) before
    // reversing a sale. A transient deletion may only be observable in its log.
    const salesRemaining = await scanSales();
    const changesRemaining = await readDeletions();
    await confirmDeletions();
    return salesRemaining || changesRemaining;
  }

  return {
    sync,
    reconcile() {
      transaction(() => {
        write.run("sales-cursor", "");
        write.run("delete-cursor", "");
        write.run("scan-active", "1");
      });
    },
    close: () => db.close(),
  };
}

export function runLoop(connector, signal, onError) {
  let wake = new AbortController();
  let requested = false;
  const requestSync = () => {
    requested = true;
    wake.abort();
  };

  async function run() {
    let retry = 0;
    while (!signal.aborted) {
      requested = false;
      wake = new AbortController();
      let next;
      try {
        const more = await connector.sync();
        retry = 0;
        next = more || requested ? 1000 : 30_000;
      } catch (error) {
        retry = Math.min(retry + 1, 7);
        onError(error.message);
        next = Math.max(Math.min(1000 * 2 ** retry, 120_000), Math.min(error.retryMs || 0, 300_000));
      }
      const pause = retry || requested ? signal : AbortSignal.any([signal, wake.signal]);
      await delay(next, undefined, { signal: pause }).catch((error) => {
        if (error.name !== "AbortError") throw error;
      });
    }
  }

  return { requestSync, run };
}
