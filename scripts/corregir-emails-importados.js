/**
 * corregir-emails-importados.js — aplica las correcciones de correo a fichas YA
 * importadas de Organízate.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── Por qué hace falta un script aparte ────────────────────────────────────
 *
 * `import-aumenta.js` ya conoce las correcciones (mismo módulo
 * `_correcciones-email-aumenta.js`), pero **salta las fichas que ya existen**:
 * es idempotente por diseño, para poder relanzarlo sin duplicar nada. Eso
 * significa que repetir la importación NO arregla una ficha ya creada. Esto sí.
 *
 * En producción, si la importación se hace ya con las correcciones dentro, este
 * script no tendrá nada que hacer y lo dirá.
 *
 * ── Qué toca, y qué no ─────────────────────────────────────────────────────
 *
 * · El correo del TUTOR al que pertenece la dirección (respetando su `id`, que
 *   es lo que ata las firmas del contrato a la persona).
 * · Lo borra del tutor donde Organízate lo había dejado, si era otro.
 * · El correo de la FICHA, solo si está vacío y la dirección es del titular.
 *   Si es de un tutor que no es el titular, la ficha se queda sin correo a
 *   propósito: ese tutor entra igual al portal por su propio correo, y poner la
 *   dirección de otro como contacto de la familia sería inventar.
 *
 * Uso:
 *   node --env-file=.env.local scripts/corregir-emails-importados.js            → simulación
 *   node --env-file=.env.local scripts/corregir-emails-importados.js --confirm  → escribe
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { CORRECCIONES_EMAIL } from "./_correcciones-email-aumenta.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const DATOS = (args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null) || "C:/Claude Code/migracion-aumenta";

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const cap = (s) => String(s ?? "").trim();

/** Mismo criterio que el importador: el nombre corto es la misma persona. */
function mismaPersona(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y + " ") || y.startsWith(x + " ");
}

async function main() {
  console.log(`\n${"═".repeat(62)}`);
  console.log(` CORRECCIÓN DE CORREOS → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(62)}\n`);

  const fichas = JSON.parse(readFileSync(path.join(DATOS, "pacientes-limpio.json"), "utf8")).fichas;
  const fact = JSON.parse(readFileSync(path.join(DATOS, "organizate-bonos-facturacion.json"), "utf8")).fichas;
  const pagadorDe = new Map(fact.map((f) => [String(f.id_pac), f.facturacion]));

  const { models: m, sequelize } = getTenantDb(SLUG);

  // ── Qué hay que tocar ───────────────────────────────────────────────────
  // Una misma familia puede tener varios pacientes: se agrupa por ficha para no
  // escribir dos veces lo mismo.
  const trabajos = new Map();

  for (const f of fichas) {
    const pag = pagadorDe.get(String(f.id_pac));
    for (const g of Array.isArray(f.guardians) ? f.guardians : []) {
      const corr = CORRECCIONES_EMAIL[cap(g.email)];
      if (!corr) continue;
      const clave = cap(pag?.cifnif) || norm(pag?.nombre);
      if (!clave) {
        console.log(`  ⚠ ${cap(g.nombre)}: su ficha no tiene pagador, no sé a qué cliente pertenece.`);
        continue;
      }
      if (!trabajos.has(clave)) trabajos.set(clave, { nif: cap(pag?.cifnif) || null, nombre: cap(pag?.nombre), cambios: [] });
      trabajos.get(clave).cambios.push({
        origen: cap(g.nombre),
        destino: corr.de ?? cap(g.nombre),
        email: corr.email,
        bruto: cap(g.email),
      });
    }
  }

  if (!trabajos.size) {
    console.log("No hay ninguna corrección que aplicar.\n");
    process.exit(0);
  }

  const aEscribir = [];

  for (const [, t] of trabajos) {
    const cliente = t.nif
      ? await m.Client.findOne({ where: { taxId: t.nif } })
      : await m.Client.findOne({ where: { name: t.nombre } });

    if (!cliente) {
      console.log(`  ⛔ «${t.nombre}»: no está en el CRM. ¿Importación pendiente?`);
      continue;
    }

    const tutores = Array.isArray(cliente.guardians) ? cliente.guardians.map((g) => ({ ...g })) : [];
    let tocado = false;
    const lineas = [];

    for (const c of t.cambios) {
      const destino = tutores.find((g) => mismaPersona(g.name, c.destino));
      if (!destino) {
        console.log(`  ⛔ «${t.nombre}»: no encuentro al tutor «${c.destino}» en la ficha.`);
        continue;
      }
      if (destino.email !== c.email) { destino.email = c.email; tocado = true; }
      lineas.push(`${destino.name} ← ${c.email}`);

      if (c.origen !== c.destino) {
        const origen = tutores.find((g) => mismaPersona(g.name, c.origen) && g !== destino);
        if (origen?.email) { origen.email = null; tocado = true; lineas.push(`${origen.name} → se le quita (no era suyo)`); }
      }

      // El correo de la ficha solo si está vacío Y es del titular.
      if (!cap(cliente.email) && mismaPersona(cliente.name, destino.name)) {
        lineas.push(`ficha ← ${c.email}`);
        if (cliente.email !== c.email) tocado = true;
        cliente.email = c.email;
      }
    }

    if (!tocado) {
      console.log(`  · «${cliente.name}»: ya estaba correcto.`);
      continue;
    }
    console.log(`  ✓ «${cliente.name}»`);
    for (const l of lineas) console.log(`       ${l}`);
    aEscribir.push({ cliente, tutores });
  }
  console.log("");

  if (!aEscribir.length) {
    console.log("Nada que escribir.\n");
    process.exit(0);
  }

  if (!CONFIRM) {
    console.log(`${"═".repeat(62)}`);
    console.log(` SIMULACIÓN: se tocarían ${aEscribir.length} ficha(s). Con --confirm se ejecuta.`);
    console.log(`${"═".repeat(62)}\n`);
    process.exit(0);
  }

  await sequelize.transaction(async (t) => {
    for (const { cliente, tutores } of aEscribir) {
      // `guardians` es JSONB: Sequelize no detecta la mutación de sus elementos,
      // hay que reasignar el array entero para que la escriba.
      cliente.guardians = tutores;
      await cliente.save({ transaction: t });
    }
  });

  console.log(`Corregidas ${aEscribir.length} ficha(s).\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✖ Error:", e.message);
  process.exit(1);
});
