import { spawnSync } from "node:child_process";
import path from "node:path";

const heapLimitMb = 640;
const inheritedOptions = (process.env.NODE_OPTIONS || "")
  .replace(/--max[-_]old[-_]space[-_]size(?:=|\s+)\d+/g, "")
  .replace(/--max[-_]semi[-_]space[-_]size(?:=|\s+)\d+/g, "")
  .trim();
const nodeOptions = [
  inheritedOptions,
  `--max-old-space-size=${heapLimitMb}`,
  "--max-semi-space-size=16"
].filter(Boolean).join(" ");

console.log(`Low-memory build: 1 worker, Node heap limit ${heapLimitMb} MB.`);

const result = spawnSync(
  process.execPath,
  [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "build", "--webpack"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_OPTIONS: nodeOptions,
      UV_THREADPOOL_SIZE: "2"
    },
    stdio: "inherit"
  }
);

if (result.error) {
  console.error("Unable to start the low-memory build:", result.error.message);
}
if (result.signal) {
  console.error(`Build process stopped by signal ${result.signal}.`);
}
process.exit(result.status ?? 1);
