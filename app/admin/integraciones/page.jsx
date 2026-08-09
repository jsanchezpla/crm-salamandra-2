"use client";

/**
 * Integraciones — por dónde se tocan los módulos entre sí.
 *
 * POR QUÉ NO ES UNA TABLA (09/08/2026)
 * Módulos es una tabla porque allí la pregunta es comparativa: «¿quién tiene
 * support?». Aquí la pregunta es relacional —«¿qué pasa entre Leads y
 * Clientes?»— y lo que hay que ver de un vistazo es el SENTIDO del flujo. Una
 * fila de tabla no enseña una flecha; una tarjeta con origen → destino, sí.
 *
 * LOS CLIENTES SON EL FILTRO, no una columna. La pregunta que trae a alguien a
 * esta pantalla casi siempre viene con un cliente delante («¿qué se le rompe a
 * Aumenta si le quito Pacientes?»), así que los clientes están arriba como
 * botones y filtran la lista entera. Escribir el nombre a mano también vale.
 *
 * A MEDIAS NO ES UN ERROR: es «tiene el módulo de origen y no el de destino».
 * Puede ser deliberado. Se pinta como aviso, en ámbar, nunca en rojo.
 */

import { useEffect, useMemo, useState } from "react";

// Respaldos estables para mientras no ha llegado la respuesta. Escribir `?? []`
// dentro del componente crea un array nuevo en cada render y hace que los
// useMemo que dependen de él se recalculen siempre.
const SIN_NADA = [];
const SIN_NADA_OBJ = {};

function Etiqueta({ children, tono = "dim" }) {
  const color = tono === "alerta" ? "var(--alerta)" : tono === "ok" ? "var(--ok)" : "var(--tenue)";
  return (
    <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color }}>
      {children}
    </span>
  );
}

