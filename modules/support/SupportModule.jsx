"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import HelpTooltip from "../../components/ui/HelpTooltip.jsx";
import TicketDetail from "./TicketDetail.jsx";
import NewTicketModal from "./NewTicketModal.jsx";
import SupportReports from "./SupportReports.jsx";
import SupportConfig from "./SupportConfig.jsx";
import { ESTADOS, PRIORIDADES, haceCuanto, slaChip } from "./supportUi.js";

/**
 * Módulo Soporte — bandeja de tickets del tenant.
 *
 * La bandeja es una LISTA DENSA (no tarjetas): aquí lo que importa es ver de
 * un vistazo qué está sin atender y qué SLA está a punto de vencer, no leer
 * textos largos (eso es el detalle). Filas clicables → drawer de detalle.
 *
 * Si la API devuelve 403 (tenant sin el módulo), la página degrada al canal
 * de contacto directo con Salamandra — la misma tarjeta del placeholder que
 * había antes, porque el botón del pie del sidebar lo ve todo el mundo.
 */

const PESTANAS = [
  { key: "active", label: "Activos" },
  { key: "open", label: "Abiertos" },
  { key: "in_progress", label: "En curso" },
  { key: "waiting", label: "Esperando" },
  { key: "resolved", label: "Resueltos" },
  { key: "closed", label: "Cerrados" },
];

