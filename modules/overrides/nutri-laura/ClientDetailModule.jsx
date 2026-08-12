"use client";

/**
 * ClientDetailModule (override nutri_laura) — ficha de paciente con tabs.
 *
 * Tabs:
 *   1. Datos — PatientCard editable inline + historial legacy collapsible.
 *   2. Historia clínica — timeline interno (ClientNotesPanel). Se llamaba
 *      "Notas"; renombrada en la UI de nutri_laura (la clave y la tabla siguen
 *      siendo `notes` / `client_notes`).
 *   3. Documentos — PDFs del paciente (ClientAttachmentsPanel).
 *   4. Sesiones — bookings del paciente con confirm/reject (ClientBookingsPanel).
 *   5. Pautas — planes de menú asignados (ClientPlansPanel).
 *
 * Decisiones clave:
 *   - editMode + editForm viven en este componente padre, NO en PatientCard.
 *     Cambiar de tab desmonta InfoTab pero el state sobrevive aquí, así que
 *     al volver a Información los inputs reaparecen con lo que el usuario
 *     tenía escrito (regla #1 del Checkpoint 3: no romper edición inline).
 *   - InteractionsLegacySection archivado a `_InteractionsLegacySection.jsx`:
 *     la tabla `interactions` no existe en crm_nutri_laura, así que la sección
 *     se quitó del render. El backend tolera la tabla missing (try/catch en
 *     GET /api/clients/:id) y otros tenants siguen recibiendo el array para
 *     su default module.
 *   - Permisos: gate por `me.role ∈ {admin, superadmin, employee}` antes
 *     de pintar el detalle. Sin rol válido → mensaje "Sin acceso".
 *
 * Endpoints usados directamente:
 *   - GET    /api/auth/me
 *   - GET    /api/clients/:id
 *   - PUT    /api/clients/:id
 *   - DELETE /api/clients/:id
 *
 * El branding sale de CSS vars inyectadas por el layout del dashboard
 * (var(--color-primary) = #A97873 en nutri_laura).
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { eurosToCents } from "../../../lib/payments/money.js";

import ClientNotesPanel from "./ClientNotesPanel.jsx";
import ClientAttachmentsPanel from "./ClientAttachmentsPanel.jsx";
import ClientBookingsPanel from "./ClientBookingsPanel.jsx";
import ClientPlansPanel from "./ClientPlansPanel.jsx";
import ClientModulesSection from "../../../components/clients/ClientModulesSection.jsx";
import ClientCitasSection from "../../../components/clients/ClientCitasSection.jsx";
import ClientConsultaExternaSection from "../../../components/clients/ClientConsultaExternaSection.jsx";
import ClientCuentaWebSection from "../../../components/clients/ClientCuentaWebSection.jsx";
import ClientProfesionalSection from "../../../components/clients/ClientProfesionalSection.jsx";
import { edadDesde } from "../../../lib/clients/formularioAlta.js";
import { fraseArrastreSegunModulos } from "../../../lib/clients/avisoBorrado.js";

// Rótulos revisados el 04/08/2026 (Rodrigo): Datos · Historia clínica ·
// Documentos · Sesiones · Pautas. SOLO cambian los nombres visibles — las
// claves, los paneles, las tablas y los endpoints siguen siendo los mismos
// (`attachments` sigue leyendo adjuntos y `bookings`, citas).
const TABS = [
  { key: "info", label: "Datos" },
  // "Historia clínica" (antes "Notas"): para Laura estas anotaciones SON el
  // seguimiento clínico de la paciente, no notas sueltas. La clave interna
  // sigue siendo `notes` (misma tabla client_notes y mismos endpoints): solo
  // cambia el nombre visible, y SOLO en nutri_laura (el resto de tenants usa
  // modules/default/ClientDetailModule.jsx, donde siguen siendo "Notas").
  { key: "notes", label: "Historia clínica" },
  { key: "attachments", label: "Documentos" },
  // "Sesiones", no "Citas": en la consulta cada cita ES una sesión de
  // seguimiento. Sigue siendo la agenda del módulo `citas` por debajo.
  { key: "bookings", label: "Sesiones" },
  // Tab "Plan" añadida en Sprint Recetario C4 y renombrada a "Pautas". Solo
  // visible en nutri_laura.
  { key: "plan", label: "Pautas" },
];

const ROLES_WITH_ACCESS = new Set(["admin", "superadmin", "employee"]);

const STATUSES = [
  { key: "new", label: "Nuevo" },
  { key: "contacted", label: "Contactado" },
  { key: "following", label: "En seguimiento" },
  { key: "converted", label: "Paciente activo" },
  { key: "discarded", label: "Descartado" },
];

const STATUS_STYLE = {
  new: { dot: "bg-gray-400", bg: "bg-gray-100 text-gray-600" },
  contacted: { dot: "bg-blue-400", bg: "bg-blue-100 text-blue-700" },
  following: { dot: "bg-amber-400", bg: "bg-amber-100 text-amber-700" },
  converted: { dot: "bg-emerald-400", bg: "bg-emerald-100 text-emerald-700" },
  discarded: { dot: "bg-red-400", bg: "bg-red-100 text-red-600" },
};

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function NutriLauraClientDetailModule() {
  const { id } = useParams();
  const router = useRouter();

  const [me, setMe] = useState(null);
  const [meLoading, setMeLoading] = useState(true);

  const [client, setClient] = useState(null);
  const [loadingClient, setLoadingClient] = useState(true);
  const [clientError, setClientError] = useState(null);

  const [tab, setTab] = useState("info");

  // Edición inline en el padre — preserva state al cambiar tabs.
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Permisos
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => setMe(j?.ok ? j.data : null))
      .catch(() => setMe(null))
      .finally(() => setMeLoading(false));
  }, []);

  // Cliente
  const loadClient = useCallback(() => {
    setLoadingClient(true);
    setClientError(null);
    fetch(`/api/clients/${id}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) throw new Error(j?.error || "Error al cargar el paciente");
        setClient(j.data);
      })
      .catch((e) => setClientError(e.message))
      .finally(() => setLoadingClient(false));
  }, [id]);

  useEffect(() => { loadClient(); }, [loadClient]);

  function openEdit() {
    if (!client) return;
    setEditForm({
      name: client.name || "",
      taxId: client.taxId || "",
      // DATEONLY llega como "YYYY-MM-DD"; el input date no admite otra cosa.
      birthDate: client.birthDate ? String(client.birthDate).slice(0, 10) : "",
      email: client.email || "",
      phone: client.phone || "",
      domicilio: client.customFields?.domicilio || "",
      notes: client.notes || "",
      status: client.customFields?.seStatus || "new",
      edad: client.customFields?.edad || "",
      motivo: client.customFields?.motivo || "",
      info_adicional: client.customFields?.info_adicional || "",
    });
    setEditError(null);
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
    setEditError(null);
  }

  async function saveEdit() {
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const j = await res.json();
      if (!j?.ok) {
        setEditError(j?.error || `Error al guardar (HTTP ${res.status})`);
        return;
      }
      setClient(j.data);
      setEditMode(false);
    } catch (e) {
      setEditError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    await fetch(`/api/clients/${id}`, { method: "DELETE" });
    router.push("/clientes");
  }

  // ── Render gates ──────────────────────────────────────────────────────────
  if (meLoading || loadingClient) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!me || !ROLES_WITH_ACCESS.has(me.role)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
        <div className="text-2xl">🔒</div>
        <p className="text-gray-500 text-sm">No tienes acceso a esta ficha.</p>
        <Link href="/" className="text-[var(--color-primary)] hover:underline text-sm">
          ← Volver al dashboard
        </Link>
      </div>
    );
  }

  if (clientError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
        <p className="text-red-600 text-sm">No se pudo cargar el paciente:</p>
        <p className="text-xs text-gray-500">{clientError}</p>
        <div className="flex gap-2 mt-2">
          <button
            onClick={loadClient}
            className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg hover:opacity-90"
            style={{ background: "var(--color-primary)" }}
          >
            Reintentar
          </button>
          <Link
            href="/clientes"
            className="text-xs text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50"
          >
            Volver
          </Link>
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-gray-500">Paciente no encontrado</p>
        <Link href="/clientes" className="text-[var(--color-primary)] hover:underline text-sm">
          ← Volver a pacientes
        </Link>
      </div>
    );
  }

  const status = client.customFields?.seStatus || "new";
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.new;
  // La edad DERIVADA de la fecha de nacimiento manda sobre la que se escribió a
  // mano (04/08/2026): guardar las dos es garantizar que dentro de un año una de
  // ellas mienta. La escrita a mano se sigue enseñando mientras no haya fecha,
  // que es lo que tienen las fichas antiguas.
  const edadDerivada = edadDesde(client.birthDate);
  const edad = edadDerivada != null ? `${edadDerivada} años` : client.customFields?.edad;
  const dni = client.taxId;
  const motivo = client.customFields?.motivo;
  const infoAdicional = client.customFields?.info_adicional;
  // leadId puede venir como client.leadId (modelo) o como customFields.leadId
  // (compat de overrides antiguos) — soportamos los dos.
  const leadId = client.leadId ?? client.customFields?.leadId ?? null;

  return (
    <div className="flex flex-col h-full bg-[var(--color-accent,#F7F1EB)]/40">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 lg:px-8 pt-6 pb-4 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <Link
            href="/clientes"
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Volver a pacientes"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <h1 className="text-gray-900 text-lg font-semibold">{client.name}</h1>
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${st.bg}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
            {STATUSES.find((s) => s.key === status)?.label ?? status}
          </span>
        </div>
        <div className="ml-7 flex flex-wrap gap-3 text-xs text-gray-500">
          {edad && <span>Edad: <strong className="text-gray-700">{edad}</strong></span>}
          {dni && <span>DNI/NIE: <strong className="text-gray-700">{dni}</strong></span>}
          {client.email && (
            <a href={`mailto:${client.email}`} className="hover:text-[var(--color-primary)]">
              {client.email}
            </a>
          )}
          {client.phone && (
            <a href={`tel:${client.phone}`} className="hover:text-[var(--color-primary)]">
              {client.phone}
            </a>
          )}
          {leadId && (
            <Link
              href={`/leads?focus=${encodeURIComponent(leadId)}`}
              className="hover:text-[var(--color-primary)] underline-offset-2 hover:underline"
              title="Ver lead origen"
            >
              ↳ Lead origen
            </Link>
          )}
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="border-b border-gray-100 bg-white">
        <div className="px-4 lg:px-8 flex items-center gap-1 overflow-x-auto whitespace-nowrap">
          {TABS.map((t) => (
            <TabButton
              key={t.key}
              active={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </TabButton>
          ))}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 lg:px-8 py-6">
        {tab === "info" && (
          <InfoTab
            client={client}
            motivo={motivo}
            infoAdicional={infoAdicional}
            editMode={editMode}
            editForm={editForm}
            setEditForm={setEditForm}
            onEdit={openEdit}
            onSave={saveEdit}
            onCancel={cancelEdit}
            saving={saving}
            editError={editError}
            confirmDelete={confirmDelete}
            setConfirmDelete={setConfirmDelete}
            onDelete={handleDelete}
            avisoArrastre={fraseArrastreSegunModulos(me?.enabledModules)}
            onRecargar={loadClient}
          />
        )}

        {tab === "notes" && <ClientNotesPanel clientId={id} />}

        {tab === "attachments" && <ClientAttachmentsPanel clientId={id} />}

        {tab === "bookings" && (
          <>
            <ClientBookingsPanel
              clientId={id}
              clientEmail={client.email}
              userRole={me.role}
            />
          </>
        )}

        {tab === "plan" && <ClientPlansPanel clientId={id} />}
      </div>
    </div>
  );
}

// ── TabButton ────────────────────────────────────────────────────────────────

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm font-semibold px-3 lg:px-4 py-3 border-b-2 transition-colors shrink-0 ${
        active
          ? "border-[var(--color-primary)] text-gray-900"
          : "border-transparent text-gray-400 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

// ── InfoTab ──────────────────────────────────────────────────────────────────

function InfoTab({
  client,
  motivo,
  infoAdicional,
  editMode,
  editForm,
  setEditForm,
  onEdit,
  onSave,
  onCancel,
  saving,
  editError,
  confirmDelete,
  setConfirmDelete,
  onDelete,
  // Lo que el borrado se lleva por delante, según lo que Laura tenga
  // contratado. El cuadro rojo decía «sus archivos y su historia clínica» y se
  // callaba las CITAS FUTURAS, que también se borran y además le mandan a la
  // paciente el correo de cancelación (12/08/2026). Sale del mismo sitio que el
  // aviso del listado y el de la ficha del resto, para que digan lo mismo.
  avisoArrastre,
  onRecargar,
}) {
  /*
   * DOS COLUMNAS (07/08/2026, Rodrigo): «como hay tantas filas ya, vamos a
   * dividir la zona de datos en dos, que la parte derecha está completamente
   * vacía». Los datos del paciente son largos y todo lo demás son tarjetas
   * pequeñas que obligaban a bajar hasta el final para verlas.
   *
   * A la IZQUIERDA lo que se lee de arriba abajo —la ficha y su historia—, a la
   * DERECHA los interruptores y lo que cuelga de ella. Hasta `lg` va todo en
   * una columna: en un móvil dos columnas serían dos tiras estrechas.
   *
   * `items-start` para que las dos columnas se estiren por su cuenta; sin él,
   * la más corta se alarga hasta igualar a la otra y quedan huecos en blanco
   * dentro de las tarjetas.
   */
  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
    <div className="space-y-6 min-w-0">
      <PatientCard
        client={client}
        editMode={editMode}
        editForm={editForm}
        setEditForm={setEditForm}
        onEdit={onEdit}
        onSave={onSave}
        onCancel={onCancel}
        saving={saving}
        editError={editError}
        motivo={motivo}
        infoAdicional={infoAdicional}
      />

      {/* Lo que ES la paciente: quién es, qué tiene contratado y en qué
          programas está. Se lee de arriba abajo. */}
      <BonosSection bonos={client.bonos} client={client} onCambio={onRecargar} />

      <ClientModulesSection clientId={client.id} />

      {/* Borrar va al FINAL de todo y no en medio de la columna: es lo último
          que se hace con una ficha, y tenerlo entre dos tarjetas invita a
          pulsarlo mientras se busca otra cosa. */}
      {!confirmDelete ? (
        <button
          onClick={() => setConfirmDelete(true)}
          className="w-full text-xs text-red-400 hover:text-red-600 transition-colors py-1.5"
        >
          Eliminar paciente
        </button>
      ) : (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
          <p className="text-xs text-red-700 font-medium">
            ¿Eliminar a {client.name}? Esto borra también sus archivos y su historia clínica.
          </p>
          {avisoArrastre && <p className="text-xs text-red-700">{avisoArrastre}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 bg-white text-gray-700 border border-gray-200 text-xs font-medium py-1.5 rounded-md hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              onClick={onDelete}
              className="flex-1 bg-red-600 text-white text-xs font-semibold py-1.5 rounded-md hover:bg-red-700"
            >
              Sí, eliminar
            </button>
          </div>
        </div>
      )}
    </div>

    {/* La DERECHA: cómo se relaciona con el centro por fuera de la consulta —
        si entra a la web, cómo funcionan sus citas y si viene de una empresa.
        Se consulta y se cambia de vez en cuando; no se lee entero cada vez que
        se abre la ficha. (07/08/2026, Rodrigo: reparto pedido por él.) */}
    <div className="space-y-6 min-w-0">
      {/* Compartida con la ficha por defecto desde el 12/08/2026: el botón
          vivía solo aquí y Aumenta no lo tenía. Sin `mt-6` porque esta columna
          ya reparte el espacio con `space-y-6`. */}
      <ClientCuentaWebSection clientId={client.id} className="" />
      <ClientCitasSection clientId={client.id} />
      <ClientConsultaExternaSection clientId={client.id} />
      {/* Con quién lleva el seguimiento. Va justo debajo de consulta externa
          (10/08/2026, Rodrigo) porque en una externa las dos cosas se leen
          juntas: de qué empresa viene y quién la lleva. */}
      <ClientProfesionalSection clientId={client.id} />
    </div>
    </div>
  );
}