/** «1 módulo» / «6 módulos». Sale en los rótulos al pasar el ratón y en el resumen. */
function plural(n, singular, plural_) {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/** Una punta del flujo. */
function Modulo({ clave, nombre }) {
  return (
    <span
      className="text-[12px] px-2 py-1 rounded whitespace-nowrap"
      style={{ background: "var(--panel-alto)", border: "1px solid var(--line)" }}
      title={clave}
    >
      {nombre || clave}
    </span>
  );
}

export default function IntegracionesPage() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState("");
  const [cliente, setCliente] = useState(null);

  useEffect(() => {
    document.title = "Integraciones — Salamandra";
  }, []);

  useEffect(() => {
    fetch("/api/admin/integraciones", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
        return j.data;
      })
      .then(setDatos)
      .catch((e) => setError(e.message));
  }, []);

  const todas = datos?.integraciones ?? SIN_NADA;
  const nombres = datos?.nombresModulo ?? SIN_NADA_OBJ;
  const tipos = datos?.tipos ?? SIN_NADA_OBJ;

  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return todas.filter((i) => {
      if (cliente && !i.vivas.includes(cliente) && !i.aMedias.includes(cliente)) return false;
      if (!q) return true;
      return (
        i.desde.toLowerCase().includes(q) ||
        i.hacia.toLowerCase().includes(q) ||
        i.titulo.toLowerCase().includes(q) ||
        i.queHace.toLowerCase().includes(q) ||
        (nombres[i.desde] ?? "").toLowerCase().includes(q) ||
        (nombres[i.hacia] ?? "").toLowerCase().includes(q)
      );
    });
  }, [todas, filtro, cliente, nombres]);

  /**
   * Agrupadas por módulo de origen.
   *
   * Son casi cien: en una lista seguida no se lee ninguna. Agrupar por dónde
   * NACE el flujo contesta de un vistazo la pregunta con la que se entra —«¿qué
   * toca Equipo?»— y de paso enseña algo que sorprende: los módulos que más
   * hilos tiran no son los que más se venden.
   */
  const grupos = useMemo(() => {
    const m = new Map();
    for (const i of visibles) {
      if (!m.has(i.desde)) m.set(i.desde, []);
      m.get(i.desde).push(i);
    }
    return [...m.entries()]
      .map(([modulo, lista]) => ({ modulo, lista }))
      .sort((a, b) => b.lista.length - a.lista.length);
  }, [visibles]);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div style={{ fontFamily: "var(--admin-display)" }} className="text-3xl mb-3">
            No se puede mostrar
          </div>
          <p className="text-[13px] leading-relaxed" style={{ color: "var(--dim)" }}>{error}</p>
        </div>
      </main>
    );
  }

  if (!datos) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <span className="text-[12px] tracking-[0.2em] uppercase animate-pulse" style={{ color: "var(--tenue)" }}>
          Leyendo integraciones
        </span>
      </main>
    );
  }

  const elegido = datos.porCliente.find((c) => c.slug === cliente);

  return (
    <main className="min-h-screen px-6 lg:px-12 py-10 lg:py-14 max-w-[1000px] mx-auto">
      <header className="mb-8">
        <Etiqueta>Salamandra · panel interno</Etiqueta>
        <h1
          className="mt-2 text-[42px] lg:text-[58px] leading-[0.95] tracking-tight"
          style={{ fontFamily: "var(--admin-display)" }}
        >
          Por dónde se
          <br />
          <span style={{ fontStyle: "italic", color: "var(--ok)" }}>tocan los módulos</span>
        </h1>

        <div className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <div className="text-[34px] leading-none tabular-nums">{datos.totales.integraciones}</div>
            <Etiqueta>integraciones</Etiqueta>
          </div>
          <div>
            <div
              className="text-[34px] leading-none tabular-nums"
              style={{ color: datos.totales.aMedias > 0 ? "var(--alerta)" : "var(--ok)" }}
            >
              {datos.totales.aMedias}
            </div>
            <Etiqueta tono={datos.totales.aMedias > 0 ? "alerta" : "ok"}>a medias</Etiqueta>
          </div>
          <div>
            <div className="text-[34px] leading-none tabular-nums">{datos.totales.sinNadie}</div>
            <Etiqueta>sin usar por nadie</Etiqueta>
          </div>
          <p className="text-[12px] leading-relaxed max-w-xs ml-auto" style={{ color: "var(--dim)" }}>
            Un módulo suelto se vende; dos que se hablan se notan. Aquí está lo que se le rompe a un
            cliente si se le apaga algo — y lo que gana si se le enciende.
          </p>
        </div>

        {/* Los clientes, como filtro. Es la puerta por la que entra casi todo el
            mundo: la pregunta viene con un nombre delante. */}
        <div className="mt-7 flex flex-wrap gap-1.5">
          <button
            onClick={() => setCliente(null)}
            className="text-[12px] px-2.5 py-1 rounded transition-colors"
            style={{
              background: cliente === null ? "var(--panel-alto)" : "transparent",
              border: `1px solid ${cliente === null ? "var(--line)" : "transparent"}`,
              color: cliente === null ? "var(--text)" : "var(--tenue)",
            }}
          >
            todos
          </button>
          {datos.porCliente.map((c) => (
            <button
              key={c.slug}
              onClick={() => setCliente(cliente === c.slug ? null : c.slug)}
              title={`${c.nombre} — ${plural(c.modulos, "módulo", "módulos")}, ${plural(c.vivas, "integración viva", "integraciones vivas")}${c.aMedias ? `, ${c.aMedias} a medias` : ""}`}
              className="text-[12px] px-2.5 py-1 rounded transition-colors"
              style={{
                background: cliente === c.slug ? "var(--panel-alto)" : "transparent",
                border: `1px solid ${cliente === c.slug ? "var(--line)" : "transparent"}`,
                color: cliente === c.slug ? "var(--text)" : "var(--tenue)",
              }}
            >
              {c.slug} <span className="tabular-nums opacity-60">{c.vivas}</span>
            </button>
          ))}
        </div>

        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Filtrar por módulo o por lo que hace — p. ej. «citas», «convierte»"
          className="mt-4 w-full max-w-md rounded-lg px-3 py-2 text-[13px] outline-none"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--text)" }}
        />

        {elegido && (
          <p className="mt-3 text-[12px]" style={{ color: "var(--dim)" }}>
            <strong>{elegido.nombre}</strong> tiene {plural(elegido.modulos, "módulo", "módulos")} y{" "}
            <strong>{elegido.vivas}</strong>{" "}
            {elegido.vivas === 1 ? "integración funcionando" : "integraciones funcionando"}
            {elegido.aMedias > 0 && (
              <span style={{ color: "var(--alerta)" }}> · {elegido.aMedias} a medias</span>
            )}
            .
          </p>
        )}
      </header>

      {visibles.length === 0 && (
        <p className="text-[13px]" style={{ color: "var(--tenue)" }}>
          Nada casa con lo que hay filtrado.
        </p>
      )}

      <div className="space-y-9">
        {grupos.map(({ modulo, lista }) => (
          <section key={modulo}>
            <div className="flex items-baseline gap-2.5 mb-3">
              <Etiqueta>desde {nombres[modulo] || modulo}</Etiqueta>
              <span className="text-[11px] tabular-nums" style={{ color: "var(--tenue)" }}>
                {lista.length}
              </span>
            </div>

            <div className="space-y-2.5">
              {lista.map((i) => {
                const aMediasAqui = cliente ? i.aMedias.includes(cliente) : i.aMedias.length > 0;
                return (
            <article
              key={`${i.desde}-${i.hacia}-${i.titulo}`}
              className="rounded-lg px-4 py-4"
              style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
            >
              <div className="flex flex-wrap items-center gap-2 mb-2.5">
                {/* El origen ya lo dice el encabezado del grupo: aquí solo
                    interesa a DÓNDE va. */}
                <span style={{ color: "var(--tenue)" }}>→</span>
                <Modulo clave={i.hacia} nombre={nombres[i.hacia]} />
                <span
                  className="text-[10px] uppercase tracking-[0.16em] ml-1"
                  style={{ color: "var(--tenue)" }}
                  title={tipos[i.tipo]}
                >
                  {i.tipo}
                </span>
                {!i.automatico && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ color: "var(--tenue)", border: "1px solid color-mix(in srgb, var(--tenue) 35%, transparent)" }}
                    title="Alguien tiene que pulsar algo para que pase"
                  >
                    a mano
                  </span>
                )}
              </div>

              <h2 className="text-[15px] leading-snug">{i.titulo}</h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: "var(--dim)" }}>
                {i.queHace}
              </p>

              {i.nota && (
                <p className="mt-2 text-[12px] leading-relaxed" style={{ color: "var(--alerta)" }}>
                  {i.nota}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
                <span className="text-[11.5px]" style={{ color: "var(--tenue)" }}>
                  {i.vivas.length === 0 ? (
                    "no la usa ningún cliente todavía"
                  ) : (
                    <>
                      la usan <strong style={{ color: "var(--dim)" }}>{i.vivas.join(", ")}</strong>
                    </>
                  )}
                </span>
                {aMediasAqui && (
                  <span className="text-[11.5px]" style={{ color: "var(--alerta)" }}>
                    a medias en {i.aMedias.join(", ")} — tienen {nombres[i.desde] || i.desde} y no{" "}
                    {nombres[i.hacia] || i.hacia}
                  </span>
                )}
              </div>

              {i.donde?.length > 0 && (
                <details className="mt-2.5">
                  <summary className="cursor-pointer text-[11px]" style={{ color: "var(--tenue)" }}>
                    dónde está en el código
                  </summary>
                  <div className="mt-1.5 text-[11px] leading-relaxed" style={{ color: "var(--tenue)" }}>
                    {i.donde.map((d) => (
                      <div key={d}>{d}</div>
                    ))}
                  </div>
                </details>
              )}
            </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-8 text-[11px] leading-relaxed" style={{ color: "var(--tenue)" }}>
        El mapa sale de <code>lib/provisioning/integraciones.js</code>, escrito leyendo el código, y se
        cruza en vivo con lo que cada cliente tiene contratado. «A medias» significa que tiene el
        módulo de origen y no el de destino: a veces es a propósito.
      </p>
    </main>
  );
}
