"use client";

/**
 * Citas sin profesional — la cola de lo que hay que asignar.
 *
 * Sale de la migración de Aumenta (Rodrigo, 02/08/2026): 1.827 de las 12.030
 * citas importadas vinieron sin profesional, porque en Organízate estaban a
 * nombre de «NADIE» o de alguien que ya no está en el centro.
 *
 * Dos decisiones de la pantalla:
 *
 * · Se agrupan por DEPARTAMENTO, que es lo que pidió Rodrigo. El departamento no
 *   está guardado en ningún sitio: se deduce del tipo de cita («CUOTA LOGOPEDIA
 *   45» → logopedia). Eso permite ofrecer solo a las profesionales de esa
 *   especialidad al asignar, en vez de las quince.
 * · Se asigna EN BLOQUE. Son casi dos mil: de una en una no lo haría nadie.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const inputCls =
  "rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

const DEPTO_LABEL = {
  logopedia: "Logopedia",
  psicologia: "Psicología",
  neuropsicologia: "Neuropsicología",
  pedagogia: "Pedagogía",
  terapia_ocupacional: "Terapia ocupacional",
  fisioterapia: "Fisioterapia",
  habilidades_sociales: "Habilidades sociales",
  "(sin departamento)": "Sin departamento",
};

const fmt = (iso) =>
  new Date(iso).toLocaleString("es-ES", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

export default function CitasSinProfesionalPage() {
  const [citas, setCitas] = useState([]);
  const [porDepto, setPorDepto] = useState({});
  const [total, setTotal] = useState(0);
  const [equipo, setEquipo] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [aviso, setAviso] = useState(null);

  const [depto, setDepto] = useState("");
  const [incluirPasadas, setIncluirPasadas] = useState(false);
  const [elegidas, setElegidas] = useState(new Set());
  const [aQuien, setAQuien] = useState("");
  const [asignando, setAsignando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams();
      if (depto) qs.set("departamento", depto);
      if (incluirPasadas) qs.set("incluirPasadas", "1");
      const r = await fetch(`/api/citas/sin-profesional?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron cargar las citas");
      setCitas(j.data?.citas ?? []);
      setPorDepto(j.data?.porDepartamento ?? {});
      setTotal(j.data?.total ?? 0);
      setElegidas(new Set());
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setCargando(false);
    }
  }, [depto, incluirPasadas]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    fetch("/api/team?status=active&limit=200", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) setEquipo(j.data?.members ?? []); })
      .catch(() => {});
  }, []);

  function marcar(id) {
    setElegidas((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }
  const todasMarcadas = citas.length > 0 && elegidas.size === citas.length;
  function marcarTodas() {
    setElegidas(todasMarcadas ? new Set() : new Set(citas.map((c) => c.id)));
  }

  async function asignar() {
    if (!aQuien || !elegidas.size) return;
    setAsignando(true);
    setErrorMsg(null);
    setAviso(null);
    try {
      const r = await fetch("/api/citas/sin-profesional", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingIds: [...elegidas], teamMemberId: aQuien }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron asignar");
      setAviso(
        j.data.yaTenian
          ? `Asignadas ${j.data.asignadas}. Otras ${j.data.yaTenian} ya tenían profesional: alguien se adelantó.`
          : `Asignadas ${j.data.asignadas} citas.`
      );
      setAQuien("");
      await cargar();
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setAsignando(false);
    }
  }

  // Al filtrar por departamento se ofrecen SOLO las profesionales de esa
  // especialidad: con quince en plantilla, la lista entera es ruido.
  const equipoOfrecido = depto
    ? equipo.filter((m) => (m.specialties ?? []).includes(depto))
    : equipo;

  return (
    <div className="p-4 lg:p-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-800">Citas sin profesional</h1>
          <p className="text-[12.5px] text-neutral-500 mt-0.5">
            Citas ya reservadas a las que les falta quién las atiende. No es la lista de
            espera de admisión: esa es gente esperando plaza.
          </p>
        </div>
        <Link href="/citas" className="text-[12.5px] text-neutral-500 hover:text-neutral-800">← Volver a la agenda</Link>
      </div>

      {Object.keys(porDepto).length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setDepto("")}
            className={`text-[12px] px-3 py-1.5 rounded-lg border transition ${!depto ? "bg-[var(--color-primary,#1B3A2D)] text-white border-transparent" : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"}`}
          >
            Todas ({total})
          </button>
          {Object.entries(porDepto).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <button
              key={k}
              onClick={() => setDepto(k === "(sin departamento)" ? "" : k)}
              className={`text-[12px] px-3 py-1.5 rounded-lg border transition ${depto === k ? "bg-[var(--color-primary,#1B3A2D)] text-white border-transparent" : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"}`}
            >
              {DEPTO_LABEL[k] ?? k} ({v})
            </button>
          ))}
        </div>
      )}

      <label className="flex items-center gap-2 text-[12.5px] text-neutral-600">
        <input type="checkbox" checked={incluirPasadas} onChange={(e) => setIncluirPasadas(e.target.checked)} />
        Incluir también las citas ya pasadas
        <span className="text-neutral-400">(reasignar una cita de hace meses no suele servir de nada)</span>
      </label>

      {errorMsg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{errorMsg}</div>}
      {aviso && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-800">{aviso}</div>}

      {elegidas.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
          <span className="text-[12.5px] text-neutral-700 font-medium">{elegidas.size} cita(s) elegidas</span>
          <select value={aQuien} onChange={(e) => setAQuien(e.target.value)} className={`${inputCls} max-w-xs`}>
            <option value="">— Asignar a… —</option>
            {equipoOfrecido.map((mm) => <option key={mm.id} value={mm.id}>{mm.name ?? mm.displayName}</option>)}
          </select>
          <button
            onClick={asignar}
            disabled={!aQuien || asignando}
            className="text-[12.5px] px-3 py-1.5 rounded-lg bg-[var(--color-primary,#1B3A2D)] text-white font-medium hover:opacity-90 transition disabled:opacity-40"
          >
            {asignando ? "Asignando…" : "Asignar"}
          </button>
          {depto && equipoOfrecido.length === 0 && (
            <span className="text-[12px] text-amber-700">
              Nadie del equipo tiene «{DEPTO_LABEL[depto] ?? depto}» entre sus especialidades.
            </span>
          )}
        </div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="bg-neutral-50 text-neutral-500">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" checked={todasMarcadas} onChange={marcarTodas} aria-label="Marcar todas" />
                </th>
                <th className="text-left font-medium px-3 py-2">Cuándo</th>
                <th className="text-left font-medium px-3 py-2">Paciente</th>
                <th className="text-left font-medium px-3 py-2">Tipo</th>
                <th className="text-left font-medium px-3 py-2">Departamento</th>
              </tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={5} className="px-3 py-6 text-center text-neutral-400">Cargando…</td></tr>}
              {!cargando && citas.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-neutral-400">
                  No queda ninguna cita sin profesional. Buena señal.
                </td></tr>
              )}
              {!cargando && citas.map((c) => (
                <tr key={c.id} className={`border-t border-neutral-100 ${elegidas.has(c.id) ? "bg-neutral-50" : ""}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={elegidas.has(c.id)} onChange={() => marcar(c.id)} />
                  </td>
                  <td className="px-3 py-2 text-neutral-700 first-letter:uppercase">{fmt(c.cuando)}</td>
                  <td className="px-3 py-2 font-medium text-neutral-800">{c.paciente}</td>
                  <td className="px-3 py-2 text-neutral-500">{c.tipo ?? "—"}</td>
                  <td className="px-3 py-2">
                    {c.departamento
                      ? <span className="text-[11.5px] px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">{DEPTO_LABEL[c.departamento] ?? c.departamento}</span>
                      : <span className="text-neutral-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
