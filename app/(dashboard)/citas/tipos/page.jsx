"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

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

export default function CitasTiposPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null); // id de edición, "new" para alta
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

  useEffect(() => { load(); }, [load]);

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
        active: !!data.active,
        order: data.order ?? 0,
        _bookingCount: data.bookingCount ?? 0,
      });
    } catch {
      setForm({ ...EMPTY_FORM, ...item });
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
    if (form.modalities.includes("online") && !form.meetUrl.trim()) {
      setFormError("URL de reunión obligatoria si aceptas modalidad online"); return;
    }

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
          <h1 className="font-display text-[24px] lg:text-[34px] leading-[1.05] text-[var(--ink-900)] tracking-tight">
            Citas <span className="font-display-italic text-[var(--ink-400)]">— tipos de cita</span>
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
        {loading ? (
          <div className="text-sm text-neutral-400">Cargando...</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-neutral-400">
            No hay tipos de cita aún. Crea el primero para empezar.
          </div>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200">
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Nombre</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Duración</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Modalidades</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Color</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Estado</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Orden</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr
                    key={it.id}
                    onClick={() => openEdit(it)}
                    className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-800">{it.name}</div>
                      <div className="text-[11px] text-neutral-400">{it.slug}</div>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{it.duration} min</td>
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
              <p className="text-[11px] text-neutral-400 -mt-1">
                Minutos que bloqueamos en la agenda para preparación o descanso entre citas.
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
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">URL de reunión</label>
                  <input
                    type="url"
                    value={form.meetUrl}
                    onChange={(e) => updateForm("meetUrl", e.target.value)}
                    placeholder="https://meet.google.com/..."
                    className={inputCls}
                  />
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
