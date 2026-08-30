import { defineConfig } from "vitest/config";

// The finding/ranges/report-extract prompt builders read the current date and local-timezone
// getters (patient age, overdue-marker windows). Pinned so a standalone `npm test` here can't
// disagree with the app's own TZ=UTC-pinned run over the same golden fixtures.
export default defineConfig({
  test: { env: { TZ: "UTC" } },
});
