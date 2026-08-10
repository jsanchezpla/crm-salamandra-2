"use client";

/**
 * Registro — lo que falta y lo que ya está.
 *
 * ⚠️ La CARPETA y la ruta siguen llamándose `tablero`: el 10/08/2026 se cambió
 * solo el rótulo, a petición de Jorge. Si algún día se renombra la ruta, hay que
 * mover también `/api/admin/tablero`.
 *
 * POR QUÉ EXISTE (09/08/2026)
 * `docs/backlog.md` y `docs/resuelto.md` son la fuente y están bien, pero nadie
 * entra al repositorio a mirar qué hay que hacer. Esta pantalla los enseña donde
 * Jorge y Rodrigo ya entran. Es para LEER: se escribe en el repo, en el mismo
 * commit que el arreglo, y aquí se ve.
 *
 * DOS PESTAÑAS Y NO DOS PANTALLAS. Lo pendiente y lo resuelto son la misma
 * pregunta mirada desde dos lados —«¿qué le debemos a este cliente?» y «¿qué le
 * hemos entregado?»— y separarlas en dos sitios obligaría a recordar que la
 * segunda existe. Se abre en Pendiente, que es lo que se mira noventa veces de
 * cada cien.
 *
 * El filtro por cliente cruza las dos pestañas a propósito: la pregunta real
 * cuando llama alguien es «¿cómo vamos con Aumenta?», y eso incluye lo hecho.
 */

import { useEffect, useMemo, useState } from "react";

/** Cuánto corre cada bloque, por su título. Lo que no case, en gris. */
const TONOS = [
  { casa: /^P0/i, color: "var(--alerta)", etiqueta: "hoy" },
  { casa: /^P1/i, color: "#B45309", etiqueta: "esta semana" },
  { casa: /^P2/i, color: "var(--dim)", etiqueta: "cuando se pueda" },
  { casa: /^P3/i, color: "var(--tenue)", etiqueta: "deuda" },
  { casa: /decisión|decision/i, color: "var(--ok)", etiqueta: "lo decidís vosotros" },
];

function tonoDe(titulo) {
  return TONOS.find((t) => t.casa.test(titulo)) ?? { color: "var(--tenue)", etiqueta: null };
}

function Etiqueta({ children, color }) {
  return (
    <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: color ?? "var(--tenue)" }}>
      {children}
    </span>
  );
}

export default function TableroPage() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [pestaña, setPestaña] = useState("pendiente");
  const [filtro, setFiltro] = useState("");

  useEffect(() => { document.title = "Registro — Salamandra"; }, []);

  useEffect(() => {
    fetch("/api/admin/tablero", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
        return j.data;
      })
      .then(setDatos)
      .catch((e) => setError(e.message));
  }, []);

  const secciones = datos?.[pestaña] ?? [];

  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return secciones;
    return secciones
      .map((s) => ({
        ...s,
        tareas: s.tareas.filter(
          (t) =>
            (t.quien ?? "").toLowerCase().includes(q) ||
            t.titulo.toLowerCase().includes(q) ||
            t.cuerpo.toLowerCase().includes(q)
        ),
      }))
      .filter((s) => s.tareas.length > 0);
  }, [secciones, filtro]);

  const cuantas = (clave) =>
    (datos?.[clave] ?? []).reduce((n, s) => n + s.tareas.length, 0);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div style={{ fontFamily: "var(--admin-display)" }} className="text-3xl mb-3">
            No se puede mostrar
          </div>
          <p className="text-[13px]" style={{ color: "var(--dim)" }}>{error}</p>
        </div>
      </main>
    );
  }

  if (!datos) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <span className="text-[12px] tracking-[0.2em] uppercase animate-pulse" style={{ color: "var(--tenue)" }}>
          Leyendo el registro
        </span>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 lg:px-12 py-10 lg:py-14 max-w-[900px] mx-auto">
      <header className="mb-8">
        <Etiqueta>Salamandra · panel interno</Etiqueta>
        <h1
          className="mt-2 text-[42px] lg:text-[58px] leading-[0.95] tracking-tight"
          style={{ fontFamily: "var(--admin-display)" }}
        >
          Qué hay
          <br />
          <span style={{ fontStyle: "italic", color: "var(--ok)" }}>que hacer</span>
        </h1>

        {datos.faltan?.length > 0 && (
          <p className="mt-4 text-[12px]" style={{ color: "var(--alerta)" }}>
            No se han podido leer: {datos.faltan.join(", ")}. El registro está incompleto.
          </p>
        )}

        <div className="mt-7 flex items-center gap-1">
          {[
            ["pendiente", "Pendiente", cuantas("pendiente")],
            ["resuelto", "Resuelto", cuantas("resuelto")],
          ].map(([clave, texto, n]) => (
            <button
              key={clave}
              onClick={() => setPestaña(clave)}
              className="px-4 py-2 rounded-lg text-[13px] transition-colors"
              style={{
                background: pestaña === clave ? "var(--panel-alto)" : "transparent",
                color: pestaña === clave ? "var(--text)" : "var(--tenue)",
                border: `1px solid ${pestaña === clave ? "var(--line)" : "transparent"}`,
              }}
            >
              {texto} <span className="tabular-nums opacity-60">{n}</span>
            </button>
          ))}
        </div>

        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Filtrar por cliente — p. ej. «aumenta», «nutri_laura»"
          className="mt-4 w-full max-w-md rounded-lg px-3 py-2 text-[13px] outline-none"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--text)" }}
        />
      </header>

      {visibles.length === 0 && (
        <p className="text-[13px]" style={{ color: "var(--tenue)" }}>
          {filtro ? `Nada casa con «${filtro}».` : "Nada por aquí."}
        </p>
      )}

      <div className="space-y-8">
        {visibles.map((s) => {
          const tono = tonoDe(s.titulo);
          return (
            <section key={s.titulo}>
              <div className="flex items-baseline gap-2.5 mb-3">
                <Etiqueta color={tono.color}>{s.titulo}</Etiqueta>
                <span className="text-[11px] tabular-nums" style={{ color: "var(--tenue)" }}>
                  {s.tareas.length}
                </span>
              </div>

              <div className="space-y-px">
                {s.tareas.map((t) => (
                  <details
                    key={t.titulo}
                    className="rounded-lg px-4 py-3"
                    style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
                  >
                    <summary className="cursor-pointer list-none flex items-start gap-3">
                      <span
                        className="inline-block w-[3px] rounded-full shrink-0 self-stretch"
                        style={{ background: tono.color }}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="text-[14px]">{t.titulo}</span>
                        {t.quien && (
                          <span
                            className="ml-2 text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap"
                            style={{
                              color: "var(--dim)",
                              border: "1px solid color-mix(in srgb, var(--tenue) 35%, transparent)",
                            }}
                          >
                            {t.quien}
                          </span>
                        )}
                      </span>
                    </summary>
                    {/* El cuerpo se pinta tal cual, respetando saltos de línea: es
                        texto escrito para leerse, no datos que reformatear. */}
                    <div
                      className="mt-3 ml-[15px] text-[12.5px] leading-relaxed whitespace-pre-wrap"
                      style={{ color: "var(--dim)" }}
                    >
                      {t.cuerpo}
                    </div>
                  </details>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <p className="mt-10 text-[11px] leading-relaxed" style={{ color: "var(--tenue)" }}>
        Esto sale de <code>docs/backlog.md</code> y <code>docs/resuelto.md</code>, que se editan en el
        repositorio junto al código que resuelve cada cosa. Nada entra ni sale sin comprobarse contra
        producción.
      </p>
    </main>
  );
}
