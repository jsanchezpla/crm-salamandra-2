"use client";

/**
 * Lista de espera de ADMISIÓN (sprint Aumenta 2026-07, punto 9).
 *
 * Gente esperando PLAZA en el centro: sin cita y sin fecha, por orden de
 * llegada. No confundir con la «lista de espera» de Citas, que son solicitudes
 * de reserva concretas — por eso esta se llama «de admisión» en todas partes.
 *
 * Cuando entra plaza, «Convertir en cliente» crea la ficha y deja la entrada
 * enlazada: así se puede responder cuánto esperó cada familia.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const VACIO = { name: "", phone: "", email: "", notes: "" };

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function diasEsperando(iso) {
  if (!iso) return null;
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return dias < 1 ? "hoy" : dias === 1 ? "1 día" : `${dias} días`;
}

export default function ListaEsperaClient() {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(VACIO);
  const [creando, setCreando] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/clients/waitlist?status=${status}`, { cache: "no-store" })
      .then(async (r) => ({ r, j: await r.json().catch(() => ({})) }))
      .then(({ r, j }) => {
        if (r.status === 403) throw new Error("Este cliente no tiene el módulo de clientes activo");
        if (!j.ok) throw new Error(j.error || "No se pudo cargar la lista");
        setEntries(j.data.entries ?? []);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => load(), [load]);

  async function crear(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreando(true);
    setError(null);
    try {
      const r = await fetch("/api/clients/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo añadir");
      setForm(VACIO);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreando(false);
    }
  }

  async function accion(id, body, confirmacion) {
    if (confirmacion && !window.confirm(confirmacion)) return;
    setBusy(id);
    setError(null);
    try {
      const r = await fetch(`/api/clients/waitlist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function mover(index, delta) {
    const nuevo = [...entries];
    const destino = index + delta;
    if (destino < 0 || destino >= nuevo.length) return;
    [nuevo[index], nuevo[destino]] = [nuevo[destino], nuevo[index]];
    setEntries(nuevo); // optimista: mover una fila tiene que sentirse instantáneo
    try {
      await fetch("/api/clients/waitlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orden: nuevo.map((e) => e.id) }),
      });
    } catch {
      load();
    }
  }

  const input = "w-full rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-neutral-400";

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="eyebrow">Clientes</div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mt-1">Lista de espera de admisión</h1>
          <p className="text-xs text-neutral-500 mt-1">
            Quien espera plaza en el centro, por orden de llegada. No son solicitudes de cita: eso
            vive en Citas.
          </p>
        </div>
        <div className="flex gap-2">
          {[["active", "En espera"], ["converted", "Ya son clientes"], ["removed", "Salieron"]].map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setStatus(k)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition ${status === k ? "border-transparent text-white" : "bg-white border-neutral-200 text-neutral-500"}`}
              style={status === k ? { background: "var(--color-primary, #1B3A2D)" } : undefined}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {status === "active" && (
        <form onSubmit={crear} className="bg-white border border-neutral-100 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div className="sm:col-span-1">
            <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Nombre *</label>
            <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Teléfono</label>
            <input className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-neutral-400 mb-1">Notas</label>
            <input className={input} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Qué pide, disponibilidad…" />
          </div>
          <button
            type="submit"
            disabled={creando || !form.name.trim()}
            className="text-xs font-medium px-4 py-2 rounded-lg text-white disabled:opacity-40"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            {creando ? "Añadiendo…" : "+ Añadir a la lista"}
          </button>
        </form>
      )}

      {error && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{error}</div>}

      {loading ? (
        <div className="text-sm text-neutral-400">Cargando…</div>
      ) : entries.length === 0 ? (
        <div className="bg-white border border-dashed border-neutral-200 rounded-xl p-10 text-center text-sm text-neutral-600">
          {status === "active" ? "No hay nadie esperando plaza." : "Nada por aquí."}
        </div>
      ) : (
        <div className="bg-white border border-neutral-100 rounded-xl divide-y divide-neutral-50">
          {entries.map((e, i) => (
            <div key={e.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
              <span className="w-7 h-7 rounded-full bg-neutral-100 text-neutral-600 text-xs flex items-center justify-center shrink-0">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-neutral-800">{e.name}</div>
                <div className="text-[11px] text-neutral-500 flex flex-wrap gap-x-3">
                  {e.phone && <span>{e.phone}</span>}
                  {e.email && <span className="break-all">{e.email}</span>}
                  <span>En la lista desde {fmtDate(e.createdAt)} · {diasEsperando(e.createdAt)}</span>
                </div>
                {e.notes && <div className="text-[11px] text-neutral-600 mt-0.5">{e.notes}</div>}
              </div>

              {status === "active" && (
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => mover(i, -1)} disabled={i === 0} className="text-neutral-400 hover:text-neutral-700 disabled:opacity-30 text-xs">↑</button>
                  <button onClick={() => mover(i, 1)} disabled={i === entries.length - 1} className="text-neutral-400 hover:text-neutral-700 disabled:opacity-30 text-xs">↓</button>
                  {/* Quien entró por el alta de clientes YA tiene ficha: ahí
                      lo que falta no es crearla, es darle la plaza. Ofrecer
                      «convertir» solo servía para que la API respondiera 409. */}
                  {e.clientId ? (
                    <button
                      onClick={() => accion(e.id, { status: "converted" }, `¿${e.name} ya tiene plaza?`)}
                      disabled={busy === e.id}
                      className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline disabled:opacity-40"
                    >
                      Ya tiene plaza
                    </button>
                  ) : (
                    <button
                      onClick={() => accion(e.id, { convertir: true }, `¿Crear la ficha de cliente de ${e.name}?`)}
                      disabled={busy === e.id}
                      className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline disabled:opacity-40"
                    >
                      Convertir en cliente
                    </button>
                  )}
                  <button
                    onClick={() => accion(e.id, { status: "removed" }, `¿Sacar a ${e.name} de la lista?`)}
                    disabled={busy === e.id}
                    className="text-[11px] text-rose-500 hover:text-rose-700 disabled:opacity-40"
                  >
                    Quitar
                  </button>
                </div>
              )}

              {e.clientId && (
                <Link href={`/clientes/${e.clientId}`} className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline shrink-0">
                  Ver ficha
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
