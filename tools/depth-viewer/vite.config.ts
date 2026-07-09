import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { rebuildPlugin } from "./rebuild-plugin";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(HERE, "public/data");

// Watch the trace data dir and tell the app to re-fetch when build.ts rewrites
// it. Vite's default watcher only tracks files imported by the module graph;
// public/ assets are served raw without HMR. We send a custom event rather than
// a `full-reload` so the app can swap in the new dataset *in place* — keeping
// the user's selected file/symbol — instead of losing all context to a reload.
// build.ts writes three JSON files back-to-back, so the notification is
// debounced to fire once after the last write lands.
function dataDirHmr(): Plugin {
  return {
    name: "depth-viewer:data-hmr",
    apply: "serve",
    configureServer(server) {
      server.watcher.add(`${DATA_DIR}/**/*.json`);
      let timer: ReturnType<typeof setTimeout> | null = null;
      const notify = (file: string) => {
        if (!file.startsWith(DATA_DIR)) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          server.ws.send({ type: "custom", event: "depth:data-changed" });
        }, 200);
      };
      server.watcher.on("change", notify);
      server.watcher.on("add", notify);
    },
  };
}

export default defineConfig({
  plugins: [react(), dataDirHmr(), rebuildPlugin()],
  server: {
    port: 5180,
    strictPort: false,
  },
});
