"use client";

/**
 * ClientDetailModule (default) — ficha de cliente "vanilla" usada por todos
 * los tenants con módulo clients que NO tengan override por tenant. El
 * wrapper `app/(dashboard)/clientes/[id]/page.jsx` decide entre este
 * componente y el override según `x-tenant` del request.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ClientBillingSection from "../../components/billing/ClientBillingSection.jsx";
import ClientModulesSection from "../../components/clients/ClientModulesSection.jsx";
import ClientContactMethodsSection from "../../components/clients/ClientContactMethodsSection.jsx";
import ClientFiscalSection from "../../components/clients/ClientFiscalSection.jsx";
import { camposCliente, PERFIL_COMERCIAL } from "../../lib/clients/formularioAlta.js";
import { avisoBorradoSegunModulos } from "../../lib/clients/avisoBorrado.js";
import { esAdmin } from "../../lib/auth/permisos.js";
import ClientContractSection from "../../components/clients/ClientContractSection.jsx";
import ClientGuardiansSection from "../../components/clients/ClientGuardiansSection.jsx";
import ClientPortalMonthsSection from "../../components/clients/ClientPortalMonthsSection.jsx";
import ClientComunicacionesSection from "../../components/clients/ClientComunicacionesSection.jsx";
import ClientCitasSection from "../../components/clients/ClientCitasSection.jsx";
import ClientWhatsappSection from "../../components/clients/ClientWhatsappSection.jsx";
import ClientBonosSection from "../../components/clients/ClientBonosSection.jsx";
import ClientConsultaExternaSection from "../../components/clients/ClientConsultaExternaSection.jsx";
import ClientProfesionalSection from "../../components/clients/ClientProfesionalSection.jsx";
import ClientPatientsSection from "../../components/clients/ClientPatientsSection.jsx";
import ClientCuentaWebSection from "../../components/clients/ClientCuentaWebSection.jsx";
import ClientNotesPanel from "../../components/clients/ClientNotesPanel.jsx";
import ClientAttachmentsPanel from "../../components/clients/ClientAttachmentsPanel.jsx";
import ClientBookingsPanel from "../../components/clients/ClientBookingsPanel.jsx";
import ClientPlansPanel from "../nutricion/ClientPlansPanel.jsx";
import { PIEZAS_NINGUNA, textosPiezas } from "../../lib/clients/piezasFicha.js";

/**
 * ── LA FICHA VA POR PESTAÑAS (12/08/2026, Rodrigo) ─────────────────────────
 *
 * Eran CATORCE tarjetas apiladas en una sola columna. En un cliente con todos
 * los módulos —Aumenta— la ficha medía varias pantallas y para llegar a la
 * facturación había que pasar por delante del contrato, los tutores, los
 * consentimientos y las citas. Y lo pidió así: «demasiado larga, pero universal,
 * para que el que tenga todos los módulos no se líe».
 *
 * El reparto agrupa por PREGUNTA, no por módulo:
 *   · Datos          — quién es y cómo se le escribe.
 *   · Interacciones  — el diario de lo que se ha hablado con esta persona.
 *   · Servicio       — qué se le presta y quién se lo presta.
 *   · Contrato y avisos — lo que ha firmado y lo que ha consentido.
 *   · Citas          — su agenda.
 *   · Facturación    — su dinero.
 *
 * El patrón (pestañas + `TabButton`) es el que ya usaba la ficha de nutri_laura;
 * aquí no se inventa nada, se generaliza.
 *
 * ⚠️ UNA PESTAÑA VACÍA CONFUNDE MÁS QUE UNA LARGA. Casi todas estas secciones
 * se esconden solas cuando el tenant no tiene su módulo (`return null`), así que
 * un cliente de solo Citas tendría cuatro pestañas que no enseñan nada. Por eso
 * cada panel se mide a sí mismo y la pestaña desaparece si dentro no queda nada
 * (ver `PanelPestana`).
 *
 * ── LAS TRES PIEZAS QUE VINIERON DE LA FICHA DE LAURA (18/08/2026) ─────────
 * «Notas» (o «Historia clínica»), «Documentos» y la lista de citas con
 * Confirmar/Rechazar dentro de «Citas». Vivían en
 * `modules/overrides/nutri-laura/` sobre tablas y endpoints que tiene todo el
 * mundo; ahora están en `components/clients/` y las monta esta ficha PARA
 * QUIEN DIGA `lib/clients/piezasFicha.js` (por módulos: en un centro clínico
 * o con archivo avanzado ya existen por otro lado, y Aumenta no cambia). Las
 * decide la PÁGINA y llegan por `piezas`; sus palabras («el cliente» / «el
 * paciente») por `textos`. Sin la pieza no se monta nada, y la pestaña se
 * esconde sola como las demás.
 */
