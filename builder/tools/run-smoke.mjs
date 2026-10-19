/* Golden-path smoke: build the app, serve dist, drive the New Demo flow in a
   real browser with a mocked backend, plus the objectives-compiler tests.
   Run from builder/: npm run smoke  (CHROMIUM_PATH env to pin a browser). */
import { spawn, execSync } from "child_process";

const run = (cmd, args, opts = {}) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { stdio: "inherit", ...opts });
  p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} → exit ${code}`))));
});

try {
  execSync("node tools/parse-objectives.test.mjs", { stdio: "inherit" });
  execSync("node tools/api-kinds.test.mjs", { stdio: "inherit" });
  execSync("node tools/maya.test.mjs", { stdio: "inherit" });
  await run("npm", ["run", "build"]);
  const server = spawn("node", ["tools/smoke-serve.mjs"], { stdio: "inherit" });
  await new Promise((r) => setTimeout(r, 800));
  try {
    await run("node", ["tools/smoke-newdemo.mjs"]);
    console.log("\nSMOKE: ALL GREEN — the golden path (intake → build → apply → settings) works.");
  } finally {
    server.kill();
  }
} catch (e) {
  console.error(`\nSMOKE: RED — ${e.message}`);
  process.exit(1);
}
