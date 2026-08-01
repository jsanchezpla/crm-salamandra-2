/**
 * seed-analiticas-demo.js — visitas web INVENTADAS para el escaparate.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * La demo pública da sesión de ADMIN a visitantes anónimos, así que no puede
 * tener credenciales de Cloudflare de nadie: sería el token de un cliente real
 * detrás de un enlace público. Sin credenciales, la pantalla de Analíticas
 * enseñaba el "configura tu token" — el andamio en vez del producto.
 *
 * Aquí se siembra un año de visitas falsas en `web_visits_daily`, y la ruta
 * (`app/api/analiticas/route.js`) hace que en la demo TODOS los rangos salgan
 * de esa tabla, sin llamar a Cloudflare.
 *
 * ── Por qué no es ruido plano ──────────────────────────────────────────────
 *
 * Un escaparate con números aleatorios se nota: la gráfica sale como una sierra
 * y los porcentajes no cuadran con nada. Esto genera una web plausible:
 *
 *   · tendencia creciente suave a lo largo del año (un negocio que va a más)
 *   · caída de fin de semana (tráfico B2B)
 *   · agosto y Navidad flojos
 *   · un pico de campaña puntual, para que el gráfico tenga algo que contar
 *   · reparto de países/páginas/dispositivos estable, con variación diaria
 *
 * Es DETERMINISTA (PRNG con semilla fija): dos ejecuciones producen exactamente
 * los mismos números, así que la demo no cambia de cifras cada vez que se
 * resiembra y el upsert no genera ruido.
 *
 * ── Seguridad ──────────────────────────────────────────────────────────────
 *
 * Solo escribe en tenants de demostración (`demo`, `demo_golden`, `sandbox`).
 * Sembrar visitas falsas en el CRM de un cliente real sería corromper sus
 * datos, así que cualquier otro slug se rechaza aunque se pase a mano.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-analiticas-demo.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/seed-analiticas-demo.js
 * Opciones:   --tenant=slug   (por defecto: demo)
 *             --dias=N        (por defecto: 400, para que el rango de año llene)
 *             --limpiar       borra lo sembrado antes de volver a sembrar
 */

import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";

const TENANTS_PERMITIDOS = new Set(["demo", "demo_golden", "sandbox"]);

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? null;
const SLUG = flag("tenant") ?? "demo";
const DIAS = Number(flag("dias") ?? 400);
const LIMPIAR = args.includes("--limpiar");

function log(m) { process.stdout.write(`  ${m}\n`); }

