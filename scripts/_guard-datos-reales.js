/**
 * _guard-datos-reales.js — El seguro de los scripts que borran.
 *
 * DE DÓNDE SALE (auditoría del 2026-08-07)
 * Los scripts de sembrado y limpieza se escribieron cuando ningún cliente tenía
 * datos de verdad, así que ninguno lleva freno. Hoy Aumenta lleva el centro con
 * el CRM y `seed-clinica-demo.js` empieza con `destroy({ where: {} })` sobre
 * pacientes, sesiones e informes — y su propia cabecera enseñaba a lanzarlo
 * contra `aumenta`, en producción, con el slug ya escrito. Un copia-pega
 * despistado y no hay vuelta atrás.
 *
 * POR QUÉ NO BASTA CON MIRAR LA `DATABASE_URL`
 * `seed-sandbox.js` mira si la URL contiene "prod". Es lo único que había, y se
 * queda corto por dos lados: en producción los scripts se lanzan DENTRO del
 * contenedor, donde la URL apunta al host `db` de Docker y no dice "prod" por
 * ningún lado; y aun estando en local, sembrar encima de una copia de trabajo
 * de un cliente real destruye igual lo que había.
 *
 * QUÉ HACE ESTE, ENTONCES
 * Pregunta por el TENANT, no por el entorno. Y lo hace al revés de lo que
 * parece natural: en vez de enumerar los clientes reales —una lista que crece
 * cada vez que se firma uno nuevo y que alguien olvidará actualizar— enumera
 * los tenants DE PRUEBA, que son cuatro y no cambian. Todo lo demás se
 * considera real.
 *
 * Así, el cliente que demos de alta mañana queda protegido hoy, sin tocar nada.
 * Es el mismo criterio de `middleware.js` con `ADMIN_HOST`: una ausencia nunca
 * debe abrir una puerta.
 *
 * USO
 *   import { exigirTenantDePruebas } from "./_guard-datos-reales.js";
 *   exigirTenantDePruebas(SLUG, { script: "seed-clinica-demo.js", destruye: "…" });
 */

import { DEMO_SLUGS } from "../lib/demo/demos.js";

/**
 * Los únicos tenants sobre los que se puede arrasar sin pensarlo: las demos
 * públicas (la MISMA lista blanca que usa el botón «Prueba una demo», así una
 * demo nueva queda cubierta sola) más los tenants de laboratorio. Cualquier
 * slug que no esté aquí se trata como cliente real: es deliberado que la lista
 * corta sea esta y no la contraria.
 *
 * Hasta el 31/08/2026 la lista era fija y no incluía las demos por oficio,
 * nacidas DESPUÉS del freno: `seed-clinica-demo.js demo_clinica` moría aquí,
 * `crear-demos-por-oficio.js` se tragaba el código de salida y demo_clinica se
 * quedaba con los pacientes genéricos del sandbox.
 */
const TENANTS_DE_PRUEBA = new Set([...DEMO_SLUGS, "demo_golden", "sandbox", "test"]);

/** Bandera que hay que teclear entera para saltarse el freno. */
const BANDERA = "--si-quiero-tocar-un-cliente-real";

export function esTenantDePruebas(slug) {
  return TENANTS_DE_PRUEBA.has(String(slug || "").trim().toLowerCase());
}

/**
 * Corta la ejecución si el slug no es de pruebas.
 *
 * @param {string} slug          tenant sobre el que va a actuar el script
 * @param {object} opciones
 * @param {string} opciones.script    nombre del script, para el mensaje
 * @param {string} opciones.destruye  qué se pierde exactamente, en cristiano
 * @param {string[]} [opciones.argv]  por defecto process.argv
 */
export function exigirTenantDePruebas(slug, { script, destruye, argv = process.argv } = {}) {
  if (esTenantDePruebas(slug)) return;

  if (argv.includes(BANDERA)) {
    process.stderr.write(
      `\n⚠️  ${script}: vas a tocar '${slug}', que NO es un tenant de pruebas.\n` +
        `   Has escrito ${BANDERA}, así que continúo.\n` +
        `   Espero que haya una copia reciente.\n\n`
    );
    return;
  }

  process.stderr.write(
    `\n${"═".repeat(70)}\n` +
      `  ⛔ ABORTADO — '${slug}' no es un tenant de pruebas\n` +
      `${"═".repeat(70)}\n\n` +
      `  ${script} destruye datos:\n` +
      `    ${destruye}\n\n` +
      `  Tenants de pruebas: ${[...TENANTS_DE_PRUEBA].join(", ")}\n` +
      `  Cualquier otro se considera un cliente REAL, incluidos los que se den\n` +
      `  de alta en el futuro.\n\n` +
      `  Si de verdad es lo que quieres:\n` +
      `    1. Haz una copia AHORA:  /opt/crm-salamandra/scripts/backup-db.sh\n` +
      `    2. Repite el comando añadiendo:  ${BANDERA}\n\n`
  );
  process.exit(1);
}

/**
 * Freno para scripts que no reciben un slug pero tampoco deberían correr contra
 * la base de producción (p. ej. los que hacen `sync({ alter: true })`, que
 * borran columnas que el modelo ya no declara).
 */
export function exigirEntornoLocal({ script, motivo, argv = process.argv } = {}) {
  const url = process.env.DATABASE_URL || "";

  if (!url) {
    process.stderr.write(`\n✗ ${script}: falta DATABASE_URL (usa --env-file=.env.local).\n\n`);
    process.exit(1);
  }
  if (argv.includes(BANDERA)) return;

  // En producción los scripts corren DENTRO del contenedor, donde la base
  // responde al nombre de servicio de Docker. Fuera de local, cualquier host
  // que no sea la propia máquina se trata como sospechoso.
  const pareceProduccion =
    /prod|production/i.test(url) || /@(db|postgres|crm-salamandra-db)/i.test(url);
  const pareceLocal = /@(localhost|127\.0\.0\.1|::1)/i.test(url);

  if (pareceProduccion || !pareceLocal) {
    process.stderr.write(
      `\n${"═".repeat(70)}\n` +
        `  ⛔ ABORTADO — esto no parece tu base local\n` +
        `${"═".repeat(70)}\n\n` +
        `  ${script} solo debe correr en local.\n` +
        `    ${motivo}\n\n` +
        `  Si sabes lo que haces, añade:  ${BANDERA}\n\n`
    );
    process.exit(1);
  }
}
