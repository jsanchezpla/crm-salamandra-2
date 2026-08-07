"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * PanelVacaciones — «Vacaciones» y ausencias del equipo (06/08/2026, Rodrigo).
 *
 * Rodrigo lo pidió como «un tipo de cita especial que no requiere paciente,
 * con fecha y hora de inicio y de fin, asignado a un miembro del equipo». Vive
 * en la pantalla de Tipos de cita porque es donde va a buscarlo, aunque por
 * dentro no sea una cita (el porqué, en `models/tenant/TeamBlock.model.js`).
 *
 * Solo lo ve y lo toca ADMIN: bloquear la agenda de otra persona es una
 * decisión de dirección. El endpoint lo comprueba también, no solo la pantalla.
 */

/*
 * La hora se manda PARTIDA (fecha + hora) y la interpreta el servidor como hora
 * de Madrid. Antes se mandaba "2026-08-17T07:00:00" de una pieza y sin zona:
 * el servidor de producción va en UTC, así que «de 7 a 9» se guardaba como «de
 * 9 a 11» de Madrid. En local no se veía, porque aquí el reloj ya es de Madrid.
 *
 * Se sigue mandando también el ISO suelto por si una versión vieja de la
 * pantalla se queda abierta; el servidor prefiere la forma partida.
 */
function iso(fecha, hora) {
  if (!fecha) return null;
  return `${fecha}T${hora || "00:00"}:00`;
}

/** "2026-08-10T09:00:00.000Z" → "10 ago, 11:00" en hora de Madrid. */
function bonito(valor) {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Madrid",
  });
}

const HOY = () => new Date().toISOString().slice(0, 10);

