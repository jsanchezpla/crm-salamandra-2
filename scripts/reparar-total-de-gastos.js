// @vivo — Recalcula `costs.total` donde quedó a 0 teniendo base imponible. Genérico y en seco por defecto; se relanza si otra importación vuelve a dejarlos así.
/**
 * reparar-total-de-gastos.js — los gastos importados que se quedaron sin
 * importe (08/09/2026, AV-0075 de Aumenta).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── QUÉ PASÓ ───────────────────────────────────────────────────────────────
 * Isabel: «Los Gastos o Costes de Agosto los tenemos que presentar a gestoría
 * ya. También lo vamos a tener que hacer desde Organízate». Y era peor de lo
 * que contaba: los **1.803 gastos** de Aumenta —de septiembre de 2022 a agosto
 * de 2026— tenían `total = 0`. Cuatro años de contabilidad sin una sola cifra.
 *
 * Pero el dinero NO se había perdido: la importación guardó el importe en
 * `tax_base` y **nunca calculó `total`**. 1.797 filas con base y total a cero,
 * 1.922.991 € de base esperando ahí. Lo que faltaba era una multiplicación que
 * nadie hizo, no un dato.
 *
 * ── LO QUE HACE, Y LO QUE NO INVENTA ───────────────────────────────────────
 * `total = base imponible + IVA − IRPF`, que es la misma cuenta que hace el
 * CRM al dar de alta un gasto a mano. Ni más:
 *
 * · **No se inventa el IVA.** En lo importado el IVA es 0 en casi todas (3 €
 *   en total, de 1.803), porque de Organízate vino UN importe y no un desglose.
 *   Poner un 21 % «porque los gastos llevan IVA» sería fabricarle a la gestoría
 *   un dato que nadie tiene. Si el total sale igual que la base, es que eso es
 *   lo que sabemos.
 * · **No toca las filas que ya cuadran.** Es idempotente: relanzarlo no cambia
 *   nada, y no pisa un gasto que alguien haya corregido a mano.
 * · **No toca las que no tienen base**: sin base no hay de dónde sacar el
 *   total, y dejarlas a 0 dice la verdad. Salen contadas aparte.
 * · **Sí toca las de base NEGATIVA**, que son abonos de verdad —AQUASERVICE,
 *   IONOS, proveedores: cinco en Aumenta, −186,16 €—. La condición es «base
 *   distinta de cero» y no «mayor que cero» justo por ellas: dejarlas a 0
 *   inflaría el gasto del ejercicio en el importe de lo que se devolvió.
 *
 * Es genérico: recorre el tenant que se le diga. Se puede relanzar el día que
 * otra importación deje lo mismo.
 *
 * Uso:
 *   node --env-file=.env.local scripts/reparar-total-de-gastos.js <slug>
 *   node --env-file=.env.local scripts/reparar-total-de-gastos.js <slug> --confirm
 */

import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.find((a) => !a.startsWith("--"));

if (!SLUG) {
  process.stderr.write("\n✗ Falta el slug del cliente.\n\n");
  process.exit(1);
}

const eur = (n) => `${Number(n ?? 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

async function main() {
  process.stdout.write(`\n${"═".repeat(70)}\n`);
  process.stdout.write(` GASTOS SIN IMPORTE → "${SLUG}"\n`);
  process.stdout.write(CONFIRM ? " ⚠️  MODO REAL: va a escribir\n" : " · SIMULACIÓN: no se escribe nada\n");
  process.stdout.write(`${"═".repeat(70)}\n\n`);

  const { sequelize } = getTenantDb(SLUG);
  const esquema = `crm_${SLUG}`;
  const q = (sql) => sequelize.query(sql, { type: sequelize.QueryTypes.SELECT });

  // El total que DEBERÍA tener cada gasto, con la cuenta del propio CRM.
  const BUENO = `(tax_base + coalesce(tax_amount, 0) - coalesce(irpf_amount, 0))`;

  const [antes] = await q(`
    select count(*) total,
      count(*) filter (where round(total, 2) <> round(${BUENO}, 2) and tax_base <> 0) a_reparar,
      count(*) filter (where tax_base = 0 or tax_base is null) sin_base,
      round(sum(total), 2) suma_hoy,
      round(sum(case when tax_base <> 0 then ${BUENO} else total end), 2) suma_despues
    from ${esquema}.costs`);

  process.stdout.write(`  gastos en total          : ${String(antes.total).padStart(6)}\n`);
  process.stdout.write(`  con el total mal         : ${String(antes.a_reparar).padStart(6)}\n`);
  process.stdout.write(`  sin base (no se tocan)   : ${String(antes.sin_base).padStart(6)}\n\n`);
  process.stdout.write(`  suma hoy                 : ${eur(antes.suma_hoy).padStart(16)}\n`);
  process.stdout.write(`  suma después             : ${eur(antes.suma_despues).padStart(16)}\n`);

  const porAnio = await q(`
    select extract(year from incurred_at)::int anio, count(*) n,
      round(sum(total), 2) hoy, round(sum(case when tax_base <> 0 then ${BUENO} else total end), 2) despues
    from ${esquema}.costs
    where round(total, 2) <> round(${BUENO}, 2) and tax_base <> 0
    group by 1 order by 1`);
  if (porAnio.length) {
    process.stdout.write("\n  por ejercicio:\n");
    for (const a of porAnio) {
      process.stdout.write(`    ${a.anio}  ${String(a.n).padStart(5)} gastos   ${eur(a.hoy).padStart(14)} → ${eur(a.despues).padStart(16)}\n`);
    }
  }

  if (!Number(antes.a_reparar)) {
    process.stdout.write("\n  Nada que reparar.\n\n");
    process.exit(0);
  }
  if (!CONFIRM) {
    process.stdout.write(`\n${"═".repeat(70)}\n`);
    process.stdout.write(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.\n");
    process.stdout.write(`${"═".repeat(70)}\n\n`);
    process.exit(0);
  }

  process.stdout.write("\n  ⚠️  Escribiendo…\n");
  await sequelize.query(`
    update ${esquema}.costs
       set total = round(${BUENO}, 2), updated_at = now()
     where round(total, 2) <> round(${BUENO}, 2) and tax_base <> 0`);

  // Se relee: un UPDATE por WHERE no dice si escribió lo que se esperaba.
  const [despues] = await q(`
    select count(*) filter (where round(total, 2) <> round(${BUENO}, 2) and tax_base <> 0) quedan,
      round(sum(total), 2) suma
    from ${esquema}.costs`);
  process.stdout.write(`  ✓ suma ahora: ${eur(despues.suma)} · quedan mal: ${despues.quedan}\n\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
