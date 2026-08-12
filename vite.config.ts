import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        assetFileNames: (asset) => asset.name === "eng.traineddata.gz"
          ? "assets/eng.traineddata.gz"
          : "assets/[name]-[hash][extname]",
      },
    },
  },
});
