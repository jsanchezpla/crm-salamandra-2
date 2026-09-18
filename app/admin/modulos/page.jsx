"use client";

/**
 * Módulos y personalizaciones — qué tiene cada cliente y qué lleva a medida.
 *
 * POR QUÉ ES UNA TABLA Y NO TARJETAS (08/08/2026)
 * La Custodia son tarjetas porque allí se mira un cliente y se le pide algo:
 * la acción es por cliente. Aquí la pregunta es COMPARATIVA —«¿quién tiene
 * support?», «¿a cuántos les mantenemos una pantalla propia?»— y para comparar
 * hacen falta filas alineadas. Cambiar de forma según la pregunta es lo que
 * hace que las dos pantallas sirvan para algo distinto.
 *
 * La columna que de verdad importa es la de A MEDIDA. Los módulos se venden;
 * las personalizaciones se mantienen, y ese coste no aparece en ninguna factura.
 * Cuando nació esta pantalla, cinco de los seis clientes con `leads` tenían su
 * propia pantalla del embudo: cada arreglo de leads había que hacerlo cinco
 * veces, y eso solo se veía aquí. El 18/08/2026 quedaron cuatro de nueve
 * (aumenta, nutri_laura, retorika, spain_enzymes): el base pasó a ser el de
 * aumenta y las copias de demo y sandbox se borraron (CLAUDE.md, «En Leads la
 * pirámide está al revés»).
 *
 * LA MARCA «pantalla propia» SALE DE `tenant_modules.ui_override`, que es un
 * LETRERO: el código no lo lee, y se mantiene fiel a los mapas UI_OVERRIDES con
 * `scripts/sincronizar-ui-override.mjs` (en producción, tras cada despliegue
 * que añada, mueva o borre un override). Si aquí sale algo que el código ya no
 * carga, no es que la pantalla mienta: es que falta relanzar ese script.
 */

import { useEffect, useMemo, useState } from "react";
import { anchoPanel } from "@/components/admin/anchoPanel.js";
import { coincidePorNombre } from "@/lib/utils/busqueda.js";

/** Marca de un tipo de personalización, con su explicación al pasar el ratón. */
function Marca({ texto, titulo, fuerte = false }) {
  return (
    <span
      title={titulo}
      className="text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{
        color: fuerte ? "var(--alerta)" : "var(--tenue)",
        border: `1px solid color-mix(in srgb, ${fuerte ? "var(--alerta)" : "var(--tenue)"} 35%, transparent)`,
      }}
    >
      {texto}
    </span>
  );
}

/**
 * Abre la ficha de un módulo y la trae a la vista. DOM imperativo a propósito:
 * los desplegables son `<details>` nativos (el patrón del back-office: uno que
 * no necesita JavaScript no se puede romper), así que abrirlos no necesita
 * estado de React — solo poner `open` en el suyo y en los de arriba.
 */
