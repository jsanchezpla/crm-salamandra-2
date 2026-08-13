/**
 * lib/demo/demos.js — QUÉ demos públicas existen, en un solo sitio.
 *
 * (Fichero nuevo en /lib, regla #2: lo leen el guard de la demo, el resolutor
 * del botón público, las pestañas del dashboard, la restauración desde la foto
 * dorada y el script que las siembra. Cinco copias de esta lista se
 * desincronizan el primer día.)
 *
 * ── POR QUÉ HAY MÁS DE UNA (13/08/2026, recado de Jorge del 12/08) ──────────
 * Había UNA demo con veinte módulos encendidos a la vez, y era lo primero que
 * veía cualquiera que pulsara «Prueba una demo» desde la web. Una nutricionista
 * entraba y se encontraba un centro de psicología con almacén; un centro
 * clínico, un recetario. El escaparate enseñaba TODO el catálogo, que es
 * justo lo que no se vende: se vende lo que hace su oficio.
 *
 * ── LA LISTA ES UNA LISTA BLANCA, NO UN PARÁMETRO ───────────────────────────
 * El botón público manda un `slug` y el servidor firma con él una sesión de
 * ADMIN sin pedir contraseña. Si ese slug se aceptara tal cual, sería la puerta
 * para entrar en el CRM de cualquier cliente escribiendo su nombre. Por eso
 * `/api/auth/demo` solo acepta lo que esté AQUÍ, y por eso esta lista se escribe
 * a mano y no se deduce de la base de datos: dar de alta un cliente no puede
 * ser, ni por accidente, publicar su CRM.
 *
 * ── Y CADA UNA SE LLEVA SU FOTO DORADA ──────────────────────────────────────
 * `crm_{slug}_golden` es la copia impecable desde la que se restaura en cada
 * recarga (lib/demo/resetDemo.js). Multiplicar demos multiplica fotos: las
 * cuatro se rehacen a la vez con `scripts/demo-golden-snapshot.js` sin
 * argumentos.
 *
 * Este fichero NO IMPORTA NADA a propósito: lo lee `isDemo.js`, que tiene que
 * poder cargarse desde un script de Node suelto (ver su cabecera).
 */

/**
 * `modulos` es lo que enciende el sembrador (`scripts/crear-demos-por-oficio.js`).
 * La demo general NO lo lleva: su set lo manda `scripts/rebuild-demo-showcase.js`,
 * que es quien la reconstruye desde antes de que existiera este fichero, y tener
 * dos listas mandando sobre el mismo tenant es pedir que se contradigan.
 */
export const DEMOS = [
  {
    slug: "demo",
    rotulo: "General",
    titulo: "CRM completo",
    desc: "Todo el catálogo encendido a la vez, para ver hasta dónde llega.",
    modulos: null, // lo manda rebuild-demo-showcase.js
  },
  {
    slug: "demo_clinica",
    rotulo: "Clínica",
    titulo: "Centro clínico",
    desc: "Pacientes separados del pagador, sesiones, informes y coordinaciones.",
    // El paquete Clínica (lib/provisioning/catalogo.js) + lo que un centro usa
    // de verdad para que la demo no tenga pantallas huecas: su agenda, su
    // facturación y el repaso de fichas incompletas.
    modulos: [
      "clients", "clients_avanzado", "leads", "formularios", "team", "team_avanzado",
      "citas", "documents", "pacientes", "clinica", "billing", "calendar",
    ],
  },
  {
    slug: "demo_nutricion",
    rotulo: "Nutrición",
    titulo: "Consulta de nutrición",
    desc: "Recetario, alimentos y pautas semanales, con su agenda y su área privada.",
    // El paquete Nutrición + facturación y calendario. Sin `pacientes` ni
    // `clinica` a propósito: en una consulta de nutrición el cliente ES el
    // paciente, y es esa ausencia la que hace que el módulo Clientes se rotule
    // «Pacientes» (lib/clients/vocabulario.js). Encender `pacientes` aquí
    // pondría DOS «Pacientes» distintos en el mismo menú.
    modulos: [
      "clients", "leads", "formularios", "team",
      "citas", "documents", "nutricion", "billing", "calendar",
    ],
  },
  {
    slug: "demo_agencia",
    rotulo: "Agencia",
    titulo: "Agencia y servicios",
    desc: "Captación en frío con IA, analítica de su web, proyectos y pedidos.",
    // Sin Clínica ni Nutrición (Rodrigo, 13/08): es la demo para quien no es un
    // centro de salud. Captación y Analíticas van por delante, que es lo que la
    // distingue de la general.
    //
    // Sin `team_avanzado` tampoco, y no por criterio: sus siete pantallas
    // —Desempeño, Dirección, Productividad, Incidencias, Bandeja, Ocupación— se
    // alimentan de datos clínicos o de citas, así que exige Clínica o Citas
    // (lib/provisioning/dependencias.js:225). Aquí quedaría como un menú lleno
    // de 403, que en un escaparate es peor que no tenerlo.
    modulos: [
      "clients", "leads", "formularios", "team",
      "projects", "billing", "orders", "calendar", "support",
      "outreach", "analytics",
    ],
  },
];

/** La que abre el botón público cuando no se pide ninguna en concreto. */
export const DEMO_POR_DEFECTO = "demo";

export const DEMO_SLUGS = DEMOS.map((d) => d.slug);

const POR_SLUG = new Map(DEMOS.map((d) => [d.slug, d]));

export function esSlugDemo(slug) {
  return POR_SLUG.has(String(slug || ""));
}

export function demoPorSlug(slug) {
  return POR_SLUG.get(String(slug || "")) ?? null;
}

/** El schema con la copia impecable de una demo. */
export function schemaDorado(slug) {
  return `crm_${slug}_golden`;
}
