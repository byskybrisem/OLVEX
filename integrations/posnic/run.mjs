import { once } from "node:events";
import { loadConfig } from "./config.mjs";
import { openConnector, runLoop } from "./connector.mjs";
import { webhookServer } from "./webhook.mjs";

async function main() {
  const [path, mode, ...rest] = process.argv.slice(2);
  if (!path || rest.length || (mode && mode !== "--reconcile")) {
    throw new Error("Kullanım: node integrations/posnic/run.mjs <ayar.json> [--reconcile]");
  }
  if (process.platform !== "win32") process.umask(0o077);
  const config = await loadConfig(path);
  const connector = openConnector(config);
  const stop = new AbortController();
  const loop = runLoop(connector, stop.signal, message => console.error(`Posnic aktarımı: ${message}`));
  const server = webhookServer(config.webhookSecret, loop.requestSync);
  process.once("SIGINT", () => stop.abort());
  process.once("SIGTERM", () => stop.abort());
  try {
    if (mode === "--reconcile") connector.reconcile();
    server.listen(config.port, "127.0.0.1");
    await once(server, "listening");
    console.info(`Posnic bağlayıcısı 127.0.0.1:${config.port} üzerinde çalışıyor.`);
    await loop.run();
  } finally {
    server.close();
    connector.close();
  }
}

main().catch(error => {
  // JSON syntax errors can quote input. Keep secrets and raw HTTP payloads out of logs.
  console.error(error instanceof SyntaxError || error instanceof TypeError ? "Posnic ayar dosyası geçersiz." : error.message);
  process.exitCode = 1;
});
