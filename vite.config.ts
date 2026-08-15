import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        text: resolve(import.meta.dirname, "index.html"),
        image: resolve(import.meta.dirname, "image/index.html"),
      },
      output: {
        assetFileNames: (asset) => asset.name === "eng.traineddata.gz"
          ? "assets/eng.traineddata.gz"
          : "assets/[name]-[hash][extname]",
      },
    },
  },
});
