import { defineConfig } from "vitest/config";

// Tests contra la API real de Hacienda: se corren aparte (npm run test:live) porque
// dependen de la red y de que el servicio de Hacienda esté disponible.
export default defineConfig({
  test: {
    include: ["src/**/*.live.ts"],
    testTimeout: 30_000,
  },
});
