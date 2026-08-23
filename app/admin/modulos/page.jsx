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

  // Filtro por módulo: responde a «¿quién tiene esto?», que es media razón de
  // ser de la pantalla. Casa también contra el nombre y el slug del cliente.
  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter(
      (c) =>
        c.slug.toLowerCase().includes(q) ||
        c.nombre.toLowerCase().includes(q) ||
        c.modulos.some((m) => m.toLowerCase().includes(q))
    );
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
    <main className="min-h-screen px-6 lg:px-12 py-10 lg:py-14 max-w-[1180px] mx-auto">
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

                <td className="px-4 py-3.5 text-[12px] leading-relaxed" style={{ color: "var(--dim)" }}>
                  {c.modulos.length ? c.modulos.join(" · ") : <span style={{ color: "var(--tenue)" }}>ninguno</span>}
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
    </main>
  );
}
