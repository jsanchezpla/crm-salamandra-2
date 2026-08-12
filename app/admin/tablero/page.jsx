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
 *
 * AGRUPAR POR CLIENTE (12/08/2026)
 * Antes eso solo se podía contestar escribiendo el slug en el filtro y fiándose
 * de que estuviera bien puesto en todas las tareas. Ahora hay un interruptor.
 *
 * Lo que costó no fue agrupar, fue poder hacerlo sin mentir: el troceador
 * devolvía el destinatario como una CADENA, así que «demo, aumenta,
 * salamandra_solutions» formaba un grupo propio de una sola tarea y Aumenta
 * enseñaba 7 de sus 10. Ahora el endpoint devuelve además `quienes`, ya troceado
 * en nombres conocidos, y una tarea compartida aparece en todos sus grupos. Un
 * tablero que miente por poco es peor que uno que no agrupa: nadie lo comprueba.
 *
 * YA NO ES SOLO DE LEER (12/08/2026, Rodrigo)
 * Dos cosas se pueden tocar desde aquí: de quién es cada tarea y si ya está.
 * Van a `master.tablero_estado`, NO a los ficheros —viajan dentro de la imagen
 * de Docker y el siguiente despliegue se llevaría por delante lo que
 * escribiéramos—, y se pintan encima de lo que dicen los `.md`.
 *
 * El tick MUEVE la tarea de pestaña, así que después de guardarlo hay que volver
 * a pedir los datos: es el endpoint quien decide de qué lado cae cada una, y
 * duplicar aquí esa decisión es como se llega a dos pantallas que no coinciden.
 *
 * Marcar aquí NO cierra una tarea de verdad: eso sigue siendo moverla a
 * `resuelto.md` en el commit que la arregla. El tick es para ponerse de acuerdo
 * entre los dos, y por eso lo marcado a mano se pinta en su propio bloque en vez
 * de mezclarse con lo cerrado en el repositorio.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

/** Cuánto corre cada bloque, por su título. Lo que no case, en gris. */
const TONOS = [
  { casa: /^P0/i, color: "var(--alerta)", etiqueta: "hoy" },
  { casa: /^P1/i, color: "#B45309", etiqueta: "esta semana" },
  { casa: /^P2/i, color: "var(--dim)", etiqueta: "cuando se pueda" },
  { casa: /^P3/i, color: "var(--tenue)", etiqueta: "deuda" },
  { casa: /decisión|decision/i, color: "var(--ok)", etiqueta: "lo decidís vosotros" },
  // Los dos bloques que inventa el endpoint para lo que se mueve con el tick.
  // Llevan etiqueta propia para que se vea de un vistazo que eso NO está cerrado
  // en el repositorio: está marcado a mano y le falta su commit.
  { casa: /^Marcadas desde el Registro/i, color: "var(--ok)", etiqueta: "sin commit" },
  { casa: /^Reabiertas desde el Registro/i, color: "#B45309", etiqueta: "reabierta aquí" },
];

function tonoDe(titulo) {
  return TONOS.find((t) => t.casa.test(titulo)) ?? { color: "var(--tenue)", etiqueta: null };
}

/**
 * Los que no son un cliente. Agrupando por cliente van DESPUÉS de los clientes
 * de verdad: «producto» es una respuesta válida a «¿de quién es esto?», pero no
 * es quien llama por teléfono.
 */
const NO_ES_CLIENTE = new Set([
  "todos", "producto", "interno", "documentación", "varios", "sin asignar",
]);

function Etiqueta({ children, color }) {
  return (
    <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: color ?? "var(--tenue)" }}>
      {children}
    </span>
  );
}

/**
 * El tick. Es un `button` y no un `input type=checkbox` a propósito: esto vive
 * dentro de un `<summary>`, donde cualquier clic despliega el detalle, así que
 * hace falta cortar el evento a mano — y un checkbox al que se le corta el
 * evento por defecto se queda pintando lo contrario de lo que hay guardado.
 */
function Tick({ marcada, ocupada, onToggle }) {
  return (
    <button
      type="button"
      aria-label={marcada ? "Devolver a pendiente" : "Marcar como resuelta"}
      title={marcada ? "Devolver a pendiente" : "Marcar como resuelta"}
      disabled={ocupada}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="shrink-0 mt-[1px] w-[18px] h-[18px] rounded-[5px] grid place-items-center text-[11px] transition-colors disabled:opacity-40"
      style={{
        border: `1px solid ${marcada ? "var(--ok)" : "color-mix(in srgb, var(--tenue) 45%, transparent)"}`,
        background: marcada ? "color-mix(in srgb, var(--ok) 22%, transparent)" : "transparent",
        color: "var(--ok)",
      }}
    >
      {marcada ? "✓" : ""}
    </button>
  );
}

