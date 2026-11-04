import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../scoop/package.json"));
const tsxCli = join(dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
const child = spawnSync(process.execPath, [tsxCli, join(here, "watch-wave.ts"), ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(child.status === null ? 1 : child.status);
