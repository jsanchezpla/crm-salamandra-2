import { headers } from "next/headers";
import { getTenantContext } from "../../lib/tenant/tenantResolver.js";
import { buildPortada } from "../../lib/home/summary.js";
import GraficaRotatoria from "../../components/home/GraficaRotatoria.jsx";
import MiAgenda from "../../components/home/MiAgenda.jsx";
import MiTrabajo from "../../components/home/MiTrabajo.jsx";

/**
 * La portada «Hoy y el negocio» (rediseño del 26/08/2026, elegido por Rodrigo).
 *
 * Dos mitades con nombre: a la izquierda HOY (Mi agenda + lo pendiente como
 * botones), a la derecha EL NEGOCIO (tres cifras + una gráfica que rota).
 * El saludo baja a una línea, y en escritorio TODO cabe en una pantalla sin
 * scroll (`lg:overflow-hidden` — lo vigila `_smoke-anchos-y-ayuda.mjs`); en
 * móvil las mitades se apilan y ahí sí se desplaza.
 *
 * Cada pieza llega ya gateada del servidor (lib/home/summary.js): módulo del
 * tenant ∩ acceso del usuario, la agenda con su regla de visibilidad, y el
 * cobrado solo para admin. Si a alguien le falta una mitad entera, la otra
 * ocupa todo el ancho.
 *
 * Quien NO está adherido a facturación no ve gráficas de ningún tipo (Rodrigo,
 * 29/08/2026): su mitad derecha es «Mi trabajo» (bandeja, semana, tareas), con
 * la misma disposición de cajas. La regla vive en el servidor; aquí solo se
 * elige qué sección pintar.
 */

function greeting() {
  const h = Number(
    new Date().toLocaleString("es-ES", { hour: "2-digit", hour12: false, timeZone: "Europe/Madrid" })
  );
  if (h < 6) return "Buenas noches";
  if (h < 13) return "Buenos días";
  if (h < 21) return "Buenas tardes";
  return "Buenas noches";
}

const eur = (n) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    Number(n || 0)
  );

// Resuelve el contexto de tenant desde el RSC (el middleware ya inyectó
// x-tenant / x-user-id en los headers) y construye la portada.
async function loadPortada() {
  const h = await headers();
  const shim = {
    headers: { get: (k) => h.get(k) },
    cookies: { get: () => undefined }, // el slug se resuelve por header x-tenant
    url: "http://internal/",
  };
  try {
    const ctx = await getTenantContext(shim);
    return await buildPortada(ctx);
  } catch (err) {
    // Fallo catastrófico (p.ej. master DB caída): la portada NUNCA da 500.
    console.error("[home] portada no disponible:", err?.message || err);
    return { admin: false, finance: null, agenda: null, pendiente: [], vistas: [], trabajo: null };
  }
}

/**
 * Lo que Salamandra le ha contestado y aún no ha abierto. Se lee de `master`
 * —donde vive el buzón— y NO del schema del cliente, así que no depende de
 * ningún módulo. Best-effort: la portada nunca da 500 por un aviso.
 */
async function respuestasSinLeer() {
  try {
    const h = await headers();
    const userId = h.get("x-user-id");
    if (!userId) return [];
    const { sinVerDeUsuario } = await import("../../lib/buzon/buzonStore.js");
    return await sinVerDeUsuario(userId);
  } catch (err) {
    console.error("[home] buzón no disponible:", err?.message || err);
    return [];
  }
}

const TONO_BOTON = {
  rojo: "bg-red-600",
  cobre: "bg-amber-600",
  verde: "bg-[var(--color-primary)]",
};

function PendienteCard({ item }) {
  return (
    <a
      href={item.href}
      className="bg-white border border-[var(--ink-200)] rounded-[var(--radius-card)] flex flex-col items-center gap-2 py-4 px-2 hover:border-[var(--ink-300)] transition-colors"
    >
      <span
        className={`w-12 h-12 rounded-full ${TONO_BOTON[item.tono] || TONO_BOTON.verde} text-white flex items-center justify-center font-display text-[20px] shadow-sm`}
      >
        {item.count > 99 ? "99+" : item.count}
      </span>
      <span className="text-[12px] font-medium text-center leading-tight text-[var(--ink-900)]">{item.titulo}</span>
      <span className="text-[10px] text-[var(--ink-400)]">{item.modulo}</span>
    </a>
  );
}

function Kpi({ label, value, sub, danger }) {
  return (
    <div className="bg-white border border-[var(--ink-200)] rounded-[var(--radius-card)] px-4 py-3">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--ink-400)] mb-1">{label}</div>
      <div className={`font-display text-[22px] leading-none tracking-tight ${danger ? "text-red-600" : "text-[var(--ink-900)]"}`}>
        {value}
      </div>
      {sub && <div className={`text-[10.5px] mt-1 ${danger ? "text-red-600" : "text-[var(--ink-500)]"}`}>{sub}</div>}
    </div>
  );
}

