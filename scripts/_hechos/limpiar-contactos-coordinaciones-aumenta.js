/**
 * limpiar-contactos-coordinaciones-aumenta.js — los nombres que el volcado de
 * Organízate dejó a medias en la agenda de contactos (18/09/2026, AV-0102).
 *
 * ── QUÉ PASÓ ────────────────────────────────────────────────────────────────
 * Silvia (Aumenta, 09/09/2026): «dentro de su ficha, en el apartado
 * coordinaciones, donde pone "contactos" me pone cosas sin sentido». No lo
 * escribió nadie: en agosto se volcaron las actas de coordinación de Organízate
 * y el programa fue sacando de cada una con quién se había hablado. En las
 * actas con los nombres sueltos salió bien; en las que eran un texto seguido se
 * llevó por delante trozos de frase. Contados el 18/09/2026: **311 contactos de
 * 1.032 no parecen el nombre de nadie**, repartidos en 123 pacientes.
 *
 * ── POR QUÉ ESTE SCRIPT NO DECIDE NADA ──────────────────────────────────────
 * Los 311 se revisaron UNO A UNO y la decisión de cada uno viene escrita en
 * `--datos`. No hay reglas aquí dentro a propósito: una regla automática se
 * equivocaba en 20 de ellos, donde el «nombre» era el del PROPIO PACIENTE
 * —«padres de Eva», «MAIL MAMA FRANK», «de Vanesa Requena»— y habría metido al
 * niño como contacto externo de sí mismo. Otra docena tenía los campos
 * cruzados: el nombre en `role` y el oficio en `name` («psicóloga» con papel
 * «Karen»). Eso no lo distingue una expresión regular.
 *
 * Lo que sí hace el script: comprobar que cada fila sigue como se la dejó antes
 * de tocarla, escribir solo lo que cambia, y no crear ni borrar ningún
 * contacto. Las actas no se tocan: lo que ya está escrito dentro de cada una se
 * queda igual, y el enlace acta→contacto tampoco se mueve.
 *
 * ── CÓMO SE LANZA ───────────────────────────────────────────────────────────
 *   # ensayo (no escribe): dice qué haría, fila a fila
 *   docker exec -i crm-salamandra-app-1 node scripts/_hechos/limpiar-contactos-coordinaciones-aumenta.js \
 *     --datos /tmp/cambios-contactos.json
 *
 *   # de verdad
 *   … --datos /tmp/cambios-contactos.json --confirmar
 *
 * `--datos` es el JSON de la revisión: `[{ id, antes:{name,role,entity},
 * despues:{name?,role?,entity?}, porque }]`. Si una fila ya no está como decía
 * `antes`, se salta y se cuenta aparte: significa que alguien la corrigió a
 * mano entre la revisión y el pase, y su trabajo manda sobre esta lista.
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
    console.error("Falta --datos <fichero.json> con la revisión.");
    process.exit(1);
  }
  const cambios = JSON.parse(readFileSync(RUTA, "utf8"));
  if (!Array.isArray(cambios) || cambios.length === 0) {
    console.error("El fichero de datos no trae ninguna fila.");
    process.exit(1);
  }

  const { models } = getTenantDb(SLUG);
  const { ExternalContact } = models;
  if (!ExternalContact) throw new Error("Este cliente no tiene agenda de contactos externos");

  const cuenta = { escritos: 0, sinCambio: 0, movidos: 0, noEstan: 0, sinSitio: 0 };
  const movidos = [];
  const sinSitio = [];

  for (const c of cambios) {
    const fila = await ExternalContact.findByPk(c.id);
    if (!fila) {
      cuenta.noEstan += 1;
      console.log(`  · ${c.corto ?? c.id.slice(0, 8)} ya no existe, se salta`);
      continue;
    }

    // Ya aplicado: se cuenta y se sigue. Hace falta para poder relanzar el
    // script sin que lo hecho parezca «cambiado por alguien».
    const yaEsta = Object.entries(c.despues).every(([campo, valor]) => igual(fila[campo], valor));
    if (yaEsta) {
      cuenta.sinCambio += 1;
      continue;
    }

    // Que siga como estaba cuando se revisó. Si no, manda quien lo tocó.
    const mismo =
      igual(fila.name, c.antes.name) &&
      igual(fila.role, c.antes.role) &&
      igual(fila.entity, c.antes.entity);
    if (!mismo) {
      cuenta.movidos += 1;
      movidos.push(c.corto ?? c.id.slice(0, 8));
      continue;
    }

    /*
     * LA REGLA DE LA BASE, comprobada aquí y no al chocar (18/09/2026).
     * `external_contacts_algo_check` exige nombre O papel: un contacto sin
     * ninguno de los dos no es nadie y PostgreSQL no lo admite. Vaciarle el
     * nombre a uno que tampoco tiene papel revienta el UPDATE y para el pase a
     * media lista —pasó en la fila 27 de 207—, así que se detecta antes, se
     * salta y se cuenta: son los que hay que decidir aparte, porque dejarlos
     * como están y borrarlos son cosas distintas y ninguna la elige un script.
     */
    const nombreFinal = "name" in c.despues ? c.despues.name : fila.name;
    const papelFinal = "role" in c.despues ? c.despues.role : fila.role;
    if (!nombreFinal && !papelFinal) {
      cuenta.sinSitio += 1;
      sinSitio.push(c.corto ?? c.id.slice(0, 8));
      continue;
    }

    const updates = {};
    for (const campo of ["name", "role", "entity"]) {
      if (campo in c.despues && !igual(fila[campo], c.despues[campo])) {
        updates[campo] = c.despues[campo];
      }
    }
    if (Object.keys(updates).length === 0) {
      cuenta.sinCambio += 1;
      continue;
    }

    const comoQueda = Object.entries(updates)
      .map(([k, v]) => `${k}: ${JSON.stringify(fila[k])} → ${JSON.stringify(v)}`)
      .join(" | ");
    console.log(`  ${CONFIRMAR ? "✓" : "·"} ${c.corto ?? c.id.slice(0, 8)}  ${comoQueda}`);
    if (CONFIRMAR) await fila.update(updates);
    cuenta.escritos += 1;
  }

  console.log("");
  console.log(`  filas en la revisión:     ${cambios.length}`);
  console.log(`  ${CONFIRMAR ? "escritas" : "se escribirían"}: ${cuenta.escritos}`);
  console.log(`  ya estaban así:           ${cuenta.sinCambio}`);
  console.log(`  cambiadas por alguien:    ${cuenta.movidos}${movidos.length ? ` (${movidos.join(", ")})` : ""}`);
  console.log(`  ya no existen:            ${cuenta.noEstan}`);
  console.log(`  se quedarían sin nombre Y sin papel (la base no lo admite): ${cuenta.sinSitio}`);
  if (sinSitio.length) console.log(`     ${sinSitio.join(", ")}`);
  if (!CONFIRMAR) console.log("\n  ENSAYO: no se ha escrito nada. Con --confirmar se aplica.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
