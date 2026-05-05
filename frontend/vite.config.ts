import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(async () => {
  const isProductionBuild = process.env.NODE_ENV === "production";
  const plugins = [react()];

  if (!isProductionBuild) {
    const runtimeErrorOverlay = await import("@replit/vite-plugin-runtime-error-modal").then(
      (module) => module.default,
    );

    plugins.push(runtimeErrorOverlay());

    if (process.env.REPL_ID !== undefined) {
      const cartographer = await import("@replit/vite-plugin-cartographer").then(
        (module) => module.cartographer,
      );
      const devBanner = await import("@replit/vite-plugin-dev-banner").then(
        (module) => module.devBanner,
      );

      plugins.push(cartographer(), devBanner());
    }
  }

  const FASTAPI_PORT = process.env.FASTAPI_PORT || "5000";

  return {
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      },
    },
    root: path.resolve(import.meta.dirname, "client"),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port: 3000,
      // Proxy all /api requests to the FastAPI backend
      proxy: {
        "/api": {
          target: `http://localhost:${FASTAPI_PORT}`,
          changeOrigin: true,
          secure: false,
        },
      },
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
  };
});
