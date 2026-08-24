// Resumen "Tu día" de la portada. Server component puro: recibe `blocks` (el
// mapa que devuelve lib/home/summary.js), `admin` (para las magnitudes
// sensibles de finanzas) y `vocab` (cómo llama este centro a sus clientes) y
// pinta una tarjeta por bloque presente. Sin estado ni interactividad — cada
// tarjeta enlaza a su módulo.

import { VOCABULARIO_CLIENTE } from "../../lib/clients/vocabulario.js";

const ORDER = [
  "agenda",
  "tareas",
  "salud",
  "finance",
  "clientes",
  "leads",
  "outreach",
  "nutricion",
  "formacion",
  "pedidos",
];

const eur = (n) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    Number(n || 0)
  );

function fmtTime(d) {
  return new Date(d).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
function fmtDay(d) {
  return new Date(d).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}
function isToday(d) {
  const a = new Date(d);
  const b = new Date();
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function prettyStage(s) {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

const PRIORITY_DOT = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-[var(--ink-300)]",
};
const ORDER_STATUS_LABEL = {
  draft: "Borrador",
  confirmed: "Confirmado",
  preparing: "Preparando",
  shipped: "Enviado",
  completed: "Completado",
  cancelled: "Cancelado",
};

// ─── Primitivas de presentación ─────────────────────────────────────────────

function CardShell({ href, eyebrow, children }) {
  return (
    <a
      href={href}
      className="group flex flex-col bg-white border border-[var(--ink-200)] rounded-[var(--radius-card)] p-6 hover:border-[var(--ink-300)] hover:shadow-[0_1px_0_var(--ink-200)] transition-all"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ink-400)]">
          {eyebrow}
        </div>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="w-3.5 h-3.5 text-[var(--ink-300)] group-hover:text-[var(--color-primary)] group-hover:translate-x-0.5 transition-all"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
      </div>
      {children}
    </a>
  );
}

function Metric({ value, label, tone }) {
  const color =
    tone === "danger" ? "text-red-600" : tone === "muted" ? "text-[var(--ink-500)]" : "text-[var(--ink-900)]";
  return (
    <div>
      <div className={`font-display text-[26px] leading-none tracking-tight ${color}`}>{value}</div>
      <div className="text-[11px] text-[var(--ink-500)] mt-1.5">{label}</div>
    </div>
  );
}

function MetricRow({ children }) {
  return <div className="flex flex-wrap gap-x-7 gap-y-4">{children}</div>;
}

function MiniList({ children }) {
  return <div className="mt-4 pt-4 border-t border-[var(--ink-150)] space-y-2">{children}</div>;
}

// El lado derecho es la columna "corta" (una hora, un estado, un importe) y por
// eso no encoge. Pero algunos bloques meten ahí texto libre y largo — el nombre
// de un curso en Formación — que al no encoger se salía de la tarjeta y además
// aplastaba el lado izquierdo hasta 0px. Se le pone tope al 55% del ancho y
// puntos suspensivos: lo corto sigue entero, lo largo se corta.
function Row({ left, right, muted }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span
        title={typeof left === "string" ? left : undefined}
        className={`min-w-0 truncate ${muted ? "text-[var(--ink-400)]" : "text-[var(--ink-700)]"}`}
      >
        {left}
      </span>
      {right != null && (
        <span
          title={typeof right === "string" ? right : undefined}
          className="shrink-0 max-w-[55%] truncate text-[12px] text-[var(--ink-400)]"
        >
          {right}
        </span>
      )}
    </div>
  );
}

function EmptyHint({ children }) {
  return <div className="text-[13px] text-[var(--ink-400)] mt-1">{children}</div>;
}

// ─── Tarjetas por bloque ────────────────────────────────────────────────────

function AgendaCard({ d }) {
  return (
    <CardShell href="/citas" eyebrow="Agenda">
      <Metric value={d.todayCount} label={d.todayCount === 1 ? "cita hoy" : "citas hoy"} />
      {d.upcoming.length > 0 ? (
        <MiniList>
          {d.upcoming.slice(0, 4).map((b) => (
            <Row
              key={b.id}
              left={b.clientName || "Sin nombre"}
              right={`${isToday(b.scheduledAt) ? "" : fmtDay(b.scheduledAt) + " "}${fmtTime(b.scheduledAt)}`}
            />
          ))}
        </MiniList>
      ) : (
        <EmptyHint>Sin próximas citas</EmptyHint>
      )}
    </CardShell>
  );
}

