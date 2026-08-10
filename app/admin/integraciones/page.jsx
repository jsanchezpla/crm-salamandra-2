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
 *
 * ── DOS VISTAS DESDE EL 10/08/2026 ─────────────────────────────────────────
 *
 * «Qué necesita cada uno» responde la otra pregunta, la de ANTES de vender:
 * ¿esto se puede vender solo? Son dos pestañas y no dos pantallas porque se
 * consultan con el mismo cliente en la cabeza y el filtro de arriba vale para
 * las dos; separarlas obligaría a recordar que la segunda existe.
 *
 * Y AQUÍ SÍ ES UNA TABLA, por el mismo motivo por el que la otra vista no lo
 * es: la pregunta cambia. Allí es relacional («¿qué pasa entre Leads y
 * Clientes?») y hace falta ver la flecha; aquí es comparativa («¿cuáles puedo
 * vender sueltos?») y lo que hace falta es poder recorrer una columna con el
 * dedo. Cinco columnas y ni una más: módulo, qué necesita, si le hace falta
 * para funcionar y qué pasa si no lo tiene.
 *
 * ORDENADA POR GRAVEDAD, no por área de venta. La primera versión iba agrupada
 * por el grupo del catálogo —Base, Dinero, Salud— pensando en quien arma un
 * presupuesto, y eso volvía a mezclar lo que no se puede vender solo con lo que
 * sí: había que leerla entera para encontrar los once que importan. Ahora se lee
 * de arriba abajo y se para cuando deja de doler. El orden lo fija
 * `lib/provisioning/dependencias.js`, que es donde está escrito el porqué.
 *
 * Y CON EL SEMÁFORO DE VERDAD (10/08/2026, Jorge). Si la tabla está ordenada por
 * gravedad, el color TIENE que decir dónde está el corte, y los tonos apagados
 * del panel no lo decían — ver `SEMAFORO` más abajo. La tabla va además sobre
 * blanco, en su propia tarjeta: sobre el beige de la página, un amarillo lavado
 * y un fondo lavado son casi el mismo color.
 */

import { useEffect, useMemo, useState } from "react";

// Respaldos estables para mientras no ha llegado la respuesta. Escribir `?? []`
// dentro del componente crea un array nuevo en cada render y hace que los
// useMemo que dependen de él se recalculen siempre.
const SIN_NADA = [];
const SIN_NADA_OBJ = {};

/**
 * El semáforo de la matriz: rojo, amarillo y verde de verdad (10/08/2026).
 *
 * Lo que había antes NO era un semáforo. El «rojo» era `--alerta` (#B45309, el
 * naranja quemado que el back-office reserva para «sin cifrar» en Custodia), el
 * «ámbar» era `--tenue` —gris— y el verde era el verde oscuro de la marca. Tres
 * tonos apagados que a tamaño de punto no se distinguen entre sí, y dos de ellos
 * ya significaban otra cosa en el resto del panel.
 *
 * VIVE AQUÍ Y NO EN LA PALETA DEL LAYOUT a propósito: es de esta tabla. Arreglar
 * el rojo tocando `--alerta` habría movido colores en Custodia y en los avisos,
 * que no tienen nada que ver con si un módulo se puede vender suelto.
 *
 * Cada tono trae su versión oscura para texto (el amarillo puro sobre blanco no
 * se lee) y su versión lavada para los fondos.
 */
const SEMAFORO = {
  rojo: {
    punto: "#DC2626",
    texto: "#991B1B",
    suave: "#FEF3F2",
    borde: "#F3B9B4",
    dice: "No se vende solo",
  },
  ambar: {
    punto: "#EAB308",
    texto: "#854D0E",
    suave: "#FEFAEB",
    borde: "#EBD489",
    dice: "Se vende solo, pierde una utilidad",
  },
  verde: {
    punto: "#16A34A",
    texto: "#166534",
    suave: "#F1FBF4",
    borde: "#A6DEB9",
    dice: "Independiente",
  },
};

const semaforo = (severidad) => SEMAFORO[severidad] ?? SEMAFORO.verde;