/** De quién es. Dos botones porque somos dos; el segundo clic la deja sin dueño. */
function Reparto({ responsables, asignadoA, ocupada, onElegir }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      {responsables.map((r) => {
        const suya = asignadoA === r;
        return (
          <button
            key={r}
            type="button"
            disabled={ocupada}
            title={suya ? `Quitar a ${r}` : `Asignar a ${r}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onElegir(suya ? null : r);
            }}
            className="px-2 py-0.5 rounded-md text-[11px] capitalize transition-colors disabled:opacity-40"
            style={{
              background: suya ? "var(--panel-alto)" : "transparent",
              color: suya ? "var(--text)" : "var(--tenue)",
              border: `1px solid ${suya ? "var(--line)" : "transparent"}`,
            }}
          >
            {r}
          </button>
        );
      })}
    </span>
  );
}

export default function TableroPage() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [pestaña, setPestaña] = useState("pendiente");
  const [filtro, setFiltro] = useState("");
  // Se abre por urgencia, que es la pregunta de todos los días («¿qué toca
  // ahora?»). Por cliente es la del teléfono sonando («¿cómo vamos con
  // Aumenta?»), que se hace menos veces pero con más prisa.
  const [agrupacion, setAgrupacion] = useState("urgencia");
  // La tarea que se está guardando ahora mismo, por su clave: se le apagan los
  // botones para que dos clics seguidos no manden dos cambios cruzados.
  const [guardando, setGuardando] = useState(null);
  const [fallo, setFallo] = useState(null);

  useEffect(() => { document.title = "Registro — Salamandra"; }, []);

  const cargar = useCallback(
    () =>
      fetch("/api/admin/tablero", { cache: "no-store" })
        .then(async (r) => {
          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
          return j.data;
        })
        .then(setDatos)
        .catch((e) => setError(e.message)),
    []
  );

  useEffect(() => { cargar(); }, [cargar]);

  /**
   * Guarda un cambio y vuelve a pedir el tablero entero.
   *
   * Se recarga en vez de tocar el estado local porque el tick MUEVE la tarea de
   * pestaña, y quién cae de qué lado lo decide el endpoint. Reproducir aquí esa
   * regla es cómo se acaba con dos pantallas que no dicen lo mismo.
   */
  async function tocar(tarea, cambios) {
    setGuardando(tarea.clave);
    setFallo(null);
    try {
      const r = await fetch("/api/admin/tablero", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clave: tarea.clave, titulo: tarea.titulo, ...cambios }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
      await cargar();
    } catch (e) {
      setFallo(e.message);
    } finally {
      setGuardando(null);
    }
  }

  /**
   * El tick, con la fuente delante.
   *
   * Solo se guarda lo que se DESVÍA del repositorio: marcar una tarea que ya
   * está en `resuelto.md` no necesita fila (vuelve a `null`, «manda el
   * fichero»), y lo mismo al devolver a pendiente una que está en `backlog.md`.
   * Así el estado guardado no acumula filas que no dicen nada.
   */
  function alternarTick(t, estaResuelta) {
    const quiero = !estaResuelta;
    const loQueDiceElFichero = t.fuente === "resuelto";
    return tocar(t, { marcada: quiero === loQueDiceElFichero ? null : quiero });
  }

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

  /**
   * Los bloques que se pintan, agrupados de una forma o de la otra.
   *
   * Cada tarea se lleva su `tono` puesto, porque agrupando por cliente el color
   * ya no lo puede dar el bloque: dentro de «aumenta» hay P0 y P3 mezclados, y
   * perder de vista qué corre prisa sería cambiar un problema por otro.
   *
   * Una tarea de tres clientes sale en los TRES grupos. Es a propósito: si
   * saliera en uno solo, los recuentos volverían a mentir, que es de lo que
   * venimos.
   */
  const grupos = useMemo(() => {
    if (agrupacion === "urgencia") {
      return visibles.map((s) => {
        const tono = tonoDe(s.titulo);
        return {
          titulo: s.titulo,
          etiqueta: tono.etiqueta,
          color: tono.color,
          tareas: s.tareas.map((t) => ({ ...t, tono, deSeccion: null })),
        };
      });
    }

    const mapa = new Map();
    for (const s of visibles) {
      const tono = tonoDe(s.titulo);
      for (const t of s.tareas) {
        for (const quien of t.quienes?.length ? t.quienes : ["sin asignar"]) {
          if (!mapa.has(quien)) mapa.set(quien, []);
          mapa.get(quien).push({ ...t, tono, deSeccion: s.titulo });
        }
      }
    }

    return [...mapa.entries()]
      .map(([titulo, tareas]) => ({ titulo, etiqueta: null, color: "var(--tenue)", tareas }))
      .sort((a, b) => {
        const ga = NO_ES_CLIENTE.has(a.titulo) ? 1 : 0;
        const gb = NO_ES_CLIENTE.has(b.titulo) ? 1 : 0;
        if (ga !== gb) return ga - gb;
        return b.tareas.length - a.tareas.length || a.titulo.localeCompare(b.titulo);
      });
  }, [visibles, agrupacion]);

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

        {fallo && (
          <p className="mt-4 text-[12px]" style={{ color: "var(--alerta)" }}>
            No se ha podido guardar: {fallo}
          </p>
        )}

        <div className="mt-7 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1">
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

          {/* Agrupar. La agrupación se conserva al cambiar de pestaña, igual
              que el filtro: «¿cómo vamos con Aumenta?» incluye lo entregado. */}
          <div className="flex items-center gap-1">
            <Etiqueta>Agrupar por</Etiqueta>
            {[
              ["urgencia", "Urgencia"],
              ["cliente", "Cliente"],
            ].map(([clave, texto]) => (
              <button
                key={clave}
                onClick={() => setAgrupacion(clave)}
                className="px-2.5 py-1 rounded-md text-[12px] transition-colors"
                style={{
                  background: agrupacion === clave ? "var(--panel-alto)" : "transparent",
                  color: agrupacion === clave ? "var(--text)" : "var(--tenue)",
                  border: `1px solid ${agrupacion === clave ? "var(--line)" : "transparent"}`,
                }}
              >
                {texto}
              </button>
            ))}
          </div>
        </div>

        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Filtrar por cliente — p. ej. «aumenta», «nutri_laura»"
          className="mt-4 w-full max-w-md rounded-lg px-3 py-2 text-[13px] outline-none"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--text)" }}
        />
      </header>

      {grupos.length === 0 && (
        <p className="text-[13px]" style={{ color: "var(--tenue)" }}>
          {filtro ? `Nada casa con «${filtro}».` : "Nada por aquí."}
        </p>
      )}

      <div className="space-y-8">
        {grupos.map((g) => (
          <section key={g.titulo}>
            <div className="flex items-baseline gap-2.5 mb-3">
              <Etiqueta color={g.color}>{g.titulo}</Etiqueta>
              <span className="text-[11px] tabular-nums" style={{ color: "var(--tenue)" }}>
                {g.tareas.length}
              </span>
            </div>

            <div className="space-y-px">
              {g.tareas.map((t) => (
                <details
                  key={`${g.titulo}·${t.titulo}`}
                  className="group rounded-lg px-4 py-3"
                  style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
                >
                  <summary className="cursor-pointer list-none flex items-start gap-3">
                    {/*
                      LA FLECHITA (12/08/2026). El `list-none` de aquí al lado
                      quita el triángulo que pone el navegador, y sin nada en su
                      sitio la fila parece un título suelto: no hay forma de
                      adivinar que debajo está el cuerpo entero de la tarea —el
                      qué pasa, el cómo se comprueba y el sello—.
                      No es una suposición: pasó. Al repasar el Registro se dio
                      por hecho que la pantalla ya solo enseñaba títulos, y de
                      ahí salió el encargo de «poner el cuerpo», que ya estaba.
                      Gira 90° al abrir, para que también se lea el estado.
                    */}
                    <svg
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                      aria-hidden="true"
                      className="shrink-0 mt-[4px] w-3 h-3 transition-transform group-open:rotate-90"
                      style={{ color: "var(--apagado)" }}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <Tick
                      marcada={pestaña === "resuelto"}
                      ocupada={guardando === t.clave}
                      onToggle={() => alternarTick(t, pestaña === "resuelto")}
                    />
                    <span
                      className="inline-block w-[3px] rounded-full shrink-0 self-stretch"
                      style={{ background: t.tono.color }}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="text-[14px]">{t.titulo}</span>
                      {/* Agrupando por cliente, la urgencia deja de estar en la
                          cabecera del bloque, así que se dice aquí. */}
                      {t.deSeccion && t.tono.etiqueta && (
                        <span
                          className="ml-2 text-[10px] uppercase tracking-[0.14em] whitespace-nowrap"
                          style={{ color: t.tono.color }}
                        >
                          {t.tono.etiqueta}
                        </span>
                      )}
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
                    <Reparto
                      responsables={datos.responsables ?? []}
                      asignadoA={t.asignadoA}
                      ocupada={guardando === t.clave}
                      onElegir={(quien) => tocar(t, { asignadoA: quien })}
                    />
                  </summary>
                  {/* El cuerpo se pinta tal cual, respetando saltos de línea: es
                      texto escrito para leerse, no datos que reformatear. */}
                  <div
                    className="mt-3 ml-[15px] text-[12.5px] leading-relaxed whitespace-pre-wrap"
                    style={{ color: "var(--dim)" }}
                  >
                    {t.cuerpo}
                  </div>
                  {t.tocadaPor && t.marcada !== null && (
                    <p className="mt-2 ml-[15px] text-[11px]" style={{ color: "var(--tenue)" }}>
                      {t.marcada ? "Marcada" : "Reabierta"} aquí por {t.tocadaPor} — sin pasar por el
                      repositorio.
                    </p>
                  )}
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-10 text-[11px] leading-relaxed" style={{ color: "var(--tenue)" }}>
        El texto de cada tarea sale de <code>docs/backlog.md</code> y <code>docs/resuelto.md</code>, que se
        editan en el repositorio junto al código que resuelve cada cosa. Nada entra ni sale sin
        comprobarse contra producción.
        <br />
        El tick y el reparto sí se guardan desde aquí, pero aparte: marcar una tarea la mueve de
        pestaña para que los dos sepáis por dónde va, y no sustituye a cerrarla en su commit.
      </p>
    </main>
  );
}
