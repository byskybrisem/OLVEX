import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

export async function localPages({ seed, legacyWorkspaceSeed, https = false, bindings = {}, registration = "preview" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "olvex-test-"));
  const dbId = crypto.randomUUID();
  const config = join(dir, "wrangler.test.toml");
  // Local D1 export reads Wrangler's default persistence directory.
  const storage = join(dir, ".wrangler", "state");
  const testEnv = {
    OLVEX_SIGNUPS: registration,
    OLVEX_AI_MODE: "mock",
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
    return run(process.execPath, [cli, ...args], { cwd: dir, env: environment, timeout: 120_000 });
  }

  try {
    const assets = ["_headers", "_routes.json", "sitemap.xml", "favicon.ico", "assets", "index.html", "demo.html", "app.html", "login.html", "register.html", "setup.html",
      "join.html", "forgot-password.html", "terms.html", "privacy.html", "contact.html", "scripts", "scene"];
    await Promise.all([...assets, "functions", ...(legacyWorkspaceSeed ? [] : ["migrations"])].map((name) =>
      cp(join(root, name), join(dir, name), { recursive: true })));
    await symlink(join(root, "node_modules"), join(dir, "node_modules"), "dir");
    await run(process.execPath, ["scripts/build.mjs"], { cwd: dir, env: environment });
    await writeFile(config, `name = "olvex-test"\ncompatibility_date = "2025-10-01"\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "olvex-test"\ndatabase_id = "${dbId}"\nmigrations_dir = "migrations"\n`);
    const dbArgs = (path = storage) => ["DB", "--local", "--config", config, "--persist-to", path];
    const migrate = () => wrangler("d1", "migrations", "apply", ...dbArgs());
    const replayFile = (name) => wrangler("d1", "execute", ...dbArgs(), "--file", join(dir, "migrations", name));
    const query = async (sql, path = storage) => {
      const { stdout } = await wrangler("d1", "execute", ...dbArgs(path), "--command", sql, "--json");
      return JSON.parse(stdout).map((statement) => statement.results);
    };
    const applyFixture = async (sql) => {
      const fixture = join(dir, "fixture.sql");
      await writeFile(fixture, sql);
      await wrangler("d1", "execute", ...dbArgs(), "--file", fixture);
    };

    let restoredQuery;
    if (legacyWorkspaceSeed) {
      const migrations = join(dir, "migrations");
      // Install the last production schema, then exercise the upgrade on genuine old rows.
      await mkdir(migrations);
      for (const filename of ["0001_auth.sql", "0002_workspace.sql"]) {
        await cp(join(root, "migrations", filename), join(migrations, filename));
      }
      await migrate();
      await applyFixture(legacyWorkspaceSeed);
      const backup = join(dir, "pre-upgrade.sql");
      await wrangler("d1", "export", "DB", "--local", "--config", config, "--output", backup);
      const restore = join(dir, "isolated-restore");
      await wrangler("d1", "execute", ...dbArgs(restore), "--file", backup);
      restoredQuery = (sql) => query(sql, restore);
      await cp(join(root, "migrations"), migrations, { recursive: true });
    }
    await migrate();
    if (seed) await applyFixture(seed);

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

    const startupDeadline = Date.now() + 90_000;
    while (Date.now() < startupDeadline) {
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
          return { url, close, query, migrate, replayFile, restoredQuery, logs: () => logs };
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
