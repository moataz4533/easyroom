import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      // Data loading is intentionally client-side because Supabase sessions,
      // realtime/offline cache hydration and role-aware RLS live in the browser.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "coverage/**", "playwright-report/**"]),
]);
