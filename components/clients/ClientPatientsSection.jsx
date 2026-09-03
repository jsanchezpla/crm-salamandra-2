"use client";

/**
 * ClientPatientsSection — sección "Pacientes" de la ficha de cliente.
 *
 * Aumenta: el cliente/tutor que PAGA puede tener varios pacientes (hijos…). El
 * paciente ya NO se crea solo al asignar el módulo Clínica (ver
 * lib/clients/moduleAssignments.js); se crea explícitamente aquí. Los contactos
 * del paciente son los del cliente pagador (no se duplican).
 *
 * Sólo se muestra si el tenant tiene módulo Clínica/Pacientes (si el GET de
 * pacientes responde 403, la sección no se renderiza).
 *
 * Autocontenido: recibe `clientId`. Habla con /api/pacientes y, para el flag
 * "padres separados" (dato del cliente/tutor), con /api/clients/[id].
 *
 * Se monta en DOS sitios desde el 03/09/2026: la pestaña «Servicio» de la ficha
 * completa y el panel «Editar ficha» del listado (AV-0032 de Aumenta: una
 * adulta dada de alta sin paciente, y desde el listado no había por dónde
 * crearlo). Y la casilla «el paciente es el propio cliente» es la misma del
 * alta (`PacientesDelAlta.jsx`): copia el nombre de la ficha a los campos con
 * `partirNombre` y deja el parentesco puesto. Los parentescos son los de
 * `formularioAlta.js`, para que la ficha y el mostrador digan lo mismo.
 */

import { useCallback, useEffect, useState } from "react";
import SpecialtyPicker from "../clinica/SpecialtyPicker.jsx";
import { PARENTESCOS, PARENTESCO_ES_EL_CLIENTE, partirNombre } from "../../lib/clients/formularioAlta.js";

const STATUS_LABEL = { active: "Activo", paused: "En pausa", discharged: "Alta" };

// Sin contrato: desde el sprint 2026-07 (punto 1.1) el contrato es de la
// FAMILIA y se sube en la sección "Contrato" de esta misma ficha, no por
// paciente.
const EMPTY_FORM = {
  specialties: [],
  firstName: "", lastName: "", dni: "", birthDate: "", address: "",
  relationship: "", relationshipOther: "", educationCenter: "",
  images: false, marketing: false, whatsapp: false,
};

