/**
 * eslint.undef.mjs — la red que caza «X is not defined».
 *
 *   npx eslint --no-config-lookup -c eslint.undef.mjs app lib components modules
 *   npm run lint:undef
 *
 * ── POR QUÉ HACE FALTA UNA CONFIG APARTE ───────────────────────────────────
 *
 * `eslint-config-next` NO lleva `no-undef` —esa red la da TypeScript, y aquí no
 * hay TypeScript— y el `build` de Next tampoco la da: compila tan campante. Un
 * identificador que se usa y no se importa no aparece hasta que alguien abre la
 * pantalla, y entonces es un 500.
 *
 * No se puede meter en `eslint.config.mjs` sin más: activar `no-undef` sobre
 * todo el repo con la config de Next enciende también un montón de avisos que
 * hoy nadie mira. Esta config hace UNA cosa.
 *
 * ── DE QUÉ FALLO REAL NACE (28/08/2026) ────────────────────────────────────
 *
 * Al pasar quince buscadores a buscar por palabras se olvidaron DOS imports —el
 * de Soporte y el del Excel de Presupuestos—. Lint verde, build verde, `npm
 * test` verde. Los dos daban 500 en cuanto alguien escribía en la caja, y solo
 * salieron al probar los endpoints uno a uno contra la base. Con esta red
 * habrían salido en ocho segundos.
 *
 * Los plugins se cargan solo para que existan las reglas que mencionan los
 * comentarios `eslint-disable-next-line` repartidos por el código: si no están
 * declaradas, ESLint aborta con «Definition for rule was not found» y el ruido
 * tapa lo que sí importa. Todas sus reglas van apagadas: aquí solo manda
 * `no-undef`.
 */

import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import next from "@next/eslint-plugin-next";

export default [
  {
    files: ["**/*.js", "**/*.jsx", "**/*.mjs"],
    plugins: { "react-hooks": reactHooks, "@next/next": next },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      // El navegador y Node a la vez: en este repo un mismo fichero de `lib/`
      // puede acabar en los dos sitios.
      globals: { ...globals.browser, ...globals.node, React: "readonly" },
    },
    rules: { "no-undef": "error" },
  },
];
