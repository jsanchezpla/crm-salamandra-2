"use client";

/**
 * ClientDetailModule (default) — ficha de cliente "vanilla" usada por todos
 * los tenants con módulo clients que NO tengan override por tenant. El
 * wrapper `app/(dashboard)/clientes/[id]/page.jsx` decide entre este
 * componente y el override según `x-tenant` del request.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ClientBillingSection from "../../components/billing/ClientBillingSection.jsx";
import ClientModulesSection from "../../components/clients/ClientModulesSection.jsx";
import ClientContactMethodsSection from "../../components/clients/ClientContactMethodsSection.jsx";
import ClientFiscalSection from "../../components/clients/ClientFiscalSection.jsx";
import { camposCliente, PERFIL_COMERCIAL } from "../../lib/clients/formularioAlta.js";
import ClientContractSection from "../../components/clients/ClientContractSection.jsx";
import ClientGuardiansSection from "../../components/clients/ClientGuardiansSection.jsx";
import ClientPortalMonthsSection from "../../components/clients/ClientPortalMonthsSection.jsx";
import ClientComunicacionesSection from "../../components/clients/ClientComunicacionesSection.jsx";
import ClientCitasSection from "../../components/clients/ClientCitasSection.jsx";
import ClientConsultaExternaSection from "../../components/clients/ClientConsultaExternaSection.jsx";
import ClientPatientsSection from "../../components/clients/ClientPatientsSection.jsx";

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

export default function ClientDetailModule({ perfil = PERFIL_COMERCIAL, conPacientes = false, conFacturacion = false }) {
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
    // Mismo aviso que en el listado: desde el 06/08/2026 el borrado se lleva
    // también los documentos y las citas que aún no han ocurrido.
    const aviso =
      "¿Eliminar este cliente y todas sus interacciones?\n\n" +
      "Se borrarán también sus documentos y las citas que todavía no han ocurrido. " +
      "Las citas pasadas se conservan como constancia del trabajo hecho.\n\n" +
      "No se puede deshacer.";
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

      {/* Body */}
      <div className="flex-1 overflow-auto px-4 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">

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
                    <button
                      onClick={handleDelete}
                      className="text-xs text-red-500 hover:text-red-700 border border-red-100 hover:border-red-200 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Eliminar
                    </button>
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
        </div>

        <ClientContactMethodsSection clientId={id} />

        {/* A nombre de quién se factura. Solo donde se factura: al resto le
            sobraría una tarjeta de datos fiscales que nadie va a usar. */}
        {conFacturacion && <ClientFiscalSection clientId={id} />}

        <ClientModulesSection clientId={id} />

        <ClientPatientsSection clientId={id} />

        {/* Los tutores son quienes firman; el contrato es de la familia, no del
            paciente (sprint 2026-07, puntos 1.2 y 1.1). */}
        <ClientGuardiansSection clientId={id} />

        <ClientContractSection clientId={id} />

        {/* Por dónde acepta la familia que se le escriba (01/08). */}
        <ClientComunicacionesSection clientId={id} />

        {/* Sus citas, ¿entran confirmadas o pasan por la bandeja? (06/08). */}
        <ClientConsultaExternaSection clientId={id} />
        <ClientCitasSection clientId={id} />

        {/* Solo se pinta si el centro tiene el bloqueo por impago encendido. */}
        <ClientPortalMonthsSection clientId={id} />

        <ClientBillingSection clientId={id} />
      </div>
    </div>
  );
}
