"use client";

/**
 * PatientExternalContactsSection — «Contactos externos» de la ficha de paciente
 * (Rodrigo, 02/08/2026).
 *
 * La agenda de profesionales de FUERA del centro con los que se coordina el
 * caso: la orientadora del instituto, la tutora del cole, el psiquiatra, la PT
 * del aula TEA…
 *
 * POR QUÉ: hasta ahora esa gente se escribía a mano en cada acta de
 * coordinación (`participants`, texto libre). El mismo nombre se reescribía en
 * cada reunión, no había forma de saber que era la misma persona, y su teléfono
 * no vivía en ningún sitio: había que rebuscarlo en el acta anterior. Al migrar
 * Aumenta aparecieron metidos en las ranuras de «tutor» de Organízate, que es
 * justo el síntoma de que faltaba este sitio.
 *
 * El cargo es TEXTO LIBRE a propósito. Una lista cerrada se queda corta el
 * primer día y la gente acaba escribiendo en el hueco que encuentre — que es
 * exactamente de donde venimos.
 *
 * Se esconde sola si el endpoint responde 403 (tenant sin módulo clínico).
 */

import { useCallback, useEffect, useState } from "react";

const NUEVO = { name: "", role: "", phone: "", email: "", entity: "" };

export default function PatientExternalContactsSection({ patientId }) {
  const [contactos, setContactos] = useState([]);
  const [disponible, setDisponible] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(NUEVO);
  const [abriendo, setAbriendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [ocupado, setOcupado] = useState(null);

  const cargar = useCallback(() => {
    if (!patientId) return;
    setCargando(true);
    fetch(`/api/pacientes/${patientId}/contactos`, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 403) {
          setDisponible(false);
          return null;
        }
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || "No se pudieron cargar los contactos");
        return j.data;
      })
      .then((d) => d && setContactos(d.contactos ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, [patientId]);

  useEffect(cargar, [cargar]);

  async function crear(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch(`/api/pacientes/${patientId}/contactos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo añadir");
      setForm(NUEVO);
      setAbriendo(false);
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(c) {
    // Se avisa de que las actas NO se pierden: es la duda razonable de
    // cualquiera antes de borrar algo que está enlazado a un historial.
    if (!window.confirm(`¿Quitar a ${c.name} de la agenda?\n\nLas coordinaciones ya registradas se conservan; solo dejarán de tener contacto asociado.`)) return;
    setOcupado(c.id);
    setError(null);
    try {
      const r = await fetch(`/api/pacientes/${patientId}/contactos/${c.id}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo borrar");
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(null);
    }
  }

  if (!disponible) return null;

  const input =
    "w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--color-primary,#1B3A2D)]";

  return (
    <section className="bg-white border border-neutral-100 rounded-xl p-4 lg:p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink-900,#1a1a1a)]">Contactos externos</h2>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Profesionales de fuera del centro con los que se coordina el caso. Las coordinaciones se
            enlazan a esta agenda.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAbriendo((v) => !v)}
          className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-white shrink-0"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          {abriendo ? "Cancelar" : "+ Añadir"}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-700 rounded-lg p-3 text-xs mb-3">{error}</div>
      )}

      {abriendo && (
        <form onSubmit={crear} className="border border-neutral-100 rounded-lg p-3 mb-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Nombre *</label>
            <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Cargo</label>
            <input
              className={input}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              placeholder="Psicóloga del cole, orientadora del instituto, PT del aula…"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Teléfono</label>
            <input className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Email</label>
            <input className={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Centro</label>
            <input
              className={input}
              value={form.entity}
              onChange={(e) => setForm({ ...form, entity: e.target.value })}
              placeholder="CEIP San José, Hospital Niño Jesús…"
            />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={guardando || !form.name.trim()}
              className="text-xs font-medium px-4 py-2 rounded-lg text-white disabled:opacity-40"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {guardando ? "Guardando…" : "Guardar contacto"}
            </button>
          </div>
        </form>
      )}

      {cargando ? (
        <p className="text-xs text-neutral-400 py-4 text-center">Cargando…</p>
      ) : contactos.length === 0 ? (
        <p className="text-xs text-neutral-400 py-4 text-center">
          Sin contactos externos. Añade aquí a quien lleve el caso desde el colegio o sanidad.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {contactos.map((c) => (
            <li key={c.id} className="py-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm text-neutral-800">
                  {c.name}
                  {c.role && <span className="text-neutral-500"> · {c.role}</span>}
                </div>
                <div className="text-[11px] text-neutral-500 flex flex-wrap gap-x-3">
                  {c.entity && <span>{c.entity}</span>}
                  {c.phone && <span>{c.phone}</span>}
                  {c.email && <span className="break-all">{c.email}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => borrar(c)}
                disabled={ocupado === c.id}
                className="text-[11px] text-neutral-400 hover:text-red-600 disabled:opacity-40 shrink-0"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
