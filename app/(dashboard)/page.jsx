import { headers } from "next/headers";
import { getTenantContext } from "../../lib/tenant/tenantResolver.js";
import { buildHomeSummary } from "../../lib/home/summary.js";
import HomeSummary from "../../components/home/HomeSummary.jsx";
import { vocabularioCliente, VOCABULARIO_CLIENTE } from "../../lib/clients/vocabulario.js";

/**
 * Los atajos de la portada.
 *
 * ⚠️ ESTA LISTA SE QUEDA VIEJA SOLA. Es un array paralelo al sidebar: cada
 * módulo nuevo hay que acordarse de añadirlo AQUÍ además de allí, y no hay nada
 * que avise. Se notó el 08/08/2026 con Aumenta —un centro de psicología con 18
 * módulos y quince personas— que abría el CRM cada mañana y NO tenía atajo a
 * Pacientes ni a Clínica, que es todo su trabajo, mientras sí veía uno a
 * «Inventario · Materia prima y producto».
 *
 * El orden importa: se pintan los que el cliente tenga, en este orden, así que
 * arriba va el trabajo del día y abajo lo de apoyo.
 */
const QUICK_LINKS = [
  // El día a día de una consulta o un centro clínico.
  { moduleKey: "citas",       href: "/citas",       eyebrow: "Agenda",       title: "Citas",       hint: "Reservas y consultas" },
  { moduleKey: "pacientes",   href: "/pacientes",   eyebrow: "Clínico",      title: "Pacientes",   hint: "Fichas e historial" },
  { moduleKey: "clinica",     href: "/clinica",     eyebrow: "Clínico",      title: "Clínica",     hint: "Sesiones, informes y coordinaciones" },
  { moduleKey: "clients",     href: "/clientes",    eyebrow: "Cuentas",      title: "Clientes",    hint: "Gestionar tu cartera" },
  { moduleKey: "nutricion",   href: "/nutricion/recetas", eyebrow: "Nutrición", title: "Recetario", hint: "Recetas, menús y pautas" },
  // Quien entra y quién lo atiende.
  { moduleKey: "leads",       href: "/leads",       eyebrow: "Comercial",    title: "Leads",       hint: "Oportunidades activas" },
  { moduleKey: "formularios", href: "/formularios", eyebrow: "Comercial",    title: "Solicitudes", hint: "Lo que llega desde la web" },
  { moduleKey: "team",        href: "/equipo",      eyebrow: "Equipo",       title: "Equipo",      hint: "Plantilla y accesos" },
  // Apoyo.
  { moduleKey: "billing",     href: "/facturacion", eyebrow: "Finanzas",     title: "Facturación", hint: "Cobros y costes" },
  { moduleKey: "documents",   href: "/documentos",  eyebrow: "Archivo",      title: "Documentos",  hint: "Contratos y ficheros" },
  { moduleKey: "support",     href: "/soporte",     eyebrow: "Atención",     title: "Soporte",     hint: "Lo que preguntan tus clientes" },
  { moduleKey: "training",    href: "/formacion",   eyebrow: "Conocimiento", title: "Formación",   hint: "Cursos y alumnos" },
  { moduleKey: "inventory",   href: "/inventario",  eyebrow: "Operaciones",  title: "Inventario",  hint: "Productos y existencias" },
  { moduleKey: "calendar",    href: "/calendario",  eyebrow: "Tiempo",       title: "Calendario",  hint: "Agenda del equipo" },
  // `referidos` se cae de la lista el 12/08/2026: el módulo se retiró entero
  // junto al cliente para el que estaba hecho a medida (abarcaia).
  // `sales` se cae de la lista: apuntaba a /comercial, que NO EXISTE como
  // página —da 404— y su único contenido real vive en /leads. Ver el runbook de
  // ayudas, donde quedó anotado como código al que no se llega.
];

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "Buenas noches";
  if (h < 12) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

