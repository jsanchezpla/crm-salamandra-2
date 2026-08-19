/**
 * reponer-precios-nutri-laura.js — devuelve a los tipos de cita los precios que
 * se borraron el 07/08/2026.
 *
 * ⚠️ ENSAYA POR DEFECTO. Sin `--aplicar` no escribe nada.
 * ⚠️ ONE_OFF: es un arreglo de UN cliente y UNA fecha, no una herramienta.
 *
 * ── QUÉ PASÓ ────────────────────────────────────────────────────────────────
 * El 07/08/2026 se guardaron cuatro tipos de cita con los campos de precio en
 * blanco. «Acompañamiento mensual» perdió sus 360 € y su cuota de 130 €, y con
 * ello dejó de poder reservarse: un bono (`sessionsCount > 1`) sin ningún
 * precio no se puede comprar, así que el widget devuelve «Esta forma de pago no
 * está disponible para este programa» al final del formulario. Una paciente se
 * chocó con eso el 09/08 y fue lo que destapó todo lo demás.
 *
 * ── DE DÓNDE SALEN LOS IMPORTES ─────────────────────────────────────────────
 * De `master.audit_logs`, que guardó el `before` de aquel guardado. No son
 * inventados ni sacados de la web —la web de tunutrilaura no publica tarifas—:
 * son los que estaban puestos. Y cuadran por dos lados más: la venta real del
 * 07/08 se cobró a 130 € × 3 = 390 €, y el propio `_smoke-fraccionado.mjs` los
 * lleva escritos como «el programa real de tunutrilaura».
 *
 * ── LO QUE NO SE TOCA, Y POR QUÉ ────────────────────────────────────────────
 *   · «Valoración inicial» sigue GRATIS. Es la primera visita y la puerta de
 *     entrada del embudo; el código tiene una excepción escrita para ella.
 *   · «Acompañamiento mensual - TRANSFERENCIA» sigue SIN PRECIO. Es el circuito
 *     de quien paga por transferencia: Laura le da el bono a mano desde la
 *     ficha y la paciente reserva contra él. Ponerle precio le cobraría por la
 *     pasarela a quien ya ha pagado.
 *   · «Supervisión profesional» ya tiene sus 60 €.
 *
 * ── «PRUEBA 1€» ─────────────────────────────────────────────────────────────
 * Es material de pruebas, no un servicio, y estaba VISIBLE en la agenda pública
 * sin precio: cualquiera podía elegirla y llevarse el mismo error. Se le
 * devuelve su precio (para poder probar el fraccionado con 3 € en vez de con
 * una paciente) y se OCULTA.
 *
 * USO
 *   node --env-file=.env.local scripts/reponer-precios-nutri-laura.js
 *   docker exec crm-salamandra-app-1 node scripts/reponer-precios-nutri-laura.js --aplicar
 */

import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";
import { logCitasAudit } from "../../lib/citas/audit.js";

const APLICAR = process.argv.includes("--aplicar");
const SLUG = "nutri_laura";
const SCHEMA = `crm_${SLUG}`;

const w = (s) => process.stdout.write(s);
const eur = (c) => (c == null ? "—" : (c / 100).toFixed(2) + " €");

/** Lo que tiene que quedar. `null` = se deja como está (no es «ponlo a null»). */
const OBJETIVO = [
  { name: "Acompañamiento mensual", price: 36000, instalmentPrice: 13000, instalmentMonths: 3, isHidden: null },
  { name: "Sesión de seguimiento", price: 6000, instalmentPrice: null, instalmentMonths: null, isHidden: null },
  { name: "Prueba 1€", price: 300, instalmentPrice: 100, instalmentMonths: 3, isHidden: true },
];

const master = getMasterDb();

w("\n══════════════════════════════════════════════════════════════\n");
w(` Reponer precios · ${SLUG}\n`);
w(`${APLICAR ? " ⚠️  MODO REAL: va a escribir" : " · ENSAYO: no se escribe nada"}\n`);
w("══════════════════════════════════════════════════════════════\n\n");

const [tenants] = await master.query(`SELECT id, name FROM master.tenants WHERE slug = :slug`, {
  replacements: { slug: SLUG },
});
if (!tenants.length) {
  w(`✗ No existe el cliente "${SLUG}".\n\n`);
  await master.close();
  process.exit(1);
}
const tenantId = tenants[0].id;

const [filas] = await master.query(
  `SELECT id, name, price, instalment_price, instalment_months, sessions_count, is_hidden, active
     FROM "${SCHEMA}"."event_types" ORDER BY name`
);

const cambios = [];
const sinTocar = [];

