/**
 * sincronizar-ui-override.mjs — que el letrero de `ui_override` diga la verdad.
 *
 *   node --env-file=.env.local scripts/sincronizar-ui-override.mjs            (solo enseña)
 *   node --env-file=.env.local scripts/sincronizar-ui-override.mjs --aplicar
 *
 * En producción hay una pega que conviene entender: la base solo se alcanza
 * DESDE DENTRO del contenedor (el host `db` no existe fuera), pero la imagen no
 * lleva `app/` —solo el compilado—, y las páginas son lo que este script lee.
 * Así que se le monta el repo del VPS en `/repo` y se le dice con `--codigo`:
 *
 *   docker run --rm --network crm-salamandra_crm-net --env-file .env.production \
 *     -v /opt/crm-salamandra:/repo:ro crm-salamandra-app \
 *     node /repo/scripts/sincronizar-ui-override.mjs --codigo=/repo [--aplicar]
 *
 * (`:ro` = solo lectura: el contenedor no puede escribir en el repo del VPS.)
 *
 * ── QUÉ ES `ui_override` HOY ────────────────────────────────────────────────
 *
 * Una columna de `master.tenant_modules` que el código NO lee. La pantalla
 * propia de un cliente se elige con un mapa de imports por slug dentro de cada
 * página (`UI_OVERRIDES = { aumenta: AumentaLeadsModule, … }` en
 * `app/(dashboard)/leads/page.jsx` y otras dos). La columna es un LETRERO: solo
 * la enseña el back-office, en /admin/modulos, para saber quién tiene qué sin
 * abrir el código.
 *
 * Y el letrero mentía en las dos direcciones (comprobado en producción el
 * 18/08/2026):
 *   · 2 filas apuntaban a ficheros BORRADOS a propósito
 *     (`nutri-laura/FormacionOverview` se fue en 125ccf8 cuando Laura pasó al
 *     overview por defecto; `nutri-laura/NutricionFoodsModule` en 25c7771
 *     cuando Nutrición dejó de ser suya). Se movió el código, nadie tocó la fila.
 *   · 4 pantallas propias que SÍ existían y SÍ se cargaban no tenían fila
 *     (demo, retorika y sandbox en Leads; nutri_laura en la ficha de cliente).
 *     (Esa misma tarde se borraron los overrides de demo y sandbox, así que
 *     el letrero de la demo volvió a cambiar: se relanzó este script.)
 *
 * ── CÓMO DECIDE QUÉ ES VERDAD ───────────────────────────────────────────────
 *
 * Leyendo los mapas `UI_OVERRIDES` de las páginas, no una lista escrita aquí.
 * Una lista a mano se quedaría vieja el día que alguien añada un override y no
 * se acuerde de este fichero — que es exactamente cómo se rompió el letrero.
 * Así se puede relanzar en cualquier momento y deja la columna igual que el
 * código, sea cual sea el código de ese día.
 *
 * Los mapas usan el slug de BD (`nutri_laura`), y el import la carpeta con
 * guion (`nutri-laura/`). Lo que se escribe en la columna es la RUTA del
 * fichero (`nutri-laura/LeadsModule`), como estaba.
 *
 * ── LO QUE NUNCA HACE ───────────────────────────────────────────────────────
 *
 * Sin `--aplicar` no escribe nada: enseña el plan y para. Con él, solo toca la
 * columna `ui_override` de las filas que difieren; ni crea filas, ni cambia
 * `enabled`, ni toca ningún schema de cliente. Si un mapa apunta a un módulo
 * que el cliente NO tiene contratado, lo dice y NO inventa la fila: eso sería
 * el letrero mintiendo por tercera vez.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { QueryTypes } from "sequelize";
import { getMasterDb } from "../lib/db/masterDb.js";
import { leerVerdadDelCodigo, paginasConOverride } from "./_ui-overrides-del-codigo.mjs";

const APLICAR = process.argv.includes("--aplicar");
// De dónde se leen las páginas. Por defecto, el propio repo; en producción se
// pasa `--codigo=/repo` porque la imagen no lleva `app/` (ver cabecera).
const RAIZ =
  process.argv.find((a) => a.startsWith("--codigo="))?.slice("--codigo=".length) ??
  join(dirname(fileURLToPath(import.meta.url)), "..");


const db = getMasterDb();
db.options.logging = false;

try {
  const verdad = leerVerdadDelCodigo(RAIZ);

  const filas = await db.query(
    `SELECT tm.id, t.slug, tm.module_key AS "moduleKey", tm.ui_override AS "uiOverride", tm.enabled
       FROM master.tenant_modules tm JOIN master.tenants t ON t.id = tm.tenant_id
      ORDER BY t.slug, tm.module_key`,
    { type: QueryTypes.SELECT }
  );

  const clave = (slug, mk) => `${slug}·${mk}`;
  const porClave = new Map(filas.map((f) => [clave(f.slug, f.moduleKey), f]));
  const deberia = new Map(verdad.map((v) => [clave(v.slug, v.moduleKey), v.ruta]));

  const cambios = [];
  const avisos = [];

  // 1) Filas con letrero: ¿sigue siendo verdad?
  for (const f of filas) {
    if (!f.uiOverride) continue;
    const esperado = deberia.get(clave(f.slug, f.moduleKey)) ?? null;
    if (esperado !== f.uiOverride) cambios.push({ fila: f, de: f.uiOverride, a: esperado });
  }
  // 2) Pantallas propias que el código carga: ¿tienen letrero?
  for (const v of verdad) {
    const f = porClave.get(clave(v.slug, v.moduleKey));
    if (!f) {
      avisos.push(`${v.slug} carga ${v.ruta} pero NO tiene el módulo ${v.moduleKey} en tenant_modules — no se inventa la fila`);
      continue;
    }
    if (!f.uiOverride) cambios.push({ fila: f, de: null, a: v.ruta });
  }

  console.log(`\nLetrero ui_override · ${APLICAR ? "APLICANDO" : "solo enseño"}\n`);
  console.log(`  El código carga ${verdad.length} pantallas propias en ${paginasConOverride(RAIZ).length} páginas.`);
  console.log(`  En la base hay ${filas.filter((f) => f.uiOverride).length} filas con letrero.\n`);

  if (!cambios.length) console.log("  ✓ El letrero ya dice la verdad. Nada que hacer.");
  for (const c of cambios) {
    const flecha = c.de && c.a ? "cambia" : c.de ? "QUITA " : "PONE  ";
    console.log(`  ${flecha}  ${c.fila.slug.padEnd(14)} ${c.fila.moduleKey.padEnd(9)} ${c.de ?? "—"}  →  ${c.a ?? "—"}`);
  }
  for (const a of avisos) console.log(`  ⚠  ${a}`);

  if (!APLICAR) {
    if (cambios.length) console.log("\n  Nada tocado. Para aplicarlo: --aplicar");
    console.log("");
    process.exit(0);
  }

  let hechos = 0;
  for (const c of cambios) {
    await db.query(`UPDATE master.tenant_modules SET ui_override = :a WHERE id = :id AND tenant_id IS NOT NULL`, {
      replacements: { a: c.a, id: c.fila.id },
      type: QueryTypes.UPDATE,
    });
    hechos++;
  }
  console.log(`\n  ✓ ${hechos} fila(s) actualizadas.\n`);
} finally {
  await db.close();
}
