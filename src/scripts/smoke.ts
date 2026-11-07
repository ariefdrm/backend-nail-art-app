// Run against the compiled build: `node dist/scripts/smoke.js`.
// Catches Node-only failures (missing .js import extensions, Bun-only APIs).
import app from "../app.js";

if (typeof app !== "function" || typeof app.use !== "function") {
  console.error("smoke test failed: app is not an Express instance");
  process.exit(1);
}

console.log("smoke test passed");
