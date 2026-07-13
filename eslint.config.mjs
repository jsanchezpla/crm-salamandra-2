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
    // intencional y extendido en el CRM: resetear el estado local de un
    // panel/formulario al cambiar la entidad seleccionada
    // (useEffect(() => { if (sel) setX(sel.y) }, [sel?.id])). No es un bug.
    // Lo dejamos como warning (sigue visible) para no bloquear PRs por esta
    // deuda preexistente, dado que el CI lintea el fichero cambiado entero.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
