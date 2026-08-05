"use client";

/**
 * ClientGuardiansSection — «Padres y tutores» de la ficha de cliente
 * (sprint Aumenta 2026-07, puntos 1.2 y 2.2).
 *
 * El endpoint de tutores existía desde el 29/07 pero no había pantalla, así que
 * en la práctica ninguna familia tenía tutores: sin ellos, la firma del portal
 * la hace el titular de la ficha y el caso de los padres SEPARADOS —dos
 * personas, una familia, dos firmas— no se podía representar. Esto es esa
 * pantalla.
 *
 * Quien esté marcado como firmante tiene que firmar el contrato en el portal
 * (con su propio correo: el email de cada tutor ES su acceso). Mientras falte
 * una firma, la documentación del paciente queda cerrada para los dos.
 *
 * Se esconde sola si el endpoint responde 403 (tenant sin módulo clients).
 */

import { useCallback, useEffect, useState } from "react";
import HelpTooltip from "../ui/HelpTooltip.jsx";

const RELACION_LABEL = {
  madre: "Madre",
  padre: "Padre",
  tutor: "Tutor/a legal",
  otro: "Otro",
};

const NUEVO = { name: "", relationship: "tutor", dni: "", phone: "", email: "", signer: true };

function fmtFecha(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ClientGuardiansSection({ clientId }) {
  const [guardians, setGuardians] = useState([]);
  const [relaciones, setRelaciones] = useState(Object.keys(RELACION_LABEL));
  const [contratoCompleto, setContratoCompleto] = useState(false);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    fetch(`/api/clients/${clientId}/guardians`)
      .then(async (r) => ({ r, d: await r.json().catch(() => ({})) }))
      .then(({ r, d }) => {
        if (!alive) return;
        if (r.status === 403) { setAvailable(false); return; }
        if (!d.ok) throw new Error(d.error || "No se pudieron cargar los tutores");
        setGuardians(d.data.guardians ?? []);
        setRelaciones(d.data.relaciones ?? Object.keys(RELACION_LABEL));
        setContratoCompleto(!!d.data.contratoCompleto);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [clientId]);

  useEffect(() => load(), [load]);

  function abrirEdicion() {
    // Se edita sobre una COPIA: cancelar tiene que dejar la lista como estaba.
    setBorrador(guardians.map((g) => ({ ...g })));
    setError(null);
    setEditando(true);
  }

  const set = (i, k, v) => setBorrador((b) => b.map((g, idx) => (idx === i ? { ...g, [k]: v } : g)));

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/guardians`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Se mandan los `id` existentes tal cual: las firmas del contrato
        // apuntan a ellos y perderlos sería perder la firma.
        body: JSON.stringify({ guardians: borrador.filter((g) => (g.name || "").trim()) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "No se pudo guardar");
      setEditando(false);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (loading || !available) return null;

  const inputCls = "w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm";
  const labelCls = "block text-xs font-medium text-gray-600 mb-1";
  const firmantes = guardians.filter((g) => g.signer);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6 max-w-5xl">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
        <span className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5">
          Padres y tutores
          <HelpTooltip title="Padres y tutores" placement="bottom">
            Quién puede entrar al área privada de esta familia y quién tiene que firmar. No es
            decorativo:{" "}
            <strong className="text-white">sin tutores aquí, nadie puede firmar el contrato desde
            el portal</strong>, y con él la documentación queda cerrada.
            {" "}
            Si pones dos —padres separados, por ejemplo— hacen falta las firmas de los DOS para
            que se abra.
          </HelpTooltip>
        </span>
        {!editando && (
          <button onClick={abrirEdicion} className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg">
            Editar
          </button>
        )}
      </div>

      <div className="p-5 space-y-4">
        {!editando ? (
          <>
            {guardians.length === 0 ? (
              <div className="text-sm text-gray-400 italic">
                Sin tutores. Mientras no haya ninguno, el contrato del portal lo firma el titular de la ficha.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {guardians.map((g) => (
                  <li key={g.id} className="py-2.5 flex items-start gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-gray-800">
                        {g.name}
                        <span className="ml-2 text-xs font-normal text-gray-500">
                          {RELACION_LABEL[g.relationship] ?? g.relationship}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 [overflow-wrap:anywhere]">
                        {g.email && <span>{g.email}</span>}
                        {g.phone && <span>{g.phone}</span>}
                        {g.dni && <span>DNI {g.dni}</span>}
                      </div>
                    </div>
                    <div className="text-[11px] shrink-0">
                      {!g.signer ? (
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">No firma</span>
                      ) : g.firmadoEl ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                          Firmó el {fmtFecha(g.firmadoEl)}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">Pendiente de firma</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {firmantes.length > 0 && (
              <div className="text-xs text-gray-500 pt-1">
                {contratoCompleto
                  ? "Contrato firmado por todos los tutores: la familia ya ve su documentación en el portal."
                  : "Hasta que firmen todos, la documentación del paciente sigue cerrada en el portal."}
              </div>
            )}
            {error && <div className="text-xs text-rose-600">{error}</div>}
          </>
        ) : (
          <>
            {borrador.map((g, i) => (
              <div key={g.id ?? `nuevo-${i}`} className="rounded-lg border border-gray-200 p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Nombre y apellidos *</label>
                    <input className={inputCls} value={g.name} onChange={(e) => set(i, "name", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Relación</label>
                    <select className={inputCls} value={g.relationship} onChange={(e) => set(i, "relationship", e.target.value)}>
                      {relaciones.map((r) => (
                        <option key={r} value={r}>{RELACION_LABEL[r] ?? r}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Email (es su acceso al portal)</label>
                    <input className={inputCls} value={g.email ?? ""} onChange={(e) => set(i, "email", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Teléfono</label>
                    <input className={inputCls} value={g.phone ?? ""} onChange={(e) => set(i, "phone", e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>DNI</label>
                    <input className={inputCls} value={g.dni ?? ""} onChange={(e) => set(i, "dni", e.target.value)} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={g.signer !== false}
                      onChange={(e) => set(i, "signer", e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 accent-[var(--color-primary)]"
                    />
                    Tiene que firmar el contrato
                  </label>
                  <button
                    onClick={() => setBorrador((b) => b.filter((_, idx) => idx !== i))}
                    className="text-xs text-rose-500 hover:text-rose-700"
                  >
                    Quitar
                  </button>
                </div>
                {g.firmadoEl && (
                  <div className="text-[11px] text-gray-400">
                    Firmó el contrato el {fmtFecha(g.firmadoEl)}. Si lo quitas de la lista, esa firma deja de contar.
                  </div>
                )}
              </div>
            ))}

            {borrador.length < 6 && (
              <button
                onClick={() => setBorrador((b) => [...b, { ...NUEVO }])}
                className="text-sm font-medium text-[var(--color-primary)] hover:underline"
              >
                + Añadir tutor
              </button>
            )}

            {error && <div className="text-xs text-rose-600">{error}</div>}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={guardar}
                disabled={guardando}
                className="text-sm font-medium px-3 py-1.5 rounded-md bg-[var(--color-primary)] text-white disabled:opacity-40"
              >
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              <button onClick={() => { setEditando(false); setError(null); }} className="text-sm text-gray-500">
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
