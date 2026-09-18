"use client";

/**
 * SelectorDestinatarios — a quién se le pone una cuota (01/09/2026, alta en
 * grupo de la pantalla de Cuotas).
 *
 * Se buscan PACIENTES (que es como los conoce el centro) y de cada uno se
 * arrastra su familia pagadora, que es quien acaba pagando. Sin módulo
 * asistencial no hay pacientes: se cae al selector de fichas de siempre.
 *
 * Vivía dentro de `app/(dashboard)/facturacion/cuotas/page.jsx` y salió aquí el
 * 09/09/2026, cuando la ficha de un tipo de cuota necesitó lo mismo para
 * «agregar pacientes» a esa cuota. Dos buscadores de destinatarios que se
 * comportan distinto es una forma segura de crear cuotas donde no tocan.
 *
 * ── EN BLOQUE (18/09/2026, Aumenta) ────────────────────────────────────────
 * «Seleccionar todos los pacientes en bulk para añadir nuevas cuotas». Uno a
 * uno son 1.174 búsquedas en Aumenta: el alta en grupo existía, pero solo se
 * podía llenar tecleando nombres de diez en diez. El panel «Añadir en bloque»
 * trae a TODOS los que casan con un filtro (estado, especialidad, texto) y los
 * mete de golpe, saltando a quien no tiene familia pagadora —sin ella no se
 * puede cobrar, y añadirlo sería crear una cuota que nadie paga—.
 *
 * El tope es 500 de una tacada: es el mismo que acepta el POST de cuotas, y un
 * número que se puede repasar antes de firmar. Con más, se afina el filtro.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import SelectorCliente from "@/components/clients/SelectorCliente.jsx";
import { SPECIALTIES } from "@/lib/clinica/specialties.js";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

/** Lo máximo que se añade de una vez (el mismo tope que el POST de cuotas). */
export const TOPE_BLOQUE = 500;

/** Cuántos chips se pintan antes de resumir: 300 nombres no se repasan. */
const CHIPS_VISIBLES = 24;

