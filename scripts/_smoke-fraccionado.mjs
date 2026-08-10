/**
 * _smoke-fraccionado.mjs — el pago a plazos por Stripe (05/08/2026).
 * Lógica pura, sin base de datos ni llamadas a Stripe:
 *
 *   node scripts/_smoke-fraccionado.mjs
 *
 * Cubre las dos cosas que se rompen en silencio y cuestan dinero:
 *
 *   1. QUÉ SE COBRA HOY. `amount` pasó de ser el total (Klarna adelantaba los
 *      390 €) a ser la primera cuota (130 €). Quien lo confunda le cobra a una
 *      paciente el triple de lo que pidió, y lo hará en producción.
 *
 *   2. DE QUIÉN ES ESTA FACTURA. Las cuotas 2ª y siguientes llegan como un
 *      `invoice.paid` suelto, sin nada del CRM salvo la metadata que Stripe
 *      copia de la suscripción. Si el sitio donde se lee cambia de nombre entre
 *      versiones de la API, las cuotas dejan de apuntarse y nadie se entera:
 *      el dinero entra igual, pero el CRM no sabe por cuál va.
 */

import { precioDeCompra, preciosDe } from "../lib/citas/packs.js";
import { sesionDeFactura, suscripcionDeFactura, topePuesto } from "../lib/payments/fraccionado.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

// El programa real de tunutrilaura: 360 € de una vez, o 3 × 130 €.
const PROGRAMA = { price: 36000, instalmentPrice: 13000, instalmentMonths: 3, sessionsCount: 6 };

process.stdout.write("\n▶ Lo que se cobra HOY no es lo que se debe en TOTAL\n");
const plazos = precioDeCompra(PROGRAMA, "instalment");
check("hoy se cobra una cuota", plazos.amount, 13000);
check("el compromiso total son 390 €", plazos.total, 39000);
check("financiar cuesta más que pagar de golpe", plazos.total > preciosDe(PROGRAMA).upfront, true);

process.stdout.write("\n▶ Lo que se le pide a Stripe\n");
check("una suscripción mensual", plazos.recurrente?.intervalo, "month");
check("de 3 cargos en total, primera cuota incluida", plazos.recurrente?.iterations, 3);
check("solo tarjeta: es lo único domiciliable", plazos.metodos, ["card"]);

process.stdout.write("\n▶ El pago único no cambia nada de lo que había\n");
const unico = precioDeCompra(PROGRAMA, "upfront");
check("se cobra entero", unico.amount, 36000);
check("sin suscripción", unico.recurrente, null);
check("con los métodos que el centro tenga activados", unico.metodos, null);

process.stdout.write("\n▶ Un fraccionado a medio configurar no se cobra\n");
check("cuota sin meses", precioDeCompra({ price: 36000, instalmentPrice: 13000 }, "instalment"), null);
check("meses sin cuota", precioDeCompra({ price: 36000, instalmentMonths: 3 }, "instalment"), null);

process.stdout.write("\n▶ De quién es esta factura (las cuotas 2ª en adelante)\n");
/*
 * ⚠️ El primer caso es EL QUE IMPORTA y hasta el 10/08/2026 no estaba: es la
 * forma que sirve la versión de API que tenemos clavada. Este bloque daba por
 * bueno solo el sitio viejo, así que iba en verde con producción rota — las dos
 * suscripciones de tunutrilaura llevaban tres días sin apuntar una sola cuota.
 * Una prueba que defiende el camino muerto es peor que no tenerla.
 */
check(
  "donde la deja la API de hoy: colgando de `parent`",
  sesionDeFactura({ parent: { subscription_details: { metadata: { paymentSessionId: "ps-0" } } } }),
  "ps-0"
);
check(
  "o en la raíz, como hacían las versiones viejas",
  sesionDeFactura({ subscription_details: { metadata: { paymentSessionId: "ps-1" } } }),
  "ps-1"
);
check(
  "o en la línea de la factura",
  sesionDeFactura({ lines: { data: [{ metadata: { paymentSessionId: "ps-2" } }] } }),
  "ps-2"
);
check("o en la propia factura", sesionDeFactura({ metadata: { paymentSessionId: "ps-3" } }), "ps-3");
check("una factura ajena no se apunta a nadie", sesionDeFactura({ id: "in_x" }), null);
check("ni una vacía revienta", sesionDeFactura(null), null);

check("la suscripción, como texto", suscripcionDeFactura({ subscription: "sub_1" }), "sub_1");
check("o expandida", suscripcionDeFactura({ subscription: { id: "sub_2" } }), "sub_2");
check(
  "o donde la dejó una API más nueva",
  suscripcionDeFactura({ parent: { subscription_details: { subscription: "sub_3" } } }),
  "sub_3"
);
check("y sin ella, null", suscripcionDeFactura({}), null);

/*
 * El tope: existir no es estar puesto.
 *
 * `subscriptionSchedules.create({ from_subscription })` nace en `release` —«al
 * acabar, suéltala y que siga cobrando»— y el tope lo pone el `update` de
 * después. Si esa segunda llamada no llega, queda un calendario que NO frena
 * nada. Y como el reintento comprobaba «¿hay calendario?» en vez de «¿hay
 * tope?», se daba por hecho y no se reintentaba nunca: así se quedaron las dos
 * suscripciones de tunutrilaura del 07/08/2026.
 */
process.stdout.write("\n▶ ¿Está el tope puesto de verdad?\n");
const FASE_EN_CURSO = { items: [{ price: "price_1" }], start_date: 1, end_date: 2 };
const FASE_RESTO = { items: [{ price: "price_1" }], start_date: 2, end_date: 3 };
check(
  "recién creado por Stripe: hay calendario pero NO hay tope",
  topePuesto({ end_behavior: "release", phases: [FASE_EN_CURSO] }, 2),
  false
);
check(
  "cancela al final pero le falta la fase de las cuotas que quedan",
  topePuesto({ end_behavior: "cancel", phases: [FASE_EN_CURSO] }, 2),
  false
);
check(
  "cancela y tiene la fase que cubre las que faltan: puesto",
  topePuesto({ end_behavior: "cancel", phases: [FASE_EN_CURSO, FASE_RESTO] }, 2),
  true
);
check(
  "plan de una sola cuota: con que cancele al final basta",
  topePuesto({ end_behavior: "cancel", phases: [FASE_EN_CURSO] }, 0),
  true
);
check("sin calendario, no hay tope", topePuesto(null, 2), false);
/*
 * El estado EXACTO en el que se quedaron las dos de tunutrilaura el 07/08/2026:
 * calendario creado, `release`, una sola fase. Si esta comprobación se pone en
 * verde alguna vez, el arreglo se ha deshecho.
 */
check(
  "el caso real del 07/08: calendario sí, tope no",
  topePuesto({ end_behavior: "release", phases: [FASE_EN_CURSO], id: "sub_sched_x" }, 2),
  false
);

process.stdout.write(
  fallos === 0 ? "\n✓ Todo correcto\n\n" : `\n✗ ${fallos} comprobación(es) fallida(s)\n\n`
);
process.exit(fallos === 0 ? 0 : 1);
