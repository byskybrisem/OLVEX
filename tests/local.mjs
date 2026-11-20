import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { appendFile, cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const cli = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const environment = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" };

async function openPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}

export async function localPages({ seed, legacyWorkspaceSeed, https = false, bindings = {}, registration = "preview", professionalFixtures = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "olvex-test-"));
  const dbId = crypto.randomUUID();
  const config = join(dir, "wrangler.test.toml");
  const storage = join(dir, "local-data");
  const testEnv = {
    OLVEX_SIGNUPS: registration,
    OLVEX_AI_MODE: "mock",
    ...(professionalFixtures ? { OLVEX_BILLING: "sandbox" } : {}),
    ...bindings
  };
  let worker;
  let logs = "";
  async function close() {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGTERM");
      await once(worker, "exit");
    }
    await rm(dir, { recursive: true, force: true });
  }

  async function wrangler(...args) {
    const timeout = args[1] === "migrations" ? 120_000 : 30_000;
    return run(process.execPath, [cli, ...args], { cwd: dir, env: environment, timeout });
  }

  try {
    const assets = ["_headers", "_routes.json", "sitemap.xml", "robots.txt", "favicon.ico", "assets", "index.html", "demo.html", "app.html", "admin.html", "login.html", "register.html", "setup.html",
      "join.html", "forgot-password.html", "terms.html", "privacy.html", "contact.html",
  "pre-information.html", "distance-service-agreement.html", "subscription-terms.html", "cookies.html", "billing.html",
      "account.html", "account-rights.html", "scripts", "scene"];
    await Promise.all([...assets, "functions", "migrations"].map((name) =>
      cp(join(root, name), join(dir, name), { recursive: true })));
    if (legacyWorkspaceSeed) await appendFile(join(dir, "migrations", "0002_workspace.sql"), "\n" + legacyWorkspaceSeed);
    await symlink(join(root, "node_modules"), join(dir, "node_modules"), "dir");
    await run(process.execPath, ["scripts/build.mjs"], { cwd: dir, env: environment });
    await writeFile(config, `name = "olvex-test"\ncompatibility_date = "2025-10-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "olvex-test"\ndatabase_id = "${dbId}"\nmigrations_dir = "migrations"\n`);
    const dbArgs = ["DB", "--local", "--config", config, "--persist-to", storage];
    await wrangler("d1", "migrations", "apply", ...dbArgs);
    if (professionalFixtures) {
      // Test-only paid records make existing feature tests go through standard plan checks.
      const fixture = join(dir, "plans.sql");
      const columns = "(id,business_id,environment,plan,plan_ref,state,provider_ref,customer_ref,paid_until)";
      const row = id => "'test-plan-'||" + id + "," + id +
        ",'sandbox','profesyonel-monthly','test-plan','active','test-sub-'||" + id + ",'test-customer',4070908800000";
      await writeFile(fixture, [
        "INSERT INTO olvex_subscriptions " + columns + " SELECT " + row("id") + " FROM businesses;",
        "CREATE TRIGGER test_paid_plan AFTER INSERT ON businesses BEGIN INSERT INTO olvex_subscriptions " +
          columns + " VALUES (" + row("NEW.id") + "); END;"
      ].join("\n"));
      await wrangler("d1", "execute", ...dbArgs, "--file", fixture);
    }
    if (seed) {
      const fixture = join(dir, "fixture.sql");
      await writeFile(fixture, seed);
      await wrangler("d1", "execute", ...dbArgs, "--file", fixture);
    }

    const port = await openPort();
    const protocol = https ? "https" : "http";
    const url = `${protocol}://127.0.0.1:${port}`;
    worker = spawn(process.execPath, [cli, "pages", "dev", "dist", "--local-protocol", protocol, "--ip", "127.0.0.1", "--port", String(port),
      "--compatibility-date", "2025-10-01", "--d1", `DB=${dbId}`, "--persist-to", storage,
      "--show-interactive-dev-session=false", "--log-level", "warn",
      ...Object.entries(testEnv).flatMap(([key, value]) => ["--binding", `${key}=${value}`])
    ], { cwd: dir, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    worker.stdout.on("data", (chunk) => { logs = (logs + chunk).slice(-5000); });
    worker.stderr.on("data", (chunk) => { logs = (logs + chunk).slice(-5000); });

    for (let attempt = 0; attempt < 90; attempt++) {
      if (worker.exitCode !== null || worker.signalCode !== null) break;
      try {
        const health = url + "/api/health";
        const ready = https ? await new Promise((resolve, reject) => {
          httpsGet(health, { rejectUnauthorized: false }, response => {
            response.resume();
            resolve(response.statusCode === 200);
          }).on("error", reject);
        }) : (await fetch(health)).ok;
        if (ready) {
          const query = async (sql) => {
            const { stdout } = await wrangler("d1", "execute", ...dbArgs, "--command", sql, "--json");
            return JSON.parse(stdout).map((statement) => statement.results);
          };
          return { url, close, query, logs: () => logs };
        }
      } catch {}
      await delay(180);
    }
    throw new Error(`Yerel Pages sunucusu başlatılamadı.\n${logs}`);
  } catch (error) {
    await close();
    throw error;
  }
}