function TareasCard({ d }) {
  return (
    <CardShell href="/calendario" eyebrow="Calendario">
      <Metric value={d.pendingCount} label="tareas pendientes" />
      {d.today.length > 0 ? (
        <MiniList>
          {d.today.slice(0, 4).map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-[13px]">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[t.priority] || PRIORITY_DOT.low}`} />
              <span className={`truncate ${t.status === "done" ? "text-[var(--ink-400)] line-through" : "text-[var(--ink-700)]"}`}>
                {t.title}
              </span>
              {!t.allDay && t.startTime && (
                <span className="ml-auto shrink-0 text-[12px] text-[var(--ink-400)]">{String(t.startTime).slice(0, 5)}</span>
              )}
            </div>
          ))}
        </MiniList>
      ) : (
        <EmptyHint>Nada para hoy</EmptyHint>
      )}
    </CardShell>
  );
}

function SaludCard({ d }) {
  return (
    <CardShell href="/clinica" eyebrow="Salud">
      <MetricRow>
        <Metric value={d.patientsActive} label="pacientes activos" />
        <Metric value={d.sessionsMonth} label="sesiones (mes)" />
        <Metric
          value={d.reportsPending}
          label="informes pendientes"
          tone={d.reportsPending > 0 ? undefined : "muted"}
        />
      </MetricRow>
      {d.reportsOverdue > 0 && (
        <div className="text-[12px] text-red-600 mt-3">
          {d.reportsOverdue} {d.reportsOverdue === 1 ? "informe vencido" : "informes vencidos"}
        </div>
      )}
      {d.nextDelivery && (
        <MiniList>
          <Row
            left={`Próxima entrega${d.nextDelivery.patientName ? " · " + d.nextDelivery.patientName : ""}`}
            right={fmtDay(d.nextDelivery.dueDate)}
          />
        </MiniList>
      )}
    </CardShell>
  );
}

function FinanceCard({ d, admin }) {
  return (
    <CardShell href="/facturacion" eyebrow="Finanzas">
      <MetricRow>
        <Metric value={eur(d.month.billed)} label="facturado (mes)" />
        <Metric
          value={eur(d.overdue.amount)}
          label={d.overdue.count > 0 ? `vencido · ${d.overdue.count}` : "vencido"}
          tone={d.overdue.amount > 0 ? "danger" : "muted"}
        />
      </MetricRow>
      {admin && d.margins && (
        <MiniList>
          <MetricRow>
            <Metric value={eur(d.collected)} label={`cobrado (mes) · ${d.collectedPct}%`} tone="muted" />
            <Metric value={eur(d.margins.net)} label={`margen neto · ${d.margins.netPct}%`} tone="muted" />
            <Metric value={eur(d.margins.ebitda)} label="EBITDA" tone="muted" />
          </MetricRow>
        </MiniList>
      )}
    </CardShell>
  );
}

function ClientesCard({ d, vocab }) {
  return (
    <CardShell href="/clientes" eyebrow={vocab.plural}>
      <MetricRow>
        <Metric value={d.total} label={vocab.plural.toLowerCase()} />
        <Metric value={d.companies} label="empresas" tone="muted" />
        <Metric value={d.individuals} label="particulares" tone="muted" />
      </MetricRow>
      {d.recent.length > 0 && (
        <MiniList>
          {d.recent.slice(0, 4).map((c) => (
            <Row key={c.id} left={c.name} right={c.type === "company" ? "Empresa" : "Particular"} muted={false} />
          ))}
        </MiniList>
      )}
    </CardShell>
  );
}

function LeadsCard({ d }) {
  return (
    <CardShell href="/leads" eyebrow="Comercial">
      <Metric value={d.totalOpen} label="leads abiertos" />
      {d.recent.length > 0 ? (
        <MiniList>
          {d.recent.slice(0, 4).map((l) => (
            <Row key={l.id} left={l.name} right={prettyStage(l.stage)} />
          ))}
        </MiniList>
      ) : (
        <EmptyHint>Sin leads recientes</EmptyHint>
      )}
    </CardShell>
  );
}

