"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";
import { PALETA_CATEGORIAS } from "../../../../lib/calendar/categorias.js";

/**
 * Categorías del Calendario (01/09/2026, Rodrigo: «poder poner categorías en
 * el Calendario con el mismo estilo de los tipos de cita de Citas»).
 *
 * Es a propósito la MISMA pantalla que `/citas/tipos`: cabecera con sus
 * botones, tabla con una fila por elemento —y el color como una muestra, no
 * como un código hex—, y drawer a la derecha al pulsar la fila. Quien sepa
 * mantener el catálogo de una agenda sabe mantener el de la otra sin que nadie
 * se lo explique.
 *
 * Lo que NO se copia de allí es lo que allí significa algo y aquí no: duración,
 * precio, modalidades, antelación y enlace público. Una categoría del
 * Calendario clasifica una reunión interna; no se vende ni se reserva.
 */

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const EMPTY_FORM = {
  name: "",
  description: "",
  color: PALETA_CATEGORIAS[0],
  active: true,
  order: 0,
};

export default function CategoriasCalendarioPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null); // "new" | id | null
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [verInactivas, setVerInactivas] = useState(false);
  /*
   * El catálogo lo pone dirección, y la API lo exige (403 para el resto). Aquí
   * se esconden los botones que no van a funcionar: mismo criterio y misma
   * mecánica que `/citas/tipos`. Empieza en `null` —ni sí ni no— para no
   * enseñar «Nueva categoría» medio segundo y quitarlo después; ante la duda,
   * no se enseña.
   */
  const [esAdmin, setEsAdmin] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setEsAdmin(["admin", "superadmin"].includes(j?.data?.role)))
      .catch(() => setEsAdmin(false));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/calendar/categories", { cache: "no-store" });
      const j = await res.json();
      setItems(j.ok ? (j.data ?? []) : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const inactivas = items.filter((c) => !c.active).length;
  const visibles = verInactivas ? items : items.filter((c) => c.active);

  function openCreate() {
    setFormError(null);
    // El siguiente color de la paleta que nadie esté usando: dos categorías
    // del mismo color no se distinguen, que es justo lo que se venía a evitar.
    const usados = new Set(items.map((c) => (c.color || "").toUpperCase()));
    const libre = PALETA_CATEGORIAS.find((c) => !usados.has(c)) ?? PALETA_CATEGORIAS[0];
    setForm({ ...EMPTY_FORM, color: libre, order: items.length });
    setOpenId("new");
  }

  function openEdit(item) {
    setFormError(null);
    setForm({
      name: item.name ?? "",
      description: item.description ?? "",
      color: item.color ?? PALETA_CATEGORIAS[0],
      active: item.active !== false,
      order: item.order ?? 0,
    });
    setOpenId(item.id);
  }

  function updateForm(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setFormError("El nombre es obligatorio");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const esNueva = openId === "new";
      const res = await fetch(esNueva ? "/api/calendar/categories" : `/api/calendar/categories/${openId}`, {
        method: esNueva ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          color: form.color,
          active: !!form.active,
          order: Number(form.order) || 0,
        }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "No se ha podido guardar");
      await load();
      setOpenId(null);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("¿Eliminar esta categoría? Si algún evento la usa, se desactivará en su lugar.")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/calendar/categories/${openId}`, { method: "DELETE" });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || "No se ha podido eliminar");
      // El servidor decide cuál de las dos cosas pasó; aquí solo se cuenta.
      setAviso(
        j.data?.borrada
          ? "Categoría eliminada."
          : `La categoría está en ${j.data?.enUso} evento${j.data?.enUso === 1 ? "" : "s"}, así que se ha desactivado en vez de borrarla: los eventos que ya la tenían la conservan, pero no se ofrecerá al apuntar nada nuevo.`
      );
      await load();
      setOpenId(null);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-6 lg:px-10 pt-8 pb-5 flex items-end justify-between shrink-0 border-b border-[var(--ink-200)] gap-6 flex-wrap">
        <div>
          <div className="eyebrow mb-1.5 lg:mb-2">Tiempo · Configuración</div>
          <h1 className="font-display text-[24px] lg:text-[34px] leading-[1.05] text-[var(--ink-900)] tracking-tight flex items-center gap-2 flex-wrap">
            <span>
              Calendario <span className="font-display-italic text-[var(--ink-400)]">— categorías</span>
            </span>
            <HelpTooltip title="Categorías del calendario" placement="bottom">
              De qué va cada cosa que apuntas: reuniones de equipo, coordinaciones, formación,
              gestión… Cada una con su color, y desde el calendario puedes ver la semana{" "}
              <strong className="text-white">coloreada por categoría en vez de por prioridad</strong>{" "}
              con los botones de arriba.
            </HelpTooltip>
          </h1>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Link
            href="/calendario"
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-neutral-200 text-neutral-700 hover:bg-neutral-50 transition"
          >
            Calendario
          </Link>
          {esAdmin && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0F0F0F] text-white text-xs font-medium rounded-md hover:bg-[#222] transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Nueva categoría
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 lg:px-10 py-6">
        {aviso && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 flex items-start justify-between gap-3">
            <p className="text-xs text-amber-900">{aviso}</p>
            <button onClick={() => setAviso(null)} className="text-xs font-semibold text-amber-800 shrink-0">
              ✕
            </button>
          </div>
        )}

        {inactivas > 0 && (
          <div className="mb-3 flex items-center justify-end">
            <button
              onClick={() => setVerInactivas((v) => !v)}
              className="text-xs text-neutral-500 hover:text-neutral-800 underline underline-offset-2"
            >
              {verInactivas
                ? "Ocultar las desactivadas"
                : `Ver ${inactivas} desactivada${inactivas === 1 ? "" : "s"}`}
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-sm text-neutral-400">Cargando...</div>
        ) : visibles.length === 0 ? (
          <div className="bg-white border border-neutral-200 rounded-xl px-6 py-8 max-w-xl">
            <div className="font-display text-[19px] text-neutral-900 mb-1.5">
              {items.length === 0 ? "Aún no hay categorías." : "No queda ninguna categoría activa."}
            </div>
            <p className="text-[13px] text-neutral-500 leading-relaxed">
              Una categoría es de qué va lo que apuntas: «Reunión de equipo», «Coordinación»,
              «Formación». Con dos o tres basta para empezar — y desde el calendario podrás ver la
              semana coloreada por categoría en vez de por prioridad.
            </p>
            {esAdmin ? (
              <button
                onClick={openCreate}
                className="mt-4 px-3 py-1.5 bg-[#0F0F0F] text-white text-xs font-medium rounded-md hover:bg-[#222] transition-colors"
              >
                Crear la primera
              </button>
            ) : (
              <p className="text-[12px] text-neutral-400 mt-3">
                El catálogo lo pone la administración del centro.
              </p>
            )}
          </div>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200">
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Nombre</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Color</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Estado</th>
                  <th className="text-left font-medium text-neutral-500 px-4 py-2.5">Orden</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((it) => (
                  <tr
                    key={it.id}
                    onClick={() => esAdmin && openEdit(it)}
                    className={`border-b border-neutral-100 last:border-0 ${esAdmin ? "hover:bg-neutral-50 cursor-pointer" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-neutral-800">{it.name}</div>
                      {it.description && (
                        <div className="text-[11px] text-neutral-400 line-clamp-1">{it.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="w-4 h-4 rounded border border-black/10 shrink-0"
                          style={{ backgroundColor: it.color || "#D4D4D4" }}
                        />
                        <span className="text-neutral-400 text-[11px]">{it.color || "sin color"}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {it.active ? (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                          Activa
                        </span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500 border border-neutral-200">
                          Desactivada
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{it.order}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Drawer (regla #13: respeta la barra móvil) */}
      {openId && (
        <div className="fixed inset-0 z-50" onClick={(e) => { if (e.target === e.currentTarget) setOpenId(null); }}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">
                {openId === "new" ? "Nueva categoría" : "Editar categoría"}
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
                  onChange={(e) => updateForm("name", e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  placeholder="Reunión de equipo"
                  autoFocus
                  className={inputCls}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1">Descripción</label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateForm("description", e.target.value)}
                  rows={2}
                  placeholder="Opcional: para qué se usa."
                  className={`${inputCls} min-h-[60px]`}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-neutral-500 mb-1.5">Color</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {PALETA_CATEGORIAS.map((c) => {
                    const elegido = (form.color || "").toUpperCase() === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => updateForm("color", c)}
                        aria-label={`Color ${c}`}
                        className={`w-7 h-7 rounded-md border-2 transition ${
                          elegido ? "border-neutral-800 scale-105" : "border-transparent hover:border-neutral-300"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.color || PALETA_CATEGORIAS[0]}
                    onChange={(e) => updateForm("color", e.target.value.toUpperCase())}
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

              <div className="grid grid-cols-2 gap-2 items-end">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-500 mb-1">Orden</label>
                  <input
                    type="number"
                    value={form.order}
                    onChange={(e) => updateForm("order", e.target.value)}
                    className={inputCls}
                  />
                </div>
                <label className="flex items-center gap-2 text-[13px] text-neutral-700 cursor-pointer pb-2">
                  <input
                    type="checkbox"
                    checked={!!form.active}
                    onChange={(e) => updateForm("active", e.target.checked)}
                    className="rounded border-neutral-300"
                  />
                  Activa
                </label>
              </div>

              <p className="text-[11px] text-neutral-400 leading-relaxed pt-1">
                Una categoría desactivada no se ofrece al apuntar un evento nuevo, pero los que ya
                la tenían la conservan — y siguen pintándose de su color.
              </p>
            </div>

            <div className="px-5 py-4 border-t border-neutral-100 flex items-center justify-between">
              <div>
                {openId !== "new" && (
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors disabled:opacity-40"
                  >
                    Eliminar
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOpenId(null)}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1.5 bg-[#0F0F0F] text-white text-xs font-medium rounded-lg hover:bg-[#222] transition-colors disabled:opacity-50 min-w-[80px]"
                >
                  {saving ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
