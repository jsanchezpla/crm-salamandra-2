/**
 * _smoke-no-se-devuelve.mjs — el CRM no devuelve dinero (07/08/2026, Rodrigo).
 * Lógica pura, sin base de datos ni Stripe:
 *
 *   node scripts/_smoke-no-se-devuelve.mjs
 *
 * Esto no vigila un cálculo, vigila una REGLA DE NEGOCIO — y de las que cuestan
 * dinero real si alguien la deshace sin querer. «No se devuelve el dinero nunca.
 * Ya lo harán ellos manualmente si tal. Lo que se cancela es una sesión, no la
 * compra.»
 *
 * Si algún día vuelve a haber devolución automática, que sea porque alguien
 * borró estas comprobaciones a conciencia, no por descuido.
 */

import { decidirReembolso } from "../lib/citas/politicaReembolso.js";
import { serializeClientBooking } from "../lib/citas/clientBookingSerializer.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

const DENTRO_DE_UN_MES = new Date(Date.UTC(2030, 0, 15, 10, 0)).toISOString();
const AHORA = new Date(Date.UTC(2029, 11, 15, 10, 0));

process.stdout.write("\n▶ NADIE recupera el dinero automáticamente\n");
for (const quien of ["cliente", "profesional", "no_show"]) {
  check(`cancela ${quien}, con un mes de margen`,
    decidirReembolso({ quienCancela: quien, paymentStatus: "paid", amount: 6000, scheduledAt: DENTRO_DE_UN_MES, ahora: AHORA }).reembolsar,
    false);
}
check("cancela el paciente a última hora",
  decidirReembolso({ quienCancela: "cliente", paymentStatus: "paid", amount: 6000, scheduledAt: new Date(AHORA.getTime() + 3600_000).toISOString(), ahora: AHORA }).reembolsar,
  false);
check("importe grande tampoco",
  decidirReembolso({ quienCancela: "profesional", paymentStatus: "paid", amount: 250000, scheduledAt: DENTRO_DE_UN_MES, ahora: AHORA }).reembolsar,
  false);
check("nunca sale un importe a devolver",
  decidirReembolso({ quienCancela: "profesional", paymentStatus: "paid", amount: 6000, scheduledAt: DENTRO_DE_UN_MES, ahora: AHORA }).importe,
  0);

process.stdout.write("\n▶ Y lo que ve la paciente dice lo mismo\n");
const cita = (extra) => serializeClientBooking({
  id: "b1", scheduledAt: DENTRO_DE_UN_MES, duration: 45, modality: "online",
  status: "confirmed", eventType: { name: "Sesión" }, ...extra,
}, AHORA);

check("cita PAGADA → no se devuelve", cita({ amount: 6000, paymentStatus: "paid" }).siCancela.tipo, "no_se_devuelve");
check("cita pagada a última hora → el mismo mensaje",
  serializeClientBooking({ id: "b2", scheduledAt: new Date(AHORA.getTime() + 3600_000).toISOString(), duration: 45,
    modality: "online", status: "confirmed", amount: 6000, paymentStatus: "paid", eventType: { name: "S" } }, AHORA).siCancela.tipo,
  "no_se_devuelve");
check("sesión de BONO → vuelve al bono", cita({ amount: 6000, paymentStatus: "paid", packId: "p1" }).siCancela.tipo, "vuelve_al_bono");
check("cita gratuita → no se dice nada del dinero", cita({ amount: null, paymentStatus: "none" }).siCancela.tipo, "nada");

process.stdout.write("\n▶ Una RETENCIÓN sí se suelta: retener no es cobrar\n");
check("dinero solo retenido → se libera", cita({ amount: 6000, paymentStatus: "authorized" }).siCancela.tipo, "se_libera");
check("en pleno cobro → se libera", cita({ amount: 6000, paymentStatus: "capturing" }).siCancela.tipo, "se_libera");

process.stdout.write("\n▶ Ya no existe ningún mensaje que prometa devolución\n");
for (const st of ["paid", "authorized", "capturing", "none", "refunded"]) {
  const t = cita({ amount: 6000, paymentStatus: st }).siCancela.tipo;
  check(`paymentStatus=${st} no dice "se_devuelve"`, t === "se_devuelve", false);
}

process.stdout.write(fallos === 0 ? "\n✓ TODO CORRECTO\n\n" : `\n✗ ${fallos} FALLO(S)\n\n`);
process.exit(fallos === 0 ? 0 : 1);
