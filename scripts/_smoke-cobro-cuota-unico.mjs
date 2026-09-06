// @prueba ligera
/**
 * Un solo cobro por cuota y mes, y el mes de la portada en hora de Madrid
 * (06/09/2026, las dos tareas técnicas que dejó la revisión de bugs).
 *
 * Se lee el código como texto: lo que se vigila es que las tres piezas sigan
 * donde están — el índice único parcial en la migración, la captura de la
 * violación (23505) en los dos sitios que crean el cobro, y el corte del mes
 * de «Cobrado» con `AT TIME ZONE 'Europe/Madrid'` en vez de un literal UTC.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const lee = (r) => readFileSync(join(RAIZ, r), "utf8");

test("la migración crea un índice ÚNICO parcial sobre (cuota_id, period_month) de los PENDIENTES", () => {
  const m = lee("scripts/migrate-payments-cuota-unica.js");
  assert.match(m, /CREATE UNIQUE INDEX IF NOT EXISTS payments_cuota_periodo_pendiente_unica/);
  assert.match(m, /\(cuota_id, period_month\)\s*WHERE cuota_id IS NOT NULL AND status = 'pending'/, "solo los PENDIENTES: los cobrados se parten por tutor");
  assert.match(m, /DROP INDEX IF EXISTS/, "el índice de la primera versión estorba al reparto");
  assert.match(m, /HAVING count\(\*\) > 1/, "antes de crearlo tiene que contar los duplicados");
  assert.match(m, /byTable\(s, "payments"\)/, "recorre los schemas por la tabla, doradas incluidas");
});

test("la migración está registrada en el orden y en el bloque de billing", () => {
  assert.match(lee("scripts/_module-migrations.js"), /"migrate-payments-cuota-unica"/);
  assert.match(lee("scripts/_migration-order.js"), /migrate-payments-cuota-unica/);
});

test("los dos sitios que crean el cobro capturan la violación del índice como «ya tenía cobro»", () => {
  const lib = lee("lib/billing/cobroDeCuota.js");
  const lote = lee("app/api/billing/cuotas/generar/route.js");
  assert.match(lib, /esCobroRepetido\(/, "cobroDeCuota.js tiene que reconocer el 23505");
  assert.match(lib, /23505/);
  assert.match(lote, /esCobroRepetido\(/, "el lote tiene que reconocer el 23505");
});

test("«Cobrado» de la portada corta el mes en hora de Madrid, no en UTC", () => {
  const s = lee("lib/home/summary.js");
  assert.match(s, /\(paid_at AT TIME ZONE 'Europe\/Madrid'\) >= '\$\{from\}'/);
  assert.match(s, /\(paid_at AT TIME ZONE 'Europe\/Madrid'\) < '\$\{/);
  assert.ok(!/paidAt: \{ \[Op\.gte\]: `\$\{from\} 00:00:00`/.test(s), "el literal UTC de antes no puede seguir ahí");
});