function abrirFicha(clave) {
  const el = document.getElementById(`ficha-${clave}`);
  if (!el) return;
  for (let p = el; p; p = p.parentElement?.closest("details")) p.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

/**
 * La ficha de un módulo. Lo que se ve CERRADO es nombre, clave, qué hace y a
 * cuántos clientes se les ha vendido: si para saber qué hace cada módulo
 * hubiera que abrir veintinueve desplegables, esta sección no serviría de nada.
 * Dentro va el detalle: pantallas, avisos, qué necesita, qué se le dice al
 * cliente y quién lo tiene.
 */
function FichaModulo({ m, onCliente }) {
  const n = m.activoEn.length;
  return (
    <details id={`ficha-${m.clave}`} style={{ borderTop: "1px solid var(--line-suave)" }}>
      <summary className="cursor-pointer px-4 py-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[13px] font-semibold">{m.nombre}</span>
        <code className="text-[11px]" style={{ color: "var(--tenue)" }}>{m.clave}</code>
        <span className="text-[12px] flex-1 min-w-[12rem]" style={{ color: "var(--dim)" }}>
          {m.hace}
        </span>
        <span
          className="text-[11px] tabular-nums whitespace-nowrap"
          style={{ color: n > 0 ? "var(--ok)" : "var(--tenue)" }}
        >
          {n > 0 ? `activo en ${n}` : "no lo tiene nadie"}
        </span>
      </summary>

      <div className="px-4 pb-4 pt-1 text-[12px] leading-relaxed space-y-3" style={{ color: "var(--dim)" }}>
        {m.trae.length > 0 && (
          <div>
            <Etiqueta>qué trae</Etiqueta>
            <ul className="mt-1.5 space-y-1">
              {m.trae.map((t) => (
                <li key={t.donde + t.que} className="flex flex-wrap gap-x-2">
                  <span style={{ color: "var(--text)" }}>{t.que}</span>
                  <code className="text-[11px]" style={{ color: "var(--tenue)" }}>{t.donde}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        {m.ojo.length > 0 && (
          <div>
            <Etiqueta tono="alerta">a tener en cuenta</Etiqueta>
            <ul className="mt-1.5 space-y-1">
              {m.ojo.map((aviso) => (
                <li key={aviso}>· {aviso}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {m.necesita && (
            <div>
              {/* «Necesita» solo cuando es obligatorio de verdad: lo demás son
                  módulos con los que se lleva, y decir que Citas «necesita»
                  Pacientes sería mentir en una venta. */}
              <Etiqueta tono={m.necesitaEsObligatorio ? "alerta" : "dim"}>
                {m.necesitaEsObligatorio ? "no funciona sin" : "se apoya en"}
              </Etiqueta>
              <div className="mt-1">
                {m.necesita}{" "}
                <a href="/admin/integraciones" className="underline" style={{ color: "var(--tenue)" }}>
                  el porqué, en Integraciones
                </a>
              </div>
            </div>
          )}
          {m.doc && (
            <div>
              <Etiqueta>doc</Etiqueta>
              {/* Texto, no enlace: la imagen de Docker no lleva docs/. */}
              <div className="mt-1" style={{ color: "var(--tenue)" }}>{m.doc}</div>
            </div>
          )}
        </div>

        <div>
          <Etiqueta>lo que se le dice al cliente</Etiqueta>
          <div className="mt-1 italic">{m.desc}</div>
        </div>

        {n > 0 && (
          <div>
            <Etiqueta>lo tienen</Etiqueta>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {m.activoEn.map((slug) => (
                <button
                  key={slug}
                  type="button"
                  onClick={() => onCliente(slug)}
                  className="text-[11px] px-1.5 py-0.5 rounded"
                  style={{ color: "var(--tenue)", border: "1px solid var(--line)" }}
                >
                  {slug}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function Etiqueta({ children, tono = "dim" }) {
  const color = tono === "alerta" ? "var(--alerta)" : tono === "ok" ? "var(--ok)" : "var(--tenue)";
  return (
    <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color }}>
      {children}
    </span>
  );
}

export default function ModulosPage() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState("");

  // El layout del back-office fija el título en su metadata («Custodia»), y una
  // página cliente no puede exportar la suya. Se pone a mano para que la pestaña
  // diga en cuál de las tres estás, que con tres abiertas a la vez importa.
  useEffect(() => {
    document.title = "Módulos — Salamandra";
  }, []);

  useEffect(() => {
    fetch("/api/admin/modulos", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
        return j.data;
      })
      .then(setDatos)
      .catch((e) => setError(e.message));
  }, []);

  const clientes = datos?.clientes ?? [];
  const catalogo = datos?.catalogo ?? null;
  const totalModulos = catalogo ? catalogo.grupos.reduce((n, g) => n + g.modulos.length, 0) : 0;

  /** Desde la ficha, «lo tienen: aumenta» filtra la tabla de arriba y sube. */
  const verCliente = (slug) => {
    setFiltro(slug);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Filtro por módulo: responde a «¿quién tiene esto?», que es media razón de
  // ser de la pantalla. Casa también contra el nombre y el slug del cliente.
  const visibles = useMemo(() => {
    if (!filtro.trim()) return clientes;
    return clientes.filter((c) => coincidePorNombre(filtro, [c.slug, c.nombre, ...c.modulos]));
  }, [clientes, filtro]);

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
          Leyendo módulos
        </span>
      </main>
    );
  }

  return (
    <main className={anchoPanel()}>
      <header className="mb-8">
        <Etiqueta>Salamandra · panel interno</Etiqueta>
        <h1
          className="mt-2 text-[42px] lg:text-[58px] leading-[0.95] tracking-tight"
          style={{ fontFamily: "var(--admin-display)" }}
        >
          Módulos y
          <br />
          <span style={{ fontStyle: "italic", color: "var(--ok)" }}>personalizaciones</span>
        </h1>

        <div className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-4">
          <div>
            <div className="text-[34px] leading-none tabular-nums">{datos.totales.clientes}</div>
            <Etiqueta>clientes</Etiqueta>
          </div>
          <div>
            <div className="text-[34px] leading-none tabular-nums">{datos.totales.personalizaciones}</div>
            <Etiqueta>cosas a medida</Etiqueta>
          </div>
          {/* Dos números y no uno (18/08/2026): CUÁNTAS pantallas propias hay
              que mantener y a CUÁNTOS clientes afectan. Solo el segundo
              escondía que Laura tiene dos. */}
          <div>
            <div
              className="text-[34px] leading-none tabular-nums"
              style={{ color: datos.totales.pantallasPropias > 0 ? "var(--alerta)" : "var(--ok)" }}
            >
              {datos.totales.pantallasPropias ?? datos.totales.conPantallaPropia}
            </div>
            <Etiqueta tono={datos.totales.pantallasPropias > 0 ? "alerta" : "ok"}>
              pantallas propias · en {datos.totales.conPantallaPropia} cliente{datos.totales.conPantallaPropia === 1 ? "" : "s"}
            </Etiqueta>
          </div>
          <p className="text-[12px] leading-relaxed max-w-xs ml-auto" style={{ color: "var(--dim)" }}>
            Los módulos se venden; las personalizaciones se mantienen. Una pantalla propia hay que
            tocarla aparte cada vez que se cambia la base: es el último peldaño de la escalera, no el
            primero.
          </p>
        </div>

        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Filtrar por cliente o por módulo — p. ej. «citas», «support»"
          className="mt-6 w-full max-w-md rounded-lg px-3 py-2 text-[13px] outline-none"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--text)" }}
        />
      </header>

      <section
        className="rounded-lg overflow-x-auto"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
      >
        <table className="w-full text-left border-collapse">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              <th className="px-4 py-3"><Etiqueta>cliente</Etiqueta></th>
              <th className="px-4 py-3 text-right whitespace-nowrap"><Etiqueta>módulos</Etiqueta></th>
              <th className="px-4 py-3"><Etiqueta>qué tiene activo</Etiqueta></th>
              <th className="px-4 py-3"><Etiqueta>a medida</Etiqueta></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((c) => (
              <tr key={c.slug} style={{ borderTop: "1px solid var(--line-suave)" }} className="align-top">
                <td className="px-4 py-3.5">
                  <div className="text-[14px] font-semibold">{c.nombre}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--tenue)" }}>
                    {c.slug}
                    {c.estado !== "active" && (
                      <span style={{ color: "var(--alerta)" }}> · {c.estado}</span>
                    )}
                  </div>
                </td>

                <td className="px-4 py-3.5 text-right tabular-nums text-[15px] whitespace-nowrap">
                  {c.modulos.length}
                  {c.apagados.length > 0 && (
                    <span
                      className="text-[11px]"
                      style={{ color: "var(--tenue)" }}
                      title={`Apagados: ${c.apagados.join(", ")}`}
                    >
                      {" "}(+{c.apagados.length} off)
                    </span>
                  )}
                </td>

                {/* Cada clave abre su ficha, que es donde está escrito qué hace
                    (18/09/2026). Antes esto era un `join(" · ")` mudo: para
                    saber qué era `productos_avanzado` había que abrir docs/. */}
                <td className="px-4 py-3.5 text-[12px] leading-relaxed" style={{ color: "var(--dim)" }}>
                  {c.modulos.length ? (
                    c.modulos.map((clave, i) => (
                      <span key={clave}>
                        {i > 0 && " · "}
                        <button
                          type="button"
                          onClick={() => abrirFicha(clave)}
                          title={`Qué hace ${clave}`}
                          className="underline decoration-dotted underline-offset-2"
                          style={{ color: "inherit" }}
                        >
                          {clave}
                        </button>
                      </span>
                    ))
                  ) : (
                    <span style={{ color: "var(--tenue)" }}>ninguno</span>
                  )}
                </td>

                <td className="px-4 py-3.5">
                  {c.aMedida.length === 0 ? (
                    <span className="text-[12px]" style={{ color: "var(--tenue)" }}>de fábrica</span>
                  ) : (
                    <div className="space-y-1.5">
                      {c.aMedida.map((m) => (
                        <div key={m.modulo} className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[12px]">{m.modulo}</span>
                          {m.pantalla && (
                            <Marca
                              fuerte
                              texto="pantalla propia"
                              titulo={`${m.pantalla} — peldaño 5: un fichero aparte que hay que tocar cada vez que se cambia la pantalla base`}
                            />
                          )}
                          {m.logica && (
                            <Marca texto="parámetro" titulo="Peldaño 4 (logicOverrides): el módulo se comporta distinto para este cliente según un valor" />
                          )}
                          {m.pruebas && (
                            <Marca texto="interruptor" titulo="Peldaño 3 (featureFlags): un «esto sí / esto no» encendido para este cliente, p. ej. «formación abierta»" />
                          )}
                          {m.campos && <Marca texto="campos" titulo="Campos extra en su schema (schemaExtensions)" />}
                        </div>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visibles.length === 0 && (
          <div className="px-4 py-8 text-center text-[13px]" style={{ color: "var(--tenue)" }}>
            Ningún cliente casa con «{filtro}».
          </div>
        )}
      </section>

      <p className="mt-4 text-[11px] leading-relaxed" style={{ color: "var(--tenue)" }}>
        Se listan solo las personalizaciones de módulos encendidos. Los apagados se cuentan aparte
        («+N off»): pasa el ratón por encima para ver cuáles son.
      </p>

      {/* La escalera de la regla #16 (CLAUDE.md), para que las marcas se lean
          como lo que son: peldaños de coste creciente. Los dos primeros no
          salen en esta tabla porque viven en el código, no en la base. */}
      <section
        className="mt-6 rounded-lg px-4 py-4 text-[12px] leading-relaxed"
        style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--dim)" }}
      >
        <Etiqueta>cómo se trabaja · la escalera</Etiqueta>
        <p className="mt-2">
          Cuando un cliente pide algo se prueba en este orden y se para en el primer peldaño que
          sirva:{" "}
          <span style={{ color: "var(--text)" }}>1 palabras</span> (un rótulo, p. ej. «Interesados») ·{" "}
          <span style={{ color: "var(--text)" }}>2 un dato en el código</span> (su embudo, sus campos del
          alta) ·{" "}
          <span style={{ color: "var(--text)" }}>3 interruptor</span> ·{" "}
          <span style={{ color: "var(--text)" }}>4 parámetro</span> ·{" "}
          <span style={{ color: "var(--alerta)" }}>5 pantalla propia</span>, y solo si es de verdad de un
          cliente y no cabe antes. Si funciona distinto de verdad, no es un peldaño: es un módulo nuevo
          que se pueda vender a un segundo cliente. Nunca más una copia entera de un módulo.
        </p>
        <p className="mt-2">
          Aquí salen los peldaños 3, 4 y 5 y los campos extra, que viven en la base de datos. Los
          peldaños 1 y 2 viven en el código y no se listan a mano a propósito: una lista copiada
          mentiría en una semana. Está escrito entero en CLAUDE.md, regla #16.
        </p>
      </section>

      {/* QUÉ HACE CADA MÓDULO (18/09/2026, Jorge: «que se explique qué hace cada
          módulo»). Va PLEGADA: de normal ocupa una línea, porque la pregunta
          que trae a alguien a esta pantalla sigue siendo comparativa y la tabla
          manda. Se llega a ella pulsando una clave de la tabla, que abre la
          ficha y baja sola. Al final, y no antes de «la escalera», porque la
          escalera es la leyenda de la columna «a medida». */}
      {catalogo && (
        <details className="mt-6 rounded-lg" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
          <summary className="cursor-pointer px-4 py-4 flex flex-wrap items-baseline gap-x-3">
            <Etiqueta>qué hace cada módulo</Etiqueta>
            <span className="text-[12px]" style={{ color: "var(--dim)" }}>
              {totalModulos} módulos en el catálogo — para cuando una clave de la tabla no dice nada
            </span>
          </summary>

          <div className="pb-2">
            {catalogo.grupos.map((g) => (
              <div key={g.grupo}>
                <div className="px-4 pt-4 pb-1">
                  <Etiqueta>{g.grupo}</Etiqueta>
                </div>
                {g.modulos.map((m) => (
                  <FichaModulo key={m.clave} m={m} onCliente={verCliente} />
                ))}
              </div>
            ))}

            {catalogo.sinFicha.length > 0 && (
              <div>
                <div className="px-4 pt-5 pb-1">
                  <Etiqueta>fuera del catálogo</Etiqueta>
                </div>
                <p className="px-4 pb-2 text-[12px]" style={{ color: "var(--tenue)" }}>
                  Claves encendidas en la base que no se venden. Salen para que nadie las tome por un
                  fallo.
                </p>
                {catalogo.sinFicha.map((s) => (
                  <div
                    key={s.clave}
                    className="px-4 py-2.5 text-[12px] flex flex-wrap items-baseline gap-x-2.5"
                    style={{ borderTop: "1px solid var(--line-suave)", color: "var(--dim)" }}
                  >
                    <code className="text-[11px]" style={{ color: "var(--tenue)" }}>{s.clave}</code>
                    <span className="flex-1 min-w-[12rem]">
                      {s.porQue ?? (
                        <span style={{ color: "var(--alerta)" }}>
                          Sin explicar: apúntala en FUERA_DEL_CATALOGO o dale su ficha.
                        </span>
                      )}
                    </span>
                    <span className="text-[11px] tabular-nums" style={{ color: "var(--tenue)" }}>
                      en {s.activoEn.length}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </main>
  );
}
