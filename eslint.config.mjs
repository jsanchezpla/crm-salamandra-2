import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

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
  {
    // `set-state-in-effect` (regla del React Compiler) marca un patrón
    // intencional y extendido en el CRM: fijar loading/estado local dentro de
    // un useEffect de carga de datos. No es un bug. Lo dejamos como warning
    // (sigue visible) para no bloquear PRs por esta deuda preexistente, dado
    // que el CI lintea el fichero cambiado entero.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