for (const objetivo of OBJETIVO) {
  const fila = filas.find((f) => f.name === objetivo.name);
  if (!fila) {
    sinTocar.push([objetivo.name, "no existe ese tipo de cita"]);
    continue;
  }
  const antes = {
    price: fila.price,
    instalmentPrice: fila.instalment_price,
    instalmentMonths: fila.instalment_months,
    isHidden: fila.is_hidden,
  };
  const despues = {
    price: objetivo.price,
    instalmentPrice: objetivo.instalmentPrice,
    instalmentMonths: objetivo.instalmentMonths,
    isHidden: objetivo.isHidden === null ? fila.is_hidden : objetivo.isHidden,
  };
  const igual = JSON.stringify(antes) === JSON.stringify(despues);
  if (igual) {
    sinTocar.push([objetivo.name, "ya está como tiene que estar"]);
    continue;
  }
  cambios.push({ id: fila.id, name: fila.name, sesiones: fila.sessions_count, antes, despues });
}

// Los que no salen en OBJETIVO: se enumeran para que se vea que se dejan a
// propósito y no por olvido.
for (const f of filas) {
  if (OBJETIVO.some((o) => o.name === f.name)) continue;
  sinTocar.push([f.name, `no está en la lista: se deja con ${eur(f.price)}`]);
}

w(`▶ SE CAMBIAN ${cambios.length}:\n\n`);
for (const c of cambios) {
  w(`  ${c.name}  (${c.sesiones} sesión/es)\n`);
  w(`     pago único    ${eur(c.antes.price)}  →  ${eur(c.despues.price)}\n`);
  w(`     cuota         ${eur(c.antes.instalmentPrice)}  →  ${eur(c.despues.instalmentPrice)}\n`);
  w(`     meses         ${c.antes.instalmentMonths ?? "—"}  →  ${c.despues.instalmentMonths ?? "—"}\n`);
  if (c.antes.isHidden !== c.despues.isHidden) {
    w(`     oculto        ${c.antes.isHidden}  →  ${c.despues.isHidden}\n`);
  }
  w("\n");
}

w(`▶ SE DEJAN COMO ESTÁN ${sinTocar.length}:\n\n`);
for (const [nombre, motivo] of sinTocar) w(`  ${nombre} — ${motivo}\n`);
w("\n");

if (!APLICAR) {
  w("· Ensayo: no se ha escrito nada. Si cuadra, repite con --aplicar.\n\n");
  await master.close();
  process.exit(0);
}
if (!cambios.length) {
  w("· Nada que cambiar.\n\n");
  await master.close();
  process.exit(0);
}

const t = await master.transaction();
try {
  for (const c of cambios) {
    await master.query(
      `UPDATE "${SCHEMA}"."event_types"
          SET price = :price, instalment_price = :cuota, instalment_months = :meses,
              is_hidden = :oculto, updated_at = now()
        WHERE id = :id`,
      {
        replacements: {
          price: c.despues.price,
          cuota: c.despues.instalmentPrice,
          meses: c.despues.instalmentMonths,
          oculto: c.despues.isHidden,
          id: c.id,
        },
        transaction: t,
      }
    );
  }
  await t.commit();
} catch (e) {
  await t.rollback();
  w(`\n✗ ERROR, no se ha tocado nada: ${e.message}\n\n`);
  await master.close();
  process.exit(1);
}

/*
 * La auditoría, DESPUÉS del commit y fuera de la transacción (regla del
 * proyecto). `userId: null` a propósito: esto no lo ha hecho una persona desde
 * su pantalla y firmarlo como si sí sería mentir en el único sitio donde se
 * puede mirar quién cambió un precio.
 */
for (const c of cambios) {
  await logCitasAudit({
    tenantId,
    userId: null,
    action: "citas.event_type_updated",
    entity: "EventType",
    entityId: c.id,
    before: { name: c.name, ...c.antes },
    after: { name: c.name, ...c.despues, origen: "scripts/reponer-precios-nutri-laura.js" },
  });
}

// Se relee de la base, no se da por bueno lo que se acaba de escribir.
const [despues] = await master.query(
  `SELECT name, price, instalment_price, instalment_months, is_hidden, sessions_count
     FROM "${SCHEMA}"."event_types" ORDER BY name`
);
w("✓ Hecho. Cómo queda (releído):\n\n");
for (const f of despues) {
  w(
    `  ${f.name.padEnd(40)} ${String(f.sessions_count).padStart(2)} ses · ` +
      `${eur(f.price).padStart(9)} · cuota ${eur(f.instalment_price).padStart(8)}` +
      `${f.instalment_months ? ` × ${f.instalment_months}` : ""}${f.is_hidden ? "  (oculto)" : ""}\n`
  );
}
w("\n");

await master.close();
process.exit(0);