// ── PatientCard ──────────────────────────────────────────────────────────────

/**
 * Bonos de sesiones de la paciente (04/08/2026).
 *
 * Lo que Laura necesita ver de un vistazo es CUÁNTAS LE QUEDAN, así que ese
 * número va primero y grande. Las reservadas se dicen aparte porque no son lo
 * mismo que las gastadas: están puestas en la agenda pero todavía se pueden
 * cancelar a tiempo.
 *
 * Si no hay bonos la sección no se pinta: la mayoría de las pacientes vienen
 * por sesiones sueltas y un recuadro vacío solo estorba.
 */
function BonosSection({ bonos, client, onCambio }) {
  const [abierto, setAbierto] = useState(false);
  const [quitando, setQuitando] = useState(null);
  const [falloQuitar, setFalloQuitar] = useState(null);
  const lista = Array.isArray(bonos) ? bonos.filter((b) => b.estado !== "anulado") : [];

  /*
   * Quitarle el bono (06/08/2026, Rodrigo). Por dentro se ANULA, no se borra:
   * la fila se queda con lo que se cobró, quién lo dio y cuándo, y las sesiones
   * que ya se dieron conservan su número. Borrarla dejaría sesiones numeradas
   * colgando de un bono que nadie recuerda.
   *
   * De cara a la nutricionista da igual: deja de contar, desaparece de aquí y
   * la paciente vuelve a dejar de ver ese tipo de cita en la agenda.
   */
  async function quitar(b) {
    const quedan = b.restantes > 0 ? ` Le quedan ${b.restantes} sesión(es) sin usar.` : "";
    if (!window.confirm(`¿Quitarle el bono «${b.nombre}»?${quedan}

Dejará de poder reservar con él. Las citas que ya tenga puestas no se tocan.`)) return;
    setQuitando(b.id);
    setFalloQuitar(null);
    try {
      const res = await fetch(`/api/citas/packs/${b.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "anulado" }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "No se ha podido quitar el bono");
      onCambio?.();
    } catch (e) {
      setFalloQuitar(e.message);
    }
    setQuitando(null);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-gray-700">Bonos de sesiones</span>
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          className="text-xs font-semibold text-[var(--color-primary)] hover:underline shrink-0"
        >
          {abierto ? "Cancelar" : "Dar un bono"}
        </button>
      </div>

      {abierto && (
        <DarBonoForm
          client={client}
          onHecho={() => { setAbierto(false); onCambio?.(); }}
        />
      )}

      {lista.length === 0 && !abierto && (
        <p className="px-5 py-4 text-[11px] text-gray-400">
          Todavía no tiene ningún bono. Dale uno cuando te pague por fuera de la pasarela
          (transferencia, Bizum): a partir de ahí verá su tipo de cita y podrá reservar sola.
        </p>
      )}

      {falloQuitar && (
        <p className="px-5 pt-3 text-[11px] text-red-600">{falloQuitar}</p>
      )}

      <div className={lista.length ? "p-5 space-y-4" : "hidden"}>
        {lista.map((b) => (
          <div key={b.id}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-gray-800">{b.nombre}</span>
              <span
                className={`text-sm font-semibold ${b.restantes > 0 ? "text-[var(--color-primary)]" : "text-gray-400"}`}
              >
                {b.restantes > 0 ? `Le quedan ${b.restantes}` : "Agotado"}
              </span>
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5 flex items-baseline justify-between gap-3">
              <span>
                {b.resumen}
                {b.modoPago === "instalment" && " · pago fraccionado"}
              </span>
              <button
                type="button"
                onClick={() => quitar(b)}
                disabled={quitando === b.id}
                title="Deja de contar y la paciente deja de ver ese tipo de cita. Queda registrado que se le dio."
                className="text-[11px] text-gray-400 hover:text-red-600 hover:underline shrink-0 disabled:opacity-50"
              >
                {quitando === b.id ? "Quitando…" : "Quitar bono"}
              </button>
            </div>
            {/* Barra de progreso: gastadas + reservadas sobre el total. */}
            <div className="mt-2 h-1.5 rounded-full bg-gray-100 overflow-hidden flex">
              <div
                className="bg-[var(--color-primary)]"
                style={{ width: `${b.total ? (b.gastadas / b.total) * 100 : 0}%` }}
              />
              <div
                className="bg-[var(--color-primary)] opacity-40"
                style={{ width: `${b.total ? (b.reservadas / b.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Dar un bono a mano (05/08/2026).
 *
 * Es lo que cierra el círculo de los cobros que NO pasan por la pasarela: la
 * paciente paga por transferencia o Bizum, aquí se le abre el bono, y a partir
 * de ese momento ve su tipo de cita —aunque esté oculto— con su contador y
 * reserva sola, sin pedir hora por WhatsApp cada vez.
 *
 * El importe es opcional y NO se comprueba contra el precio del tipo de cita:
 * un acuerdo cerrado por WhatsApp puede ser otro, y bloquear el alta por un
 * descuadre de 10 € obligaría a mentir en el formulario.
 */
function DarBonoForm({ client, onHecho }) {
  const [tipos, setTipos] = useState([]);
  const [eventTypeId, setEventTypeId] = useState("");
  const [sesiones, setSesiones] = useState("");
  const [importe, setImporte] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState(null);
  const [avisos, setAvisos] = useState([]);

  useEffect(() => {
    let vivo = true;
    fetch("/api/citas/event-types?active=true", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (vivo && j.ok) setTipos(j.data ?? []); })
      .catch(() => { if (vivo) setErr("No se pudieron cargar los tipos de cita"); });
    return () => { vivo = false; };
  }, []);

  // Al elegir el tipo, se propone su número de sesiones. Se puede cambiar: no
  // todos los acuerdos son el paquete estándar.
  function elegirTipo(id) {
    setEventTypeId(id);
    const t = tipos.find((x) => x.id === id);
    setSesiones(String(t?.sessionsCount ?? 1));
  }

  async function guardar(e) {
    e.preventDefault();
    setErr(null);
    setAvisos([]);
    if (!eventTypeId) { setErr("Elige el tipo de cita"); return; }

    setGuardando(true);
    try {
      const res = await fetch("/api/citas/packs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client?.id ?? null,
          clientEmail: client?.portalEmail || client?.email || "",
          eventTypeId,
          totalSessions: Number(sesiones) || 1,
          amount: importe === "" ? null : eurosToCents(importe),
          notes: nota.trim() || null,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || "No se pudo dar el bono");
      // Los avisos no bloquean: el bono ya está dado. Se enseñan un momento por
      // si algo no encaja (tipo a la vista de todos, sesiones de más).
      if (j?.data?.avisos?.length) {
        setAvisos(j.data.avisos);
        setTimeout(() => onHecho?.(), 3500);
      } else {
        onHecho?.();
      }
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setGuardando(false);
    }
  }

  const correo = client?.portalEmail || client?.email || "";
  const inputCls =
    "w-full text-xs border border-gray-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";

  return (
    <form onSubmit={guardar} className="px-5 py-4 bg-gray-50/70 border-b border-gray-100 space-y-3">
      <p className="text-[11px] text-gray-500">
        El bono se le da al correo <strong className="text-gray-700">{correo || "—"}</strong>, que es
        con el que entra en su área privada.
      </p>

      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-1">Tipo de cita</label>
        <select value={eventTypeId} onChange={(e) => elegirTipo(e.target.value)} className={inputCls}>
          <option value="">Elige…</option>
          {tipos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}{t.isHidden ? " · oculto" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Sesiones</label>
          <input
            type="number" min={1} max={200}
            value={sesiones}
            onChange={(e) => setSesiones(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">Importe cobrado (€)</label>
          <input
            type="number" step="0.01" min={0}
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            placeholder="Opcional"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-medium text-gray-500 mb-1">Nota</label>
        <input
          type="text"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Transferencia recibida el 3/8"
          className={inputCls}
        />
      </div>

      {err && <p className="text-[11px] text-red-600">{err}</p>}
      {avisos.map((a, i) => (
        <p key={i} className="text-[11px] text-amber-700">⚠ {a}</p>
      ))}

      <button
        type="submit"
        disabled={guardando}
        className="w-full bg-[var(--color-primary)] text-white text-xs font-semibold py-2 rounded-md disabled:opacity-50"
      >
        {guardando ? "Dando el bono…" : "Dar el bono"}
      </button>
    </form>
  );
}

function PatientCard({
  client,
  editMode,
  editForm,
  setEditForm,
  onEdit,
  onSave,
  onCancel,
  saving,
  editError,
  motivo,
  infoAdicional,
}) {
  // Se deriva de `client`, que ya llega por props, y NO de una variable del
  // componente de arriba: esto es otro componente y allí no existe. Un
  // `domicilio` suelto aquí compila igual y revienta la ficha entera al pintar
  // (04/08/2026) — el build y ESLint no lo ven venir.
  const domicilio = client?.customFields?.domicilio;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Datos del paciente</span>
        {editMode ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onSave}
              disabled={saving}
              className="bg-[var(--color-primary)] hover:opacity-90 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
            <button
              onClick={onCancel}
              className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            onClick={onEdit}
            className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg"
          >
            Editar
          </button>
        )}
      </div>

      {editMode ? (
        <div className="p-5 space-y-3">
          {editError && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
              {editError}
            </div>
          )}
          {[
            { label: "Nombre", key: "name", type: "text" },
            { label: "DNI / NIE", key: "taxId", type: "text" },
            { label: "Fecha de nacimiento", key: "birthDate", type: "date" },
            { label: "Email", key: "email", type: "email" },
            { label: "Teléfono", key: "phone", type: "tel" },
            { label: "Domicilio", key: "domicilio", type: "text" },
            // «Edad» a mano solo mientras no haya fecha de nacimiento: con las
            // dos a la vez, una de ellas acaba mintiendo.
            ...(editForm?.birthDate ? [] : [{ label: "Edad", key: "edad", type: "text" }]),
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                {label}
              </label>
              <input
                type={type}
                value={editForm[key] || ""}
                onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
              />
            </div>
          ))}
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Motivo de la consulta
            </label>
            <textarea
              rows={2}
              value={editForm.motivo || ""}
              onChange={(e) => setEditForm((f) => ({ ...f, motivo: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Información adicional
            </label>
            <textarea
              rows={3}
              value={editForm.info_adicional || ""}
              onChange={(e) => setEditForm((f) => ({ ...f, info_adicional: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Estado
            </label>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setEditForm((f) => ({ ...f, status: s.key }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                    editForm.status === s.key
                      ? `${STATUS_STYLE[s.key].bg} border-transparent`
                      : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[s.key].dot}`} />
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-5 space-y-3 text-sm">
          {motivo && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Motivo de la consulta
              </div>
              <div className="text-gray-700 whitespace-pre-wrap leading-relaxed">{motivo}</div>
            </div>
          )}
          {infoAdicional && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Info adicional
              </div>
              <div className="text-gray-700 whitespace-pre-wrap leading-relaxed">{infoAdicional}</div>
            </div>
          )}
          {domicilio && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Domicilio
              </div>
              <div className="text-gray-700 leading-relaxed">{domicilio}</div>
            </div>
          )}
          {client.notes && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Notas rápidas
              </div>
              <div className="text-gray-600 whitespace-pre-wrap leading-relaxed">{client.notes}</div>
            </div>
          )}
          <div className="pt-2 border-t border-gray-50 text-xs text-gray-400">
            Alta: {fmtDate(client.createdAt)}
          </div>
        </div>
      )}
    </div>
  );
}

