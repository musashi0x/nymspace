import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

/**
 * Next 16 removed the `next lint` subcommand, so linting is the ESLint CLI
 * directly (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md`).
 * The bare word `lint` was being parsed as a positional project directory,
 * which is why the old script failed looking for `apps/web/lint`.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