export default function PanelVacaciones({ esAdmin }) {
  const [bloqueos, setBloqueos] = useState([]);
  const [equipo, setEquipo] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [form, setForm] = useState({
    teamMemberId: "", label: "Vacaciones",
    fechaIni: "", horaIni: "00:00", fechaFin: "", horaFin: "23:59",
  });

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      // Desde hoy: lo que ya pasó no ayuda a nadie y la lista se llenaría sola.
      const desde = new Date(`${HOY()}T00:00:00`).toISOString();
      const hasta = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
      const res = await fetch(`/api/citas/bloqueos?from=${desde}&to=${hasta}`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setBloqueos(json.data.bloqueos ?? []);
    } catch { /* la lista se queda como estaba */ }
    setCargando(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    let vivo = true;
    fetch("/api/team?status=active&limit=200", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo && j?.data?.members) setEquipo(j.data.members); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  async function crear() {
    setFallo(null);
    setAviso(null);
    const fechaFin = form.fechaFin || form.fechaIni;
    const startAt = iso(form.fechaIni, form.horaIni);
    const endAt = iso(fechaFin, form.horaFin);
    if (!startAt || !endAt) { setFallo("Pon al menos la fecha de inicio"); return; }
    if (new Date(endAt) <= new Date(startAt)) { setFallo("El final tiene que ser posterior al inicio"); return; }

    setGuardando(true);
    try {
      const res = await fetch("/api/citas/bloqueos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamMemberId: form.teamMemberId || null,
          label: form.label || "Vacaciones",
          startDate: form.fechaIni,
          startTime: form.horaIni || "00:00",
          endDate: fechaFin,
          endTime: form.horaFin || "23:59",
          startAt, endAt,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se ha podido guardar");
      // Las citas que ya estaban dentro NO se cancelan: se avisa y decide el centro.
      if (json.data?.citasDentro > 0) {
        setAviso(`Bloqueado. Ojo: hay ${json.data.citasDentro} cita(s) ya puestas dentro de ese tramo; no se han tocado.`);
      } else {
        setAviso("Bloqueado.");
      }
      setAbierto(false);
      setForm((f) => ({ ...f, fechaIni: "", fechaFin: "" }));
      cargar();
    } catch (e) {
      setFallo(e.message);
    }
    setGuardando(false);
  }

  async function quitar(id) {
    setFallo(null);
    try {
      const res = await fetch(`/api/citas/bloqueos?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("No se ha podido quitar");
      setBloqueos((b) => b.filter((x) => x.id !== id));
    } catch (e) {
      setFallo(e.message);
    }
  }

  if (!esAdmin) return null;

  return (
    <section className="mt-8 border border-[var(--ink-200)] rounded-xl overflow-hidden">
      <header className="px-4 lg:px-5 py-3.5 bg-neutral-50/70 border-b border-[var(--ink-200)] flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink-900)]">Vacaciones y ausencias</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            Tramos en los que alguien no pasa consulta. La agenda deja de ofrecer sus huecos;
            las citas que ya hubiera dentro no se tocan.
          </p>
        </div>
        <button
          onClick={() => { setAbierto((v) => !v); setFallo(null); }}
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#0F0F0F] text-white hover:bg-[#222] transition-colors shrink-0"
        >
          {abierto ? "Cancelar" : "Bloquear un tramo"}
        </button>
      </header>

      {abierto && (
        <div className="px-4 lg:px-5 py-4 border-b border-[var(--ink-200)] bg-white">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs">
              <span className="block text-neutral-500 mb-1">Quién</span>
              <select
                value={form.teamMemberId}
                onChange={(e) => setForm((f) => ({ ...f, teamMemberId: e.target.value }))}
                className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-sm bg-white"
              >
                <option value="">Todo el centro</option>
                {equipo.map((m) => (
                  <option key={m.id} value={m.id}>{m.displayName || m.email}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-neutral-500 mb-1">Motivo</span>
              <input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Vacaciones"
                className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="block text-neutral-500 mb-1">Desde</span>
              <div className="flex gap-1.5">
                <input type="date" value={form.fechaIni}
                  onChange={(e) => setForm((f) => ({ ...f, fechaIni: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-sm" />
                <input type="time" value={form.horaIni}
                  onChange={(e) => setForm((f) => ({ ...f, horaIni: e.target.value }))}
                  className="w-24 border border-neutral-200 rounded-md px-2 py-1.5 text-sm" />
              </div>
            </label>
            <label className="text-xs">
              <span className="block text-neutral-500 mb-1">Hasta</span>
              <div className="flex gap-1.5">
                <input type="date" value={form.fechaFin} min={form.fechaIni || undefined}
                  onChange={(e) => setForm((f) => ({ ...f, fechaFin: e.target.value }))}
                  className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-sm" />
                <input type="time" value={form.horaFin}
                  onChange={(e) => setForm((f) => ({ ...f, horaFin: e.target.value }))}
                  className="w-24 border border-neutral-200 rounded-md px-2 py-1.5 text-sm" />
              </div>
            </label>
          </div>
          <p className="text-[11px] text-neutral-400 mt-2">
            Si dejas «Hasta» vacío se bloquea solo el día de inicio. Un día entero es de 00:00 a 23:59.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={crear}
              disabled={guardando}
              className="text-xs px-3 py-1.5 rounded-md bg-[#0F0F0F] text-white hover:bg-[#222] disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Bloquear"}
            </button>
            {fallo && <span className="text-xs text-red-600">{fallo}</span>}
          </div>
        </div>
      )}

      {aviso && !abierto && (
        <p className="px-4 lg:px-5 py-2.5 text-xs text-emerald-800 bg-emerald-50 border-b border-emerald-100">{aviso}</p>
      )}

      <div className="divide-y divide-[var(--ink-100)]">
        {cargando && <p className="px-4 lg:px-5 py-4 text-xs text-neutral-400">Cargando…</p>}
        {!cargando && bloqueos.length === 0 && (
          <p className="px-4 lg:px-5 py-4 text-xs text-neutral-400">
            No hay ningún tramo bloqueado por delante.
          </p>
        )}
        {bloqueos.map((b) => (
          <div key={b.id} className="px-4 lg:px-5 py-3 flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium text-[var(--ink-900)] truncate">
                {b.label}
                <span className="font-normal text-neutral-500">
                  {" · "}{b.teamMemberName || "Todo el centro"}
                </span>
              </p>
              <p className="text-xs text-neutral-500">
                {bonito(b.startAt)} → {bonito(b.endAt)}
              </p>
            </div>
            <button
              onClick={() => quitar(b.id)}
              className="text-xs px-2.5 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50 shrink-0"
            >
              Quitar
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