function OutreachCard({ d }) {
  return (
    <CardShell href="/outreach" eyebrow="Captación">
      <MetricRow>
        <Metric value={d.total} label="empresas captadas" />
        <Metric
          value={d.pendingAnalysis}
          label="sin analizar"
          tone={d.pendingAnalysis > 0 ? undefined : "muted"}
        />
      </MetricRow>
      {d.recent.length > 0 && (
        <MiniList>
          {d.recent.slice(0, 4).map((o) => (
            <Row
              key={o.id}
              left={o.name}
              right={o.analyzed ? "Analizado" : "Pendiente"}
              muted={false}
            />
          ))}
        </MiniList>
      )}
    </CardShell>
  );
}

function NutricionCard({ d }) {
  return (
    <CardShell href="/nutricion/asignados" eyebrow="Nutrición">
      <MetricRow>
        <Metric value={d.assigned} label="pautas asignadas" />
        <Metric value={d.templates} label="menús" tone="muted" />
      </MetricRow>
      {d.recent.length > 0 && (
        <MiniList>
          {d.recent.slice(0, 4).map((p) => (
            <Row key={p.id} left={p.name} right={p.type === "template" ? "Menú" : "Pauta"} />
          ))}
        </MiniList>
      )}
    </CardShell>
  );
}

function FormacionCard({ d }) {
  return (
    <CardShell href="/formacion" eyebrow="Formación">
      <MetricRow>
        <Metric value={d.totalEnrollments} label="matrículas" />
        <Metric value={d.activeUsers} label="alumnos activos" tone="muted" />
      </MetricRow>
      {d.recent.length > 0 && (
        <MiniList>
          {d.recent.slice(0, 4).map((e) => (
            <Row key={e.id} left={e.user || "—"} right={e.course || null} muted={false} />
          ))}
        </MiniList>
      )}
      {d.lastSync && (
        <div className="text-[11px] text-[var(--ink-400)] mt-3">
          Última sync: {fmtDay(d.lastSync.syncedAt)} · {d.lastSync.itemsSynced} ítems
        </div>
      )}
    </CardShell>
  );
}

function PedidosCard({ d }) {
  return (
    <CardShell href="/pedidos" eyebrow="Pedidos">
      <MetricRow>
        <Metric value={d.total} label="pedidos" />
        <Metric value={d.pending} label="en curso" tone={d.pending > 0 ? undefined : "muted"} />
      </MetricRow>
      {d.recent.length > 0 && (
        <MiniList>
          {d.recent.slice(0, 4).map((o) => (
            <Row
              key={o.id}
              left={o.client || "Sin cliente"}
              right={`${eur(o.total)} · ${ORDER_STATUS_LABEL[o.status] || o.status}`}
            />
          ))}
        </MiniList>
      )}
    </CardShell>
  );
}

const CARDS = {
  agenda: (d) => <AgendaCard d={d} />,
  tareas: (d) => <TareasCard d={d} />,
  salud: (d) => <SaludCard d={d} />,
  finance: (d, admin) => <FinanceCard d={d} admin={admin} />,
  clientes: (d, admin, vocab) => <ClientesCard d={d} vocab={vocab} />,
  leads: (d) => <LeadsCard d={d} />,
  outreach: (d) => <OutreachCard d={d} />,
  nutricion: (d) => <NutricionCard d={d} />,
  formacion: (d) => <FormacionCard d={d} />,
  pedidos: (d) => <PedidosCard d={d} />,
};

export default function HomeSummary({ blocks, admin, vocab = VOCABULARIO_CLIENTE }) {
  const present = ORDER.filter((k) => blocks && blocks[k]);
  if (present.length === 0) return null;

  return (
    <section className="px-5 lg:px-12 pb-4 max-w-6xl mx-auto">
      <div className="border-t border-[var(--ink-200)] pt-10">
        <div className="eyebrow mb-6">Resumen de hoy</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
          {present.map((k) => (
            <div key={k} className="fade-up">
              {CARDS[k](blocks[k], admin, vocab)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