function pestanasDe(textos) {
  return [
    { key: "datos", label: "Datos" },
    // Las PERSONAS de esta ficha (24/08/2026). Va justo detrás de Datos porque
    // es lo que se mira antes de escribir: en un ayuntamiento no se escribe «al
    // ayuntamiento», se escribe al concejal de Cultura. Se esconde sola si no
    // hay ninguna, así que a un centro que no las use no le aparece.
    { key: "personas", label: "Personas" },
    { key: "interacciones", label: "Interacciones" },
    // El hilo de WhatsApp, pegado a Interacciones por el mismo criterio que
    // ordena a las dos de al lado: esto es lo que se ha hablado CON esta
    // persona, solo que por otro canal; Notas es el diario SOBRE ella. Se
    // esconde sola si no hay ningún mensaje, así que en un centro que no ha
    // conectado WhatsApp la pestaña no existe — y no hace falta gatearla por
    // módulo, que WhatsApp es una integración universal (regla #14).
    { key: "whatsapp", label: "WhatsApp" },
    // Notas / Historia clínica: el diario de esta persona. Detrás de
    // Interacciones, que es el diario de lo que se ha hablado CON ella.
    { key: "notas", label: textos.notas.pestana },
    { key: "servicio", label: "Servicio" },
    { key: "contrato", label: "Contrato y avisos" },
    // Sus ficheros, después del papeleo firmado y antes de la agenda.
    { key: "documentos", label: textos.documentos.pestana },
    { key: "citas", label: "Citas" },
    // "Pautas" — el menú que sigue esta persona (13/08/2026). Vivía SOLO en la
    // ficha de nutri_laura, así que cualquier otro centro con Nutrición tenía las
    // cuatro pantallas de /nutricion y ningún sitio desde donde asignar un menú a
    // alguien: se veía en la demo, que lleva `nutricion` activo y no tenía esta
    // pestaña. Va después de Citas y antes del dinero, junto al resto de lo que
    // se le presta al paciente.
    { key: "pautas", label: "Pautas" },
    { key: "facturacion", label: "Facturación" },
  ];
}

const STATUSES = [
  { key: "new", label: "Nuevo" },
  { key: "contacted", label: "Contactado" },
  { key: "following", label: "En seguimiento" },
  { key: "converted", label: "Convertido" },
  { key: "discarded", label: "Descartado" },
];

const STATUS_STYLE = {
  new: { dot: "bg-gray-400", bg: "bg-gray-100 text-gray-600" },
  contacted: { dot: "bg-blue-400", bg: "bg-blue-100 text-blue-700" },
  following: { dot: "bg-amber-400", bg: "bg-amber-100 text-amber-700" },
  converted: { dot: "bg-emerald-400", bg: "bg-emerald-100 text-emerald-700" },
  discarded: { dot: "bg-red-400", bg: "bg-red-100 text-red-600" },
};

const INTERACTION_TYPES = [
  { key: "note", label: "Nota" },
  { key: "call", label: "Llamada" },
  { key: "email", label: "Email" },
  { key: "meeting", label: "Reunión" },
];

const TYPE_STYLE = {
  note: "bg-gray-100 text-gray-600",
  call: "bg-blue-100 text-blue-700",
  email: "bg-purple-100 text-purple-700",
  meeting: "bg-emerald-100 text-emerald-700",
};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Fecha de nacimiento, que llega como "2019-04-07" (DATEONLY) y NO como un
 * instante: se parte a mano en vez de dejársela a `new Date`, que la
 * interpretaría en UTC y en España la enseñaría un día antes.
 */
