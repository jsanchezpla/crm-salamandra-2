import { headers } from "next/headers";
import { getMasterModels } from "../../lib/db/masterDb.js";

const QUICK_LINKS = [
  { moduleKey: "clients",   href: "/clientes",    eyebrow: "Cuentas",      title: "Clientes",    hint: "Gestionar tu cartera" },
  { moduleKey: "leads",     href: "/leads",       eyebrow: "Comercial",    title: "Leads",       hint: "Oportunidades activas" },
  { moduleKey: "sales",     href: "/comercial",   eyebrow: "Comercial",    title: "Comercial",   hint: "Pipeline y conversión" },
  { moduleKey: "citas",     href: "/citas",       eyebrow: "Agenda",       title: "Citas",       hint: "Reservas y consultas" },
  { moduleKey: "inventory", href: "/inventario",  eyebrow: "Operaciones",  title: "Inventario",  hint: "Materia prima y producto" },
  { moduleKey: "billing",   href: "/facturacion", eyebrow: "Finanzas",     title: "Facturación", hint: "Cobros y costes" },
  { moduleKey: "training",  href: "/formacion",   eyebrow: "Conocimiento", title: "Formación",   hint: "Cursos y alumnos" },
  { moduleKey: "calendar",  href: "/calendario",  eyebrow: "Tiempo",       title: "Calendario",  hint: "Agenda del equipo" },
  { moduleKey: "referidos", href: "/referidos",   eyebrow: "Crecimiento",  title: "Referidos",   hint: "Programa de referidos" },
];

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "Buenas noches";
  if (h < 12) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

async function getEnabledModules() {
  const headersList = await headers();
  const tenantSlug = headersList.get("x-tenant");
  if (!tenantSlug) return new Set();

  const { Tenant, TenantModule } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: tenantSlug } });
  if (!tenant) return new Set();

  const modules = await TenantModule.findAll({ where: { tenantId: tenant.id } });
  return new Set(modules.filter((m) => m.enabled).map((m) => m.moduleKey));
}

export default async function HomePage() {
  const today = new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const enabled = await getEnabledModules();
  const visibleLinks = QUICK_LINKS.filter((l) => enabled.has(l.moduleKey));

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