/**
 * El nivel de UNA dependencia es media fila: si sin ella no funciona, va en
 * rojo; si funciona y pierde una utilidad, en ámbar. Es el mismo semáforo, un
 * escalón más abajo — la severidad de la fila sale precisamente de si alguna de
 * sus dependencias es obligatoria.
 */
const semaforoNivel = (nivel) => (nivel === "obligatorio" ? SEMAFORO.rojo : SEMAFORO.ambar);

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

/**
 * Una punta del flujo.
 *
 * Con `nivel` se pinta del color del semáforo, y es como se usa en la columna
 * «Necesita» de la matriz: ahí lo que hay que ver de un vistazo no es sólo QUÉ
 * módulo hace falta, sino si es de los que sin él no arranca nada. Sin `nivel`
 * —en el mapa de integraciones— se queda neutro, como siempre.
 */
function Modulo({ clave, nombre, nivel }) {
  const t = nivel ? semaforoNivel(nivel) : null;
  return (
    <span
      className="text-[12px] px-2 py-1 rounded whitespace-nowrap"
      style={{
        background: t ? t.suave : "var(--panel-alto)",
        border: `1px solid ${t ? t.borde : "var(--line)"}`,
        color: t ? t.texto : "var(--text)",
      }}
      title={
        nivel
          ? `${clave} — ${nivel === "obligatorio" ? "sin esto no funciona" : "funciona, pero pierde una utilidad"}`
          : clave
      }
    >
      {nombre || clave}
    </span>
  );
}

/**
 * Obligatorio vs parcial.
 *
 * El ámbar del semáforo NO es una alerta, y por eso ahora un `parcial` sí se
 * pinta. Un parcial casi siempre es deliberado —Quality Energy tiene Leads y no
 * quiere fichas—, así que ponerlo del color de aviso convertiría la pantalla en
 * un muro de alarmas falsas, que es lo que rompió la primera versión del mapa.
 * Amarillo dice lo que hay que decir: funciona, y se queda sin algo.
 */
function Nivel({ nivel }) {
  const t = semaforoNivel(nivel);
  return (
    <span
      className="text-[9.5px] uppercase tracking-[0.14em] px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ color: t.texto, background: t.suave, border: `1px solid ${t.borde}` }}
    >
      {nivel === "obligatorio" ? "obligatorio" : "pierde algo"}
    </span>
  );
}

/**
 * La columna «Necesita», en fichas y no en texto corrido.
 *
 * Antes iba el texto ya montado que calcula `textoNecesita()` —«Clientes +
 * Facturación», «(Clínica o Citas)»—, y para saber si eso era obligatorio había
 * que abrir el desplegable de la última columna. Ahora cada módulo es una ficha
 * del color de su nivel, así que la columna se recorre con el dedo: donde hay
 * rojo, sin eso no arranca.
 *
 * UN SOLO SEPARADOR PARA SUMAR: «+». El texto que monta `textoNecesita()` usa
 * «+» entre dependencias y «y» dentro de una, y las dos cosas significan lo
 * mismo —«hacen falta las dos»—, así que «Clientes y Leads profesionales +
 * Pacientes» hay que leerlo dos veces. Aquí todo lo que se suma lleva «+».
 *
 * La alternativa —Equipo avanzado vale con Clínica O con Citas— va con «o» y
 * ENCAJONADA. Sin la caja, «Equipo básico + Clínica o Citas» se puede leer como
 * si Citas bastara por sí sola. Ese matiz es justo el que hace que el catálogo
 * no sepa declarar esta dependencia.
 */
function Requisitos({ necesita, nombres }) {
  if (!necesita?.length) {
    return (
      <span style={{ color: "var(--apagado)" }} title="No necesita ningún otro módulo">
        —
      </span>
    );
  }

  const mas = (
    <span className="text-[11px]" style={{ color: "var(--tenue)" }}>
      +
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {necesita.map((dep, i) => {
        const fichas = dep.claves.map((k, n) => (
          <span key={k} className="flex items-center gap-1.5">
            {n > 0 &&
              (dep.cualquiera ? (
                <span className="text-[11px]" style={{ color: "var(--tenue)" }}>
                  o
                </span>
              ) : (
                mas
              ))}
            <Modulo clave={k} nombre={nombres[k]} nivel={dep.nivel} />
          </span>
        ));

        return (
          <span key={dep.claves.join("-")} className="flex flex-wrap items-center gap-1.5">
            {i > 0 && mas}
            {dep.cualquiera && dep.claves.length > 1 ? (
              <span
                className="flex flex-wrap items-center gap-1.5 rounded-md px-1.5 py-1"
                style={{ border: "1px dashed var(--line)" }}
                title="Basta con uno de los dos"
              >
                {fichas}
              </span>
            ) : (
              fichas
            )}
          </span>
        );
      })}
    </div>
  );
}

