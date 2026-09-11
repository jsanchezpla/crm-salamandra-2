/**
 * atar-conceptos-a-tipos-aumenta.js — los tipos de cita de Aumenta con su
 * cuota (concepto) atada, según lo decidido por Rodrigo el 11/09/2026.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada. Idempotente: lo que
 * ya está como tiene que estar se deja en paz y se dice.
 *
 * ── LO QUE HACE (los «claros»; los dudosos van al PDF para el centro) ──────
 *  1. Conceptos: renombra los dos bonos que ya existían sin uso
 *     («Bono 5 ss x 1 h» 250 € → «Bono terapia de una hora», «Bono 5 ss x 45
 *     min» 200 € → «Bono terapia de 45 minutos») y crea «Cuota Pedagogía 60x2»
 *     (380 €), que faltaba en el catálogo y tenía 80 citas de septiembre sin
 *     dinero.
 *  2. Tipos nuevos: «SESIÓN SUELTA 45» y «SESIÓN SUELTA 60», sobre los dos
 *     conceptos de sesión suelta que ya existían (45 min 50 €; 1 h con el
 *     precio que tenga el catálogo: hoy 60 €, Rodrigo dijo 50; se pregunta).
 *  3. Tipo → concepto: PSICOLOGIA 60/45 (los bonos), CUOTA PEDAGOGÍA 60X2,
 *     CUOTA T.O. 60+45, ASESORAMIENTOS, PROGRAMA DE CONDUCTA, INFORME EXTRA.
 *  4. Desactiva «INFORME PARA DIAGNOSTICO2» (duplicado, 0 citas).
 *
 * Todo por id de producción (medidos el 11/09/2026); si un id no está, se
 * salta y se dice: no se adivina por nombre.
 *
 * Uso:
 *   docker exec crm-salamandra-app-1 node scripts/atar-conceptos-a-tipos-aumenta.js
 *   docker exec crm-salamandra-app-1 node scripts/atar-conceptos-a-tipos-aumenta.js --confirm
 */

import { getTenantDb } from "../lib/db/tenantDb.js";

const CONFIRM = process.argv.includes("--confirm");
const SLUG = "aumenta";

const CONCEPTO_BONO_1H = "c6a4d3e0-2bc6-40b2-aa94-a7db5bd73d73";
const CONCEPTO_BONO_45 = "29789045-aaf9-408b-bbbf-0385f0432934";
const CONCEPTO_SUELTA_45 = "2dcf8742-11bd-4783-95b1-bc366c3a8eef";
const CONCEPTO_SUELTA_1H = "5f302007-e164-43f6-9480-801318edfe02";
const CONCEPTO_TO_60_45 = "9d85c0ae-3f75-4751-a4e4-4f9b22435f99";
const CONCEPTO_ASESORAMIENTO = "1c08b95c-4a83-4ec4-a641-e3868c9997ef";
const CONCEPTO_PROGRAMA_CONDUCTA = "2b933fd1-db65-4b06-9ede-fd23683073dd";
const CONCEPTO_INFORME_EXTRA = "93a23ccd-bf3f-43a9-b8ce-92499e1837fa";

const TIPO_PSICO_60 = "4abff0b8-2743-4922-8270-a16e868f9961";
const TIPO_PSICO_45 = "bdbb007e-ad42-4046-abb6-4a7555d9f20d";
const TIPO_PEDA_60X2 = "1800c3ce-8730-4574-a0b8-92cdf677e68e";
const TIPO_TO_60_45 = "dc1c3558-d314-4fe5-84a7-6abb003d1c66";
const TIPO_ASESORAMIENTOS = "c52a9b6c-c0a6-42a2-ac4a-3b024ac1a0e6";
const TIPO_PROGRAMA_CONDUCTA = "0019fba2-69d4-4cb8-bd01-556383cdd428";
const TIPO_INFORME_EXTRA = "8bc9adf1-5b88-4f81-b8b6-0dd36b84caa6";
const TIPO_INFORME_DIAG2 = "184cd763-433d-4385-a5eb-8b9a88081298";

const log = (s) => process.stdout.write(`${s}\n`);