export default function ClientPatientsSection({ clientId }) {
  const [patients, setPatients] = useState([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [separated, setSeparated] = useState(null);
  const [clienteNombre, setClienteNombre] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      fetch(`/api/pacientes?clientId=${clientId}`).then(async (r) => ({ r, d: await r.json().catch(() => ({})) })),
      fetch(`/api/clients/${clientId}`).then((r) => r.json()).catch(() => null),
    ])
      .then(([{ r, d }, clientRes]) => {
        if (!alive) return;
        if (r.status === 403) { setAvailable(false); return; }
        if (!d.ok) throw new Error(d.error || "Error cargando pacientes");
        setPatients(d.data.patients || []);
        setSeparated(clientRes?.data?.separated ?? null);
        setClienteNombre(clientRes?.data?.name ?? "");
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [clientId]);

  useEffect(() => load(), [load]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const esElCliente = form.relationship === PARENTESCO_ES_EL_CLIENTE;
  const marcarEsElCliente = (marcado) =>
    setForm((f) =>
      marcado
        ? { ...f, ...partirNombre(clienteNombre), relationship: PARENTESCO_ES_EL_CLIENTE }
        : { ...f, relationship: "" }
    );

  async function toggleSeparated(next) {
    const prev = separated; // preserva el tri-estado (null si desconocido)
    setSeparated(next); // optimista
    try {
      const r = await fetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ separated: next }),
      });
      if (!r.ok) throw new Error("No se pudo guardar");
    } catch (e) {
      setSeparated(prev); // revert al valor previo real
      setError(e.message);
    }
  }

  async function submit() {
    if (busy) return;
    if (!form.firstName.trim() || !form.lastName.trim()) { setError("Nombre y apellidos son obligatorios"); return; }
    setBusy(true);
    setError(null);
    try {
      const relationship =
        form.relationship === "Otro" ? form.relationshipOther.trim() : form.relationship || null;
      const payload = {
        clientId,
        specialties: form.specialties,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dni: form.dni.trim() || null,
        birthDate: form.birthDate || null,
        address: form.address.trim() || null,
        relationship,
        educationCenter: form.educationCenter.trim() || null,
        consents: { images: form.images, marketing: form.marketing, whatsapp: form.whatsapp },
      };
      const r = await fetch(`/api/pacientes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No se pudo crear el paciente");

      setForm(EMPTY_FORM);
      setCreating(false);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading || !available) return null;

  const inputCls = "w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1";

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm font-semibold text-gray-700">Pacientes</span>
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!!separated}
            onChange={(e) => toggleSeparated(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 accent-[var(--color-primary)]"
          />
          Padres/tutores separados
        </label>
      </div>

      <div className="p-5 space-y-4">
        {patients.length === 0 && !creating && (
          <div className="text-sm text-gray-400 italic">Este cliente no tiene pacientes todavía.</div>
        )}

        {patients.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {patients.map((p) => (
              <li key={p.id} className="py-2.5 flex items-center gap-3">
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
                  style={{ background: p.color || "var(--color-primary)" }}
                >
                  {p.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <a href={`/pacientes/${p.id}`} className="text-sm font-medium text-gray-800 hover:text-[var(--color-primary)] hover:underline">
                    {p.name}
                  </a>
                  <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                    {p.relationship && <span>{p.relationship}</span>}
                  </div>
                  {p.specialtyLabels?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.specialtyLabels.map((lbl) => (
                        <span
                          key={lbl}
                          className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                            lbl === "Nutrición" ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"
                          }`}
                        >
                          {lbl}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 shrink-0">
                  {STATUS_LABEL[p.status] || p.status}
                </span>
              </li>
            ))}
          </ul>
        )}

        {creating ? (
          <div className="rounded-lg border border-gray-200 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <SpecialtyPicker value={form.specialties} onChange={(v) => set("specialties", v)} />
              </div>
              {/* Donde el paciente ES el cliente (una adulta que viene a
                  consulta), basta marcar: se copia el nombre de la ficha y
                  queda editable. Igual que en el alta del mostrador. */}
              <label className="sm:col-span-2 flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={esElCliente}
                  onChange={(e) => marcarEsElCliente(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 accent-[var(--color-primary)]"
                />
                <span className="text-xs text-gray-600">El paciente es el propio cliente</span>
              </label>
              <div>
                <label className={labelCls}>Nombre *</label>
                <input className={inputCls} value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Apellidos *</label>
                <input className={inputCls} value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>DNI</label>
                <input className={inputCls} value={form.dni} onChange={(e) => set("dni", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Fecha de nacimiento</label>
                <input type="date" className={inputCls} value={form.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Domicilio</label>
                <input className={inputCls} value={form.address} onChange={(e) => set("address", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Parentesco con el cliente</label>
                <select className={inputCls} value={form.relationship} onChange={(e) => set("relationship", e.target.value)}>
                  <option value="">—</option>
                  {PARENTESCOS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Centro escolar</label>
                <input className={inputCls} value={form.educationCenter} onChange={(e) => set("educationCenter", e.target.value)} />
              </div>
              {form.relationship === "Otro" && (
                <div className="sm:col-span-2">
                  <label className={labelCls}>Especifica el parentesco</label>
                  <input className={inputCls} value={form.relationshipOther} onChange={(e) => set("relationshipOther", e.target.value)} />
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Consentimientos</div>
              <div className="flex flex-col sm:flex-row sm:gap-6 gap-2">
                {[
                  ["images", "Toma de imágenes"],
                  ["marketing", "Publicidad"],
                  ["whatsapp", "Comunicaciones por WhatsApp"],
                ].map(([k, lbl]) => (
                  <label key={k} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={form[k]} onChange={(e) => set(k, e.target.checked)} className="w-4 h-4 rounded border-gray-300 accent-[var(--color-primary)]" />
                    {lbl}
                  </label>
                ))}
              </div>
            </div>

            {error && <div className="text-xs text-rose-600">{error}</div>}

            <div className="flex items-center gap-2 pt-1">
              <button
                disabled={busy}
                onClick={submit}
                className="text-sm font-medium px-3 py-1.5 rounded-md bg-[var(--color-primary)] text-white disabled:opacity-40"
              >
                {busy ? "Creando…" : "Crear paciente"}
              </button>
              <button onClick={() => { setCreating(false); setForm(EMPTY_FORM); setError(null); }} className="text-sm text-gray-500">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <>
            {error && <div className="text-xs text-rose-600">{error}</div>}
            <button
              onClick={() => { setCreating(true); setError(null); }}
              className="text-sm font-medium text-[var(--color-primary)] hover:underline"
            >
              + Crear paciente
            </button>
          </>
        )}
      </div>
    </div>
  );
}