// Resuelve el contexto de tenant desde el RSC (el middleware ya inyectó
// x-tenant / x-user-id en los headers; getTenantContext solo necesita un objeto
// con .headers.get() y .cookies.get()) y construye el resumen "Tu día".
async function loadHome() {
  const h = await headers();
  const shim = {
    headers: { get: (k) => h.get(k) },
    cookies: { get: () => undefined }, // el slug se resuelve por header x-tenant
    url: "http://internal/",
  };
  try {
    const ctx = await getTenantContext(shim);
    const { blocks, admin } = await buildHomeSummary(ctx);
    // Accesos rápidos gateados por hasModule (módulo del tenant ∩ acceso del
    // usuario), igual que los widgets. `admin` viene del agregador (fuente única).
    const enabled = new Set(QUICK_LINKS.filter((l) => ctx.hasModule(l.moduleKey)).map((l) => l.moduleKey));
    // En una consulta de nutrición el módulo Clientes se llama «Pacientes»; la
    // home tiene que decirlo igual que el menú (lib/clients/vocabulario.js).
    // `tenantHasModule` y no `hasModule`: cómo se llaman las cosas depende del
    // CENTRO, no de a qué módulos llegue quien mira. Si no, una recepcionista
    // sin acceso a Nutrición vería «Clientes» en la home y «Pacientes» en el
    // menú, que sí va por el tenant.
    return { blocks, enabled, admin, vocab: vocabularioCliente(ctx.tenantHasModule) };
  } catch (err) {
    // Fallo catastrófico (p.ej. master DB caída): degradar a solo el hero. NO se
    // reintenta contra la misma DB dentro del catch (volvería a fallar y tumbaría
    // la home con un 500). enabled vacío = sin accesos rápidos ni widgets, pero
    // la home NUNCA da 500.
    console.error("[home] resumen no disponible:", err?.message || err);
    return { blocks: {}, enabled: new Set(), admin: false, vocab: VOCABULARIO_CLIENTE };
  }
}

export default async function HomePage() {
  const today = new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const { blocks, enabled, admin, vocab } = await loadHome();
  const visibleLinks = QUICK_LINKS.filter((l) => enabled.has(l.moduleKey)).map((l) =>
    l.moduleKey === "clients"
      ? { ...l, eyebrow: vocab.area, title: vocab.plural, hint: vocab.pistaHome }
      : l
  );

  return (
    <div className="min-h-full bg-[var(--color-accent)]">
      {/* Hero editorial */}
      <section className="px-5 lg:px-12 pt-7 lg:pt-16 pb-8 lg:pb-10 max-w-6xl">
        <div className="eyebrow mb-3 lg:mb-5 fade-up" style={{ animationDelay: "60ms" }}>
          {today}
        </div>
        <h1
          className="font-display-lg text-[clamp(30px,7vw,72px)] leading-[1.02] text-[var(--ink-900)] mb-4 lg:mb-6 fade-up"
          style={{ animationDelay: "120ms" }}
        >
          {greeting()}
        </h1>
        <p
          className="text-[15px] lg:text-[17px] text-[var(--ink-500)] max-w-xl leading-relaxed fade-up"
          style={{ animationDelay: "200ms" }}
        >
          Tu panel de control. Aquí ves de un vistazo lo que está pasando hoy en tu negocio —
          clientes, ventas, facturación y todo lo que tienes activo.
        </p>
      </section>

      {/* Resumen "Tu día" — widgets de datos por módulo activo */}
      <HomeSummary blocks={blocks} admin={admin} vocab={vocab} />

      {/* Bloque de accesos rápidos */}
      {visibleLinks.length > 0 && (
        <section className="px-6 lg:px-12 pb-20 max-w-6xl">
          <div className="border-t border-[var(--ink-200)] pt-10">
            <div className="eyebrow mb-6">Acceso rápido</div>
            <div
              className={`grid border border-[var(--ink-200)] rounded-[var(--radius-card)] overflow-hidden ${
                visibleLinks.length === 1
                  ? "grid-cols-1"
                  : visibleLinks.length === 2
                  ? "grid-cols-1 sm:grid-cols-2"
                  : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
              }`}
            >
              {visibleLinks.map((l) => (
                <QuickLink key={l.moduleKey} {...l} />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function QuickLink({ href, eyebrow, title, hint }) {
  return (
    <a
      href={href}
      className="group relative bg-white p-7 hover:bg-[var(--ink-50)] transition-colors block border-l border-t border-[var(--ink-200)] -ml-px -mt-px"
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-400)] mb-3">
        {eyebrow}
      </div>
      <div className="font-display text-[28px] leading-tight text-[var(--ink-900)] mb-1.5 tracking-tight">
        {title}
      </div>
      <div className="text-[13px] text-[var(--ink-500)] mb-5">{hint}</div>
      <div className="flex items-center gap-1.5 text-[var(--color-primary)] text-[12px] font-medium group-hover:gap-3 transition-all">
        Abrir
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
      </div>
    </a>
  );
}