export default async function HomePage() {
  const hoyLargo = new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Madrid",
  });
  const mes = new Date().toLocaleDateString("es-ES", { month: "long", timeZone: "Europe/Madrid" });

  const [portada, sinLeer] = await Promise.all([loadPortada(), respuestasSinLeer()]);
  const { admin, finance, agenda, vistas, trabajo } = portada;

  const pendiente = [...portada.pendiente];
  if (sinLeer.length > 0) {
    pendiente.push({
      key: "buzon",
      count: sinLeer.length,
      titulo: sinLeer.length === 1 ? "Respuesta sin leer" : "Respuestas sin leer",
      modulo: "Ayuda",
      href: "/ayuda",
      tono: "verde",
    });
  }

  const hayHoy = Boolean(agenda) || pendiente.length > 0;
  const hayNegocio = Boolean(finance) || vistas.length > 0;
  // «Mi trabajo» solo llega del servidor cuando las gráficas están vetadas
  // (sin adhesión a facturación), así que nunca compite con «El negocio».
  const hayTrabajo = !hayNegocio && Boolean(trabajo);
  const hayDerecha = hayNegocio || hayTrabajo;

  return (
    <div className="lg:h-full lg:overflow-hidden flex flex-col gap-3 lg:gap-4 px-4 lg:px-7 py-4 lg:py-5 bg-[var(--color-accent)]">
      {/* El saludo, en una línea: la portada recibe con datos, no con un titular */}
      <div className="flex items-baseline gap-3 shrink-0">
        <h1 className="text-[18px] font-semibold tracking-tight text-[var(--ink-900)]">Inicio</h1>
        <span className="text-[12.5px] text-[var(--ink-500)]">
          {greeting()} · {hoyLargo}
        </span>
      </div>

      {!hayHoy && !hayDerecha ? (
        <div className="bg-white border border-[var(--ink-200)] rounded-[var(--radius-card)] p-8 max-w-xl">
          <div className="font-display text-[22px] text-[var(--ink-900)] mb-2">Tu panel está listo.</div>
          <p className="text-[14px] text-[var(--ink-500)] leading-relaxed">
            En cuanto haya actividad —citas, clientes, facturas— este panel se llena solo. Empieza por el menú
            de la izquierda.
          </p>
        </div>
      ) : (
        <div className="lg:flex-1 lg:min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* ── HOY ── */}
          {hayHoy && (
            <section
              className={`${hayDerecha ? "lg:col-span-5" : "lg:col-span-12"} flex flex-col gap-2.5 min-h-0`}
            >
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-400)]">Hoy</div>
              {agenda && <MiAgenda agenda={agenda} />}
              {pendiente.length > 0 && (
                <div className="shrink-0">
                  <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-400)] mb-2">
                    Pendiente
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {pendiente.slice(0, 6).map((p) => (
                      <PendienteCard key={p.key} item={p} />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── EL NEGOCIO ── */}
          {hayNegocio && (
            <section className={`${hayHoy ? "lg:col-span-7" : "lg:col-span-12"} flex flex-col gap-2.5 min-h-0`}>
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-400)]">
                El negocio
              </div>
              {finance && (
                <div className={`grid gap-2.5 ${admin ? "grid-cols-3" : "grid-cols-2"}`}>
                  <Kpi
                    label={`Facturado · ${mes}`}
                    value={eur(finance.month.billed)}
                    sub={`${finance.month.invoices} ${finance.month.invoices === 1 ? "factura" : "facturas"}`}
                  />
                  {admin && finance.collected != null && (
                    <Kpi
                      label={`Cobrado · ${mes}`}
                      value={eur(finance.collected)}
                      sub={`el ${finance.collectedPct}% de lo facturado`}
                    />
                  )}
                  <Kpi
                    label="Vencido"
                    value={eur(finance.overdue.amount)}
                    sub={
                      finance.overdue.count > 0
                        ? `${finance.overdue.count} ${finance.overdue.count === 1 ? "factura" : "facturas"}`
                        : "nada pendiente"
                    }
                    danger={finance.overdue.amount > 0}
                  />
                </div>
              )}
              <GraficaRotatoria vistas={vistas} />
            </section>
          )}

          {/* ── MI TRABAJO (sin adhesión a facturación: cero gráficas) ── */}
          {hayTrabajo && (
            <section className={`${hayHoy ? "lg:col-span-7" : "lg:col-span-12"} flex flex-col gap-2.5 min-h-0`}>
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-400)]">
                Mi trabajo
              </div>
              <MiTrabajo trabajo={trabajo} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