/**
 * La luz del semáforo: rojo no se vende solo, amarillo se vende y pierde algo,
 * verde independiente.
 *
 * Punto de color y no emoji porque en el back-office no hay ni un emoji, y uno
 * suelto en una tabla de veintidós filas canta. Dice exactamente lo mismo.
 */
function Punto({ severidad, tam = 9 }) {
  const t = semaforo(severidad);
  return (
    <span
      title={t.dice}
      aria-label={t.dice}
      className="inline-block rounded-full shrink-0"
      style={{ width: tam, height: tam, background: t.punto }}
    />
  );
}

/**
 * Los resúmenes de la matriz llevan trozos de código entre acentos graves
 * (`Invoice.clientId`, `leads`). Sin esto salían los acentos tal cual, que es
 * peor que no ponerlos. Se parte por pares y lo impar va en <code>.
 */
function ConCodigo({ texto }) {
  if (!texto) return null;
  return texto.split("`").map((trozo, i) =>
    i % 2 === 1 ? (
      <code key={i} style={{ color: "var(--text)" }}>
        {trozo}
      </code>
    ) : (
      <span key={i}>{trozo}</span>
    )
  );
}

/** Aviso de cabecera. Solo se pinta si hay algo que decir. */
function Aviso({ tono = "alerta", titulo, children }) {
  const color = tono === "ok" ? "var(--ok)" : "var(--alerta)";
  return (
    <div
      className="rounded-lg px-4 py-3.5 mb-4"
      style={{ background: "var(--panel)", border: `1px solid color-mix(in srgb, ${color} 30%, var(--line))` }}
    >
      <div className="text-[12px] uppercase tracking-[0.16em] mb-1.5" style={{ color }}>
        {titulo}
      </div>
      <div className="text-[12.5px] leading-relaxed" style={{ color: "var(--dim)" }}>
        {children}
      </div>
    </div>
  );
}

