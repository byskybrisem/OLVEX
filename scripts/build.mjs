import { cp, mkdir, rm } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const deployable = [
  "_headers", "_routes.json", "assets", "index.html", "app.html", "login.html", "register.html", "setup.html",
  "join.html", "forgot-password.html", "terms.html", "privacy.html", "contact.html"
];
for (const name of deployable) {
  await cp(new URL(`../${name}`, import.meta.url), new URL(name, dist), { recursive: true });
}
