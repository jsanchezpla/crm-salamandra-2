"use client";

/**
 * /clinica/diagnosticos — los pacientes en diagnóstico (12/09/2026, Rodrigo
 * con Isa, Aumenta).
 *
 * Un diagnóstico es un producto cerrado de horas —simple: 10 h (1 de
 * entrevista + 9); completo: 20 h (1 + 19)— con un terapeuta asignado y una
 * barra 0→10 o 0→20 que se CUENTA desde las citas, nunca un contador guardado
 * (`lib/clinica/diagnostico.js`). Esta pantalla es la lista: una fila por
 * expediente con su paciente, su producto, quién lo lleva, la barra y los
 * botones que toquen según el estado.
 *
 * ── EL FLUJO, EN BOTONES ───────────────────────────────────────────────────
 *   «Nuevo diagnóstico»          paciente + producto + terapeuta → `entrevista`
 *   «Abrir entrevista inicial»   a la agenda con la cita preparada (tipo
 *                                DIAGNÓSTICO, 60 min, sin coste todavía)
 *   «Parar» / «Seguir»           solo dirección o quien lleve Facturación:
 *                                parar apunta el cobro de la entrevista (50 €);
 *                                seguir da un bono sin tope y el cobro del
 *                                producto (350 / 650 €, con la entrevista ya
 *                                cobrada descontada). La confirmación dice el
 *                                importe que va a nacer, calculado por el
 *                                servidor con la misma regla que lo apuntará.
 *   «Añadir horas»               a la agenda con la cita del bono; apagado si
 *                                no quedan horas (la agenda daría 422)
 *   «Desbloquear horas»          sube el tope, de media en media, auditado
 *   «Cerrar»                     a mano
 *   «Expediente»                 la ficha del expediente: registros de
 *                                diagnóstico por fecha, citas e informe
 *                                (segunda entrega, 12/09/2026)
 *   «Informe»                    el informe de valoración, cuando ya existe
 *
 * Qué botones salen lo decide LA FILA de la API (`acciones`, cruzado con
 * estado y permiso); aquí solo se pintan y se confirman. Las confirmaciones y
 * las llamadas viven en `useAccionesDeDiagnostico`, el mismo hook que usa la
 * ficha. Lo ve todo el equipo con `clinica`; crear expediente, cualquiera del
 * equipo.
 *
 * ── «EMPEZAR DESDE LO QUE YA HAY» ──────────────────────────────────────────
 * Debajo de la lista, plegado, el bloque de candidatos
 * (`CandidatosDiagnostico`): los pacientes con citas de diagnóstico o
 * entrevista inicial hecha y sin expediente. Su «Abrir expediente» abre el
 * panel de alta con el paciente fijo, el terapeuta sugerido y la casilla de
 * meter dentro lo que ya hay; al crear, se va a la ficha del expediente.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import DiagnosticoFila from "@/components/clinica/DiagnosticoFila.jsx";
import { LeyendaDeHoras } from "@/components/clinica/BarraDeHoras.jsx";
import NuevoDiagnosticoPanel from "@/components/clinica/NuevoDiagnosticoPanel.jsx";
import CandidatosDiagnostico from "@/components/clinica/CandidatosDiagnostico.jsx";
import { useAccionesDeDiagnostico } from "@/components/clinica/useAccionesDeDiagnostico.js";
import { anchoPantalla } from "@/components/layout/anchoPantalla.js";
import { coincidePorNombre } from "@/lib/utils/busqueda.js";

const FILTROS = [
  { key: "en_curso", label: "En curso" },
  { key: "cerrado", label: "Cerrados" },
  { key: "todos", label: "Todos" },
];

export default function DiagnosticosPage() {
  const router = useRouter();
  const [filtro, setFiltro] = useState("en_curso");
  const [mios, setMios] = useState(false);
  const [busca, setBusca] = useState("");
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);
  // null = cerrado; {} = alta normal; { candidato } = desde «Empezar desde lo que ya hay».
  const [panel, setPanel] = useState(null);
  // Si quien mira tiene acceso a Citas: sin él, los enlaces a la agenda darían 403.
  const [tieneCitas, setTieneCitas] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(null);
    try {
      const q = new URLSearchParams({ estado: filtro });
      if (mios) q.set("mios", "1");
      const r = await fetch(`/api/clinica/diagnosticos?${q}`, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "No se pudieron cargar los diagnósticos");
      setData(j.data);
    } catch (e) {
      setErrorCarga(e.message);
    } finally {
      setCargando(false);
    }
  }, [filtro, mios]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j?.ok) setTieneCitas((j.data?.enabledModules ?? []).includes("citas")); })
      .catch(() => {});
  }, []);

  /** Sustituye una fila por la que devuelve la API, sin recargar la lista entera. */
  const reemplazar = useCallback(
    (fila) => setData((d) => (d ? { ...d, expedientes: d.expedientes.map((e) => (e.id === fila.id ? fila : e)) } : d)),
    []
  );

  const acciones = useAccionesDeDiagnostico({ cobroEntrevista: data?.cobroEntrevista ?? null, reemplazar, recargar: cargar });
  const { flash } = acciones;
  const errorMsg = errorCarga ?? acciones.errorMsg;

  // Memorizado para que el buscador de abajo no se recalcule en cada render.
  const expedientes = useMemo(() => data?.expedientes ?? [], [data]);
  const visibles = useMemo(
    () => expedientes.filter((e) => coincidePorNombre(busca, [e.paciente?.nombre, e.producto?.nombre, e.terapeuta?.nombre])),
    [expedientes, busca]
  );

  // Por qué no se puede ir a la agenda desde aquí, si es que no se puede.
  const motivoSinAgenda = !data
    ? null
    : !tieneCitas
      ? "No tienes acceso al módulo de Citas: pide a dirección que abra la cita"
      : !data.tipoDiagnostico
        ? "Este centro no tiene un tipo de cita DIAGNÓSTICO: créalo en Citas → Tipos de cita"
        : null;

  const abiertos = expedientes.filter((e) => e.abierto).length;

  return (
    <div className={`${anchoPantalla("listado")} space-y-5`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Clínica · Diagnósticos</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">
            Diagnósticos
            <HelpTooltip title="Qué es un diagnóstico" className="ml-2">
              Un producto cerrado de horas —simple, 10 h; completo, 20 h— con un terapeuta asignado. La barra
              se cuenta desde las citas: la entrevista inicial vale una hora, cada sesión lo que dure, y las
              citas futuras reservan. Al parar se cobra la entrevista; al seguir, el producto entero con un
              bono sin tope. Cuando se acaban las horas, dirección las desbloquea desde aquí. Cada expediente
              tiene su ficha con los registros de diagnóstico por fecha y el informe que los une.
            </HelpTooltip>
          </h1>
          <p className="text-xs text-neutral-400 mt-1">
            {cargando && !data
              ? "Cargando…"
              : filtro === "en_curso"
                ? `${abiertos} ${abiertos === 1 ? "diagnóstico abierto" : "diagnósticos abiertos"}${mios ? " que llevas tú" : ""}`
                : `${expedientes.length} ${expedientes.length === 1 ? "diagnóstico" : "diagnósticos"}${mios ? " que llevas tú" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start lg:self-auto">
          <Link href="/clinica" className="text-xs font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors">← Clínica</Link>
          <button
            onClick={() => setPanel({})}
            disabled={!!data?.sinMigrar}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity disabled:opacity-40"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            Nuevo diagnóstico
          </button>
        </div>
      </div>

      {data?.sinMigrar && (
        <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
          Los diagnósticos aún no están disponibles en este centro. Avisa a Salamandra.
        </div>
      )}
      {data && !data.sinMigrar && !data.tipoDiagnostico && (
        <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
          Este centro no tiene un tipo de cita <strong>DIAGNÓSTICO</strong> (nombre que empiece por «DIAGN» y con
          informe «Diagnóstico»). Sin él se pueden abrir expedientes, pero no la entrevista ni las horas desde
          aquí: créalo en <Link href="/citas/tipos" className="underline">Citas → Tipos de cita</Link>.
        </div>
      )}
      {errorMsg && <div className="px-4 py-3 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{errorMsg}</div>}
      {acciones.okMsg && <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-100 text-xs text-emerald-700">{acciones.okMsg}</div>}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFiltro(f.key)}
              className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors ${filtro === f.key ? "text-white" : "bg-white border border-neutral-200 text-neutral-600 hover:border-neutral-300"}`}
              style={filtro === f.key ? { background: "var(--color-primary, #1B3A2D)" } : undefined}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="sm:ml-auto flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-neutral-600 cursor-pointer select-none" title="Solo los diagnósticos cuyo terapeuta asignado eres tú">
            <input
              type="checkbox"
              checked={mios}
              onChange={(e) => setMios(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-neutral-300 accent-[var(--color-primary,#1B3A2D)]"
            />
            Mis pacientes
          </label>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por paciente, producto o terapeuta…"
            aria-label="Buscar diagnósticos"
            className="text-xs border border-neutral-200 rounded-lg px-3 py-2 bg-white hover:border-neutral-300 focus:outline-none focus:border-neutral-400 w-64"
          />
        </div>
      </div>

      {mios && data?.sinFichaDeEquipo && (
        <p className="text-[11px] text-neutral-400">
          No tienes ficha en el equipo, así que ningún diagnóstico puede estar asignado a ti. Quita «Mis pacientes» para verlos todos.
        </p>
      )}

      <div className="bg-white border border-neutral-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1040px]">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[11px] uppercase tracking-wide text-neutral-400">
                <th className="px-4 py-3 font-medium">Paciente</th>
                <th className="px-4 py-3 font-medium">Producto</th>
                <th className="px-4 py-3 font-medium">Terapeuta</th>
                <th className="px-4 py-3 font-medium">Horas</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cargando && expedientes.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-xs text-neutral-400">Cargando…</td></tr>
              )}
              {!cargando && visibles.length === 0 && (
                <tr><td colSpan={6} className="text-center py-12 text-xs text-neutral-400">
                  {expedientes.length
                    ? "Ningún diagnóstico casa con esa búsqueda."
                    : filtro === "en_curso"
                      ? mios
                        ? "No llevas ningún diagnóstico abierto."
                        : "No hay diagnósticos abiertos. Abre el primero con «Nuevo diagnóstico»."
                      : "Todavía no hay diagnósticos cerrados."}
                </td></tr>
              )}
              {visibles.map((e) => (
                <DiagnosticoFila
                  key={e.id}
                  expediente={e}
                  equipo={data?.equipo ?? []}
                  motivoSinAgenda={motivoSinAgenda}
                  ocupado={acciones.ocupadoId === e.id}
                  onCambiarTerapeuta={acciones.cambiarTerapeuta}
                  onParar={acciones.parar}
                  onSeguir={acciones.seguir}
                  onDesbloquear={acciones.desbloquear}
                  onCerrar={acciones.cerrar}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-neutral-100 bg-neutral-50/50">
          <LeyendaDeHoras />
        </div>
      </div>

      {data && !data.sinMigrar && (
        <CandidatosDiagnostico
          deshabilitado={!!panel}
          onAbrirExpediente={(candidato) => setPanel({ candidato })}
        />
      )}

      {panel && (
        <NuevoDiagnosticoPanel
          productos={data?.productos ?? []}
          equipo={data?.equipo ?? []}
          pacienteFijo={panel.candidato?.paciente ? { ...panel.candidato.paciente, clientId: panel.candidato.clientId } : null}
          terapeutaSugerido={panel.candidato?.terapeutaSugerido?.id ?? null}
          adopcion={panel.candidato ? { resumen: panel.candidato.resumen, adoptar: panel.candidato.adoptar } : null}
          onClose={() => setPanel(null)}
          onCreado={async (d) => {
            const desdeCandidato = Boolean(panel.candidato);
            setPanel(null);
            // Desde «Empezar desde lo que ya hay» se va al expediente recién
            // abierto: lo que se quiere ver es qué ha entrado dentro.
            if (desdeCandidato && d.expediente?.id) {
              router.push(`/clinica/diagnosticos/${d.expediente.id}`);
              return;
            }
            if (filtro === "cerrado") setFiltro("en_curso");
            else await cargar();
            flash(
              `Diagnóstico abierto para ${d.expediente?.paciente?.nombre ?? "el paciente"}${d.avisos?.length ? ` · ${d.avisos.join(" ")}` : ""}`
            );
          }}
        />
      )}

      {acciones.dialogo}
    </div>
  );
}
