import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");

const assetCopies = [
  ["node_modules/@xterm/xterm/lib/xterm.mjs", "src-web/vendor/xterm.mjs"],
  ["node_modules/@xterm/xterm/css/xterm.css", "src-web/vendor/xterm.css"],
  ["node_modules/@xterm/addon-fit/lib/addon-fit.mjs", "src-web/vendor/addon-fit.mjs"],
  ["node_modules/mermaid/dist/mermaid.min.js", "src-web/vendor/mermaid.min.js"],
];

await mkdir(resolve(rootDir, "src-web/vendor"), { recursive: true });

for (const [source, destination] of assetCopies) {
  await cp(resolve(rootDir, source), resolve(rootDir, destination));
}
