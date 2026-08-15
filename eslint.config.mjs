import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    rules: {
      // Data loading is intentionally client-side because Supabase sessions,
      // realtime/offline cache hydration and role-aware RLS live in the browser.
      "react-hooks/set-state-in-effect": "off",

      // A reference to a variable that no longer exists is a crash the moment
      // that line renders, and nothing else catches it: it type-checks, it
      // lints, it builds, and the tests pass, because none of them render the
      // screen. Renaming a variable and missing one use of it shipped a
      // bookings screen that threw the moment a booking was opened. On, from
      // now on.
      "no-undef": "error",
    },
  },
  {
    // Edge functions run on Deno, not in the browser.
    files: ["supabase/functions/**/*.ts"],
    languageOptions: { globals: { Deno: "readonly" } },
  },
  globalIgnores([".next/**", "node_modules/**", "coverage/**", "playwright-report/**"]),
]);
