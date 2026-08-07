"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import PanelVacaciones from "../../../../components/citas/PanelVacaciones.jsx";
import { eurosToCents, centsToEuros, formatMoney } from "../../../../lib/payments/money.js";
import {
  TIPOS as TIPOS_PREGUNTA,
  ETIQUETA_TIPO,
  ESCALA_POR_DEFECTO,
  MAX_PREGUNTAS,
} from "../../../../lib/citas/preguntasCita.js";

const MODALITY_LABELS = { presencial: "Presencial", phone: "Teléfono", online: "Online" };
const ALL_MODALITIES = ["presencial", "phone", "online"];

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const EMPTY_FORM = {
  name: "",
  slug: "",
  description: "",
  duration: 60,
  bufferBefore: 0,
  bufferAfter: 0,
  color: "#3F6E5B",
  modalities: ["online"],
  location: "",
  phoneNumber: "",
  meetUrl: "",
  additionalDataLabel: "",
  additionalDataRequired: false,
  minNoticeHours: 3,
  maxAdvanceDays: 60,
  // En EUROS mientras se edita; se convierte a céntimos al guardar. Vacío = gratis.
  price: "",
  // Bono de sesiones y pago a plazos (04/08/2026). 1 sesión = cita suelta.
  sessionsCount: 1,
  instalmentPrice: "",
  instalmentMonths: "",
  // Preguntas que se contestan al reservar. [] = no pregunta nada.
  formQuestions: [],
  // La primera visita: se entra sin firmar contratos. Solo una por cliente.
  isInitialAssessment: false,
  // Fuera de la agenda pública: solo lo ve quien tenga bono activo de este tipo.
  isHidden: false,
  active: true,
  order: 0,
};

function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/**
 * ConstructorPreguntas — las preguntas que se contestan al reservar esta cita.
 *
 * Cuatro clases y no más (`lib/citas/preguntasCita.js`): número, escala de
 * círculos, texto corto y texto largo. Cada clase que se añade hay que
 * pintarla en el widget, validarla en el servidor y enseñarla en la ficha.
 */
/**
 * CopiarEnlace — el enlace para mandar SOLO esta cita (04/08/2026, Rodrigo).
 *
 * Va por el slug del tipo de cita y no por su id: esto se manda por WhatsApp y
 * a veces se dicta, y un UUID de 36 caracteres no se puede ni leer en voz alta
 * ni comprobar de un vistazo.
 *
 * ── APUNTA A LA WEB DEL CENTRO, NO AL CRM (06/08/2026, Rodrigo) ────────────
 * Daba la dirección del CRM, y ese enlace abierto desde un WhatsApp cae FUERA
 * de la web del centro: allí no hay sesión de WordPress que valga, así que el
 * widget solo podía enseñar «Inicia sesión para reservar» —aunque la paciente
 * estuviera perfectamente identificada en la web—. Un enlace que no se puede
 * abrir no sirve para nada.
 *
 * Con la página de reservas puesta en Configuración, el enlace es el de SU web
 * con `?tipo=`: quien lo abre entra por donde entra siempre. Sin ponerla se
 * conserva el enlace de antes, que al menos funciona en los centros que no
 * exigen identificarse.
 */
function CopiarEnlace({ slug, tenantSlug }) {
  const [copiado, setCopiado] = useState(false);
  const [reservaUrl, setReservaUrl] = useState(null);

  useEffect(() => {
    if (!tenantSlug) return;
    let vivo = true;
    fetch(`/api/public/c/${tenantSlug}/info`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo) setReservaUrl(j?.data?.reservaUrl ?? null); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [tenantSlug]);

  if (!tenantSlug) return null;

  const base = reservaUrl
    ? reservaUrl.replace(/\/+$/, "") + "/"
    : typeof window === "undefined"
      ? ""
      : `${window.location.origin}/widget/c/${tenantSlug}`;
  const url = base ? `${base}${base.includes("?") ? "&" : "?"}tipo=${encodeURIComponent(slug)}` : "";

  async function copiar(e) {
    e.stopPropagation(); // la fila entera abre la edición
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Sin permiso de portapapeles (http, navegador viejo): se enseña el
      // enlace para copiarlo a mano en vez de dejar el botón mudo.
      window.prompt("Copia el enlace:", url);
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copiar}
      title={url}
      className={`text-[11px] px-1.5 py-0.5 rounded border transition ${
        copiado
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-700"
      }`}
    >
      {copiado ? "copiado" : "copiar enlace"}
    </button>
  );
}