function fmtFechaCorta(valor) {
  const s = String(valor ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [a, m, d] = s.split("-");
  return `${d}/${m}/${a}`;
}

/**
 * Un campo del formulario de la ficha, del tipo que declare `camposCliente`.
 * Gemelo de `CampoAlta` en la pantalla de Clientes: la ficha edita exactamente
 * lo que se pregunta en el mostrador, así que tiene que saber pintar lo mismo.
 */
function CampoFicha({ tipo, valor, opciones, placeholder, onChange }) {
  const cls =
    "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]";

  if (tipo === "textarea") {
    return (
      <textarea
        rows={3}
        value={valor}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${cls} resize-none`}
      />
    );
  }

  if (tipo === "select") {
    return (
      <select value={valor} onChange={(e) => onChange(e.target.value)} className={cls}>
        {(opciones ?? []).map((o) => (
          <option key={o.valor} value={o.valor}>{o.label}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={tipo}
      value={valor}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cls}
    />
  );
}

/** Cómo se lee el parentesco del titular, que se guarda como clave corta. */
const PARENTESCO_LABEL = {
  madre: "Madre",
  padre: "Padre",
  tutor: "Tutor/a legal",
  otro: "Otro familiar",
};

/** "1 de agosto de 2026" — la fecha se lee, no se descifra. */
function fechaLarga(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

export default function ClientDetailModule({
  perfil = PERFIL_COMERCIAL,
  conPacientes = false,
  conFacturacion = false,
  conNutricion = false,
  // Qué paneles de consulta se montan (`lib/clients/piezasFicha.js`) y con qué
  // palabras. Sin ellos —la página no pudo decidir— no se monta ninguno.
  piezas = PIEZAS_NINGUNA,
  textos: textosProp,
}) {
  const textos = textosProp ?? textosPiezas();
  const TABS = pestanasDe(textos);
  const { id } = useParams();
  const router = useRouter();
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [interactions, setInteractions] = useState([]);
  const [newInteraction, setNewInteraction] = useState({
    type: "note",
    content: "",
    date: new Date().toISOString().slice(0, 10),
  });
  const [addingInteraction, setAddingInteraction] = useState(false);
  /**
   * Los módulos que este usuario ve (el centro ∩ su acceso), solo para saber DE
   * QUÉ avisa el borrado. `null` = todavía no se sabe, y entonces se avisa de
   * todo: ver `lib/clients/avisoBorrado.js`.
   */
  const [modulos, setModulos] = useState(null);
  /*
   * El rol, solo para decidir si sale el botón de Eliminar (14/08/2026,
   * Rodrigo; la regla, en `lib/auth/permisos.js`). Todo lo demás de la ficha lo
   * hace cualquiera del equipo que tenga el módulo — esto no es «la ficha es de
   * admin», es «destruirla sí».
   *
   * Arranca en `null` y `esAdmin(null)` es false: mientras no se sepa, no se
   * enseña. Recargar es más barato que deshacer un borrado, que no se deshace.
   */
  const [rol, setRol] = useState(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!vivo) return;
        if (Array.isArray(j?.data?.enabledModules)) setModulos(j.data.enabledModules);
        if (j?.data?.role) setRol(j.data.role);
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);
  const [tab, setTab] = useState("datos");

  // Qué pestañas se han quedado sin contenido. `undefined` = todavía no se sabe,
  // y mientras tanto se enseñan todas: esconderlas de entrada y devolverlas al
  // cargar las secciones sería un parpadeo en el menú.
  const [vacias, setVacias] = useState({});
  const marcarPanel = useCallback((clave, vacio) => {
    setVacias((prev) => (prev[clave] === vacio ? prev : { ...prev, [clave]: vacio }));
  }, []);
  const pestanasVisibles = TABS.filter((t) => !vacias[t.key]);

  // Si la abierta se queda sin contenido, se salta a la primera que tenga. No
  // puede pasar hoy —«Datos» siempre pinta algo— pero deja la pantalla a salvo
  // de que mañana una sección nueva se esconda sola.
  useEffect(() => {
    if (vacias[tab]) setTab(pestanasVisibles[0]?.key ?? "datos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vacias, tab]);

  useEffect(() => {
    fetch(`/api/clients/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setClient(data.data);
          setInteractions(data.data.interactions || []);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  function openEdit() {
    // email/phone NO se editan aquí: los gestiona la sección "Contactos"
    // (client_contact_methods). Incluirlos aquí reenviaría un valor obsoleto en
    // el PUT y pisaría el contacto principal.
    // ⚠️ Lo que NO se siembra aquí sale vacío al abrir «Editar» y se guarda
    // vacío al pulsar «Guardar»: el DNI, la fecha de nacimiento y el domicilio
    // llevaban desde el 04/08 en el formulario del mostrador y no en este, así
    // que editar una ficha para corregir la ciudad podía borrar el DNI que
    // recepción acababa de teclear.
    setEditForm({
      name: client.name || "",
      taxId: client.taxId || "",
      birthDate: client.birthDate ? String(client.birthDate).slice(0, 10) : "",
      domicilio: client.customFields?.domicilio || "",
      postalCode: client.customFields?.postalCode || "",
      notes: client.notes || "",
      status: client.customFields?.seStatus || "new",
      company: client.customFields?.company || "",
      country: client.customFields?.country || "",
      city: client.customFields?.city || "",
      motivo: client.customFields?.motivo || "",
      parentescoTitular: client.customFields?.parentescoTitular || "",
    });
    setEditMode(true);
  }

  async function saveEdit() {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (data.ok) {
        setClient(data.data);
        setEditMode(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function addInteraction() {
    if (!newInteraction.content.trim() || !newInteraction.date) return;
    setAddingInteraction(true);
    try {
      const res = await fetch(`/api/clients/${id}/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newInteraction),
      });
      const data = await res.json();
      if (data.ok) {
        setInteractions((prev) => [data.data, ...prev]);
        setNewInteraction({ type: "note", content: "", date: new Date().toISOString().slice(0, 10) });
      }
    } finally {
      setAddingInteraction(false);
    }
  }

  async function handleDelete() {
    // Mismo aviso que en el listado, y desde el mismo sitio: el borrado se lleva
    // también los documentos y las citas que aún no han ocurrido — pero solo se
    // promete de lo que este centro tiene contratado (12/08/2026). A retorika y
    // a spain_enzymes, que no tienen agenda, esa frase no les mentía: les
    // hablaba de cancelar citas que no existen.
    const aviso = avisoBorradoSegunModulos(modulos, { esteCliente: true });
    if (!confirm(aviso)) return;
    await fetch(`/api/clients/${id}`, { method: "DELETE" });
    router.push("/clientes");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-gray-500">Cliente no encontrado</p>
        <Link href="/clientes" className="text-[var(--color-primary)] hover:underline text-sm">
          ← Volver a clientes
        </Link>
      </div>
    );
  }

  // La ficha edita lo mismo que se pregunta en el mostrador, menos email y
  // teléfono: esos los gestiona la sección "Contactos", que admite varios.
  const CAMPOS_FICHA = camposCliente(perfil, { conPacientes }).filter((c) => c.key !== "email" && c.key !== "phone");

  const status = client.customFields?.seStatus || "new";
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.new;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="px-4 lg:px-8 pt-6 pb-4 border-b border-gray-100 bg-white">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-1">
          <Link href="/clientes" className="text-gray-400 hover:text-gray-600 transition-colors shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <h1 className="text-gray-900 text-lg font-semibold min-w-0 [overflow-wrap:anywhere]">{client.name}</h1>
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${st.bg}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
            {STATUSES.find((s) => s.key === status)?.label ?? status}
          </span>
          {/* Lista de espera de ADMISIÓN: lo primero que se pregunta al abrir
              la ficha de una familia que aún no tiene plaza. */}
          {client.listaEspera && (
            <Link
              href="/clientes/lista-espera"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors"
              title="Ver la lista de espera"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              En lista de espera desde el {fechaLarga(client.listaEspera.desde)}
              {client.listaEspera.posicion != null && ` · nº ${client.listaEspera.posicion}`}
            </Link>
          )}
        </div>
        {client.customFields?.company && (
          <p className="text-sm text-gray-500 ml-7">{client.customFields.company}</p>
        )}
      </div>

      {/* Pestañas */}
      <div className="border-b border-gray-100 bg-white shrink-0">
        <div className="px-4 lg:px-8 flex items-center gap-1 overflow-x-auto whitespace-nowrap">
          {pestanasVisibles.map((t) => (
            <TabButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </TabButton>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-4 lg:px-8 py-6">
        <PanelPestana clave="datos" activo={tab === "datos"} onEstado={marcarPanel}>

          {/* Datos del cliente */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <span className="text-[13px] font-semibold text-gray-700">Datos del cliente</span>
              {/* Botones en su propia fila, debajo del título (evita que el
                  título se parta en móvil al competir por el ancho). */}
              <div className="flex items-center gap-2 mt-2.5">
                {editMode ? (
                  <>
                    <button
                      onClick={saveEdit}
                      disabled={saving}
                      className="bg-[var(--color-primary)] hover:opacity-90 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-50"
                    >
                      {saving ? "Guardando…" : "Guardar"}
                    </button>
                    <button
                      onClick={() => setEditMode(false)}
                      className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={openEdit}
                      className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                      </svg>
                      Editar
                    </button>
                    {/* Solo admin (14/08/2026, ver lib/auth/permisos.js). No
                        sale deshabilitado a propósito: un botón apagado es una
                        pregunta que alguien tiene que ir a hacer. */}
                    {esAdmin(rol) && (
                      <button
                        onClick={handleDelete}
                        className="text-xs text-red-500 hover:text-red-700 border border-red-100 hover:border-red-200 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Eliminar
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {editMode ? (
              <div className="p-5 space-y-4">
                {/* El tipo de cada campo lo declara `camposCliente`, y desde el
                    08/08/2026 los hay que no son `<input>`: el motivo de
                    consulta es un párrafo y el parentesco un desplegable. Con
                    un `<input type={type}>` a secas, `textarea` sale como una
                    caja de UNA línea y `select` como un desplegable vacío. */}
                {CAMPOS_FICHA.map(({ label, key, type, opciones, placeholder }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                    <CampoFicha
                      tipo={type}
                      valor={editForm[key] || ""}
                      opciones={opciones}
                      placeholder={placeholder}
                      onChange={(v) => setEditForm((f) => ({ ...f, [key]: v }))}
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Notas</label>
                  <textarea
                    rows={3}
                    value={editForm.notes || ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none"
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
              <div className="p-5 space-y-4">
                {/* Móvil (<sm): una sola columna → email y teléfono en filas
                    separadas, imposible que se solapen. sm+: dos columnas.
                    min-w-0 permite que la celda del grid encoja por debajo del
                    ancho de su contenido; overflow-wrap:anywhere fuerza el corte
                    de un email/valor largo sin espacios DENTRO de su columna (y,
                    a diferencia de break-words, reduce el min-content del grid,
                    que era la causa real del desbordamiento). */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  {/* Email/Teléfono ya no se muestran aquí: los presenta la
                      sección "Contactos" (múltiples, con principal). */}
                  {/* ⚠️ Todo lo que se pregunta en el mostrador tiene que salir
                      aquí. El DNI, la fecha de nacimiento y el domicilio se
                      pedían desde el 04/08 y no se pintaban en ninguna parte:
                      recepción los tecleaba y luego no había forma de leerlos
                      sin abrir «Editar». Las filas se filtran por `!!value`,
                      así que a quien no tenga el dato no le aparece nada. */}
                  {[
                    { label: "DNI / NIE", value: client.taxId },
                    { label: "Fecha de nacimiento", value: fmtFechaCorta(client.birthDate) },
                    { label: "Parentesco con el paciente", value: PARENTESCO_LABEL[client.customFields?.parentescoTitular] },
                    { label: "Domicilio", value: client.customFields?.domicilio },
                    { label: "Código postal", value: client.customFields?.postalCode },
                    { label: "Ciudad", value: client.customFields?.city },
                    { label: "País", value: client.customFields?.country },
                    { label: "Empresa", value: client.customFields?.company },
                    { label: "Origen", value: client.customFields?.origin },
                  ]
                    .filter(({ value }) => !!value)
                    .map(({ label, value, href }) => (
                      <div key={label} className="min-w-0">
                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</div>
                        {href ? (
                          <a
                            href={href}
                            className="text-[13px] text-[var(--color-primary)] hover:underline mt-0.5 block [overflow-wrap:anywhere]"
                          >
                            {value}
                          </a>
                        ) : (
                          <div className="text-[13px] text-gray-700 mt-0.5 [overflow-wrap:anywhere]">{value}</div>
                        )}
                      </div>
                    ))}
                </div>
                {/*
                  El motivo de consulta y lo que escribió la familia en el
                  formulario de la web se guardaban desde siempre y no se
                  pintaban en ninguna parte: una solicitud aceptada creaba una
                  ficha en la que no se leía nada de lo que esa persona había
                  contado. `whitespace-pre-wrap` no es opcional aquí:
                  `info_adicional` viene como «Pregunta:\nRespuesta» y sin él
                  sale todo en un churro.
                */}
                {client.customFields?.motivo && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                      Motivo de consulta
                    </div>
                    <div className="text-[13px] text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {client.customFields.motivo}
                    </div>
                  </div>
                )}
                {client.customFields?.info_adicional && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                      Lo que nos contó
                    </div>
                    <div className="text-[13px] text-gray-600 whitespace-pre-wrap leading-relaxed">
                      {client.customFields.info_adicional}
                    </div>
                  </div>
                )}
                {client.notes && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Notas</div>
                    <div className="text-[13px] text-gray-600 whitespace-pre-wrap leading-relaxed">{client.notes}</div>
                  </div>
                )}
                <div className="pt-2 border-t border-gray-50">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Alta</div>
                  <div className="text-[13px] text-gray-600 mt-0.5">{formatDate(client.createdAt)}</div>
                </div>
              </div>
            )}
          </div>

          {/* `conPortal` sale de la misma pieza que el contrato: el área privada
              es de Citas, y sin ella el subtítulo prometía un portal que no
              existe. */}
          <ClientContactMethodsSection clientId={id} conPortal={piezas.contratoPortal} />

          {/* A nombre de quién se factura. Solo donde se factura: al resto le
              sobraría una tarjeta de datos fiscales que nadie va a usar. */}
          {conFacturacion && <ClientFiscalSection clientId={id} />}

          {/* Abrirle la cuenta de la web, si el centro tiene web (12/08/2026). */}
          <ClientCuentaWebSection clientId={id} />
        </PanelPestana>

        <PanelPestana clave="personas" activo={tab === "personas"} onEstado={marcarPanel}>
          <ClientPersonasSection clientId={id} />
        </PanelPestana>

        <PanelPestana clave="interacciones" activo={tab === "interacciones"} onEstado={marcarPanel}>
          {/* Historial de interacciones */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col" style={{ minHeight: "400px" }}>
            <div className="px-5 py-4 border-b border-gray-100 shrink-0">
              <span className="text-[13px] font-semibold text-gray-700">
                Historial de interacciones
                {interactions.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-400">({interactions.length})</span>
                )}
              </span>
            </div>

            {/* Añadir interacción */}
            <div className="p-4 border-b border-gray-100 bg-gray-50/50 shrink-0">
              {/* flex-wrap: sin él, los 4 tipos desbordaban en móvil y metían
                  scroll horizontal en toda la página. */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {INTERACTION_TYPES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setNewInteraction((f) => ({ ...f, type: t.key }))}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      newInteraction.type === t.key
                        ? `${TYPE_STYLE[t.key]} border-transparent`
                        : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <input
                type="date"
                value={newInteraction.date}
                onChange={(e) => setNewInteraction((f) => ({ ...f, date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mb-2 focus:outline-none focus:border-[var(--color-primary)]"
              />
              <textarea
                rows={2}
                placeholder="Escribe una nota, resultado de llamada, reunión…"
                value={newInteraction.content}
                onChange={(e) => setNewInteraction((f) => ({ ...f, content: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--color-primary)]"
              />
              <button
                onClick={addInteraction}
                disabled={!newInteraction.content.trim() || addingInteraction}
                className="mt-2 w-full bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium py-2 rounded-lg transition-opacity disabled:opacity-40"
              >
                {addingInteraction ? "Guardando…" : "Registrar interacción"}
              </button>
            </div>

            {/* Lista de interacciones */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {interactions.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm">Sin interacciones registradas</div>
              ) : (
                interactions.map((interaction) => (
                  <div key={interaction.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          TYPE_STYLE[interaction.type] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {INTERACTION_TYPES.find((t) => t.key === interaction.type)?.label ?? interaction.type}
                      </span>
                      <span className="text-xs text-gray-400">{formatDate(interaction.date)}</span>
                      {interaction.createdBy && (
                        <span className="text-xs text-gray-400 [overflow-wrap:anywhere]">· {interaction.createdBy}</span>
                      )}
                    </div>
                    <div className="text-[13px] text-gray-700 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">
                      {interaction.content}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </PanelPestana>

        {/* Sin un solo mensaje, la sección devuelve null y esta pestaña
            desaparece del menú sola. No lleva `piezas`: no es una pieza que la
            página decida, es una integración que cualquier cliente puede
            conectar mañana (regla #14). */}
        <PanelPestana clave="whatsapp" activo={tab === "whatsapp"} onEstado={marcarPanel}>
          <ClientWhatsappSection clientId={id} />
        </PanelPestana>

        {/* Notas / Historia clínica (`client_notes`). Solo si la página lo
            decidió: sin la pieza, el panel queda vacío y la pestaña se va. */}
        <PanelPestana clave="notas" activo={tab === "notas"} onEstado={marcarPanel}>
          {piezas.notas && <ClientNotesPanel clientId={id} textos={textos.notas} />}
        </PanelPestana>

        <PanelPestana clave="servicio" activo={tab === "servicio"} onEstado={marcarPanel}>
          <ClientModulesSection clientId={id} />

          <ClientPatientsSection clientId={id} />

          {/* Consulta externa: viene por un acuerdo con una empresa y su
              HISTORIA CLÍNICA se guarda aquí. Solo donde hay clínica: hasta el
              25/08/2026 salía en TODAS las fichas, así que una radio en el CRM
              de una cantante leía «su historia clínica». */}
          {piezas.consultaExterna && <ClientConsultaExternaSection clientId={id} />}
          {/* Con quién lleva el seguimiento (10/08/2026, Rodrigo). Debajo de
              consulta externa: en una externa, quién la lleva es además quién la
              ve, y las dos cosas se leen juntas. */}
          <ClientProfesionalSection clientId={id} />
        </PanelPestana>

        <PanelPestana clave="contrato" activo={tab === "contrato"} onEstado={marcarPanel}>
          {/* Los tutores son quienes firman; el contrato es de la familia, no del
              paciente (sprint 2026-07, puntos 1.2 y 1.1). Sin `pacientes` no hay
              menores a los que representar. */}
          {piezas.tutores && <ClientGuardiansSection clientId={id} />}

          {/* El Contrato de Prestación de Servicios se firma en el ÁREA PRIVADA,
              y el área privada es de Citas. Sin portal, «Firmas en el portal:
              0 de 1» no significa nada. */}
          {piezas.contratoPortal && <ClientContractSection clientId={id} />}

          {/* Por dónde acepta la familia que se le avise DE SUS CITAS (01/08).
              Sin Citas no hay avisos que preferir. */}
          {piezas.avisosCitas && <ClientComunicacionesSection clientId={id} />}

          {/* Solo se pinta si el centro tiene el bloqueo por impago encendido. */}
          <ClientPortalMonthsSection clientId={id} />
        </PanelPestana>

        {/* Documentos de esta persona (`client_attachments`), con «que lo vea
            en su portal» y las firmas documento a documento. */}
        <PanelPestana clave="documentos" activo={tab === "documentos"} onEstado={marcarPanel}>
          {piezas.documentos && <ClientAttachmentsPanel clientId={id} textos={textos.documentos} />}
        </PanelPestana>

        <PanelPestana clave="citas" activo={tab === "citas"} onEstado={marcarPanel}>
          <ClientCitasSection clientId={id} />

          {/* Bonos de sesiones (13/08/2026, Rodrigo: «todo el mundo tiene
              bonos, solo tienen que ponerlos»). La sección vivía solo en la
              ficha de nutri_laura, así que el resto de centros con Citas tenían
              el motor entero —tabla, endpoint, descuento— y ningún sitio donde
              dar uno. Se pinta sola solo si el centro tiene Citas. */}
          <ClientBonosSection clientId={id} />

          {/* Y sus citas, con Confirmar/Rechazar desde aquí (18/08/2026, la
              tercera pieza de la ficha de Laura). Debajo del interruptor y de
              los bonos: primero cómo entran, luego cuáles hay. */}
          {piezas.sesiones && (
            <ClientBookingsPanel clientId={id} clientEmail={client.email} textos={textos.sesiones} />
          )}
        </PanelPestana>

        {/* Sin el módulo no se pinta NADA aquí dentro, y entonces `PanelPestana`
            se declara vacío y la pestaña desaparece sola del menú. Por eso el
            gate va aquí y no dentro del panel: `ClientPlansPanel` siempre pinta
            algo (cargando, vacío o el error del 403), así que nunca se
            declararía vacío por sí mismo. */}
        <PanelPestana clave="pautas" activo={tab === "pautas"} onEstado={marcarPanel}>
          {conNutricion && <ClientPlansPanel clientId={id} />}
        </PanelPestana>

        <PanelPestana clave="facturacion" activo={tab === "facturacion"} onEstado={marcarPanel}>
          <ClientBillingSection clientId={id} />
        </PanelPestana>
      </div>
    </div>
  );
}

// ── Pestañas ────────────────────────────────────────────────────────────────

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

/** Cuánto se espera antes de dar una pestaña por vacía (ms). */
const MARGEN_CARGA = 900;

/**
 * PanelPestana — el contenido de una pestaña, que además se mide a sí mismo.
 *
 * POR QUÉ SE MIDE. Las secciones de la ficha deciden solas si se pintan: sin el
 * módulo del tenant, sin permiso o sin datos, cada una devuelve `null`. El padre
 * no puede saberlo sin preguntárselo a los mismos endpoints otra vez, así que se
 * mira el resultado: un panel SIN NINGÚN HIJO en el DOM es una pestaña que no
 * tiene nada que enseñar, y esa pestaña no debe salir en el menú.
 *
 * TODAS LAS PESTAÑAS SE MONTAN, aunque solo una se vea (`hidden` = display:none,
 * no desmonta). Es a propósito y no cuesta nada: es exactamente lo que hacía la
 * ficha antes de tener pestañas —las catorce secciones montadas a la vez—, así
 * que ni hay peticiones de más ni se recarga nada al cambiar de pestaña, que es
 * lo que haría que perder lo que estás escribiendo fuera posible.
 *
 * El margen de `MARGEN_CARGA` evita el parpadeo: las secciones tardan lo que
 * tarde su fetch en aparecer, y sin él el menú saldría con todas las pestañas,
 * se quedaría en una, y volverían de una en una. Un panel que se llena ANTES
 * (mutación del DOM) se declara lleno al instante, sin esperar.
 */
/**
 * Las PERSONAS de una ficha: quién es quién dentro de esa organización.
 *
 * Nace el 24/08/2026 con los contratantes de Laura Úbeda. En un ayuntamiento no
 * se escribe «al ayuntamiento»: se escribe al concejal de Cultura, y el técnico
 * de sonido de una sala no es la misma persona que quien firma el contrato.
 *
 * Si no hay ninguna NO PINTA NADA, y entonces `PanelPestana` esconde la pestaña
 * sola —cuenta hijos del DOM— así que a un centro que no las use no le aparece.
 */
function ClientPersonasSection({ clientId }) {
  const [personas, setPersonas] = useState(null);
  const [abriendo, setAbriendo] = useState(false);
  const [form, setForm] = useState({ name: "", role: "", email: "", phone: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/contactos`, { cache: "no-store" });
      const json = await res.json();
      setPersonas(res.ok ? (json?.data?.contactos ?? []) : []);
    } catch {
      setPersonas([]);
    }
  }, [clientId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const crear = async () => {
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/contactos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "No se ha podido guardar");
      setForm({ name: "", role: "", email: "", phone: "" });
      setAbriendo(false);
      await cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  };

  // Todavía cargando, o vacío y sin el formulario abierto: nada que pintar.
  if (personas === null) return null;
  if (!personas.length && !abriendo) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <p className="text-sm text-gray-500 mb-3">
          Nadie con nombre y cargo en esta ficha todavía.
        </p>
        <button
          type="button"
          onClick={() => setAbriendo(true)}
          className="text-sm font-medium underline text-gray-700 hover:text-gray-900"
        >
          Añadir una persona
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-gray-700">
          Personas y buzones
          <span className="ml-2 text-xs font-normal text-gray-400">({personas.length})</span>
        </span>
        <button
          type="button"
          onClick={() => setAbriendo((v) => !v)}
          className="text-xs underline text-gray-500 hover:text-gray-800"
        >
          {abriendo ? "Cancelar" : "Añadir"}
        </button>
      </div>

      {abriendo && (
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              placeholder="Nombre y apellidos"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <input
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              placeholder="Cargo (Concejal de Cultura, técnico…)"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            />
            <input
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              placeholder="Correo"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <input
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              placeholder="Teléfono"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="button"
            onClick={crear}
            disabled={guardando || !form.name.trim()}
            className="px-3 py-1.5 rounded-lg text-white text-sm font-medium disabled:opacity-40"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      )}

      <ul className="divide-y divide-gray-100">
        {personas.map((p) => (
          <li key={p.id} className="px-5 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">
                {p.name}
                {p.role && <span className="ml-2 text-xs font-normal text-gray-500">{p.role}</span>}
              </div>
              <div className="text-xs text-gray-400 truncate">
                {[p.email, p.phone].filter(Boolean).join(" · ") || "sin datos de contacto"}
              </div>
            </div>
            {p.email && (
              <a
                href={`/correo?destinatario=${encodeURIComponent(p.email)}`}
                className="text-xs underline text-gray-500 hover:text-gray-800 shrink-0"
              >
                Escribirle
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PanelPestana({ clave, activo, onEstado, children }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const mirar = () => onEstado(clave, el.childElementCount === 0);

    // Cualquier sección que aparezca (o desaparezca) lo dice al momento.
    const observador = new MutationObserver(mirar);
    observador.observe(el, { childList: true });
    // Y el veredicto para las que nunca llegan, pasado el margen.
    const reloj = setTimeout(mirar, MARGEN_CARGA);

    return () => {
      observador.disconnect();
      clearTimeout(reloj);
    };
  }, [clave, onEstado]);

  /*
   * ── EL ANCHO DE LA FICHA SE DECIDE AQUÍ, Y EN NINGÚN OTRO SITIO ───────────
   * (24/08/2026). Antes lo decidía cada tarjeta con su `max-w-` escrito a mano
   * —VEINTIUNA, entre 768 y 1.024— y el resultado era que la ficha cambiaba de
   * ancho según la pestaña que pulsaras: medido en un monitor de 1.920, seis
   * pestañas a 1.024, Documentos y Pautas a 768, y Facturación a 1.636.
   *
   * `max-w-5xl` son 1.024 px, que es el ancho que quince de esas veintiuna ya
   * llevaban: o sea, lo que el CRM ya había decidido sin decirlo. Para Aumenta
   * —1.083 fichas, la pantalla que más abre— esto solo encoge Facturación; sus
   * otras seis pestañas no se mueven un píxel.
   *
   * ⚠️ SIN `mx-auto`, Y ES A PROPÓSITO. El nombre del cliente y la barra de
   * pestañas viven FUERA de este cuerpo (líneas 399 y 431), a lo ancho de la
   * pantalla y empezando en x=252. Centrar solo lo de aquí dentro dejaría las
   * tarjetas 306 px a la derecha del nombre del cliente, que se lee como roto.
   * Si algún día se quiere centrar, hay que darle el mismo contenedor a la
   * cabecera y a las pestañas EN EL MISMO COMMIT.
   *
   * ⚠️ Y las clases van en ESTE div, no en uno nuevo por dentro: el escondido
   * automático de las pestañas vacías mira `el.childElementCount` sobre este
   * mismo nodo (unas líneas más arriba), así que envolver a los hijos dejaría
   * el contador en 1 para siempre y no volvería a esconderse ninguna.
   */
  return (
    <div ref={ref} className={activo ? "max-w-5xl" : "hidden"}>
      {children}
    </div>
  );
}