export default function IntegracionesPage() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [filtro, setFiltro] = useState("");
  const [cliente, setCliente] = useState(null);
  // Dos preguntas distintas sobre lo mismo: «¿qué pasa entre estos dos?» y
  // «¿esto se puede vender solo?». Se entra por la primera, que es la que trae
  // a alguien aquí con un cliente al teléfono.
  const [vista, setVista] = useState("tocan");

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
  const matriz = datos?.dependencias?.matriz ?? SIN_NADA;
  const discrepancias = datos?.dependencias?.discrepancias ?? SIN_NADA;
  const rotos = datos?.dependencias?.rotos ?? SIN_NADA;

  /**
   * La matriz, filtrada. Lista plana y NO agrupada: ya viene del servidor en el
   * orden de la tabla —lo que no se puede vender solo arriba— y ese orden es lo
   * que la hace útil. Agruparla por área de venta la volvía a mezclar.
   *
   * Con un cliente elegido se deja solo lo que tiene, que es la otra pregunta
   * real: «¿qué le falta a este para que le funcione todo?».
   */
  const filasDeps = useMemo(() => {
    const q = filtro.trim().toLowerCase();

    return matriz.filter((fila) => {
      if (cliente && !fila.loTienen.includes(cliente)) return false;
      if (!q) return true;
      return (
        fila.modulo.toLowerCase().includes(q) ||
        (nombres[fila.modulo] ?? "").toLowerCase().includes(q) ||
        (fila.resumen ?? "").toLowerCase().includes(q) ||
        (fila.necesitaTexto ?? "").toLowerCase().includes(q) ||
        fila.necesita.some(
          (d) =>
            d.claves.some((k) => k.toLowerCase().includes(q) || (nombres[k] ?? "").toLowerCase().includes(q)) ||
            d.porque.toLowerCase().includes(q)
        )
      );
    });
  }, [matriz, filtro, cliente, nombres]);

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
          {vista === "tocan" ? "Por dónde se" : "Qué necesita"}
          <br />
          <span style={{ fontStyle: "italic", color: "var(--ok)" }}>
            {vista === "tocan" ? "tocan los módulos" : "cada módulo"}
          </span>
        </h1>

        {/* Las dos preguntas. Se separan porque se hacen en momentos distintos:
            «qué necesita» antes de vender, «por dónde se tocan» cuando ya está
            vendido y algo no sale. */}
        <div className="mt-6 flex gap-1">
          {[
            ["tocan", "Por dónde se tocan"],
            ["necesitan", "Qué necesita cada uno"],
          ].map(([clave, rotulo]) => (
            <button
              key={clave}
              onClick={() => setVista(clave)}
              className="text-[12.5px] px-3 py-1.5 rounded transition-colors"
              style={{
                background: vista === clave ? "var(--panel-alto)" : "transparent",
                border: `1px solid ${vista === clave ? "var(--line)" : "transparent"}`,
                color: vista === clave ? "var(--text)" : "var(--tenue)",
              }}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {vista === "tocan" ? (
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
        ) : (
          <div className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-4">
            <div>
              <div className="text-[34px] leading-none tabular-nums">{datos.totales.modulos}</div>
              <Etiqueta>módulos</Etiqueta>
            </div>
            <div>
              <div className="text-[34px] leading-none tabular-nums" style={{ color: "var(--ok)" }}>
                {datos.totales.seVendenSolos}
              </div>
              <Etiqueta tono="ok">se venden solos</Etiqueta>
            </div>
            <div>
              <div
                className="text-[34px] leading-none tabular-nums"
                style={{ color: discrepancias.length > 0 ? "var(--alerta)" : "var(--ok)" }}
              >
                {discrepancias.length}
              </div>
              <Etiqueta tono={discrepancias.length > 0 ? "alerta" : "ok"}>el alta los vende mal</Etiqueta>
            </div>
            <div>
              <div
                className="text-[34px] leading-none tabular-nums"
                style={{ color: rotos.length > 0 ? "var(--alerta)" : "var(--ok)" }}
              >
                {rotos.length}
              </div>
              <Etiqueta tono={rotos.length > 0 ? "alerta" : "ok"}>clientes afectados</Etiqueta>
            </div>
            <p className="text-[12px] leading-relaxed max-w-xs ml-auto" style={{ color: "var(--dim)" }}>
              La pregunta de antes de vender. <strong>Obligatorio</strong> es que sin el otro no sirve
              para lo que se vende; <strong>pierde algo</strong> es que funciona y se queda sin una
              utilidad concreta, que casi siempre es a propósito.
            </p>
          </div>
        )}

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
          placeholder={
            vista === "tocan"
              ? "Filtrar por módulo o por lo que hace — p. ej. «citas», «convierte»"
              : "Filtrar por módulo o por lo que le falta — p. ej. «facturación», «clientes»"
          }
          className="mt-4 w-full max-w-md rounded-lg px-3 py-2 text-[13px] outline-none"
          style={{ background: "var(--panel)", border: "1px solid var(--line)", color: "var(--text)" }}
        />

        {elegido && vista === "tocan" && (
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

        {elegido && vista === "necesitan" && (
          <p className="mt-3 text-[12px]" style={{ color: "var(--dim)" }}>
            <strong>{elegido.nombre}</strong> tiene {plural(elegido.modulos, "módulo", "módulos")}.{" "}
            {rotos.filter((r) => r.slug === cliente).length === 0 ? (
              <span style={{ color: "var(--ok)" }}>Ninguno le falta una dependencia obligatoria.</span>
            ) : (
              <span style={{ color: "var(--alerta)" }}>
                {plural(
                  rotos.filter((r) => r.slug === cliente).length,
                  "módulo suyo no puede funcionar",
                  "módulos suyos no pueden funcionar"
                )}
                .
              </span>
            )}
          </p>
        )}
      </header>

      {vista === "necesitan" && (
        <>
          {discrepancias.length > 0 && (
            <Aviso titulo="el alta permite venderlos mal">
              Estos módulos se pueden marcar solos en el alta de clientes y no funcionarían, porque
              el catálogo no declara su <code>requiere</code>:{" "}
              {discrepancias.map((d, n) => (
                <span key={`${d.modulo}-${d.claves.join()}`}>
                  {n > 0 && " · "}
                  <strong style={{ color: "var(--text)" }}>{nombres[d.modulo] || d.modulo}</strong> sin{" "}
                  {d.claves.map((k) => nombres[k] || k).join(d.cualquiera ? " ni " : " y ")}
                </span>
              ))}
              . Se arregla en <code>lib/provisioning/catalogo.js</code>; el aviso desaparece solo
              cuando esté puesto.
            </Aviso>
          )}

          {rotos.length > 0 ? (
            <Aviso titulo="clientes que ya lo sufren">
              {rotos.map((r) => (
                <div key={`${r.slug}-${r.modulo}`}>
                  <strong style={{ color: "var(--text)" }}>{r.slug}</strong> tiene{" "}
                  {nombres[r.modulo] || r.modulo} y le falta {r.faltan.map((k) => nombres[k] || k).join(" y ")}.
                </div>
              ))}
            </Aviso>
          ) : (
            <Aviso tono="ok" titulo="ningún cliente afectado">
              Ninguno de los clientes de producción tiene hoy un módulo sin su dependencia
              obligatoria. Se comprueba en vivo contra <code>master.tenant_modules</code> cada vez
              que se abre esta pantalla.
            </Aviso>
          )}

          {filasDeps.length === 0 && (
            <p className="text-[13px]" style={{ color: "var(--tenue)" }}>
              Nada casa con lo que hay filtrado.
            </p>
          )}

          {/* Tabla y no tarjetas: la pregunta es comparativa —«¿cuáles puedo
              vender sueltos?»— y para eso hace falta poder recorrer una columna
              con el dedo. El detalle de cada dependencia, con su fichero y su
              línea, se despliega en la última celda para no ensuciar la lectura
              rápida. Scroll horizontal propio: la tabla no encoge la página. */}
          {filasDeps.length > 0 && (
            <div
              className="mt-7 rounded-xl overflow-hidden"
              style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left" style={{ minWidth: 860 }}>
                  <thead>
                    <tr style={{ background: "var(--panel-alto)" }}>
                      {/* La franja de color. Sin rótulo: lo dice la leyenda. */}
                      <th className="p-0" style={{ width: 4 }} />
                      <th className="py-2.5 pl-4 pr-4 text-[10px] uppercase tracking-[0.16em] font-normal" style={{ color: "var(--tenue)" }}>
                        Módulo
                      </th>
                      <th className="py-2.5 pr-4 text-[10px] uppercase tracking-[0.16em] font-normal" style={{ color: "var(--tenue)" }}>
                        Necesita
                      </th>
                      <th className="py-2.5 pr-4 text-[10px] uppercase tracking-[0.16em] font-normal whitespace-nowrap" style={{ color: "var(--tenue)" }}>
                        ¿Para funcionar?
                      </th>
                      <th className="py-2.5 pr-4 text-[10px] uppercase tracking-[0.16em] font-normal" style={{ color: "var(--tenue)" }}>
                        Qué pasa si no lo tiene
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasDeps.map((fila) => {
                      const t = semaforo(fila.severidad);
                      const leFalta = rotos.filter((r) => r.modulo === fila.modulo);
                      // El hilo entre filas va en las celdas y NO en la fila,
                      // para que la franja de color baje de un tirón y no salga
                      // troceada en veintidós pedazos.
                      const hilo = { borderTop: "1px solid var(--line-suave)" };
                      return (
                        <tr
                          key={fila.modulo}
                          className="align-top transition-colors hover:bg-[#FBF9F6]"
                        >
                          <td className="p-0" style={{ background: t.punto }} title={t.dice} />

                          <td className="py-3.5 pl-4 pr-4" style={hilo}>
                            <div className="text-[13px] leading-tight whitespace-nowrap font-medium">
                              {nombres[fila.modulo] || fila.modulo}
                            </div>
                            <div className="text-[10.5px] mt-0.5" style={{ color: "var(--tenue)" }}>
                              {fila.loTienen.length === 0 ? "nadie lo tiene" : fila.loTienen.join(", ")}
                            </div>
                          </td>

                          <td className="py-3.5 pr-4" style={hilo}>
                            <Requisitos necesita={fila.necesita} nombres={nombres} />
                          </td>

                          <td
                            className="py-3.5 pr-4 text-[12.5px] whitespace-nowrap font-medium"
                            style={{ ...hilo, color: t.texto }}
                          >
                            <span className="flex items-center gap-2">
                              <Punto severidad={fila.severidad} tam={8} />
                              {fila.paraFuncionar}
                            </span>
                          </td>

                          <td
                            className="py-3.5 pr-4 text-[12.5px] leading-relaxed"
                            style={{ ...hilo, color: "var(--dim)" }}
                          >
                            <ConCodigo texto={fila.resumen} />

                            {leFalta.length > 0 && (
                              <div className="mt-1 text-[11.5px] font-medium" style={{ color: SEMAFORO.rojo.texto }}>
                                le falta a {leFalta.map((r) => r.slug).join(", ")}
                              </div>
                            )}

                            {fila.nota && (
                              <div className="mt-1.5 text-[11.5px] leading-relaxed" style={{ color: "var(--tenue)" }}>
                                {fila.nota}
                              </div>
                            )}

                            {fila.necesita.length > 0 && (
                              <details className="mt-1.5">
                                <summary className="cursor-pointer text-[11px]" style={{ color: "var(--tenue)" }}>
                                  por qué, y dónde está en el código
                                </summary>
                                <div className="mt-2 space-y-2.5">
                                  {fila.necesita.map((dep) => (
                                    <div key={dep.claves.join("-")}>
                                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                        {dep.claves.map((k, n) => (
                                          <span key={k} className="flex items-center gap-1.5">
                                            {n > 0 && (
                                              <span className="text-[11px]" style={{ color: "var(--tenue)" }}>
                                                {dep.cualquiera ? "o" : "+"}
                                              </span>
                                            )}
                                            <Modulo clave={k} nombre={nombres[k]} nivel={dep.nivel} />
                                          </span>
                                        ))}
                                        <Nivel nivel={dep.nivel} />
                                      </div>
                                      <p className="text-[12px] leading-relaxed" style={{ color: "var(--dim)" }}>
                                        {dep.porque}
                                      </p>
                                      <div className="mt-1 text-[11px] leading-relaxed" style={{ color: "var(--tenue)" }}>
                                        {dep.donde?.map((d) => (
                                          <div key={d}>{d}</div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </details>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px]">
            {["rojo", "ambar", "verde"].map((s) => (
              <span key={s} className="flex items-center gap-1.5" style={{ color: semaforo(s).texto }}>
                <Punto severidad={s} /> {semaforo(s).dice.toLowerCase()}
              </span>
            ))}
            <span style={{ color: "var(--tenue)" }}>
              — el color de la fila sale de sus fichas: basta una roja para que el módulo no se
              pueda vender suelto.
            </span>
          </div>
        </>
      )}

      {vista === "tocan" && visibles.length === 0 && (
        <p className="text-[13px]" style={{ color: "var(--tenue)" }}>
          Nada casa con lo que hay filtrado.
        </p>
      )}

      <div className={`space-y-9 ${vista === "tocan" ? "" : "hidden"}`}>
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
        {vista === "tocan" ? (
          <>
            El mapa sale de <code>lib/provisioning/integraciones.js</code>, escrito leyendo el código, y
            se cruza en vivo con lo que cada cliente tiene contratado. «A medias» significa que tiene el
            módulo de origen y no el de destino: a veces es a propósito.
          </>
        ) : (
          <>
            La matriz sale de <code>lib/provisioning/dependencias.js</code>, escrita leyendo el código y
            comprobada contra el VPS llamando a los endpoints reales de los clientes activos. Cada
            dependencia lleva su fichero y su línea para poder verificarla dentro de seis meses. Los dos
            avisos de arriba se calculan, no se escriben: el de venta cruza con{" "}
            <code>catalogo.js</code> y el de clientes con <code>master.tenant_modules</code>.
          </>
        )}
      </p>
    </main>
  );
}
