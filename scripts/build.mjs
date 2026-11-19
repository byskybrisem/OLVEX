import { cp, mkdir, rm } from "node:fs/promises";

import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const dist = new URL("../dist/", import.meta.url);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const deployable = [ 
  "_headers", "_routes.json", "sitemap.xml", "favicon.ico", "assets", "index.html", "app.html", "demo.html", "login.html", "register.html", "setup.html",
  "join.html", "forgot-password.html", "terms.html", "privacy.html", "contact.html"
];
for (const name of deployable) {
  await cp(new URL(`../${name}`, import.meta.url), new URL(name, dist), { recursive: true });
}

// Keep the renderer outside the initial page graph. Pages serves it from our origin.
await build({
  entryPoints: [fileURLToPath(new URL("../scene/core.js", import.meta.url))],
  outfile: fileURLToPath(new URL("assets/core-scene.js", dist)),
  bundle: true, minify: true, format: "esm", target: "es2020", legalComments: "eof"
});