const nombrePaciente = (p) => `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();

export default function SelectorDestinatarios({ valores, onChange, etiqueta = "A quién se le pone esta cuota *" }) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState([]);
  const [hayPacientes, setHayPacientes] = useState(true);
  const [buscando, setBuscando] = useState(false);
  const [enBloque, setEnBloque] = useState(false);

  // El vaciado va DENTRO del temporizador, no en el cuerpo del efecto: un
  // setState sincrono ahi encadena renders (y lo canta el lint).
  useEffect(() => {
    const t = texto.trim();
    const id = setTimeout(() => {
      if (t.length < 2) { setResultados([]); return; }
      setBuscando(true);
      fetch(`/api/pacientes?q=${encodeURIComponent(t)}&limit=10`, { cache: "no-store" })
        .then(async (r) => {
          // Sin modulo asistencial la puerta responde 403: se cae al selector
          // de fichas en vez de dejar el buscador mudo.
          if (r.status === 403) { setHayPacientes(false); return { data: {} }; }
          return r.json();
        })
        .then((j) => setResultados(j?.data?.patients ?? []))
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false));
    }, 250);
    return () => clearTimeout(id);
  }, [texto]);

  function añadir(p) {
    if (!p.clientId) return; // sin familia pagadora no se puede cobrar
    if (valores.some((v) => v.patientId === p.id)) return;
    onChange([...valores, {
      patientId: p.id,
      clientId: p.clientId,
      etiqueta: nombrePaciente(p),
      familia: p.client?.name ?? "",
    }]);
    setTexto("");
    setResultados([]);
  }

  function añadirFamilia(clientId, ficha) {
    if (!clientId || valores.some((v) => v.clientId === clientId && !v.patientId)) return;
    onChange([...valores, { patientId: null, clientId, etiqueta: ficha?.name ?? "Familia", familia: ficha?.name ?? "" }]);
  }

  /**
   * El lote entero de una vez. Se añade lo que NO estaba ya (por paciente, o
   * por ficha cuando no hay pacientes) y se dice cuántos se han saltado: quien
   * pulsa esto tiene que poder contar lo que acaba de meter.
   */
  function añadirLote(nuevos) {
    const yaPaciente = new Set(valores.filter((v) => v.patientId).map((v) => String(v.patientId)));
    const yaFamilia = new Set(valores.filter((v) => !v.patientId).map((v) => String(v.clientId)));
    const entran = nuevos.filter((n) =>
      n.patientId ? !yaPaciente.has(String(n.patientId)) : !yaFamilia.has(String(n.clientId))
    );
    if (entran.length) onChange([...valores, ...entran]);
    return entran.length;
  }

  const visibles = valores.slice(0, CHIPS_VISIBLES);
  const ocultos = valores.length - visibles.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
          {etiqueta}
        </label>
        <button type="button" onClick={() => setEnBloque((v) => !v)}
          className={`px-2 py-1 rounded-lg text-[11px] border transition ${enBloque ? "border-neutral-400 text-neutral-700 bg-neutral-50" : "bg-white border-neutral-200 text-neutral-500 hover:border-neutral-400"}`}>
          {enBloque ? "Cerrar el bloque" : "Añadir en bloque"}
        </button>
      </div>

      {enBloque && (
        <PanelEnBloque hayPacientes={hayPacientes} onAñadir={añadirLote} yaPuestos={valores.length} />
      )}

      {hayPacientes ? (
        <div className="relative">
          <input value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar paciente por nombre…" className={inputCls} />
          {texto.trim().length >= 2 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-neutral-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {buscando && <div className="px-3 py-2 text-xs text-neutral-400">Buscando…</div>}
              {!buscando && resultados.length === 0 && <div className="px-3 py-2 text-xs text-neutral-400">Sin resultados</div>}
              {resultados.map((p) => (
                <button key={p.id} type="button" onClick={() => añadir(p)}
                  disabled={!p.clientId}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed">
                  <span className="text-neutral-800">{p.firstName} {p.lastName}</span>
                  <span className="text-neutral-400"> · {p.client?.name ?? "sin familia pagadora"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <SelectorCliente value="" onChange={añadirFamilia} fuente="billing" className={inputCls}
          placeholder="Buscar familia…" />
      )}

      {valores.length > 0 && (
        <>
          <ul className="flex flex-wrap gap-1.5">
            {visibles.map((v, i) => (
              <li key={`${v.clientId}-${v.patientId ?? "x"}`}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-neutral-100 text-[11px] text-neutral-700">
                {v.etiqueta}
                <button type="button" onClick={() => onChange(valores.filter((_, j) => j !== i))}
                  className="text-neutral-400 hover:text-rose-600">×</button>
              </li>
            ))}
            {/* Con un lote de trescientos no se pintan trescientos chips: se
                dice cuántos quedan y se puede vaciar de un clic. */}
            {ocultos > 0 && (
              <li className="inline-flex items-center px-2 py-1 rounded-full bg-neutral-50 text-[11px] text-neutral-400">
                +{ocultos} más
              </li>
            )}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-neutral-400">
              {valores.length > 1
                ? "Se creará una cuota por cada uno. Quien ya tenga una cuota activa se salta y te lo digo."
                : ""}
            </p>
            {valores.length > 1 && (
              <button type="button" onClick={() => onChange([])}
                className="text-[11px] text-neutral-400 hover:text-rose-600 shrink-0">vaciar la lista</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── El panel de «en bloque» ───────────────────────────────────────────────── */

const ESTADOS = [
  { value: "active", label: "Solo activos" },
  { value: "", label: "Todos los estados" },
  { value: "paused", label: "En pausa" },
  { value: "discharged", label: "De alta (finalizados)" },
];

/**
 * Trae TODOS los que casan con el filtro —paginando hasta el tope— y los mete.
 *
 * Se piden las páginas de 300 (lo máximo que sirve `/api/pacientes`) y se para
 * en `TOPE_BLOQUE`. Lo que se ve antes de pulsar es el recuento REAL del
 * servidor, no el de la primera página: decir «10 pacientes» y añadir 300 sería
 * peor que no decir nada.
 */
function PanelEnBloque({ hayPacientes, onAñadir, yaPuestos }) {
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("active");
  const [especialidad, setEspecialidad] = useState("");
  const [total, setTotal] = useState(null);
  const [muestra, setMuestra] = useState([]);
  const [mirando, setMirando] = useState(false);
  const [trayendo, setTrayendo] = useState(false);
  const [aviso, setAviso] = useState(null);

  const url = useCallback((limite, pagina) => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set(hayPacientes ? "q" : "search", q.trim());
    if (hayPacientes) {
      if (estado) sp.set("status", estado);
      if (especialidad) sp.set("specialty", especialidad);
    }
    sp.set("limit", String(limite));
    sp.set("page", String(pagina));
    return `/api/${hayPacientes ? "pacientes" : "clients"}?${sp.toString()}`;
  }, [q, estado, especialidad, hayPacientes]);

  // El recuento, en cuanto se toca un filtro. Una página de 5 basta para
  // saber el total y enseñar a quién va a coger.
  useEffect(() => {
    const id = setTimeout(() => {
      setMirando(true);
      fetch(url(5, 1), { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (!j?.ok) { setTotal(null); setMuestra([]); return; }
          setTotal(Number(j.data?.total ?? 0));
          setMuestra(hayPacientes ? (j.data?.patients ?? []) : (j.data?.clients ?? []));
        })
        .catch(() => { setTotal(null); setMuestra([]); })
        .finally(() => setMirando(false));
    }, 300);
    return () => clearTimeout(id);
  }, [url, hayPacientes]);

  const pasaDelTope = total != null && total > TOPE_BLOQUE;

  async function traerYAñadir() {
    setTrayendo(true);
    setAviso(null);
    try {
      const porPagina = hayPacientes ? 300 : 200;
      const filas = [];
      for (let pagina = 1; filas.length < TOPE_BLOQUE; pagina += 1) {
        const r = await fetch(url(porPagina, pagina), { cache: "no-store" });
        const j = await r.json();
        if (!j?.ok) throw new Error(j?.error || "No se pudo traer la lista");
        const lote = hayPacientes ? (j.data?.patients ?? []) : (j.data?.clients ?? []);
        filas.push(...lote);
        if (lote.length < porPagina || pagina >= Number(j.data?.pages ?? 1)) break;
      }

      // Sin familia pagadora no se puede cobrar: se quedan fuera y se dice.
      const utiles = [];
      let sinFamilia = 0;
      for (const f of filas.slice(0, TOPE_BLOQUE)) {
        if (hayPacientes) {
          if (!f.clientId) { sinFamilia += 1; continue; }
          utiles.push({ patientId: f.id, clientId: f.clientId, etiqueta: nombrePaciente(f), familia: f.client?.name ?? "" });
        } else {
          utiles.push({ patientId: null, clientId: f.id, etiqueta: f.name ?? "Familia", familia: f.name ?? "" });
        }
      }

      const añadidos = onAñadir(utiles);
      const repetidos = utiles.length - añadidos;
      const partes = [`${añadidos} ${añadidos === 1 ? "añadido" : "añadidos"}`];
      if (repetidos) partes.push(`${repetidos} ya estaban en la lista`);
      if (sinFamilia) partes.push(`${sinFamilia} sin familia pagadora (no se pueden cobrar)`);
      if (total != null && total > TOPE_BLOQUE) partes.push(`hay ${total} en total: afina el filtro para el resto`);
      setAviso(partes.join(" · "));
    } catch (e) {
      setAviso(e.message);
    } finally {
      setTrayendo(false);
    }
  }

  const nombres = useMemo(
    () => muestra.map((f) => (hayPacientes ? nombrePaciente(f) : f.name)).filter(Boolean),
    [muestra, hayPacientes]
  );

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 px-3 py-3 space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder={hayPacientes ? "Filtrar por nombre (opcional)" : "Filtrar por ficha (opcional)"}
          className={inputCls} />
        {hayPacientes && (
          <>
            <select value={estado} onChange={(e) => setEstado(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400">
              {ESTADOS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
            <select value={especialidad} onChange={(e) => setEspecialidad(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400">
              <option value="">Todas las especialidades</option>
              {SPECIALTIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </>
        )}
      </div>

      <p className="text-[11px] text-neutral-500">
        {mirando && "Contando…"}
        {!mirando && total == null && "No se ha podido contar."}
        {!mirando && total != null && (
          <>
            <b className="text-neutral-800">{total}</b> {hayPacientes ? (total === 1 ? "paciente" : "pacientes") : (total === 1 ? "ficha" : "fichas")} con ese filtro
            {nombres.length > 0 && <span className="text-neutral-400"> · {nombres.slice(0, 3).join(", ")}{total > 3 ? "…" : ""}</span>}
          </>
        )}
      </p>

      <div className="flex items-center gap-2">
        <button type="button" onClick={traerYAñadir} disabled={trayendo || !total}
          className="px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wide text-white disabled:opacity-40"
          style={{ background: "var(--color-primary, #1B3A2D)" }}>
          {trayendo ? "Añadiendo…" : `Añadir ${total == null ? "" : Math.min(total, TOPE_BLOQUE)} a la lista`}
        </button>
        {pasaDelTope && (
          <span className="text-[10px] text-amber-700">
            Son más de {TOPE_BLOQUE}: entran los {TOPE_BLOQUE} primeros.
          </span>
        )}
      </div>

      {aviso && <p className="text-[11px] text-neutral-600 bg-white border border-neutral-200 rounded-lg px-2.5 py-1.5">{aviso}</p>}
      {yaPuestos > 0 && <p className="text-[10px] text-neutral-400">Ya hay {yaPuestos} en la lista; esto suma, no reemplaza.</p>}
    </div>
  );
}
