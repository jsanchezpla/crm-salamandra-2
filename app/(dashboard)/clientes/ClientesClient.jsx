"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import HelpTooltip from "../../../components/ui/HelpTooltip.jsx";
import SyncWebButton from "../../../components/clients/SyncWebButton.jsx";
import PacientesDelAlta from "../../../components/clients/PacientesDelAlta.jsx";
import { camposCliente, PERFIL_COMERCIAL, PERFIL_SALUD } from "../../../lib/clients/formularioAlta.js";
import { VOCABULARIO_CLIENTE } from "../../../lib/clients/vocabulario.js";
import Paginador from "@/components/ui/Paginador.jsx";

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/**
 * Los estados del embudo, con su ayuda.
 *
 * El texto va AQUÍ y no suelto en la pantalla (mismo patrón que `METRIC_HELP`
 * en Formación): el rótulo y su explicación se leen juntos, así que cuando
 * alguien renombre un estado tiene delante lo que hay que reescribir.
 *
 * Escritos para quien usa el CRM, no para quien lo programa: dicen qué hacer
 * con cada estado, no qué guarda la columna.
 */
const STATUSES = [
  {
    key: "new",
    label: "Nuevo",
    help: "Acaba de entrar y todavía no ha hablado nadie con él. Es la bandeja de entrada: lo que esté aquí mucho tiempo es alguien esperando respuesta.",
  },
  {
    key: "contacted",
    label: "Contactado",
    help: "Ya se le ha escrito o llamado, pero aún no hay nada cerrado. Sirve para no llamar dos veces a la misma persona ni olvidarse de quien contestó.",
  },
  {
    key: "following",
    label: "En seguimiento",
    help: "Hay conversación abierta: está decidiendo, pidiendo presupuesto o pendiente de una fecha. Es donde vive el trabajo comercial del día a día.",
  },
  {
    key: "converted",
    label: "Convertido",
    help: "Ya es cliente: ha contratado o ha empezado. A partir de aquí lo que cuenta es su ficha, no el embudo.",
  },
  {
    key: "discarded",
    label: "Descartado",
    help: "No sigue adelante — no le encajaba, no contestó o se fue a otro sitio. No se borra a propósito: saber cuánta gente se cae, y por dónde, es la mitad de la información.",
  },
];

// Flujo principal: new → contacted → following → converted.
// 'discarded' es estado terminal aparte; un click en su badge no avanza.
const STATUS_FLOW = ["new", "contacted", "following", "converted"];
function nextStatus(current) {
  const idx = STATUS_FLOW.indexOf(current);
  if (idx < 0 || idx >= STATUS_FLOW.length - 1) return null;
  return STATUS_FLOW[idx + 1];
}

const STATUS_STYLE = {
  new: { dot: "bg-gray-400", bg: "bg-gray-100 text-gray-600" },
  contacted: { dot: "bg-blue-400", bg: "bg-blue-100 text-blue-700" },
  following: { dot: "bg-amber-400", bg: "bg-amber-100 text-amber-700" },
  converted: { dot: "bg-emerald-400", bg: "bg-emerald-100 text-emerald-700" },
  discarded: { dot: "bg-red-400", bg: "bg-red-100 text-red-600" },
};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