export default function SupportModule() {
  const [vista, setVista] = useState("bandeja"); // bandeja | informes | config
  const [sinModulo, setSinModulo] = useState(false);

  const [tab, setTab] = useState("active");
  const [filtros, setFiltros] = useState({ q: "", priority: "", categoryId: "", assignedTo: "" });
  const [datos, setDatos] = useState({ tickets: [], recuento: {}, slaVencidos: 0, total: 0 });
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState(null);

  const [categorias, setCategorias] = useState([]);
  const [equipo, setEquipo] = useState([]);
  const [esAdmin, setEsAdmin] = useState(false);

  const [ticketAbierto, setTicketAbierto] = useState(null); // id
  const [nuevoAbierto, setNuevoAbierto] = useState(false);

  // Deep-links: ?ticket=<id> (campana/emails) y ?client=<id> (ficha de cliente).
  // Leídos de window.location en cliente, NO con useSearchParams: ese hook
  // mete el módulo en una Suspense boundary del SSR que en Next 16 se quedaba
  // sin resolver al hidratar (página en "Cargando" para siempre).
  const [clientFilter, setClientFilter] = useState(null);
  const [paramsListos, setParamsListos] = useState(false);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("client")) setClientFilter(sp.get("client"));
    if (sp.get("ticket")) setTicketAbierto(sp.get("ticket"));
    setParamsListos(true);
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    setFallo(null);
    try {
      const p = new URLSearchParams();
      p.set("status", tab);
      if (filtros.q) p.set("q", filtros.q);
      if (filtros.priority) p.set("priority", filtros.priority);
      if (filtros.categoryId) p.set("categoryId", filtros.categoryId);
      if (filtros.assignedTo) p.set("assignedTo", filtros.assignedTo);
      if (clientFilter) p.set("clientId", clientFilter);
      const res = await fetch(`/api/tickets?${p.toString()}`);
      if (res.status === 403) {
        setSinModulo(true);
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se han podido cargar los tickets");
      setDatos(json.data);
    } catch (e) {
      setFallo(e.message);
    } finally {
      setCargando(false);
    }
  }, [tab, filtros, clientFilter]);

  useEffect(() => {
    if (paramsListos) cargar();
  }, [cargar, paramsListos]);

  // Catálogos (una vez): categorías para filtros/modal y equipo para asignar.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/tickets/categories");
        if (res.ok) {
          const json = await res.json();
          setCategorias(json.data?.categories || []);
        }
      } catch { /* sin categorías */ }
      try {
        const res = await fetch("/api/team?limit=100");
        if (res.ok) {
          const json = await res.json();
          setEquipo(json.data?.members || []);
          setEsAdmin(!!json.data?.viewerIsAdmin);
        }
      } catch { /* tenant sin módulo team: se asigna sin lista */ }
    })();
  }, []);

  const categoriasActivas = useMemo(() => categorias.filter((c) => c.active), [categorias]);

  if (sinModulo) return <ContactoSalamandra />;

  return (
    <div className="min-h-full bg-gray-50">
      {/* Cabecera */}
      <div className="px-4 lg:px-8 pt-5 lg:pt-7 pb-3 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-1">Atención al cliente</div>
          <h1 className="text-gray-900 text-xl font-semibold">Soporte</h1>
          {clientFilter && (
            <a href="/soporte" className="inline-flex items-center gap-1.5 mt-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-full px-2.5 py-1 hover:border-gray-300">
              Filtrado por cliente
              <span className="text-gray-400">✕</span>
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          <BotonSecundario activo={vista === "informes"} onClick={() => setVista(vista === "informes" ? "bandeja" : "informes")}>
            Informes
          </BotonSecundario>
          {esAdmin && (
            <BotonSecundario activo={vista === "config"} onClick={() => setVista(vista === "config" ? "bandeja" : "config")}>
              Configuración
            </BotonSecundario>
          )}
          <button
            onClick={() => setNuevoAbierto(true)}
            className="bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-opacity"
          >
            Nuevo ticket
          </button>
        </div>
      </div>

      {vista === "informes" && <SupportReports />}
      {vista === "config" && <SupportConfig categorias={categorias} onCategoriasChange={setCategorias} />}

      {vista === "bandeja" && (
        <>
          {/* Aviso de SLA vencidos */}
          {datos.slaVencidos > 0 && (
            <div className="px-4 lg:px-8 pb-3">
              <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-2.5 text-sm flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                <span>
                  <strong>{datos.slaVencidos}</strong> {datos.slaVencidos === 1 ? "ticket con SLA vencido" : "tickets con SLA vencido"} — sin primera respuesta o fuera de plazo de resolución.
                  <HelpTooltip title="SLA vencido" className="ml-1.5">
                    Cuenta todos los tickets que siguen abiertos: no cambia con la pestaña ni con
                    los filtros que tengas puestos. Y{" "}
                    <strong className="text-white">el reloj no se para mientras esperas al cliente</strong>,
                    así que un ticket ya contestado que no te responden acaba sumando aquí. Deja de
                    contar cuando lo marcas como resuelto.
                  </HelpTooltip>
                </span>
              </div>
            </div>
          )}

          {/* Pestañas de estado */}
          <div className="px-4 lg:px-8">
            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm overflow-x-auto">
              {PESTANAS.map((p) => {
                const n = p.key === "active" ? datos.recuento?.active : datos.recuento?.[p.key];
                return (
                  <button
                    key={p.key}
                    onClick={() => setTab(p.key)}
                    className={`flex items-center gap-2 text-sm font-medium px-3.5 py-1.5 rounded-md whitespace-nowrap transition-colors ${
                      tab === p.key ? "bg-[var(--color-primary)] text-white" : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {p.label}
                    {n > 0 && (
                      <span
                        className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${
                          tab === p.key ? "bg-white/25 text-white" : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {n}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Filtros */}
          <div className="px-4 lg:px-8 pt-3 flex items-center gap-2 flex-wrap">
            <input
              type="search"
              value={filtros.q}
              onChange={(e) => setFiltros({ ...filtros, q: e.target.value })}
              placeholder="Buscar por asunto, solicitante o TK-42…"
              className="flex-1 min-w-[200px] max-w-sm text-sm bg-white border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-gray-400 transition-colors"
            />
            <SelectFiltro
              value={filtros.priority}
              onChange={(v) => setFiltros({ ...filtros, priority: v })}
              placeholder="Prioridad"
              opciones={Object.entries(PRIORIDADES).map(([k, v]) => ({ value: k, label: v.label }))}
            />
            {categoriasActivas.length > 0 && (
              <SelectFiltro
                value={filtros.categoryId}
                onChange={(v) => setFiltros({ ...filtros, categoryId: v })}
                placeholder="Categoría"
                opciones={categoriasActivas.map((c) => ({ value: c.id, label: c.name }))}
              />
            )}
            <SelectFiltro
              value={filtros.assignedTo}
              onChange={(v) => setFiltros({ ...filtros, assignedTo: v })}
              placeholder="Responsable"
              opciones={[
                { value: "me", label: "Mis tickets" },
                { value: "none", label: "Sin asignar" },
                ...equipo.map((m) => ({ value: m.id, label: m.displayName || m.email || "—" })),
              ]}
            />
          </div>

          {/* Lista */}
          <div className="px-4 lg:px-8 py-4">
            {cargando && (
              <div className="flex items-center gap-3 text-sm text-gray-500 py-10 justify-center">
                <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                Cargando tickets…
              </div>
            )}

            {fallo && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{fallo}</div>
            )}

            {!cargando && !fallo && datos.tickets.length === 0 && (
              <div className="border border-dashed border-gray-200 rounded-2xl p-12 text-center bg-white">
                <p className="text-gray-500 text-sm">
                  {tab === "active"
                    ? "No hay tickets activos. Cuando un cliente escriba por el portal (o abras uno a mano) aparecerá aquí."
                    : "Nada por aquí con este filtro."}
                </p>
              </div>
            )}

            {!cargando && datos.tickets.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl shadow-sm divide-y divide-gray-100 overflow-hidden">
                {datos.tickets.map((t) => (
                  <FilaTicket key={t.id} t={t} onClick={() => setTicketAbierto(t.id)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Drawer de detalle */}
      {ticketAbierto && (
        <TicketDetail
          ticketId={ticketAbierto}
          categorias={categoriasActivas}
          equipo={equipo}
          esAdmin={esAdmin}
          onClose={() => setTicketAbierto(null)}
          onChanged={cargar}
        />
      )}

      {/* Modal de alta */}
      {nuevoAbierto && (
        <NewTicketModal
          categorias={categoriasActivas}
          equipo={equipo}
          clientePrefijado={clientFilter}
          onClose={() => setNuevoAbierto(false)}
          onCreated={(t) => {
            setNuevoAbierto(false);
            cargar();
            setTicketAbierto(t.id);
          }}
        />
      )}
    </div>
  );
}

function FilaTicket({ t, onClick }) {
  const estado = ESTADOS[t.status] || ESTADOS.open;
  const prioridad = PRIORIDADES[t.priority] || PRIORIDADES.medium;
  const sla = slaChip(t.sla);
  const quien = t.client?.name || t.requesterName || "Sin cliente";

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 lg:px-5 py-3 hover:bg-gray-50/80 transition-colors flex items-center gap-3 lg:gap-4"
    >
      {/* Punto de estado + nº */}
      <div className="shrink-0 flex items-center gap-2.5 w-24">
        <span className={`w-2 h-2 rounded-full shrink-0 ${estado.dot}`} />
        <span className="text-[12px] font-mono text-gray-500">{t.ref}</span>
      </div>

      {/* Título + quién */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{t.title}</div>
        <div className="text-xs text-gray-500 truncate mt-0.5">
          {quien}
          {t.channel === "portal" && <span className="text-gray-400"> · portal</span>}
          <span className="text-gray-400"> · {haceCuanto(t.lastMessageAt)}</span>
        </div>
      </div>

      {/* Chips (desktop) */}
      <div className="hidden lg:flex items-center gap-1.5 shrink-0">
        {sla && <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${sla.clase}`}>{sla.texto}</span>}
        {t.category && (
          <span
            className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-gray-200 text-gray-600"
            style={t.category.color ? { borderColor: t.category.color, color: t.category.color } : undefined}
          >
            {t.category.name}
          </span>
        )}
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${prioridad.chip}`}>{prioridad.label}</span>
      </div>

      {/* Asignado */}
      <div className="hidden sm:block shrink-0 w-28 text-right">
        <span className="text-xs text-gray-500 truncate">{t.assignee?.displayName || "Sin asignar"}</span>
      </div>
    </button>
  );
}

function SelectFiltro({ value, onChange, placeholder, opciones }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`text-sm bg-white border border-gray-200 rounded-lg px-2.5 py-2 outline-none focus:border-gray-400 transition-colors ${value ? "text-gray-900" : "text-gray-500"}`}
    >
      <option value="">{placeholder}</option>
      {opciones.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function BotonSecundario({ activo, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`text-sm font-medium px-3.5 py-2 rounded-lg border transition-colors ${
        activo
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

/** El tenant no tiene el módulo: canal de contacto directo con Salamandra. */
function ContactoSalamandra() {
  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto">
      <div className="mb-6 lg:mb-8">
        <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-1.5">Ayuda · Soporte</div>
        <h1 className="text-gray-900 text-xl lg:text-2xl font-semibold mb-2">¿En qué te ayudamos?</h1>
        <p className="text-sm text-gray-500 max-w-xl leading-relaxed">
          Escríbenos y te respondemos en el día.
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg grid place-items-center shrink-0 text-white" style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-800">Escríbenos</h2>
            <p className="text-[13px] text-neutral-500 mt-1">Incidencias, dudas o mejoras del CRM:</p>
            <a href="mailto:info@salamandrasolutions.com" className="inline-block mt-2 text-sm font-medium underline underline-offset-2" style={{ color: "var(--color-primary, #1B3A2D)" }}>
              info@salamandrasolutions.com
            </a>
            <p className="text-[11px] text-neutral-400 mt-3">
              Cuéntanos qué pasaba, en qué pantalla y, si puedes, adjunta una captura: se arregla antes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
