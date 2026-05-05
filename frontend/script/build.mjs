// Build script — frontend only.
// The backend is now pure FastAPI (Python). No Node.js server build needed.
// Run: node script/build.mjs
// Output: dist/public/ (served by FastAPI in production)

import { rm } from "fs/promises";
import { build as viteBuild } from "vite";

process.env.NODE_ENV = "production";

async function buildFrontend() {
  await rm("dist", { recursive: true, force: true });
  console.log("Building React frontend...");
  await viteBuild();
  console.log("Done — output in dist/public/");
  console.log("Start backend: .venv/Scripts/uvicorn fastapi_server.main:app --port 5000");
}

buildFrontend().catch((err) => {
  console.error(err);
  process.exit(1);
});
