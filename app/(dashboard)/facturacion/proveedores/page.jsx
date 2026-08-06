"use client";

import { useCallback, useEffect, useState } from "react";
import HelpTooltip from "../../../../components/ui/HelpTooltip.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

function emptyForm() {
  return { name: "", taxId: "", contactName: "", email: "", phone: "", address: "", notes: "" };
}

export default function ProveedoresPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (verInactivos) qs.set("incluirInactivos", "1");
      const r = await fetch(`/api/proveedores?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron cargar los proveedores");
      setSuppliers(j.data?.suppliers ?? []);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, [search, verInactivos]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  function abrirNuevo() {
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
    setShowForm(true);
  }

  function abrirEdicion(s) {
    setEditingId(s.id);
    setForm({
      name: s.name ?? "",
      taxId: s.taxId ?? "",
      contactName: s.contactName ?? "",
      email: s.email ?? "",
      phone: s.phone ?? "",
      address: s.address ?? "",
      notes: s.notes ?? "",
    });
    setFormError(null);
    setShowForm(true);
  }

  async function guardar(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError("El nombre es obligatorio");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const url = editingId ? `/api/proveedores/${editingId}` : "/api/proveedores";
      const r = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo guardar");
      setShowForm(false);
      await cargar();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function darDeBaja(s) {
    // El endpoint decide: si tiene gastos asociados lo desactiva, y si no lo
    // borra de verdad. Aquí solo se avisa de lo que va a pasar.
    if (!confirm(`¿Dar de baja a «${s.name}»?\n\nSi tiene gastos asociados se conserva el histórico y solo deja de aparecer en las listas.`)) return;
    try {
      const r = await fetch(`/api/proveedores/${s.id}`, { method: "DELETE" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo dar de baja");
      await cargar();
    } catch (e) {
      setErrorMsg(e.message);
    }
  }

  async function reactivar(s) {
    try {
      const r = await fetch(`/api/proveedores/${s.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: true }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudo reactivar");
      await cargar();
    } catch (e) {
      setErrorMsg(e.message);
    }
  }

  return (
    <div className="p-4 lg:p-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-800 flex items-center gap-2">
            Proveedores
            <HelpTooltip title="Dar de baja un proveedor" placement="bottom">
              No siempre hace lo mismo. Si le has registrado algún gasto, el proveedor solo se
              oculta de las listas: el histórico conserva su nombre y puedes reactivarlo.
              {" "}
              <strong className="text-white">Si no tiene ningún gasto se borra del todo</strong>,
              sin vuelta atrás — aunque te haya entregado mercancía en el almacén.
            </HelpTooltip>
          </h1>
          <p className="text-[12.5px] text-neutral-500 mt-0.5">
            A quién le compras. Se elige al registrar un gasto y al recibir mercancía en el almacén.
          </p>
        </div>
        <button
          onClick={abrirNuevo}
          className="text-[12.5px] px-3 py-1.5 rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white font-medium hover:opacity-90 transition"
        >
          Nuevo proveedor
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por nombre, NIF o persona de contacto…"
          className={`${inputCls} max-w-sm`}
        />
        <label className="flex items-center gap-2 text-[12.5px] text-neutral-600">
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
          Ver también los dados de baja
        </label>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{errorMsg}</div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                <th className="text-left font-medium px-3 py-2">Proveedor</th>
                <th className="text-left font-medium px-3 py-2">NIF</th>
                <th className="text-left font-medium px-3 py-2">Contacto</th>
                <th className="text-left font-medium px-3 py-2">Teléfono</th>
                <th className="text-left font-medium px-3 py-2">Email</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-neutral-400">Cargando…</td>
                </tr>
              )}
              {!loading && suppliers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-neutral-400">
                    {search ? "Ningún proveedor coincide con la búsqueda." : "Todavía no hay proveedores dados de alta."}
                  </td>
                </tr>
              )}
              {!loading &&
                suppliers.map((s) => (
                  <tr key={s.id} className={`border-t border-neutral-100 ${s.active ? "" : "bg-neutral-50/60 text-neutral-400"}`}>
                    <td className="px-3 py-2">
                      <span className="font-medium text-neutral-800">{s.name}</span>
                      {!s.active && <span className="ml-2 text-[11px] text-neutral-400">(de baja)</span>}
                    </td>
                    <td className="px-3 py-2">{s.taxId || "—"}</td>
                    <td className="px-3 py-2">{s.contactName || "—"}</td>
                    <td className="px-3 py-2">{s.phone || "—"}</td>
                    <td className="px-3 py-2">{s.email || "—"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => abrirEdicion(s)} className="text-neutral-500 hover:text-neutral-800 px-2">
                        Editar
                      </button>
                      {s.active ? (
                        <button onClick={() => darDeBaja(s)} className="text-neutral-400 hover:text-red-600 px-2">
                          Dar de baja
                        </button>
                      ) : (
                        <button onClick={() => reactivar(s)} className="text-neutral-500 hover:text-neutral-800 px-2">
                          Reactivar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowForm(false)} />
          {/* top-14 en móvil: no tapar la barra del menú hamburguesa (regla 13). */}
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-xl overflow-y-auto">
            <form onSubmit={guardar} className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-neutral-800">
                  {editingId ? "Editar proveedor" : "Nuevo proveedor"}
                </h2>
                <button type="button" onClick={() => setShowForm(false)} className="text-neutral-400 hover:text-neutral-700">
                  Cerrar
                </button>
              </div>

              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{formError}</div>
              )}

              <label className="block">
                <span className="text-[12px] text-neutral-500">Nombre *</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} autoFocus />
              </label>
              <label className="block">
                <span className="text-[12px] text-neutral-500">NIF / CIF</span>
                <input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-[12px] text-neutral-500">Persona de contacto</span>
                <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className={inputCls} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[12px] text-neutral-500">Teléfono</span>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} />
                </label>
                <label className="block">
                  <span className="text-[12px] text-neutral-500">Email</span>
                  <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} />
                </label>
              </div>
              <label className="block">
                <span className="text-[12px] text-neutral-500">Dirección</span>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} />
              </label>
              <label className="block">
                <span className="text-[12px] text-neutral-500">Notas</span>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className={inputCls} />
              </label>

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white text-sm font-medium py-2 hover:opacity-90 transition disabled:opacity-50"
              >
                {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear proveedor"}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