function ConstructorPreguntas({ preguntas, onChange }) {
  const lista = Array.isArray(preguntas) ? preguntas : [];

  const cambiar = (i, campo, valor) =>
    onChange(lista.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)));
  const quitar = (i) => onChange(lista.filter((_, j) => j !== i));
  const mover = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= lista.length) return;
    const copia = [...lista];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    onChange(copia);
  };
  const anadir = () =>
    onChange([...lista, { id: `p${Date.now()}`, label: "", type: "corto", required: false }]);

  return (
    <div className="border border-neutral-200 rounded-lg p-3">
      <div className="flex items-center justify-between gap-3 mb-1">
        <label className="block text-[11px] font-medium text-neutral-500">Preguntas al reservar</label>
        <span className="text-[10px] text-neutral-400">
          {lista.length === 0 ? "ninguna" : `${lista.length} de ${MAX_PREGUNTAS}`}
        </span>
      </div>
      <p className="text-[10px] text-neutral-400 mb-3">
        Se contestan DESPUÉS de escoger fecha y hora, y las respuestas quedan guardadas con la cita.
        Déjalo vacío si esta cita no necesita preguntar nada.
      </p>

      <div className="space-y-2">
        {lista.map((p, i) => (
          <div key={p.id ?? i} className="rounded-md border border-neutral-200 bg-neutral-50/60 p-2.5">
            <div className="flex items-start gap-2">
              <input
                type="text"
                value={p.label ?? ""}
                onChange={(e) => cambiar(i, "label", e.target.value)}
                placeholder="¿Qué le preguntas? Ej. ¿Cómo has dormido esta semana?"
                className="flex-1 rounded-md px-2.5 py-1.5 text-sm bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 placeholder-neutral-300"
              />
              <div className="flex items-center gap-0.5 shrink-0">
                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0}
                  className="p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30" title="Subir">↑</button>
                <button type="button" onClick={() => mover(i, 1)} disabled={i === lista.length - 1}
                  className="p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-30" title="Bajar">↓</button>
                <button type="button" onClick={() => quitar(i)}
                  className="p-1 text-neutral-400 hover:text-red-600" title="Quitar">✕</button>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <select
                value={p.type ?? "corto"}
                onChange={(e) => cambiar(i, "type", e.target.value)}
                className="rounded-md px-2 py-1 text-[12px] bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400"
              >
                {TIPOS_PREGUNTA.map((t) => (
                  <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>
                ))}
              </select>

              {p.type === "escala" && (
                <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                  del 1 al
                  <input
                    type="number" min={2} max={10}
                    value={p.max ?? ESCALA_POR_DEFECTO}
                    onChange={(e) => cambiar(i, "max", Number(e.target.value))}
                    className="w-14 rounded-md px-2 py-1 text-[12px] bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400"
                  />
                </label>
              )}

              <label className="flex items-center gap-1.5 text-[11px] text-neutral-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={p.required === true}
                  onChange={(e) => cambiar(i, "required", e.target.checked)}
                  className="rounded border-neutral-300 accent-[var(--color-primary)]"
                />
                Obligatoria
              </label>
            </div>
          </div>
        ))}
      </div>

      {lista.length < MAX_PREGUNTAS && (
        <button
          type="button"
          onClick={anadir}
          className="mt-2 w-full py-2 text-[12px] font-medium rounded-md border border-dashed border-neutral-300 text-neutral-500 hover:border-neutral-400 hover:text-neutral-700 transition"
        >
          + Añadir pregunta
        </button>
      )}
    </div>
  );
}

