/**
 * borrar-contactos-troceados-aumenta.js — quitar de la agenda los «contactos»
 * que eran trozos de un correo (18/09/2026, AV-0102). Rodrigo lo autorizó.
 *
 * Es el SEGUNDO paso, y no se lanza sin el primero: `rescatar-actas-troceadas-
 * aumenta.js` devuelve antes a su acta el texto de las tres que se habían
 * quedado vacías. Primero se salva lo que solo estaba aquí, y después se
 * limpia; al revés se pierde una conversación con una familia.
 *
 * ── QUÉ SE BORRA Y QUÉ NO ───────────────────────────────────────────────────
 * Solo filas de `external_contacts` que cumplen las tres cosas a la vez:
 *   · están en la lista revisada a mano (`--datos`),
 *   · siguen exactamente como se las dejó (mismo nombre, papel y centro),
 *   · y se quedarían sin nombre Y sin papel — o sea, no son nadie. Es la misma
 *     regla que tiene la base en `external_contacts_algo_check`.
 *
 * **Las actas NO se tocan.** La FK de `coordinations.external_contact_id` es ON
 * DELETE SET NULL y los asistentes viven dentro de `participants` (JSONB, sin
 * FK): el acta conserva su texto entero y como mucho pierde un enlace que
 * apuntaba a media frase. Se cuenta cuántos enlaces quedan sueltos, para que
 * figure en el parte.
 *
 * ── CÓMO SE LANZA ───────────────────────────────────────────────────────────
 *   docker exec -i crm-salamandra-app-1 node scripts/_hechos/borrar-contactos-troceados-aumenta.js \
 *     --datos /tmp/cambios-contactos.json           # ensayo
 *   … --confirmar                                    # de verdad
 *
 * Respaldo previo de las 1.032 filas:
 * /root/backups/external-contacts-aumenta-antes-limpieza-20260918.json
 */

import { readFileSync } from "node:fs";
import { getTenantDb } from "../../lib/db/tenantDb.js";

const SLUG = "aumenta";
const args = process.argv.slice(2);
const CONFIRMAR = args.includes("--confirmar");
const RUTA = (() => {
  const i = args.indexOf("--datos");
  return i >= 0 ? args[i + 1] : null;
})();

const igual = (a, b) => (a ?? null) === (b ?? null);

async function main() {
  if (!RUTA) {
    console.error("Falta --datos <fichero.json>");
    process.exit(1);
  }
  const cambios = JSON.parse(readFileSync(RUTA, "utf8"));
  const { models, sequelize } = getTenantDb(SLUG);
  const { ExternalContact } = models;

  let borrados = 0, saltados = 0, enlaces = 0;
  for (const c of cambios) {
    const fila = await ExternalContact.findByPk(c.id);
    if (!fila) continue;

    const mismo =
      igual(fila.name, c.antes.name) &&
      igual(fila.role, c.antes.role) &&
      igual(fila.entity, c.antes.entity);
    if (!mismo) { saltados += 1; continue; }

    const nombreFinal = "name" in c.despues ? c.despues.name : fila.name;
    const papelFinal = "role" in c.despues ? c.despues.role : fila.role;
    if (nombreFinal || papelFinal) continue; // este sí es alguien: no se toca

    // Cuántas actas lo tienen como asistente, para decirlo en el parte.
    const [{ n }] = await sequelize.query(
      `SELECT count(*)::int AS n FROM ${sequelize.getQueryInterface().quoteIdentifier(`crm_${SLUG}`)}.coordinations c,
              jsonb_array_elements(COALESCE(c.participants,'[]'::jsonb)) p
        WHERE p->>'externalContactId' = :id`,
      { replacements: { id: fila.id }, type: sequelize.QueryTypes.SELECT }
    );
    enlaces += n;

    console.log(`  ${CONFIRMAR ? "✓" : "·"} ${fila.id.slice(0, 8)}  ${JSON.stringify(fila.name)}  (en ${n} acta/s)`);
    if (CONFIRMAR) await fila.destroy();
    borrados += 1;
  }

  console.log("");
  console.log(`  ${CONFIRMAR ? "borrados" : "se borrarían"}: ${borrados}`);
  console.log(`  enlaces desde actas que quedan sueltos: ${enlaces} (las actas conservan su texto)`);
  console.log(`  saltados por haber cambiado: ${saltados}`);
  if (!CONFIRMAR) console.log("\n  ENSAYO: no se ha borrado nada. Con --confirmar se aplica.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
