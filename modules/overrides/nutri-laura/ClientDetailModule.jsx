"use client";

/**
 * ClientDetailModule (override nutri_laura) — ficha de paciente con tabs.
 *
 * Tabs:
 *   1. Datos — PatientCard editable inline.
 *   2. Historia clínica — timeline interno (ClientNotesPanel). Se llamaba
 *      "Notas"; renombrada en la UI de nutri_laura (la clave y la tabla siguen
 *      siendo `notes` / `client_notes`).
 *   3. Documentos — ficheros de la paciente (ClientAttachmentsPanel).
 *   4. Sesiones — bookings de la paciente con confirm/reject (ClientBookingsPanel).
 *   5. Pautas — planes de menú asignados (ClientPlansPanel).
 *
 * ⚠️ LOS TRES PANELES YA NO VIVEN AQUÍ (18/08/2026). Nacieron en esta carpeta
 * y eran «el override»; en realidad eran la ficha entera, sobre tablas y
 * endpoints que tiene TODO el mundo. Pasaron a `components/clients/` y los
 * monta también la ficha por defecto —a quien decida
 * `lib/clients/piezasFicha.js`—. Esta ficha los sigue montando IGUAL, con sus
 * palabras de siempre pasadas por `textos` (abajo, `TEXTOS_LAURA`): lo que
 * Laura ve no cambió con la mudanza. Lo que queda aquí de propio es la
 * cabecera de paciente, la tarjeta de datos y el reparto en cinco pestañas.
 *
 * Decisiones clave:
 *   - editMode + editForm viven en este componente padre, NO en PatientCard.
 *     Cambiar de tab desmonta InfoTab pero el state sobrevive aquí, así que
 *     al volver a Información los inputs reaparecen con lo que el usuario
 *     tenía escrito (regla #1 del Checkpoint 3: no romper edición inline).
 *   - La tabla `interactions` no existe en crm_nutri_laura, así que esta ficha
 *     no tiene sección de interacciones (la que había, archivada como
 *     `_InteractionsLegacySection.jsx`, se borró el 18/08/2026: nadie la
 *     importaba desde junio). El backend tolera la tabla missing (try/catch en
 *     GET /api/clients/:id) y otros tenants siguen recibiendo el array para
 *     su default module.
 *   - Permisos: la ficha la abre CUALQUIERA del equipo que tenga el módulo
 *     `clients` (14/08/2026, Rodrigo). Aquí solo se comprueba que haya
 *     sesión, porque el render usa `me.role`; quién puede ver cada ficha lo
 *     decide la API (`puedeVerFicha`, consultas externas).
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

import {
  ACTIVO,
  estadosDeFicha,
  etiquetaDeEstado,
  tonoDeEstado,
  usaEstadoDePerfil,
} from "../../../lib/clients/estados.js";
import ClientNotesPanel from "../../../components/clients/ClientNotesPanel.jsx";
import ClientAttachmentsPanel from "../../../components/clients/ClientAttachmentsPanel.jsx";
import ClientBookingsPanel from "../../../components/clients/ClientBookingsPanel.jsx";
import AvisoSinContacto from "../../../components/clients/AvisoSinContacto.jsx";
import ClientPlansPanel from "../../nutricion/ClientPlansPanel.jsx";
import ClientModulesSection from "../../../components/clients/ClientModulesSection.jsx";
import ClientCitasSection from "../../../components/clients/ClientCitasSection.jsx";
import ClientWhatsappSection from "../../../components/clients/ClientWhatsappSection.jsx";
import ClientBonosSection from "../../../components/clients/ClientBonosSection.jsx";
import ClientConsultaExternaSection from "../../../components/clients/ClientConsultaExternaSection.jsx";
import ClientCuentaWebSection from "../../../components/clients/ClientCuentaWebSection.jsx";
import ClientProfesionalSection from "../../../components/clients/ClientProfesionalSection.jsx";
import { edadDesde } from "../../../lib/clients/formularioAlta.js";
import { fraseArrastreSegunModulos } from "../../../lib/clients/avisoBorrado.js";
import { esAdmin } from "../../../lib/auth/permisos.js";

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
  // El hilo de WhatsApp, pegado a la historia clínica porque es lo mismo leído
  // de otra forma: lo que se ha hablado con la paciente. A diferencia del resto,
  // esta pestaña SOLO sale si hay mensajes (ver `hayWhatsapp` más abajo).
  { key: "whatsapp", label: "WhatsApp" },
  { key: "attachments", label: "Documentos" },
  // "Sesiones", no "Citas": en la consulta cada cita ES una sesión de
  // seguimiento. Sigue siendo la agenda del módulo `citas` por debajo.
  { key: "bookings", label: "Sesiones" },
  // Tab "Plan" añadida en Sprint Recetario C4 y renombrada a "Pautas". Solo
  // visible en nutri_laura.
  { key: "plan", label: "Pautas" },
];

/**
 * Las palabras de Laura en los tres paneles compartidos: LAS MISMAS que llevaban
 * escritas cuando eran suyos (18/08/2026). En su consulta la paciente es «la
 * paciente» —en femenino, que es como habla ella— y las citas son sesiones.
 * Los paneles por defecto dicen «el cliente»; esto es lo que hace que la
 * mudanza no le cambie ni una letra.
 */