export default function CitasTiposPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null); // id de edición, "new" para alta
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /**
   * Los eliminados NO se listan (04/08/2026, Rodrigo: «los tipos de cita
   * eliminados se siguen viendo»).
   *
   * Borrar un tipo que ya tiene citas no lo puede borrar de verdad —se llevaría
   * por delante el histórico—, así que se desactiva. Pero para quien pulsó
   * «Eliminar» eso es un borrado, y verlo seguir en la lista es un fallo. Se
   * esconden detrás de este interruptor, que además es la única manera de
   * recuperarlos.
   */
  const [verEliminados, setVerEliminados] = useState(false);
  /*
   * El slug del cliente, para poder armar el enlace público de cada cita. Se
   * pide a /api/tenant/settings, que ya lo devuelve y es el mismo sitio del que
   * lo saca Configuración para la URL del webhook de Stripe. Si falla, los
   * botones de «copiar enlace» simplemente no se pintan: es una comodidad, no
   * puede tumbar la pantalla.
   */
  const [tenantSlug, setTenantSlug] = useState(null);
  /*
   * El PRECIO solo lo ve dirección (06/08/2026, Rodrigo). En una consulta con
   * equipo, lo que cobra cada servicio no es asunto de quien pasa consulta: la
   * nutricionista necesita el catálogo para saber qué ofrece y cuánto dura, no
   * la tarifa. `null` mientras se resuelve —se esconde por defecto—: enseñarlo
   * y quitarlo medio segundo después sería enseñarlo igual.
   */
  const [esAdmin, setEsAdmin] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/citas/event-types", { cache: "no-store" });
      const j = await res.json();
      if (j.ok) {
        setItems(j.data);
      }
    } finally { setLoading(false); }
  }, []);

  const visibles = verEliminados ? items : items.filter((it) => it.active);
  const eliminados = items.filter((it) => !it.active).length;

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setEsAdmin(["admin", "superadmin"].includes(j?.data?.role)))
      .catch(() => setEsAdmin(false));   // ante la duda, no se enseña
  }, []);

  useEffect(() => {
    fetch("/api/tenant/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setTenantSlug(j?.data?.slug ?? null))
      .catch(() => {});
  }, []);

  // Lo que va a ver la paciente si se fracciona. Se calcula aquí para que quien
  // configura vea el total y no se lleve la sorpresa de que 3 × 130 no son 360.
  const totalFraccionado =
    Number(form.instalmentPrice) > 0 && Number(form.instalmentMonths) > 1
      ? (Number(form.instalmentPrice) * Number(form.instalmentMonths)).toFixed(2)
      : null;

  function openCreate() {
    setForm(EMPTY_FORM);
    setOpenId("new");
    setFormError(null);
    setAdvancedOpen(false);
  }

  async function openEdit(item) {
    setOpenId(item.id);
    setFormError(null);
    setAdvancedOpen(false);
    try {
      const res = await fetch(`/api/citas/event-types/${item.id}`, { cache: "no-store" });
      const j = await res.json();
      const data = j.ok ? j.data : item;
      setForm({
        name: data.name ?? "",
        slug: data.slug ?? "",
        description: data.description ?? "",
        duration: data.duration ?? 60,
        bufferBefore: data.bufferBefore ?? 0,
        bufferAfter: data.bufferAfter ?? 0,
        color: data.color ?? "#3F6E5B",
        modalities: data.modalities ?? ["online"],
        location: data.location ?? "",
        phoneNumber: data.phoneNumber ?? "",
        meetUrl: data.meetUrl ?? "",
        additionalDataLabel: data.additionalDataLabel ?? "",
        additionalDataRequired: !!data.additionalDataRequired,
        minNoticeHours: data.minNoticeHours ?? 3,
        maxAdvanceDays: data.maxAdvanceDays ?? 60,
        price: data.price != null ? centsToEuros(data.price) : "",
        sessionsCount: data.sessionsCount ?? 1,
        instalmentPrice: data.instalmentPrice != null ? centsToEuros(data.instalmentPrice) : "",
        instalmentMonths: data.instalmentMonths ?? "",
        formQuestions: Array.isArray(data.formQuestions) ? data.formQuestions : [],
        isInitialAssessment: !!data.isInitialAssessment,
        isHidden: !!data.isHidden,
        active: !!data.active,
        order: data.order ?? 0,
        _bookingCount: data.bookingCount ?? 0,
      });
    } catch {
      // Respaldo con la fila del listado si el detalle no carga. OJO CON LAS
      // UNIDADES: ahí `price` viene en CÉNTIMOS, y este formulario trabaja en
      // euros. Volcarlo tal cual ponía 6000 en un campo etiquetado "Precio (€)",
      // y al guardar se convertía otra vez: 60 € pasaban a 6.000 €.
      setForm({
        ...EMPTY_FORM,
        ...item,
        price: item?.price != null ? centsToEuros(item.price) : "",
        instalmentPrice: item?.instalmentPrice != null ? centsToEuros(item.instalmentPrice) : "",
      });
    }
  }

  function updateForm(field, value) { setForm((p) => ({ ...p, [field]: value })); }

  function toggleModality(m) {
    setForm((p) => {
      const has = p.modalities.includes(m);
      const next = has ? p.modalities.filter((x) => x !== m) : [...p.modalities, m];
      return { ...p, modalities: next };
    });
  }

  async function submitForm() {
    setFormError(null);
    if (!form.name.trim()) { setFormError("Nombre obligatorio"); return; }
    if (!form.modalities || form.modalities.length === 0) {
      setFormError("Selecciona al menos una modalidad"); return;
    }
    if (form.modalities.includes("presencial") && !form.location.trim()) {
      setFormError("Dirección obligatoria si aceptas presencial"); return;
    }
    if (form.modalities.includes("phone") && !form.phoneNumber.trim()) {
      setFormError("Teléfono obligatorio si aceptas modalidad telefónica"); return;
    }
    // La sala fija NO se exige: ver el motivo en validateModalityFields.

    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim() || slugify(form.name),
      description: form.description.trim() || null,
      duration: Number(form.duration),
      bufferBefore: Number(form.bufferBefore),
      bufferAfter: Number(form.bufferAfter),
      color: form.color || null,
      modalities: form.modalities,
      location: form.location.trim() || null,
      phoneNumber: form.phoneNumber.trim() || null,
      meetUrl: form.meetUrl.trim() || null,
      additionalDataLabel: form.additionalDataLabel.trim() || null,
      additionalDataRequired: !!form.additionalDataRequired,
      minNoticeHours: Number(form.minNoticeHours),
      maxAdvanceDays: Number(form.maxAdvanceDays),
      // La API trabaja en CÉNTIMOS; el formulario, en euros. Vacío → null (gratis).
      price: eurosToCents(form.price),
      sessionsCount: Number(form.sessionsCount) || 1,
      // Los dos van juntos o no va ninguno: una cuota sin meses no se puede
      // cobrar, y unos meses sin cuota tampoco.
      instalmentPrice: form.instalmentMonths ? eurosToCents(form.instalmentPrice) : null,
      instalmentMonths: form.instalmentPrice ? Number(form.instalmentMonths) || null : null,
      formQuestions: form.formQuestions ?? [],
      isInitialAssessment: !!form.isInitialAssessment,
      isHidden: !!form.isHidden,
      active: !!form.active,
      order: Number(form.order),
    };

    setSaving(true);
    try {
      const isCreate = openId === "new";
      const url = isCreate ? "/api/citas/event-types" : `/api/citas/event-types/${openId}`;
      const method = isCreate ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "Error guardando");
      await load();
      setOpenId(null);
    } catch (err) {
      setFormError(err.message);
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!window.confirm("¿Eliminar este tipo de cita? Si tiene reservas, se desactivará en su lugar.")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/citas/event-types/${openId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Error eliminando");
      }
      await load();
      setOpenId(null);
    } catch (err) {
      setFormError(err.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 lg:px-10 pt-8 pb-5 flex items-end justify-between shrink-0 border-b border-[var(--ink-200)] gap-6 flex-wrap">
        <div>
          <div className="eyebrow mb-1.5 lg:mb-2">Tiempo · Configuración</div>
          <h1 className="font-display text-[24px] lg:text-[34px] leading-[1.05] text-[var(--ink-900)] tracking-tight flex items-center gap-2 flex-wrap">
            <span>
              Citas <span className="font-display-italic text-[var(--ink-400)]">— tipos de cita</span>
            </span>
            <HelpTooltip title="Tipos de cita" placement="bottom">
              El catálogo de lo que ofreces: cada tipo es un servicio con su duración, su precio y
              sus reglas. Es lo que la persona elige en la agenda pública, así que lo que pongas
              aquí es lo que ve.
              {" "}
              <strong className="text-white">Sin precio la cita no cobra nada</strong> y entra
              directa a tu lista; con precio se le retiene la tarjeta y no se cobra hasta que tú la
              confirmes.
            </HelpTooltip>
          </h1>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Link
            href="/citas"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Calendario
          </Link>
          <Link
            href="/citas/disponibilidad"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Disponibilidad
          </Link>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0F0F0F] text-white text-xs font-medium rounded-md hover:bg-[#222] transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Nuevo tipo de cita
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-auto px-6 lg:px-10 py-6">
        {/* Los eliminados no se listan: se recuperan desde aquí. */}
        {eliminados > 0 && (
          <div className="mb-3 flex items-center justify-end">
            <button
              onClick={() => setVerEliminados((v) => !v)}
              className="text-xs text-neutral-500 hover:text-neutral-800 underline underline-offset-2"
            >
              {verEliminados
                ? "Ocultar los eliminados"
                : `Ver ${eliminados} eliminado${eliminados === 1 ? "" : "s"}`}
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-neutral-400">Cargando...</div>
        ) : visibles.length === 0 ? (
          <div className="text-sm text-neutral-400">
            {items.length === 0
              ? "No hay tipos de cita aún. Crea el primero para empezar."
              : "No queda ningún tipo de cita activo."}
          </div>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200">
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Nombre</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Duración</th>
                  {esAdmin && <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Precio</th>}
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Modalidades</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Color</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Estado</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Orden</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((it) => (
                  <tr
                    key={it.id}
                    onClick={() => openEdit(it)}
                    className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-800">{it.name}</div>
                      <div className="text-[11px] text-neutral-400 flex items-center gap-2">
                        {it.slug}
                        {it.active && <CopiarEnlace slug={it.slug} tenantSlug={tenantSlug} />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{it.duration} min</td>
                    {esAdmin && (
                      <td className="px-4 py-3">
                        {it.price != null && it.price > 0 ? (
                          <span className="font-medium text-neutral-800">{formatMoney(it.price)}</span>
                        ) : (
                          <span className="text-neutral-400">Gratis</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {it.modalities?.map((m) => (
                          <span
                            key={m}
                            className="text-[11px] px-1.5 py-0.5 rounded border bg-white text-neutral-600 border-neutral-200"
                          >
                            {MODALITY_LABELS[m] ?? m}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block w-4 h-4 rounded border border-neutral-200"
                          style={{ background: it.color ?? "#3F6E5B" }}
                        />
                        <span className="text-[11px] text-neutral-400">{it.color ?? "—"}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {it.active ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border bg-emerald-50 text-emerald-700 border-emerald-100">
                          Activo
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border bg-neutral-100 text-neutral-500 border-neutral-200">
                          Inactivo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-400">{it.order ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/*
         * «Vacaciones» (06/08/2026, Rodrigo). Va aquí, debajo del catálogo,
         * porque él lo pidió como «un tipo de cita especial»: es donde lo va a
         * buscar. Lo usa todo el equipo desde el 07/08 — quien se va de
         * vacaciones tiene que poder apuntarlo sin pedírselo a nadie.
         */}
        <PanelVacaciones />
      </div>

      {/* Drawer */}
      {openId && (
        <div
          className="fixed inset-0 z-50"
          onClick={(e) => { if (e.target === e.currentTarget) setOpenId(null); }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">
                {openId === "new" ? "Nuevo tipo de cita" : "Editar tipo de cita"}
              </h2>
              <button
                onClick={() => setOpenId(null)}
                className="text-neutral-400 hover:text-neutral-700 p-0.5"
                aria-label="Cerrar"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
              {formError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Nombre</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => {
                    updateForm("name", e.target.value);
                    if (openId === "new" && !form.slug) updateForm("slug", slugify(e.target.value));
                  }}
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Slug</label>
                <input
                  type="text"
                  value={form.slug}
                  onChange={(e) => updateForm("slug", e.target.value)}
                  className={inputCls}
                  placeholder="primera-consulta"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Descripción</label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateForm("description", e.target.value)}
                  rows={2}
                  className={`${inputCls} min-h-[60px]`}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Duración (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={480}
                    value={form.duration}
                    onChange={(e) => updateForm("duration", e.target.value)}
                    className={inputCls}
                  />
                </div>
                {esAdmin && (
                  <div>
                    <label className="block text-[11px] font-medium text-neutral-500 mb-1">Precio (€)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Gratis"
                      value={form.price}
                      onChange={(e) => updateForm("price", e.target.value)}
                      className={inputCls}
                    />
                    <p className="text-[10px] text-neutral-400 mt-1">
                      {Number(form.sessionsCount) > 1
                        ? "Precio del bono ENTERO pagado de una vez."
                        : "Vacío = sin cobro. Con precio, se cobra al reservar."}
                    </p>
                  </div>
                )}
              </div>

              {/* Bono de sesiones (04/08/2026). Con 1 se comporta como siempre. */}
              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">
                  Sesiones que incluye
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={form.sessionsCount}
                  onChange={(e) => updateForm("sessionsCount", e.target.value)}
                  className={inputCls}
                />
                <p className="text-[10px] text-neutral-400 mt-1">
                  1 = una cita suelta. Más de 1 es un bono: se paga una vez y da derecho a esas citas, que se
                  reservan por separado y se numeran («3 de 10»).
                </p>
              </div>

              {/* El fraccionado es un precio APARTE, no el de arriba dividido. */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">
                    Pago a plazos: cuota al mes (€)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="No se fracciona"
                    value={form.instalmentPrice}
                    onChange={(e) => updateForm("instalmentPrice", e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Durante (meses)</label>
                  <input
                    type="number"
                    min={2}
                    max={36}
                    placeholder="—"
                    value={form.instalmentMonths}
                    onChange={(e) => updateForm("instalmentMonths", e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
              <p className="text-[10px] text-neutral-400 -mt-1">
                {totalFraccionado
                  ? `La paciente elegirá entre pagar ${form.price || 0} € de una vez o ${form.instalmentPrice} € al mes durante ${form.instalmentMonths} meses (${totalFraccionado} € en total).`
                  : "Déjalo vacío si esto solo se paga de una vez. Es un precio independiente del de arriba: financiar suele costar más."}
              </p>

              {/* Preguntas propias de este tipo de cita (04/08/2026, Rodrigo).
                  Antes esto era un desplegable con los formularios del módulo
                  Formularios: obligaba a salir de aquí, crear un formulario
                  entero con su página pública y volver a engancharlo para
                  acabar preguntando dos cosas. */}
              <ConstructorPreguntas
                preguntas={form.formQuestions}
                onChange={(v) => updateForm("formQuestions", v)}
              />

              {/* La primera visita (04/08/2026, Rodrigo): se entra sin firmar. */}
              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-neutral-200 bg-neutral-50/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isInitialAssessment}
                  onChange={(e) => updateForm("isInitialAssessment", e.target.checked)}
                  className="mt-0.5 rounded border-neutral-300 accent-[var(--color-primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-[12px] text-neutral-700">Esta es la valoración inicial</span>
                  <span className="block text-[10px] text-neutral-400 leading-snug">
                    A esta cita se entra SIN firmar los contratos: es la primera visita y todavía no
                    hay nada decidido. Solo puede haber una; si marcas esta, la anterior se desmarca.
                  </span>
                </span>
              </label>

              {/* Oculto y asignado a dedo (05/08/2026, Rodrigo). Para quien paga
                  por fuera de la pasarela (transferencia del extranjero, Bizum):
                  su cita entra como gratuita porque el dinero ya está cobrado, y
                  a la vista sería una puerta abierta. */}
              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-neutral-200 bg-neutral-50/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isHidden}
                  onChange={(e) => updateForm("isHidden", e.target.checked)}
                  className="mt-0.5 rounded border-neutral-300 accent-[var(--color-primary)]"
                />
                <span className="min-w-0">
                  <span className="block text-[12px] text-neutral-700">Oculto: solo para quien se lo asignes</span>
                  <span className="block text-[10px] text-neutral-400 leading-snug">
                    No aparece en la agenda pública para nadie. Lo ve —y lo puede reservar— solo quien
                    tenga un bono activo de este tipo, que le das tú desde su ficha cuando te pague por
                    transferencia o Bizum. No es lo mismo que desactivarlo: desactivado no lo reserva
                    nadie, tampoco quien ya lo tiene pagado.
                  </span>
                </span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Tiempo de margen antes (min)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.bufferBefore}
                    onChange={(e) => updateForm("bufferBefore", e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Tiempo de margen después (min)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.bufferAfter}
                    onChange={(e) => updateForm("bufferAfter", e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
              {/*
                El margen se RESTA de la cita, no se suma por fuera (07/08/2026,
                Rodrigo): el hueco en la agenda sigue durando lo que pone arriba
                y la sesión dura menos. Se enseña la cuenta ya hecha, con la hora
                de ejemplo, porque «60 con 10 después» y «60 con 10 antes» dan
                sesiones iguales de 50 minutos pero empiezan a horas distintas —
                y eso, dicho con palabras, no se entiende hasta que se ve.
              */}
              <p className="text-[11px] text-neutral-400 -mt-1">
                El margen se resta de la cita: el hueco sigue durando {form.duration || 0} min y la
                sesión dura menos.
                {(() => {
                  const total = Number(form.duration) || 0;
                  const antes = Math.max(0, Number(form.bufferBefore) || 0);
                  const despues = Math.max(0, Number(form.bufferAfter) || 0);
                  if (!total) return null;
                  if (antes + despues >= total) {
                    return (
                      <span className="block text-amber-700 mt-0.5">
                        Los márgenes suman {antes + despues} min y la cita dura {total}: así no cabe
                        nada, y se ignorarán hasta que lo ajustes.
                      </span>
                    );
                  }
                  const inicio = `17:${String(antes).padStart(2, "0")}`;
                  const fin = 17 * 60 + antes + (total - antes - despues);
                  const finTxt = `${String(Math.floor(fin / 60)).padStart(2, "0")}:${String(fin % 60).padStart(2, "0")}`;
                  return (
                    <span className="block text-neutral-500 mt-0.5">
                      La sesión durará <b>{total - antes - despues} min</b>. Un hueco de las 17:00
                      sería de {inicio} a {finTxt}.
                    </span>
                  );
                })()}
              </p>

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Color</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.color || "#3F6E5B"}
                    onChange={(e) => updateForm("color", e.target.value)}
                    className="w-10 h-9 border border-neutral-200 rounded cursor-pointer"
                  />
                  <input
                    type="text"
                    value={form.color || ""}
                    onChange={(e) => updateForm("color", e.target.value)}
                    placeholder="#3F6E5B"
                    className={inputCls}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1.5">Modalidades</label>
                <div className="flex gap-2 flex-wrap">
                  {ALL_MODALITIES.map((m) => (
                    <label key={m} className="flex items-center gap-1.5 text-[13px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.modalities.includes(m)}
                        onChange={() => toggleModality(m)}
                      />
                      {MODALITY_LABELS[m]}
                    </label>
                  ))}
                </div>
              </div>

              {form.modalities.includes("presencial") && (
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Dirección</label>
                  <input
                    type="text"
                    value={form.location}
                    onChange={(e) => updateForm("location", e.target.value)}
                    className={inputCls}
                  />
                </div>
              )}
              {form.modalities.includes("phone") && (
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Teléfono</label>
                  <input
                    type="tel"
                    value={form.phoneNumber}
                    onChange={(e) => updateForm("phoneNumber", e.target.value)}
                    className={inputCls}
                  />
                </div>
              )}
              {form.modalities.includes("online") && (
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">
                    Sala fija de videollamada <span className="text-neutral-400">(opcional)</span>
                  </label>
                  <input
                    type="url"
                    value={form.meetUrl}
                    onChange={(e) => updateForm("meetUrl", e.target.value)}
                    placeholder="https://meet.google.com/..."
                    className={inputCls}
                  />
                  <p className="text-[10px] text-neutral-400 mt-1 leading-snug">
                    Solo si tienes una sala permanente (Meet, Zoom…) y quieres que las citas online la
                    hereden solas. Déjalo vacío para pegar un enlace distinto en cada cita, que es lo
                    normal. Se usa únicamente con el modo automático de Configuración → Citas.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Etiqueta del campo libre</label>
                <input
                  type="text"
                  value={form.additionalDataLabel}
                  onChange={(e) => updateForm("additionalDataLabel", e.target.value)}
                  placeholder="¿Qué quieres comentar antes de la cita?"
                  className={inputCls}
                />
                <label className="flex items-center gap-1.5 text-[12px] text-neutral-500 mt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.additionalDataRequired}
                    onChange={(e) => updateForm("additionalDataRequired", e.target.checked)}
                  />
                  Obligatorio
                </label>
              </div>

              <div className="pt-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="text-[12px] text-neutral-500 hover:text-neutral-700"
                >
                  {advancedOpen ? "− Ocultar configuración avanzada" : "+ Configuración avanzada"}
                </button>
              </div>

              {advancedOpen && (
                <div className="space-y-3 pt-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-500 mb-1">Antelación mínima (h)</label>
                      <input
                        type="number"
                        min={0}
                        value={form.minNoticeHours}
                        onChange={(e) => updateForm("minNoticeHours", e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-neutral-500 mb-1">Reserva máx. (días)</label>
                      <input
                        type="number"
                        min={1}
                        value={form.maxAdvanceDays}
                        onChange={(e) => updateForm("maxAdvanceDays", e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-neutral-500 mb-1">Orden</label>
                    <input
                      type="number"
                      value={form.order}
                      onChange={(e) => updateForm("order", e.target.value)}
                      className={inputCls}
                    />
                  </div>

                  <label className="flex items-center gap-1.5 text-[13px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => updateForm("active", e.target.checked)}
                    />
                    Activo (visible para reservar)
                  </label>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-neutral-100 flex justify-between gap-2 shrink-0">
              {openId !== "new" ? (
                <button
                  onClick={handleDelete}
                  disabled={saving}
                  className="text-xs px-3 py-1.5 rounded-md bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 disabled:opacity-50"
                >
                  Eliminar
                </button>
              ) : <span />}
              <div className="flex gap-2">
                <button
                  onClick={() => setOpenId(null)}
                  disabled={saving}
                  className="text-xs px-3 py-1.5 rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={submitForm}
                  disabled={saving}
                  className="text-xs px-3 py-1.5 rounded-md bg-[#0F0F0F] text-white hover:bg-[#222] disabled:opacity-50"
                >
                  {saving ? "Guardando..." : (openId === "new" ? "Crear" : "Guardar")}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
