import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const DATA_DIR = resolve(__dirname, "public/data");

// Watch the trace data dir and trigger a full reload when build.ts rewrites
// it. Vite's default watcher only tracks files imported by the module graph;
// public/ assets are served raw without HMR. This plugin closes that gap.
function dataDirHmr(): Plugin {
  return {
    name: "depth-viewer:data-hmr",
    configureServer(server) {
      server.watcher.add(`${DATA_DIR}/**/*.json`);
      const reload = (file: string) => {
        if (file.startsWith(DATA_DIR)) {
          server.ws.send({ type: "full-reload", path: "*" });
        }
      };
      server.watcher.on("change", reload);
      server.watcher.on("add", reload);
    },
  };
}

export default defineConfig({
  plugins: [react(), dataDirHmr()],
  server: {
    port: 5180,
    strictPort: false,
  },
});