async function main() {
  log(`\n▶ Tipos de cita ↔ conceptos — ${SLUG}${CONFIRM ? "" : "  (EN SECO)"}\n`);
  const { models } = getTenantDb(SLUG);
  const { EventType, BillingConcept } = models;
  if (!EventType || !BillingConcept) throw new Error("Faltan los modelos EventType o BillingConcept");

  let cambios = 0;

  // 1. Conceptos
  const renombrar = [
    [CONCEPTO_BONO_1H, "Bono terapia de una hora"],
    [CONCEPTO_BONO_45, "Bono terapia de 45 minutos"],
  ];
  for (const [id, nombre] of renombrar) {
    const c = await BillingConcept.findByPk(id);
    if (!c) { log(`✗ concepto ${id.slice(0, 8)} no existe: se salta`); continue; }
    if (c.name === nombre) { log(`= «${nombre}» ya se llama así (${c.unitPrice} €)`); continue; }
    log(`~ concepto «${c.name}» → «${nombre}» (${c.unitPrice} €)`);
    cambios += 1;
    if (CONFIRM) await BillingConcept.update({ name: nombre }, { where: { id } });
  }

  let conceptoPeda60x2 = await BillingConcept.findOne({ where: { name: "Cuota Pedagogía 60x2" } });
  if (conceptoPeda60x2) {
    log(`= concepto «Cuota Pedagogía 60x2» ya existe (${conceptoPeda60x2.unitPrice} €)`);
  } else {
    log("+ crear concepto «Cuota Pedagogía 60x2» · 380 € · mensual");
    cambios += 1;
    if (CONFIRM) {
      const orden = (await BillingConcept.max("sortOrder")) ?? 0;
      conceptoPeda60x2 = await BillingConcept.create({
        name: "Cuota Pedagogía 60x2",
        description: "2 sesiones de 1 h semanales",
        unitPrice: 380,
        vatRate: 0,
        category: "Cuotas del Organízate",
        periodicity: "mensual",
        active: true,
        sortOrder: Number(orden) + 1,
      });
    }
  }

  // 2. Tipos nuevos
  const nuevos = [
    { slug: "sesion-suelta-45", name: "SESIÓN SUELTA 45", duration: 45, conceptId: CONCEPTO_SUELTA_45, description: "Sesión suelta de 45 min. Indicar en la cita de qué terapia es." },
    { slug: "sesion-suelta-60", name: "SESIÓN SUELTA 60", duration: 60, conceptId: CONCEPTO_SUELTA_1H, description: "Sesión suelta de 1 hora. Indicar en la cita de qué terapia es." },
  ];
  for (const n of nuevos) {
    const yaEsta = await EventType.findOne({ where: { slug: n.slug } });
    const concepto = await BillingConcept.findByPk(n.conceptId);
    if (!concepto) { log(`✗ concepto ${n.conceptId.slice(0, 8)} para «${n.name}» no existe: se salta`); continue; }
    if (yaEsta) { log(`= tipo «${n.name}» ya existe (concepto «${concepto.name}»)`); continue; }
    log(`+ crear tipo «${n.name}» · ${n.duration} min · concepto «${concepto.name}» (${concepto.unitPrice} €)`);
    cambios += 1;
    if (CONFIRM) {
      const orden = (await EventType.max("order")) ?? 0;
      await EventType.create({
        name: n.name,
        slug: n.slug,
        description: n.description,
        duration: n.duration,
        modalities: ["presencial"],
        price: null,
        sessionsCount: 1,
        conceptId: n.conceptId,
        isHidden: true, // como el resto de tipos internos: se apunta desde la agenda, no desde la web
        active: true,
        order: Number(orden) + 1,
      });
    }
  }

  // 3. Tipo → concepto
  const atar = [
    [TIPO_PSICO_60, CONCEPTO_BONO_1H],
    [TIPO_PSICO_45, CONCEPTO_BONO_45],
    [TIPO_PEDA_60X2, conceptoPeda60x2?.id ?? null],
    [TIPO_TO_60_45, CONCEPTO_TO_60_45],
    [TIPO_ASESORAMIENTOS, CONCEPTO_ASESORAMIENTO],
    [TIPO_PROGRAMA_CONDUCTA, CONCEPTO_PROGRAMA_CONDUCTA],
    [TIPO_INFORME_EXTRA, CONCEPTO_INFORME_EXTRA],
  ];
  for (const [tipoId, conceptoId] of atar) {
    const t = await EventType.findByPk(tipoId);
    if (!t) { log(`✗ tipo ${tipoId.slice(0, 8)} no existe: se salta`); continue; }
    if (!conceptoId) { log(`· «${t.name}»: el concepto se crea con --confirm; se atará entonces`); continue; }
    const c = await BillingConcept.findByPk(conceptoId);
    if (!c) { log(`✗ concepto ${conceptoId.slice(0, 8)} para «${t.name}» no existe: se salta`); continue; }
    if (t.conceptId === conceptoId) { log(`= «${t.name}» ya lleva «${c.name}» (${c.unitPrice} €)`); continue; }
    log(`~ «${t.name}» → «${c.name}» (${c.unitPrice} €)${t.conceptId ? ` (antes llevaba otro concepto)` : ""}`);
    cambios += 1;
    if (CONFIRM) await EventType.update({ conceptId: conceptoId }, { where: { id: tipoId } });
  }

  // 4. Desactivar el duplicado
  const dup = await EventType.findByPk(TIPO_INFORME_DIAG2);
  if (!dup) log("✗ INFORME PARA DIAGNOSTICO2 no existe: se salta");
  else if (!dup.active) log(`= «${dup.name}» ya está desactivado`);
  else {
    log(`- desactivar «${dup.name}» (duplicado)`);
    cambios += 1;
    if (CONFIRM) await EventType.update({ active: false }, { where: { id: TIPO_INFORME_DIAG2 } });
  }

  // Comprobación
  const conConcepto = await EventType.count({ where: { conceptId: { [models.EventType.sequelize.Sequelize.Op.ne]: null }, active: true } });
  log(`\n${CONFIRM ? "✓" : "→"} cambios ${CONFIRM ? "hechos" : "previstos"}: ${cambios}; tipos activos con concepto ${CONFIRM ? "ahora" : "hoy"}: ${conConcepto}`);
  if (!CONFIRM) log("(en seco: repite con --confirm para escribir)\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    process.stderr.write(`\n✗ ${e.message}\n`);
    process.exit(1);
  });
