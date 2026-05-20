import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const vendorDir = resolve(rootDir, "src-web/vendor");

await mkdir(vendorDir, { recursive: true });

await build({
  bundle: true,
  entryPoints: [resolve(scriptDir, "codemirror-entry.mjs")],
  format: "esm",
  outfile: resolve(vendorDir, "codemirror.bundle.mjs"),
  platform: "browser",
  sourcemap: false,
});