// `perfil`, `conPacientes` y `vocab` los resuelve el server component hermano:
// qué campos se preguntan —y cómo se llama aquí la gente— depende de lo que el
// cliente tenga contratado. En una consulta de nutrición son «pacientes».
export default function ClientesClient({
  perfil = PERFIL_COMERCIAL,
  conPacientes = false,
  conListaEspera = false,
  vocab = VOCABULARIO_CLIENTE,
}) {
  const router = useRouter();
  const mounted = useMounted();
  const [clients, setClients] = useState([]);
  const [total, setTotal] = useState(0);
  // Paginación: hasta hoy la lista pedía 200 fijos y no mandaba página, así que
  // con 1.110 clientes solo se veían los primeros 200 y no había forma de
  // llegar al resto. La API ya paginaba; lo que faltaba era usarlo.
  const POR_PAGINA = 50;
  const [pagina, setPagina] = useState(1);
  const [paginas, setPaginas] = useState(1);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState("all");
  const [search, setSearch] = useState("");
  // Ordenación por columna (04/08/2026). Va al servidor, no se ordena lo que
  // hay pintado: con 1.110 fichas y 50 por página, ordenar la página actual
  // solo ordenaría 50 y daría la falsa sensación de haber ordenado la lista.
  const [orden, setOrden] = useState("alta");
  const [dir, setDir] = useState("desc");
  // El embudo comercial (Nuevo → Contactado → Convertido) no significa nada en
  // una consulta de nutrición: allí todos son pacientes. Se esconde la columna
  // y las tarjetas de recuento (Rodrigo, 04/08/2026), igual que ya se quitaron
  // «Tema» y «Producto de interés» del alta para el mismo perfil.
  const conEmbudo = perfil !== PERFIL_SALUD;
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editError, setEditError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const CAMPOS_ALTA = camposCliente(perfil);
  const ALTA_VACIA = Object.fromEntries(CAMPOS_ALTA.map((c) => [c.key, ""]));
  // La ficha edita lo mismo que se pregunta en el alta: si no, el código
  // postal que acaba de teclear recepción no se podría corregir nunca.
  const CAMPOS_EDICION = CAMPOS_ALTA.map((c) => ({ ...c, label: c.label.replace(" *", "") }));
  const [newClientForm, setNewClientForm] = useState(ALTA_VACIA);
  const [nuevosPacientes, setNuevosPacientes] = useState([]);
  const [altaEnListaEspera, setAltaEnListaEspera] = useState(false);
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClientError, setNewClientError] = useState(null);

  const fetchClients = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(POR_PAGINA), page: String(pagina), orden, dir });
    if (activeStatus !== "all") params.set("status", activeStatus);
    if (search.trim()) params.set("search", search.trim());
    fetch(`/api/clients?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setClients(data.data.clients);
          setTotal(data.data.total ?? data.data.clients.length);
          setPaginas(data.data.pages ?? 1);
        }
      })
      .finally(() => setLoading(false));
  }, [activeStatus, search, pagina, orden, dir]);

  /** Pulsar una cabecera ordena por ella; pulsarla otra vez le da la vuelta. */
  function ordenarPor(clave) {
    if (orden === clave) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setOrden(clave); setDir("asc"); }
    setPagina(1);   // ordenar y quedarse en la página 7 no enseña lo que se busca
  }

  // Al buscar o cambiar de estado se vuelve a la primera página: quedarse en la
  // 7 tras una búsqueda que devuelve 12 resultados deja la lista vacía sin
  // explicar por qué.
  useEffect(() => { setPagina(1); }, [activeStatus, search]);

  useEffect(() => {
    const t = setTimeout(fetchClients, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchClients, search]);

  const statusCounts = clients.reduce((acc, c) => {
    const s = c.customFields?.seStatus || "new";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  function fillEditForm(client) {
    setEditForm({
      name: client.name || "",
      email: client.email || "",
      phone: client.phone || "",
      notes: client.notes || "",
      status: client.customFields?.seStatus || "new",
      company: client.customFields?.company || "",
      country: client.customFields?.country || "",
      city: client.customFields?.city || "",
      postalCode: client.customFields?.postalCode || "",
    });
  }

  function openPanel(client) {
    setSelected(client);
    fillEditForm(client);
    setEditError(null);
    setPanelOpen(true);
  }
  function closePanel() {
    setPanelOpen(false);
    setSelected(null);
    setEditError(null);
  }

  useEffect(() => {
    if (!panelOpen) return;
    function onKey(e) { if (e.key === "Escape") closePanel(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  function validateEditForm(form) {
    if (!form.name?.trim()) return "El nombre es obligatorio";
    const email = (form.email || "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "El email no tiene un formato válido (ej. nombre@empresa.com)";
    }
    const phone = (form.phone || "").trim();
    if (phone && !/^[+\d][\d\s\-().]{6,}$/.test(phone)) {
      return "El teléfono no tiene un formato válido (ej. +34 612 345 678)";
    }
    return null;
  }

  async function saveEdit(clientId) {
    const validationError = validateEditForm(editForm);
    if (validationError) {
      setEditError(validationError);
      return;
    }
    setEditError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setSelected(data.data);
        setClients((prev) => prev.map((c) => (c.id === clientId ? data.data : c)));
      } else {
        setEditError(data.error || `Error al guardar (HTTP ${res.status})`);
      }
    } catch (err) {
      setEditError(err?.message || "Error de red");
    } finally {
      setSaving(false);
    }
  }

  async function advanceClientStatus(client) {
    const current = client.customFields?.seStatus || "new";
    const next = nextStatus(current);
    if (!next) return;
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) return;
      setClients((prev) => prev.map((c) => (c.id === client.id ? data.data : c)));
      if (selected?.id === client.id) {
        setSelected(data.data);
        setEditForm((f) => ({ ...f, status: next }));
      }
    } catch {
      // silencioso a propósito; el resto de la UI sigue funcionando
    }
  }

  async function handleDelete(clientId) {
    if (!confirm(`¿Eliminar este ${vocab.singular}?`)) return;
    await fetch(`/api/clients/${clientId}`, { method: "DELETE" });
    setClients((prev) => prev.filter((c) => c.id !== clientId));
    setTotal((prev) => prev - 1);
    closePanel();
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (activeStatus !== "all") params.set("status", activeStatus);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/clients/export?${params}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clientes_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  function validateNewClient(form) {
    if (!form.name.trim()) return "El nombre es obligatorio";
    const email = form.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "El email no tiene un formato válido (ej. nombre@empresa.com)";
    }
    const phone = form.phone.trim();
    // Acepta +34 600 123 456, 600123456, 0034-600-123-456, etc. Mínimo 7 dígitos.
    if (phone && !/^[+\d][\d\s\-().]{6,}$/.test(phone)) {
      return "El teléfono no tiene un formato válido (ej. +34 612 345 678)";
    }
    return null;
  }

  async function handleCreateClient() {
    const validationError = validateNewClient(newClientForm);
    if (validationError) {
      setNewClientError(validationError);
      return;
    }
    setNewClientError(null);
    setCreatingClient(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newClientForm,
          pacientes: conPacientes ? nuevosPacientes : [],
          listaEspera: conListaEspera && altaEnListaEspera,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        fetchClients();
        setNewClientOpen(false);
        setNewClientForm(ALTA_VACIA);
        setNuevosPacientes([]);
        setAltaEnListaEspera(false);
      } else {
        setNewClientError(data.error || `Error al crear el ${vocab.singular} (HTTP ${res.status})`);
      }
    } catch (err) {
      setNewClientError(err?.message || "Error de red");
    } finally {
      setCreatingClient(false);
    }
  }

  return (
    <div className="flex h-full bg-[var(--color-accent)]">
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${panelOpen ? "lg:mr-[440px]" : ""}`}>
        {/* Header */}
        <div className="px-4 lg:px-10 pt-5 lg:pt-12 pb-0">
          <div className="flex items-end justify-between mb-5 lg:mb-7 gap-4 flex-wrap">
            <div>
              <div className="eyebrow mb-1.5 lg:mb-2">{vocab.area} · {vocab.plural}</div>
              <h1 className="font-display text-[26px] lg:text-[40px] leading-[1.05] text-[var(--ink-900)] tracking-tight flex items-center gap-2 flex-wrap">
                <span>
                  {vocab.plural} <span className="font-display-italic text-[var(--ink-400)]">— {total} {total === 1 ? vocab.unidad : vocab.unidades}</span>
                </span>
                {/* El vocabulario cambia por cliente (pacientes, familias,
                    empresas…), así que la ayuda lo usa en vez de decir
                    «clientes» y contradecir al rótulo de al lado. */}
                <HelpTooltip title={vocab.plural} placement="bottom">
                  Aquí está toda la gente que pasa por tu negocio, desde que llega hasta que se
                  queda. Las pestañas de abajo son las fases: cada {vocab.singular} avanza de una a
                  otra y así se ve de un vistazo con quién hay trabajo pendiente. Pincha en
                  cualquier fila para abrir su ficha completa.
                </HelpTooltip>
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <SyncWebButton />
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex items-center gap-2 bg-white border border-[var(--ink-200)] hover:border-[var(--ink-300)] text-[var(--ink-700)] text-[13px] font-medium px-4 py-2 rounded-[var(--radius-control)] transition-colors disabled:opacity-50"
              >
                {exporting ? (
                  <div className="w-4 h-4 border-2 border-[var(--ink-400)] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 3v13.5m0 0l-4.5-4.5M12 16.5l4.5-4.5" />
                  </svg>
                )}
                <span className="hidden sm:inline">Exportar Excel</span>
              </button>
              <button
                onClick={() => setNewClientOpen(true)}
                className="flex items-center gap-2 bg-[var(--color-primary)] hover:opacity-90 text-white text-[13px] font-medium px-4 py-2 rounded-[var(--radius-control)] transition-opacity"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Nuevo {vocab.singular}
              </button>
            </div>
          </div>

          {/* Recuento por estado del embudo comercial. Fuera en el perfil de
              salud: ahí no hay embudo, son pacientes. */}
          {conEmbudo && (
          <div className="grid grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3 mb-5">
            {STATUSES.map((s) => (
              <div
                key={s.key}
                onClick={() => setActiveStatus(activeStatus === s.key ? "all" : s.key)}
                className={`bg-white border rounded-xl p-3 cursor-pointer transition-all ${
                  activeStatus === s.key ? "border-[var(--color-primary)] shadow-md" : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_STYLE[s.key].dot}`} />
                  <span className="text-[9px] lg:text-[10px] text-gray-500 uppercase tracking-wide truncate leading-none">{s.label}</span>
                </div>
                <div className="text-gray-900 text-lg lg:text-xl font-semibold">{statusCounts[s.key] ?? 0}</div>
              </div>
            ))}
          </div>
          )}

          {/* Search */}
          <div className="flex items-center gap-2 mb-2">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Buscar por nombre, email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[var(--color-primary)] transition-colors shadow-sm"
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm overflow-x-auto min-w-0 mb-3">
            <button
              onClick={() => setActiveStatus("all")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeStatus === "all" ? "bg-[var(--color-primary)] text-white" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Todos
            </button>
            {STATUSES.map((s) => (
              // El «?» va FUERA del botón: dentro, pulsarlo cambiaría de pestaña
              // además de abrir la ayuda, y leer qué significa un estado no
              // tiene por qué obligarte a filtrar por él.
              <span key={s.key} className="inline-flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setActiveStatus(s.key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    activeStatus === s.key ? "bg-[var(--color-primary)] text-white" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {s.label}
                </button>
                <HelpTooltip title={s.label} placement="bottom">
                  {s.help}
                </HelpTooltip>
              </span>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto px-4 lg:px-8 pb-8">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : clients.length === 0 ? (
            <div className="text-center py-20 text-gray-400 text-sm">
              No hay {vocab.plural.toLowerCase()}{activeStatus !== "all" ? " con este estado" : ""}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <Cabecera clave="nombre" orden={orden} dir={dir} onClick={ordenarPor}>Nombre / Empresa</Cabecera>
                    <Cabecera clave="email" orden={orden} dir={dir} onClick={ordenarPor} className="hidden md:table-cell">Email</Cabecera>
                    <Cabecera clave="telefono" orden={orden} dir={dir} onClick={ordenarPor} className="hidden lg:table-cell">Teléfono</Cabecera>
                    {conEmbudo && (
                      <Cabecera clave="estado" orden={orden} dir={dir} onClick={ordenarPor}>Estado</Cabecera>
                    )}
                    <Cabecera clave="alta" orden={orden} dir={dir} onClick={ordenarPor} className="hidden sm:table-cell">Alta</Cabecera>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {clients.map((client, i) => {
                    const st = STATUS_STYLE[client.customFields?.seStatus] ?? STATUS_STYLE.new;
                    const statusLabel = STATUSES.find((s) => s.key === client.customFields?.seStatus)?.label ?? "Nuevo";
                    const isSelected = selected?.id === client.id;
                    return (
                      <tr
                        key={client.id}
                        role="link"
                        tabIndex={-1}
                        onClick={(e) => {
                          // No navegar si el click viene de un elemento interactivo interno.
                          if (e.target.closest("a, button, input, select, textarea, label")) return;
                          router.push(`/clientes/${client.id}`);
                        }}
                        className={`border-b border-gray-50 cursor-pointer transition-colors ${
                          isSelected ? "bg-blue-50" : i % 2 === 0 ? "hover:bg-gray-50" : "bg-gray-50/50 hover:bg-gray-100/50"
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 truncate max-w-[160px]">{client.name || "—"}</div>
                          <div className="text-xs text-gray-400 truncate max-w-[160px]">{client.customFields?.company || ""}</div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-gray-600 truncate max-w-[180px] block">{client.email || "—"}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-gray-600">{client.phone || "—"}</span>
                        </td>
                        {conEmbudo && (
                        <td className="px-4 py-3">
                          {(() => {
                            const current = client.customFields?.seStatus || "new";
                            const canAdvance = nextStatus(current) !== null;
                            const nextLabel = canAdvance
                              ? STATUSES.find((s) => s.key === nextStatus(current))?.label
                              : null;
                            return (
                              <button
                                type="button"
                                onClick={() => canAdvance && advanceClientStatus(client)}
                                disabled={!canAdvance}
                                title={canAdvance ? `Pasar a "${nextLabel}"` : "Estado final"}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition ${st.bg} ${
                                  canAdvance ? "hover:ring-2 hover:ring-offset-1 hover:ring-[var(--color-primary)]/40 cursor-pointer" : "cursor-default"
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                                {statusLabel}
                              </button>
                            );
                          })()}
                        </td>
                        )}
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-gray-500 text-xs">{formatDate(client.createdAt)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openPanel(client)}
                            className="text-xs text-[var(--color-primary)] hover:underline whitespace-nowrap"
                          >
                            Editar ficha
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <Paginador
            pagina={pagina} paginas={paginas} total={total}
            porPagina={POR_PAGINA} cargando={loading} onCambio={setPagina}
          />
        </div>
      </div>

      {/* Side panel */}
      {panelOpen && selected && mounted && createPortal(
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/50 z-[70] fade-in"
            onClick={closePanel}
            aria-hidden="true"
          />
          <div
            className="fixed top-0 right-0 h-full w-full lg:w-[440px] bg-white border-l border-gray-200 shadow-2xl flex flex-col z-[80] overflow-hidden slide-right"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            {/* Barra "Atrás" — solo móvil */}
            <button
              onClick={closePanel}
              className="lg:hidden flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors shrink-0 w-full text-left"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              <span className="text-sm font-medium">Volver al listado</span>
            </button>

            <div className="flex items-center justify-between px-4 lg:px-6 py-3 lg:py-4 border-b border-gray-100 shrink-0 gap-3">
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${(STATUS_STYLE[selected.customFields?.seStatus] ?? STATUS_STYLE.new).bg}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${(STATUS_STYLE[selected.customFields?.seStatus] ?? STATUS_STYLE.new).dot}`} />
                {STATUSES.find((s) => s.key === selected.customFields?.seStatus)?.label ?? "Nuevo"}
              </span>
              <button
                onClick={closePanel}
                className="hidden lg:flex w-10 h-10 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                aria-label="Cerrar panel"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

          <div className="flex-1 overflow-y-auto">
            <div className="p-6 space-y-4">
              {editError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                  {editError}
                </div>
              )}
              {CAMPOS_EDICION.map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                  <input
                    type={type}
                    value={editForm[key] || ""}
                    onChange={(e) => {
                      setEditForm((f) => ({ ...f, [key]: e.target.value }));
                      if (editError) setEditError(null);
                    }}
                    placeholder={placeholder}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] placeholder:text-gray-300"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Notas</label>
                <textarea
                  rows={3}
                  value={editForm.notes || ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Comentarios internos, contactos previos, etc."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none placeholder:text-gray-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Estado</label>
                <div className="flex flex-wrap gap-1.5">
                  {STATUSES.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setEditForm((f) => ({ ...f, status: s.key }))}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        editForm.status === s.key ? `${STATUS_STYLE[s.key].bg} border-transparent` : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[s.key].dot}`} />
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-xs text-gray-400 pt-2 border-t border-gray-100">
                Alta: {formatDate(selected.createdAt)}
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-2">
            <button
              onClick={() => saveEdit(selected.id)}
              disabled={saving}
              className="flex-1 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium py-2 rounded-lg transition-opacity disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
            <Link
              href={`/clientes/${selected.id}`}
              className="px-3 py-2 flex items-center justify-center border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium rounded-lg transition-colors"
              title="Ver ficha completa"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </Link>
            <button
              onClick={() => handleDelete(selected.id)}
              className="px-3 py-2 text-red-500 hover:text-red-700 border border-red-100 hover:border-red-200 rounded-lg transition-colors"
              title="Eliminar"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </button>
          </div>
        </div>
        </>,
        document.body
      )}

      {/* New client modal */}
      {newClientOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Nuevo {vocab.singular}</h2>
              <button
                onClick={() => { setNewClientOpen(false); setNewClientError(null); }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {newClientError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                  {newClientError}
                </div>
              )}
              {CAMPOS_ALTA.map(({ label, key, type, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                  <input
                    type={type}
                    value={newClientForm[key] || ""}
                    onChange={(e) => {
                      setNewClientForm((f) => ({ ...f, [key]: e.target.value }));
                      if (newClientError) setNewClientError(null);
                    }}
                    placeholder={placeholder}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] placeholder:text-gray-300"
                  />
                </div>
              ))}
              {conListaEspera && (
                <label className="flex items-start gap-2.5 p-3 rounded-xl border border-gray-100 bg-gray-50/60 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={altaEnListaEspera}
                    onChange={(e) => setAltaEnListaEspera(e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 accent-[var(--color-primary)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs text-gray-700">Entra en la lista de espera</span>
                    <span className="block text-[11px] text-gray-400 leading-snug">
                      Se le abre la ficha igual, y además se le guarda el sitio en la cola de admisión
                      con la fecha de hoy.
                    </span>
                  </span>
                </label>
              )}
              {conPacientes && (
                <PacientesDelAlta
                  pacientes={nuevosPacientes}
                  onChange={(lista) => {
                    setNuevosPacientes(lista);
                    if (newClientError) setNewClientError(null);
                  }}
                  nombreCliente={newClientForm.name}
                />
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
              <button
                onClick={handleCreateClient}
                disabled={!newClientForm.name.trim() || creatingClient}
                className="flex-1 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium py-2 rounded-lg transition-opacity disabled:opacity-40"
              >
                {creatingClient ? "Creando…" : `Crear ${vocab.singular}`}
              </button>
              <button
                onClick={() => { setNewClientOpen(false); setNewClientError(null); }}
                className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Cabecera de columna que ordena al pulsarla.
 *
 * La flecha solo sale en la columna por la que se está ordenando: marcarlas
 * todas con una flechita gris hace que no se sepa cuál manda. `aria-sort` es lo
 * que se lo cuenta a un lector de pantalla.
 */
function Cabecera({ clave, orden, dir, onClick, className = "", children }) {
  const activa = orden === clave;
  return (
    <th
      scope="col"
      aria-sort={activa ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider ${className} ${
        activa ? "text-gray-700" : "text-gray-400"
      }`}
    >
      <button
        type="button"
        onClick={() => onClick(clave)}
        className="inline-flex items-center gap-1 hover:text-gray-700 transition uppercase tracking-wider"
      >
        {children}
        <span className={activa ? "opacity-100" : "opacity-0"} aria-hidden="true">
          {dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}
