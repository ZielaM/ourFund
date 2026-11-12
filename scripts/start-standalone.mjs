// Runs the production build the same way the Docker image does:
// the standalone server plus the static assets it does not bundle on its own.
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const standaloneDir = resolve(".next/standalone");
const serverFile = resolve(standaloneDir, "server.js");

if (!existsSync(serverFile)) {
  console.error("No production build found. Run `pnpm build` first.");
  process.exit(1);
}

cpSync(resolve(".next/static"), resolve(standaloneDir, ".next/static"), { recursive: true });

if (existsSync("public")) {
  cpSync(resolve("public"), resolve(standaloneDir, "public"), { recursive: true });
}

await import(pathToFileURL(serverFile).href);