// PRNG con semilla (mulberry32). Determinista a propósito: ver cabecera.
function prng(semilla) {
  let a = semilla >>> 0;
  return function () {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Reparto de referencia. Los pesos son relativos; se normalizan al repartir.
const PAISES = [
  ["ES", 42], ["MX", 11], ["AR", 7], ["CO", 6], ["FR", 5], ["IT", 4.5],
  ["PT", 4], ["DE", 3.5], ["US", 3.5], ["GB", 3], ["CL", 2.5], ["PE", 2],
  ["NL", 1.5], ["BE", 1], ["MA", 1], ["BR", 1], ["IE", 0.8], ["PL", 0.7],
];

const PAGINAS = [
  ["/", 34], ["/servicios", 18], ["/precios", 13], ["/sobre-nosotros", 9],
  ["/contacto", 8], ["/blog", 7], ["/blog/como-elegir-un-crm", 5],
  ["/casos-de-exito", 4], ["/preguntas-frecuentes", 2],
];

const REFERRERS = [
  ["google.com", 38], ["(directo)", 27], ["linkedin.com", 14],
  ["bing.com", 6], ["instagram.com", 5], ["youtube.com", 4],
  ["facebook.com", 3], ["duckduckgo.com", 2], ["x.com", 1],
];

const DISPOSITIVOS = [["desktop", 58], ["mobile", 36], ["tablet", 6]];

const NAVEGADORES = [
  ["Chrome", 61], ["Safari", 19], ["Edge", 9], ["Firefox", 7], ["Samsung Internet", 4],
];

/**
 * Reparte `total` entre las opciones según su peso, con algo de vaivén diario.
 * Devuelve solo las que se llevan al menos una visita: una fila con 0 en la
 * tabla sería un dato inventado que además no aporta nada a la pantalla.
 */
function repartir(total, opciones, rnd) {
  const conRuido = opciones.map(([clave, peso]) => [clave, peso * (0.75 + rnd() * 0.5)]);
  const suma = conRuido.reduce((a, [, p]) => a + p, 0);

  const filas = [];
  let asignado = 0;
  for (let i = 0; i < conRuido.length; i += 1) {
    const [clave, peso] = conRuido[i];
    // Al último se le da el resto exacto, para que la suma cuadre con el total
    // y no queden visitas sueltas por el redondeo.
    const n = i === conRuido.length - 1
      ? total - asignado
      : Math.round((peso / suma) * total);
    if (n > 0) filas.push([clave, n]);
    asignado += n;
  }
  return filas;
}

function visitasDelDia(fecha, indice, rnd) {
  const diaSemana = fecha.getUTCDay();
  const mes = fecha.getUTCMonth();

  let base = 46;
  base *= 1 + (indice / DIAS) * 0.85;          // el negocio va creciendo
  if (diaSemana === 0) base *= 0.42;            // domingo
  if (diaSemana === 6) base *= 0.5;             // sábado
  if (diaSemana === 5) base *= 0.85;            // el viernes ya flojea
  if (mes === 7) base *= 0.62;                  // agosto
  if (mes === 11 && fecha.getUTCDate() > 20) base *= 0.55; // Navidad

  // Un pico de campaña, para que la gráfica cuente algo.
  const desdeElFinal = DIAS - indice;
  if (desdeElFinal > 54 && desdeElFinal < 62) base *= 2.3;

  return Math.max(3, Math.round(base * (0.82 + rnd() * 0.36)));
}

async function main() {
  if (!TENANTS_PERMITIDOS.has(SLUG)) {
    process.stderr.write(
      `\n✗ "${SLUG}" no es un tenant de demostración.\n` +
        `  Este script inventa visitas: en el CRM de un cliente real eso es corromper\n` +
        `  sus datos. Permitidos: ${[...TENANTS_PERMITIDOS].join(", ")}\n\n`
    );
    return 1;
  }

  const { models } = getTenantDb(SLUG);
  const { WebVisitDaily } = models;

  if (LIMPIAR) {
    const borradas = await WebVisitDaily.destroy({ where: {} });
    log(`· ${borradas} fila(s) anteriores borradas`);
  }

  const rnd = prng(20260731);
  const hoy = new Date();
  const filas = [];

  // Se siembra hasta MAÑANA, no hasta hoy. Dos motivos:
  //
  //  1. El rango "Hoy" de la pantalla pregunta por el día en curso. Si la
  //     siembra acaba ayer, la demo enseña un CERO enorme — que fue justo lo
  //     que pasó el 2026-08-01, con la siembra hecha el día 31.
  //  2. Da un día de margen: si el timer diario falla una vez, "Hoy" sigue
  //     teniendo datos en lugar de vaciarse.
  //
  // Sembrar un día por delante no molesta a nadie: ningún rango de la pantalla
  // pregunta más allá de hoy, así que esa fila simplemente espera su turno.
  for (let i = 0; i < DIAS + 1; i += 1) {
    const fecha = new Date(hoy);
    fecha.setUTCDate(fecha.getUTCDate() - (DIAS - 1 - i));
    const iso = fecha.toISOString().slice(0, 10);

    const visitas = visitasDelDia(fecha, i, rnd);
    // Entre 1,2 y 1,9 páginas por visita: gente que entra, mira y se va.
    const vistas = Math.round(visitas * (1.2 + rnd() * 0.7));

    filas.push({ fecha: iso, dimension: "total", valor: "", visitas, vistas });

    // A diferencia de la captura real —donde Cloudflare solo da los desgloses
    // agregados de todo el rango—, aquí se generan POR DÍA. Así cualquier rango
    // que elija el visitante cuadra al sumarse, que es lo que se espera de un
    // escaparate.
    for (const [clave, n] of repartir(visitas, PAISES, rnd)) {
      filas.push({ fecha: iso, dimension: "pais", valor: clave, visitas: n, vistas: n });
    }
    for (const [clave, n] of repartir(vistas, PAGINAS, rnd)) {
      filas.push({ fecha: iso, dimension: "pagina", valor: clave, visitas: n, vistas: n });
    }
    for (const [clave, n] of repartir(visitas, REFERRERS, rnd)) {
      filas.push({ fecha: iso, dimension: "referrer", valor: clave, visitas: n, vistas: n });
    }
    for (const [clave, n] of repartir(visitas, DISPOSITIVOS, rnd)) {
      filas.push({ fecha: iso, dimension: "dispositivo", valor: clave, visitas: n, vistas: n });
    }
    for (const [clave, n] of repartir(visitas, NAVEGADORES, rnd)) {
      filas.push({ fecha: iso, dimension: "navegador", valor: clave, visitas: n, vistas: n });
    }
  }

  // Por trozos: son decenas de miles de filas y un solo INSERT gigante se come
  // la memoria del contenedor.
  const TROZO = 2000;
  for (let i = 0; i < filas.length; i += TROZO) {
    await WebVisitDaily.bulkCreate(filas.slice(i, i + TROZO), {
      updateOnDuplicate: ["visitas", "vistas", "updatedAt"],
    });
  }

  const totalVisitas = filas
    .filter((f) => f.dimension === "total")
    .reduce((a, f) => a + f.visitas, 0);

  process.stdout.write(
    `\n✓ ${SLUG}: ${filas.length} filas sembradas — ${DIAS} días, ${totalVisitas} visitas en total\n\n`
  );
  return 0;
}

let codigo = 1;
try {
  codigo = await main();
} catch (err) {
  process.stderr.write(`\n✗ ${err?.message ?? err}\n`);
  codigo = 1;
} finally {
  try { await getMasterDb().close(); } catch { /* da igual al salir */ }
}
process.exit(codigo);
