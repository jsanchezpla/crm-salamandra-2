"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";

const MONTHS = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function pctLevel(pct) {
  if (pct == null) return "gray";
  if (pct >= 90) return "green";
  if (pct >= 75) return "amber";
  return "red";
}
const SC = {
  green: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  amber: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  red: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
  gray: { bg: "bg-neutral-100", text: "text-neutral-400", dot: "bg-neutral-300" },
};

export default function ProductividadPage() {
  const [period, setPeriod] = useState(""); // "YYYY-MM"; "" = mes actual (lo fija el server)
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hoursEdit, setHoursEdit] = useState({}); // therapistId → string
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Últimos 6 meses como opciones del selector.
  const periodOptions = useMemo(() => {
    const now = new Date();
    const opts = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      opts.push({ value, label: `${MONTHS[d.getMonth() + 1]} ${d.getFullYear()}` });
    }
    return opts;
  }, []);

  // Secuencia de peticiones: al cambiar rápido de mes, una respuesta antigua
  // que llegue tarde no debe pisar la del mes seleccionado (ni machacar las
  // horas que el admin esté editando).
  const seq = useRef(0);
  // useCallback con [period] para poder declararlo como dependencia del efecto:
  // `load` solo lee `period` (va en la URL); lo demás son setters y un ref, que
  // son estables. Antes se silenciaba el aviso con un comentario mal colocado que
  // no silenciaba nada.
  const load = useCallback(() => {
    const mySeq = ++seq.current;
    setLoading(true);
    setErrorMsg(null);
    const qs = period ? `?period=${period}` : "";
    fetch(`/api/clinica/productividad${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (mySeq !== seq.current) return; // respuesta obsoleta
        if (j.ok) {
          setData(j.data);
          const init = {};
          for (const r of j.data.rows) init[r.therapistId] = r.weeklyDirectHours == null ? "" : String(r.weeklyDirectHours);
          setHoursEdit(init);
          setMsg(null);
        } else setErrorMsg(j.error);
      })
      .catch((e) => { if (mySeq === seq.current) setErrorMsg(e.message); })
      .finally(() => { if (mySeq === seq.current) setLoading(false); });
  }, [period]);
  useEffect(() => { load(); }, [load]);

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? {};

  // ¿Hay cambios en horas/semana pendientes de guardar?
  const dirty = rows.some((r) => (hoursEdit[r.therapistId] ?? "") !== (r.weeklyDirectHours == null ? "" : String(r.weeklyDirectHours)));

  const saveHours = async () => {
    setBusy(true); setErrorMsg(null); setMsg(null);
    try {
      const hours = {};
      for (const r of rows) {
        const v = hoursEdit[r.therapistId] ?? "";
        hours[r.therapistId] = v === "" ? null : Number(v);
      }
      const res = await fetch("/api/clinica/productividad/hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "No se pudo guardar");
      setMsg("Horas guardadas. Productividad recalculada.");
      load();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      <Link href="/equipo" className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] transition-colors w-fit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Volver a Equipo
      </Link>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Equipo · Productividad</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">Productividad del equipo</h1>
          <p className="text-xs text-neutral-400 mt-1">
            % de horas de intervención directa (citas atendidas) sobre las disponibles del mes.
          </p>
        </div>
        <Select
          value={period || (data?.period?.value ?? "")}
          onChange={setPeriod}
          options={periodOptions}
          className="self-start lg:self-auto text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 cursor-pointer"
        />
      </div>

      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}

      {/* Totales */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="bg-white border border-neutral-100 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Productividad media</div>
          <div className="font-display text-2xl text-[var(--ink-900)] mt-1 tabular">{loading ? "—" : totals.teamPct != null ? `${totals.teamPct}%` : "N/D"}</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">Equipo · con objetivo fijado</div>
        </div>
        <div className="bg-white border border-neutral-100 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Horas directas</div>
          <div className="font-display text-2xl text-[var(--ink-900)] mt-1 tabular">{loading ? "—" : `${totals.totalDirectHours ?? 0} h`}</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">Citas atendidas del mes</div>
        </div>
        <div className="bg-white border border-neutral-100 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Objetivo configurado</div>
          <div className="font-display text-2xl text-[var(--ink-900)] mt-1 tabular">{loading ? "—" : `${totals.configuredCount ?? 0}/${totals.memberCount ?? 0}`}</div>
          <div className="text-[11px] text-neutral-500 mt-0.5">Profesionales con horas/semana</div>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="px-4 lg:px-5 py-3 flex items-center justify-between border-b border-neutral-100">
          <h2 className="eyebrow">Por profesional</h2>
          <span className="text-[10px] text-neutral-400">Ordenado por productividad</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-neutral-50/50">
              <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-400">
                <th className="px-4 py-2 font-medium">Profesional</th>
                <th className="px-4 py-2 font-medium tabular text-right">Horas directas</th>
                <th className="px-4 py-2 font-medium tabular text-right">Disponibles</th>
                <th className="px-4 py-2 font-medium tabular text-right">
                  Productividad
                  <HelpTooltip title="Productividad" className="ml-1">
                    En el mes en curso también cuentan las citas ya agendadas que aún no se han
                    dado.{" "}
                    <strong className="text-white">
                      Y las horas disponibles son todos los lunes a viernes del mes: no se
                      descuentan festivos, vacaciones ni bajas.
                    </strong>{" "}
                    Un mes con puente o con vacaciones sale más bajo sin que nadie haya trabajado
                    menos.
                  </HelpTooltip>
                </th>
                <th className="px-4 py-2 font-medium tabular text-right">Horas/semana</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="px-4 py-10 text-center text-neutral-400">Cargando…</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-neutral-400">Sin profesionales activos.</td></tr>}
              {!loading && rows.map((r) => {
                const c = SC[pctLevel(r.pct)];
                return (
                  <tr key={r.therapistId} className="border-t border-neutral-100 hover:bg-neutral-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-display" style={{ backgroundColor: r.color }}>
                          {(r.name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <div>
                          <div className="text-[var(--ink-900)] font-medium leading-tight">{r.name}</div>
                          <div className="text-[10px] text-neutral-400">{r.position}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular text-neutral-700">{r.directHours} h</td>
                    <td className="px-4 py-3 text-right tabular text-neutral-500">{r.availableHours != null ? `${r.availableHours} h` : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {r.pct != null ? (
                        <span className={`inline-flex items-center gap-1.5 ${c.bg} ${c.text} text-[11px] font-medium px-2 py-0.5 rounded-full tabular`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />{r.pct}%
                        </span>
                      ) : (
                        <span className="text-neutral-300 text-[11px]">N/D</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number" min={0} max={80}
                        value={hoursEdit[r.therapistId] ?? ""}
                        onChange={(e) => setHoursEdit((h) => ({ ...h, [r.therapistId]: e.target.value }))}
                        className="w-16 px-2 py-1 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 tabular text-right"
                        placeholder="—"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 lg:px-5 py-3 border-t border-neutral-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-neutral-50/40">
          <span className="text-[11px] text-neutral-500">
            Disponibles = horas/semana ÷ 5 × días laborables del mes. Fija las horas de cada profesional y guarda.
          </span>
          <div className="flex items-center gap-2">
            {msg && <span className="text-[11px] text-emerald-600">{msg}</span>}
            <button
              disabled={busy || !dirty}
              onClick={saveHours}
              className="text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ background: "var(--color-primary, #1B3A2D)" }}
            >
              {busy ? "Guardando…" : "Guardar horas"}
            </button>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-neutral-400 leading-relaxed">
        Las horas directas cuentan las citas del calendario en estado confirmada o completada asignadas a cada
        profesional. Esta productividad alimenta el complemento de <strong>ocupación</strong> del incentivo:
        en el editor de evaluación puedes traerla con un clic.
      </p>
    </div>
  );
}