const TEXTOS_LAURA = {
  notas: {
    titulo: "Nueva entrada de historia clínica",
    placeholder: "Evolución, observaciones, acuerdos de la sesión… (uso interno, no lo ve la paciente)",
    boton: "Añadir entrada",
    vacio: "La historia clínica está vacía. Escribe la primera entrada arriba.",
  },
  documentos: {
    limite: "archivos por paciente",
    loSubio: "Lo subió la paciente",
    loVe: "La paciente lo ve",
    queLoVea: "Que la paciente lo vea",
    faltaFirma: "la paciente",
  },
  sesiones: {
    titulo: "Sesiones del paciente",
    vacio: "Este paciente no tiene citas registradas.",
    avisoRechazo: "El paciente recibirá un email automático con tu motivo (si lo escribes).",
  },
};

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

export default function NutriLauraClientDetailModule({ perfil }) {
  const { id } = useParams();
  // El mismo estado de ficha que el módulo base (26/08/2026, Lau). La página le
  // pasa el perfil igual que al base; Laura tiene `nutricion`, o sea salud. Si
  // no llegara, se queda con el embudo de siempre, que es como estaba.
  const usaEstado = usaEstadoDePerfil(perfil);
  const router = useRouter();

  const [me, setMe] = useState(null);
  const [meLoading, setMeLoading] = useState(true);

  const [client, setClient] = useState(null);
  const [loadingClient, setLoadingClient] = useState(true);
  const [clientError, setClientError] = useState(null);

  const [tab, setTab] = useState("info");

  // Esta ficha pinta sus pestañas a mano (no usa `PanelPestana`, que en la ficha
  // por defecto deduce solo si un panel está vacío mirando el DOM), así que el
  // hilo de WhatsApp tiene que avisar de si tiene algo. Sin mensajes, la pestaña
  // no sale: una consulta que aún no ha conectado WhatsApp no debe ver una
  // pestaña vacía en todas las fichas.
  const [hayWhatsapp, setHayWhatsapp] = useState(false);
  const pestanas = TABS.filter((t) => t.key !== "whatsapp" || hayWhatsapp);

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
      // El embudo comercial solo viaja donde se usa; donde hay estado de ficha
      // viaja `estado`, que es la columna.
      ...(usaEstado
        ? { estado: client.status || ACTIVO }
        : { status: client.customFields?.seStatus || "new" }),
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

  /*
   * AQUÍ HABÍA UNA PUERTA CERRADA (retirada el 14/08/2026, Rodrigo).
   *
   * Un `ROLES_WITH_ACCESS = {admin, superadmin, employee}` dejaba fuera a
   * cualquiera con rol `user`, o sea a todo el equipo menos Laura, con un
   * candado y un «No tienes acceso a esta ficha». Los roles del CRM son
   * `superadmin | admin | manager | user` y "employee" no existe, así que esa
   * lista era admin a secas escrita de forma que no lo parecía.
   *
   * No la tenía nadie más: `modules/default/ClientDetailModule.jsx` no mira el
   * rol, y la API tampoco (solo `hasModule("clients")` y la regla de consultas
   * externas de `lib/clients/consultaExterna.js`). Y aquí no hay facturación
   * que proteger: la historia clínica, los documentos, las sesiones y las
   * pautas son justo lo que el equipo viene a escribir.
   *
   * `me` se sigue pidiendo, pero solo para saber qué módulos hay activos —
   * igual que en el módulo por defecto—, y por eso se lee con `?.`: que
   * `/api/auth/me` falle no puede volver a cerrar la ficha.
   */
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
  const st = usaEstado ? tonoDeEstado(client.status) : (STATUS_STYLE[status] ?? STATUS_STYLE.new);
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
            {usaEstado ? etiquetaDeEstado(client.status) : (STATUSES.find((s) => s.key === status)?.label ?? status)}
          </span>
          {/* La misma pieza que la ficha base. Esta pantalla es propia de Laura,
              pero «a esta familia no se la puede avisar» no es suyo: es del
              producto. Montarlo aquí evita que se quede atrás en silencio. */}
          <AvisoSinContacto client={client} />
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
          {pestanas.map((t) => (
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
      {/*
        El `max-w-5xl` (1.024 px) es el mismo que el del módulo base desde el
        24/08/2026, y entra aquí porque Jorge lo pidió: esta ficha era la que
        peor estaba de todo el CRM, saltando entre CINCO anchos según la pestaña
        (Datos 1.636, WhatsApp 1.024, Sesiones 896, Historia clínica /
        Documentos / Pautas 768). Ahora mide siempre lo mismo.

        Sin `mx-auto`, igual que el base: la cabecera de paciente y las pestañas
        están fuera de este cuerpo, así que centrar solo esto las desalinearía.

        ⚠️ LO QUE ESTO LE CAMBIA A LAURA, dicho aquí para que no se descubra
        mirando: su pestaña Datos es una rejilla de dos columnas, y esas columnas
        pasan de 806 px a ~500. El reparto en dos columnas lo pidió Rodrigo el
        07/08/2026 porque «la parte derecha está completamente vacía»; sigue
        habiendo dos columnas, pero más estrechas. Se hizo con permiso explícito
        de Jorge (24/08/2026) y sabiendo esto.
      */}
      <div className="flex-1 overflow-auto px-4 lg:px-8 py-6">
        <div className="max-w-5xl">
        {tab === "info" && (
          <InfoTab
            client={client}
            usaEstado={usaEstado}
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
            // Eliminar es de admin (14/08/2026, ver lib/auth/permisos.js). Ante
            // la duda —`me` todavía sin llegar— NO se enseña: es más fácil
            // recargar que deshacer un borrado, que no se deshace.
            puedeEliminar={esAdmin(me?.role)}
            onRecargar={loadClient}
          />
        )}

        {tab === "notes" && <ClientNotesPanel clientId={id} textos={TEXTOS_LAURA.notas} />}

        {/* Montado SIEMPRE (solo oculto), no `tab === "whatsapp" && …`: es él
            quien dice si hay mensajes, y si solo se montara al abrir su pestaña
            la pestaña no aparecería nunca — no se puede abrir lo que no está. */}
        <div className={tab === "whatsapp" ? undefined : "hidden"}>
          <ClientWhatsappSection clientId={id} onEstado={setHayWhatsapp} />
        </div>

        {tab === "attachments" && <ClientAttachmentsPanel clientId={id} textos={TEXTOS_LAURA.documentos} />}

        {tab === "bookings" && (
          <ClientBookingsPanel clientId={id} clientEmail={client.email} textos={TEXTOS_LAURA.sesiones} />
        )}

        {tab === "plan" && <ClientPlansPanel clientId={id} />}
        </div>
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
  usaEstado,
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
  puedeEliminar,
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
        usaEstado={usaEstado}
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
          programas está. Se lee de arriba abajo.

          La sección de bonos se mudó a `components/clients/ClientBonosSection`
          el 13/08/2026: era el único sitio del CRM donde se podía dar uno, y el
          motor (tabla, endpoint, descuento) siempre fue de todos. Aquí se ve
          igual; la diferencia es que ahora también sale en las demás fichas. */}
      <ClientBonosSection clientId={client.id} onCambio={onRecargar} />

      <ClientModulesSection clientId={client.id} />

      {/* Borrar va al FINAL de todo y no en medio de la columna: es lo último
          que se hace con una ficha, y tenerlo entre dos tarjetas invita a
          pulsarlo mientras se busca otra cosa.

          Y solo lo ve admin: el resto del equipo edita la ficha entera, pero
          esto no es editar (14/08/2026, ver lib/auth/permisos.js). No se
          enseña deshabilitado a propósito — un botón apagado es una pregunta
          que alguien tiene que ir a hacer; que no esté, no la genera. */}
      {puedeEliminar && (!confirmDelete ? (
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
      ))}
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

function PatientCard({
  client,
  usaEstado,
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
            {/* Los tres estados de la ficha donde los hay; el embudo comercial
                donde no. La lista sale de `lib/clients/estados.js` en los dos
                casos que la usan, para que su ficha y la base no se separen. */}
            <div className="flex flex-wrap gap-1.5">
              {(usaEstado ? estadosDeFicha() : STATUSES).map((s) => (
                <button
                  key={s.key}
                  title={s.ayuda}
                  onClick={() =>
                    setEditForm((f) => (usaEstado ? { ...f, estado: s.key } : { ...f, status: s.key }))
                  }
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                    (usaEstado ? editForm.estado : editForm.status) === s.key
                      ? `${(usaEstado ? s : STATUS_STYLE[s.key]).bg} border-transparent`
                      : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${(usaEstado ? s : STATUS_STYLE[s.key]).dot}`} />
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

