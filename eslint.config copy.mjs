// eslint.config.mjs
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettierConfig from "eslint-plugin-prettier/recommended";
const eslintConfig = defineConfig([
  ...nextVitals,
  prettierConfig, // Add Prettier config to the extends array
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
