import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["sim/**/*.test.ts", "sim/**/*.test.tsx", "ui/**/*.test.ts", "ui/**/*.test.tsx"],
    globals: false,
    setupFiles: [],
  },
});
