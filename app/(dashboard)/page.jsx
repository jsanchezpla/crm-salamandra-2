import { headers } from "next/headers";
import { getTenantContext } from "../../lib/tenant/tenantResolver.js";
import { buildPortada } from "../../lib/home/summary.js";
import GraficaRotatoria from "../../components/home/GraficaRotatoria.jsx";
import MiAgenda from "../../components/home/MiAgenda.jsx";
import MiTrabajo from "../../components/home/MiTrabajo.jsx";
import AgendaCalendario from "../../components/home/AgendaCalendario.jsx";
import TarjetaModulo from "../../components/home/TarjetaModulo.jsx";

/**
 * La portada «Hoy y el negocio» (rediseño del 26/08/2026, elegido por Rodrigo).
 *
 * Dos mitades con nombre: a la izquierda HOY (la agenda + lo pendiente como
 * botones), a la derecha EL NEGOCIO (las cifras, la gráfica y las tarjetas de
 * cada módulo). El saludo baja a una línea, y en escritorio TODO cabe en una
 * pantalla sin scroll (`lg:overflow-hidden` — lo vigila
 * `_smoke-anchos-y-ayuda.mjs`); en móvil las mitades se apilan y ahí sí se
 * desplaza.
 *
 * Cada pieza llega ya gateada del servidor (lib/home/summary.js): módulo del
 * tenant ∩ acceso del usuario, la agenda con su regla de visibilidad, y el
 * cobrado solo para admin.
 *
 * Quien NO está adherido a facturación no ve gráficas de ningún tipo (Rodrigo,
 * 29/08/2026): su mitad derecha es «Mi trabajo» (bandeja, semana, tareas). La
 * regla vive en el servidor; aquí solo se elige qué sección pintar.
 *
 * ── LA PORTADA SE COMPONE CON LOS MÓDULOS DEL CLIENTE (01/09/2026, Rodrigo) ──
 * «El inicio universal tiene una gráfica gigante y ya porque no hay agenda.»
 * Era exacto: la portada solo sabía dibujar DOS cosas —la agenda de Citas y las
 * gráficas de Facturación—, así que a un cliente sin Citas se le caía la mitad
 * izquierda entera y la gráfica se estiraba a lo ancho de la pantalla para
 * tapar el hueco. Y de sus proyectos, sus tickets o sus cursos, ni una palabra.
 *
 * Ahora hay dos fuentes más y ninguna es opcional para el reparto:
 *   · La izquierda tiene DOS agendas posibles —Citas y Calendario— y pinta la
 *     que haya. Un cliente sin Citas pero con Calendario ya tiene su «hoy».
 *   · La derecha lleva una TARJETA POR MÓDULO (`portada.tarjetas`), todas con
 *     la misma forma. La gráfica es una caja MÁS de esa rejilla, no el suelo
 *     donde cae todo lo que sobra: solo ocupa el ancho entero cuando de verdad
 *     es lo único que este cliente tiene.
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
    return {
      admin: false,
      finance: null,
      agenda: null,
      agendaCalendario: null,
      pendiente: [],
      vistas: [],
      tarjetas: [],
      trabajo: null,
    };
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

function Rotulo({ children }) {
  return (
    <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-400)]">{children}</div>
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
  const { admin, finance, agenda, agendaCalendario, vistas, tarjetas = [], trabajo } = portada;

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

  // ── Qué hay a cada lado ───────────────────────────────────────────────────
  // La izquierda es «hoy»: las agendas que tenga este cliente (Citas y/o
  // Calendario) y lo pendiente. La derecha es «el negocio»: cifras, gráfica y
  // una tarjeta por módulo.
  const hayAgenda = Boolean(agenda) || Boolean(agendaCalendario);
  const hayHoy = hayAgenda || pendiente.length > 0;
  const hayNegocio = Boolean(finance) || vistas.length > 0 || tarjetas.length > 0;
  // «Mi trabajo» solo llega del servidor cuando las gráficas están vetadas
  // (sin adhesión a facturación), así que nunca compite con «El negocio».
  const hayTrabajo = !hayNegocio && Boolean(trabajo);
  const hayDerecha = hayNegocio || hayTrabajo;

  // «Cobrado» es de admin (magnitud sensible) y sale de los cobros del mes:
  // sin cobros que leer llega en null y la fila se queda en dos columnas, no en
  // tres con un hueco.
  const conCobrado = admin && finance?.collected != null;

  // La gráfica NO manda sobre el reparto: si hay tarjetas, comparte rejilla con
  // ellas; si es lo único, se queda con el ancho, que entonces sí es suyo.
  // Cuando no hay mitad izquierda, la derecha se queda con las doce columnas:
  // ahí caben tres cajas por fila, y estirar dos a lo ancho de la pantalla es
  // exactamente lo que se venía a quitar.
  const cajasDerecha = vistas.length + tarjetas.length;
  const rejillaDerecha =
    cajasDerecha < 2
      ? "grid-cols-1"
      : hayHoy
        ? "grid-cols-1 xl:grid-cols-2"
        : "grid-cols-1 md:grid-cols-2 2xl:grid-cols-3";

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
              <Rotulo>Hoy</Rotulo>
              {/* Las dos agendas posibles. Con las dos, la de Citas manda arriba:
                  es la que tiene gente esperando al otro lado. */}
              {agenda && <MiAgenda agenda={agenda} />}
              {agendaCalendario && <AgendaCalendario agenda={agendaCalendario} />}
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
              <Rotulo>El negocio</Rotulo>
              {finance && (
                <div className={`grid gap-2.5 ${conCobrado ? "grid-cols-3" : "grid-cols-2"}`}>
                  <Kpi
                    label={`Facturado · ${mes}`}
                    value={eur(finance.month.billed)}
                    sub={`${finance.month.invoices} ${finance.month.invoices === 1 ? "factura" : "facturas"}`}
                  />
                  {conCobrado && (
                    <Kpi
                      label={`Cobrado · ${mes}`}
                      value={eur(finance.collected)}
                      sub={`${finance.collectedCount} ${finance.collectedCount === 1 ? "cobro" : "cobros"}`}
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
              {cajasDerecha > 0 && (
                <div className={`flex-1 min-h-0 grid ${rejillaDerecha} gap-2.5 auto-rows-fr lg:overflow-y-auto`}>
                  {vistas.length > 0 && <GraficaRotatoria vistas={vistas} />}
                  {tarjetas.map((t) => (
                    <TarjetaModulo key={t.key} tarjeta={t} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── MI TRABAJO (sin adhesión a facturación: cero gráficas) ── */}
          {hayTrabajo && (
            <section className={`${hayHoy ? "lg:col-span-7" : "lg:col-span-12"} flex flex-col gap-2.5 min-h-0`}>
              <Rotulo>Mi trabajo</Rotulo>
              <MiTrabajo trabajo={trabajo} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
