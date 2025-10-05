import type { Express } from "express";
import path from "node:path";

export async function registerVite(app: Express) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  const { createServer: createViteServer } = await import("vite");

  const vite = await createViteServer({
    configFile: path.resolve(process.cwd(), "vite.config.ts"),
    server: { middlewareMode: true }
  });

  app.use(vite.middlewares);
}
