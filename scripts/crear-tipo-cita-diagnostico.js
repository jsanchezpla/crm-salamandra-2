/**
 * crear-tipo-cita-diagnostico.js — el tipo de cita «DIAGNÓSTICO» y su informe
 * (09/09/2026, Aumenta: «no podemos crear las sesiones de Diagnóstico»).
 *
 * ── QUÉ FALTABA ────────────────────────────────────────────────────────────
 * El centro vende valoraciones diagnósticas —«Diagnóstico Simple» 350 € y
 * «Diagnóstico Completo» 650 €, en dos pagos, 40 facturas en lo que va de
 * 2026— y desde el 05/09 el informe de valoración diagnóstica existe con su
 * guion de 25 apartados. Pero en la agenda solo estaban los ratos de «INFORME
 * PARA DIAGNOSTICO» (escribirlo), no la sesión de valoración con el niño: los
 * 69 tipos de cita salieron del volcado de Organízate, donde un diagnóstico no
 * es un curso, así que nunca cruzó.
 *
 * ── QUÉ HACE ───────────────────────────────────────────────────────────────
 *   1. Crea el tipo de cita «DIAGNÓSTICO» (60 min) si no está, con
 *      `informeTipo: 'diagnostico'`: al abrir una cita suya aparece el botón
 *      que escribe su informe con el guion puesto.
 *   2. A los tipos que YA existen y son de diagnóstico («INFORME PARA
 *      DIAGNOSTICO…») les pone el mismo enlace al informe. No les cambia nada
 *      más: siguen llamándose igual y con sus citas.
 *
 * Sin precio y sin concepto a propósito. El diagnóstico NO es una cuota
 * mensual: se cobra una vez, y la forma de cobrarlo en el CRM es darle a la
 * familia un BONO de este tipo con sus sesiones y su importe (ficha del
 * paciente → «Bonos de sesiones»), que deja el cobro pendiente en Cobros. Un
 * concepto de 650 € pegado al tipo se copiaría en CADA cita de la valoración.
 *
 * Idempotente y en seco por defecto.
 *
 * Uso VPS:  docker exec crm-salamandra-app-1 node scripts/crear-tipo-cita-diagnostico.js [--slug aumenta] [--confirm]
 */

import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const confirmar = args.includes("--confirm");
const valorDe = (flag, porDefecto) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : porDefecto);
const SLUG = valorDe("--slug", "aumenta");

const NOMBRE = "DIAGNÓSTICO";
const SLUG_TIPO = "diagnostico";
const INFORME = "diagnostico";

const log = (m) => process.stdout.write(`  ${m}\n`);

async function main() {
  process.stdout.write(`\n▶ Tipo de cita «${NOMBRE}» y su informe — ${SLUG}${confirmar ? "" : "  (EN SECO)"}\n\n`);
  const { models } = getTenantDb(SLUG);
  const { EventType } = models;
  if (!EventType) throw new Error(`${SLUG} no tiene módulo de citas`);

  // 1. El tipo nuevo.
  const yaEsta = await EventType.findOne({ where: { slug: SLUG_TIPO } });
  if (yaEsta) {
    log(`· «${yaEsta.name}» ya existe (${yaEsta.id})`);
    if (yaEsta.informeTipo !== INFORME) {
      log(`  → le falta el enlace al informe`);
      if (confirmar) await yaEsta.update({ informeTipo: INFORME });
    }
  } else {
    log(`+ crear «${NOMBRE}» · 60 min · con informe de valoración diagnóstica`);
    if (confirmar) {
      const orden = (await EventType.max("order")) ?? 0;
      const creado = await EventType.create({
        name: NOMBRE,
        slug: SLUG_TIPO,
        description: "Sesión de valoración diagnóstica con el paciente. El informe se escribe desde la propia cita.",
        duration: 60,
        modalities: ["presencial"],
        // Sin precio: no se cobra por la pasarela. El diagnóstico se le da a la
        // familia como bono (sesiones + importe) desde la ficha del paciente.
        price: null,
        sessionsCount: 1,
        informeTipo: INFORME,
        // A la vista del equipo en la agenda, fuera de la reserva pública: una
        // valoración se cierra hablando, no se pide por la web.
        isHidden: true,
        active: true,
        order: Number(orden) + 1,
      });
      log(`  ✓ creado ${creado.id}`);
    }
  }

  // 2. Los que ya había, enlazados a su informe.
  const viejos = await EventType.findAll({ where: { informeTipo: null } });
  const deDiagnostico = viejos.filter((t) => /diagn/i.test(t.name || ""));
  for (const t of deDiagnostico) {
    log(`~ «${t.name}» → informe de valoración diagnóstica`);
    if (confirmar) await t.update({ informeTipo: INFORME });
  }
  if (!deDiagnostico.length) log("· ningún tipo antiguo de diagnóstico sin enlazar");

  const total = await EventType.count({ where: { informeTipo: INFORME } });
  log(`\n${confirmar ? "✓" : "→"} tipos con informe de diagnóstico: ${confirmar ? total : `${total} + los de arriba`}`);
  if (!confirmar) process.stdout.write("\n(en seco: repite con --confirm para escribir)\n");
  process.stdout.write("\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    process.stderr.write(`\n✗ ${e.message}\n`);
    process.exit(1);
  });
