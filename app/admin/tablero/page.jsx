"use client";

/**
 * Registro — lo que falta y lo que ya está.
 *
 * ⚠️ La CARPETA y la ruta siguen llamándose `tablero`: el 10/08/2026 se cambió
 * solo el rótulo, a petición de Jorge. Si algún día se renombra la ruta, hay que
 * mover también `/api/admin/tablero`.
 *
 * POR QUÉ EXISTE (09/08/2026)
 * El Registro (backlog y resuelto) es la fuente y está bien, pero nadie entra al
 * repositorio a mirar qué hay que hacer. Esta pantalla lo enseña donde Jorge y
 * Rodrigo ya entran. Es para LEER: el texto se publica con
 * `scripts/registro.mjs` (desde el 19/08/2026 vive en `master.tablero_documentos`,
 * antes en dos `.md` que viajaban dentro de la imagen de Docker), y aquí se ve.
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
 * Van a `master.tablero_estado`, aparte del texto, y se pintan encima de lo que
 * dice la versión publicada.
 *
 * El tick MUEVE la tarea de pestaña, así que después de guardarlo hay que volver
 * a pedir los datos: es el endpoint quien decide de qué lado cae cada una, y
 * duplicar aquí esa decisión es como se llega a dos pantallas que no coinciden.
 *
 * Y desde el 17/08/2026 el tick PREGUNTA antes (Jorge). Era un cuadro de 18px
 * pegado a la flecha de desplegar, así que bastaba un clic mal puesto para mover
 * una tarea de pestaña sin ningún aviso. El modal enseña el título de la tarea,
 * que es lo que hace que sirva: el error no es dudar, es la fila de al lado.
 *
 * Marcar aquí NO cierra una tarea de verdad: eso sigue siendo moverla a
 * Resuelto y publicar el Registro, con cómo se comprobó. El tick es para ponerse
 * de acuerdo entre los dos, y por eso lo marcado a mano se pinta en su propio
 * bloque en vez de mezclarse con lo cerrado y publicado.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { anchoPanel } from "@/components/admin/anchoPanel.js";
import { seccionDeHoy } from "@/lib/tablero/parser.js";
import { ordenarTareas } from "@/lib/tablero/estado.js";
import { tonoDe } from "@/components/admin/tableroTonos.js";
import {
  Capturas,
  ModalApuntar,
  ModalBorrar,
  ModalCerrar,
  ModalEditar,
  SelectorSeccion,
  moverTareaA,
} from "@/components/admin/TableroEditor.jsx";

/*
 * DE QUÉ COLOR VA CADA BLOQUE — se mudó a `components/admin/tableroTonos.js` el
 * 24/08/2026. No fue por ordenar: el selector de prioridad de las tarjetas tiene
 * que pintar sus botones con EXACTAMENTE los mismos colores que la lista, y con
 * dos listas eso dura hasta el primer cambio de color.
 */

/**
 * Los que no son un cliente. Agrupando por cliente van DESPUÉS de los clientes
 * de verdad: «producto» es una respuesta válida a «¿de quién es esto?», pero no
 * es quien llama por teléfono.
 */
const NO_ES_CLIENTE = new Set([
  "todos",
  "producto",
  "interno",
  "documentación",
  "varios",
  "sin asignar",
]);

function Etiqueta({ children, color }) {
  return (
    <span
      className="text-[10px] uppercase tracking-[0.18em]"
      style={{ color: color ?? "var(--tenue)" }}
    >
      {children}
    </span>
  );
}

/**
 * Los botones de dentro de una tarjeta (solución y copiar).
 *
 * Están apagados de color a propósito: la tarjeta ya tiene un tick, un reparto y
 * una etiqueta de urgencia, y tres botones más gritando dejarían el tablero
 * ilegible de un vistazo, que es justo para lo que sirve.
 */
/**
 * Una fila de botones para elegir UNA cosa: cómo agrupar, cómo ordenar.
 *
 * Existe desde el 26/08/2026, cuando el tablero pasó a tener DOS de estas. El
 * bloque de estilos era largo y estaba escrito a pelo; con dos copias, la
 * segunda vez que se toque un color una de las dos se queda con el viejo y
 * nadie lo nota hasta que se ven juntas.
 */
function Selector({ etiqueta, valor, opciones, onElegir }) {
  return (
    <div className="flex items-center gap-1">
      <Etiqueta>{etiqueta}</Etiqueta>
      {opciones.map(([clave, texto, ayuda]) => {
        const puesta = valor === clave;
        return (
          <button
            key={clave}
            type="button"
            title={ayuda}
            onClick={() => onElegir(clave)}
            className="px-2.5 py-1 rounded-md text-[12px] transition-colors cursor-pointer"
            style={{
              background: puesta ? "var(--panel-alto)" : "transparent",
              color: puesta ? "var(--text)" : "var(--tenue)",
              border: `1px solid ${puesta ? "var(--line)" : "transparent"}`,
            }}
          >
            {texto}
          </button>
        );
      })}
    </div>
  );
}

function BotonTarjeta({ children, onClick, ocupada = false, destacado = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={ocupada}
      className="text-[11.5px] px-2.5 py-1 rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      style={
        destacado
          ? { background: "var(--ok)", color: "#fff", border: "1px solid var(--ok)" }
          : { background: "var(--panel)", color: "var(--dim)", border: "1px solid var(--line)" }
      }
    >
      {children}
    </button>
  );
}

/**
 * El tick. Es un `button` y no un `input type=checkbox` a propósito: esto vive
 * dentro de un `<summary>`, donde cualquier clic despliega el detalle, así que
 * hace falta cortar el evento a mano — y un checkbox al que se le corta el
 * evento por defecto se queda pintando lo contrario de lo que hay guardado.
 *
 * No guarda al pulsarlo: abre el modal de confirmación (17/08/2026, Jorge). Es
 * un cuadro de 18px pegado a la flecha que despliega la tarea, así que un clic
 * mal puesto movía la tarea de pestaña sin decir nada.
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

/**
 * Confirmar el tick (17/08/2026, Jorge).
 *
 * Pregunta en las DOS direcciones. La de marcar es la que pidió Jorge, pero en
 * la pestaña de Resuelto el cuadro está en el mismo sitio de la fila, así que el
 * resbalón que REABRE una tarea cerrada es exactamente igual de fácil.
 *
 * Enseña el TÍTULO de la tarea, y eso es lo que hace que esto sirva para algo:
 * el fallo no es dudar de si quieres marcarla, es haber pulsado en la fila de al
 * lado. Un «¿seguro?» a secas no lo cazaría.
 *
 * El color va con la dirección, y no es decorativo: verde y ámbar son los dos
 * que la pantalla ya usa para los bloques «Marcadas» y «Reabiertas desde el
 * Registro», así que se sabe hacia dónde vas antes de leer una palabra.
 *
 * Si el guardado falla, el modal NO se cierra y lo dice aquí dentro: el aviso de
 * la cabecera puede quedar fuera de pantalla, y un modal que se cierra solo
 * después de fallar parece que ha funcionado.
 */
function ConfirmarTick({ tarea, resuelta, ocupada, fallo, onConfirmar, onCancelar }) {
  // El foco se pone a mano y no con `autoFocus`: React no aplica autoFocus
  // cuando hidrata un nodo que ya venía del servidor, y entonces el foco se
  // queda en el body — comprobado en el navegador, no supuesto.
  const cancelar = useRef(null);
  useEffect(() => {
    cancelar.current?.focus();
  }, []);

  useEffect(() => {
    const alPulsar = (e) => {
      if (e.key === "Escape" && !ocupada) onCancelar();
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [ocupada, onCancelar]);

  const acento = resuelta ? "#B45309" : "var(--ok)";
  const accion = resuelta ? "Devolver a pendiente" : "Marcar como resuelta";

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center px-4"
      style={{ background: "rgba(21,20,15,0.45)" }}
      onClick={ocupada ? undefined : onCancelar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmar-tick-titulo"
        onClick={(e) => e.stopPropagation()}
        className="relative z-50 w-full max-w-md rounded-xl p-5 max-h-[85dvh] overflow-auto"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          boxShadow: "0 18px 50px -12px rgba(21,20,15,0.28)",
        }}
      >
        <Etiqueta color={acento}>Vas a {accion.toLowerCase()}</Etiqueta>
        <h2
          id="confirmar-tick-titulo"
          className="mt-2 text-[19px] leading-snug"
          style={{ fontFamily: "var(--admin-display)" }}
        >
          {tarea.titulo}
        </h2>

        {tarea.quien && (
          <span
            className="mt-2.5 inline-block text-[11px] px-1.5 py-0.5 rounded"
            style={{
              color: "var(--dim)",
              border: "1px solid color-mix(in srgb, var(--tenue) 35%, transparent)",
            }}
          >
            {tarea.quien}
          </span>
        )}

        <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: "var(--dim)" }}>
          {resuelta
            ? "Vuelve a Pendiente, al bloque «Reabiertas desde el Registro», y lo veis los dos."
            : "Sale de Pendiente y pasa a Resuelto, y lo veis los dos."}
        </p>

        {/* El recordatorio va solo al marcar: es donde se confunde una cosa con
            la otra. Al reabrir no hay nada que aclarar. */}
        {!resuelta && (
          <p className="mt-2 text-[11.5px] leading-relaxed" style={{ color: "var(--tenue)" }}>
            No la cierra del todo. Eso sigue siendo moverla a Resuelto y publicar el Registro, con
            cómo se comprobó.
          </p>
        )}

        {fallo && (
          <p className="mt-3 text-[12px]" style={{ color: "var(--alerta)" }}>
            No se ha podido guardar: {fallo}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          {/* El foco arranca en Cancelar: si esto se abre por un clic que no
              querías, un Enter de más no debe confirmarlo. */}
          <button
            type="button"
            ref={cancelar}
            onClick={onCancelar}
            disabled={ocupada}
            className="text-[12px] px-3 py-1.5 rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              background: "var(--panel-alto)",
              color: "var(--dim)",
              border: "1px solid var(--line)",
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={ocupada}
            className="text-[12px] px-3 py-1.5 rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ background: acento, color: "#fff", border: `1px solid ${acento}` }}
          >
            {ocupada ? "Guardando…" : accion}
          </button>
        </div>
      </div>
    </div>
  );
}

/** «19/08 16:40» en hora de Madrid, que es donde se lee. */
function cuando(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

/**
 * Cuándo se apuntó una tarea, para la fila cerrada: «26/08».
 *
 * Sin año mientras sea el de hoy, que es el caso de todas: el sitio en esa fila
 * es poco y el año repetido veinte veces no dice nada. En cuanto una tarea
 * cumple el año, el año aparece — y esa es justo la que interesa ver.
 */
function fechaCorta(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const opciones = { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit" };
    if (d.getFullYear() !== new Date().getFullYear()) opciones.year = "2-digit";
    return new Intl.DateTimeFormat("es-ES", opciones).format(d);
  } catch {
    return null;
  }
}

/** La misma fecha entera, para el globito: «26 de agosto de 2026». */
function fechaLarga(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("es-ES", {
      timeZone: "Europe/Madrid",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

/**
 * De dónde sale el texto de cada pestaña (19/08/2026).
 *
 * Una línea por documento: «Pendiente · v12 · 19/08 16:40 · jorge · «apuntar el
 * buscador»». Existe porque con el texto en una tabla ya no hay commit que
 * mirar para saber si lo que se ve es lo último: la versión y la hora son esa
 * respuesta. Y si sale «leído del fichero», en producción significa que nadie
 * ha publicado todavía — se pinta en ámbar para que no pase por bueno.
 */
function Procedencia({ documentos }) {
  if (!documentos) return null;
  const filas = [
    ["Pendiente", documentos.backlog],
    ["Resuelto", documentos.resuelto],
  ].filter(([, m]) => m);
  if (!filas.length) return null;
  return (
    <div className="mt-4 space-y-0.5">
      {filas.map(([nombre, m]) => (
        <p
          key={nombre}
          className="text-[11px] tabular-nums"
          style={{ color: m.origen === "base" ? "var(--tenue)" : "#B45309" }}
        >
          <span className="uppercase tracking-[0.14em]">{nombre}</span>
          {m.origen === "base" ? (
            <>
              {" · "}v{m.version}
              {cuando(m.publicadoEn) && <> · {cuando(m.publicadoEn)}</>}
              {m.publicadoPor && <> · {m.publicadoPor}</>}
              {m.nota && <> · «{m.nota}»</>}
            </>
          ) : (
            <> · leído del fichero {m.ruta ? <code>{m.ruta}</code> : null}, sin versión publicada</>
          )}
        </p>
      ))}
    </div>
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
  /*
   * CÓMO SE ORDENA DENTRO DE CADA BLOQUE (26/08/2026, Jorge: «que se pueda
   * ordenar por fecha, de momento solo está ordenado por prioridad»).
   *
   * Se abre en «prioridad», que es el orden del documento y el de siempre: la
   * pantalla no puede cambiar de aspecto sola el día que se despliegue esto.
   * Ordenar y agrupar son ejes distintos y se combinan — por cliente + antiguas
   * contesta «¿qué le llevamos debiendo más tiempo a Aumenta?».
   */
  const [orden, setOrden] = useState("prioridad");
  // La tarea que se está guardando ahora mismo, por su clave: se le apagan los
  // botones para que dos clics seguidos no manden dos cambios cruzados.
  const [guardando, setGuardando] = useState(null);
  const [fallo, setFallo] = useState(null);
  // Qué tarea tiene el cuadro de la solución abierto, y lo que lleva escrito sin
  // guardar. Solo una a la vez: dos cuadros abiertos con dos borradores es la
  // forma más rápida de guardar el texto en la tarea equivocada.
  const [editando, setEditando] = useState(null);
  const [borrador, setBorrador] = useState("");
  // La clave de la que se acaba de copiar, para poder decirlo. Se borra sola.
  const [copiada, setCopiada] = useState(null);
  // La tarea cuyo tick está esperando confirmación: `{ tarea, resuelta }`, donde
  // `resuelta` es de qué lado venía. Null = no hay modal abierto.
  const [confirmando, setConfirmando] = useState(null);

  /*
   * ── ESCRIBIR EN EL REGISTRO DESDE AQUÍ (24/08/2026) ──────────────────────
   * Hasta hoy esta pantalla solo leía: apuntar o mover una tarea era bajar el
   * Registro, editar el markdown y publicar con `registro.mjs`, o sea que hacía
   * falta el ordenador con el repo y la llave del VPS. Se nota en el propio
   * historial: 16 versiones publicadas por dos usuarios de máquina.
   *
   * Cada uno de estos cuatro guarda la tarea que tiene el modal abierto. Se
   * mantienen separados del `confirmando` del tick a propósito: el tick NO toca
   * el documento y esto sí, y mezclarlos llevaría a un modal que unas veces
   * guarda una fila y otras publica una versión de 40 KB.
   */
  const [apuntando, setApuntando] = useState(false);
  const [reescribiendo, setReescribiendo] = useState(null);
  const [cerrandoTarea, setCerrandoTarea] = useState(null);
  const [borrando, setBorrando] = useState(null);

  useEffect(() => {
    document.title = "Registro — Salamandra";
  }, []);

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

  useEffect(() => {
    cargar();
  }, [cargar]);

  /**
   * Guarda un cambio y vuelve a pedir el tablero entero.
   *
   * Se recarga en vez de tocar el estado local porque el tick MUEVE la tarea de
   * pestaña, y quién cae de qué lado lo decide el endpoint. Reproducir aquí esa
   * regla es cómo se acaba con dos pantallas que no dicen lo mismo.
   *
   * Devuelve si ha ido bien, para que quien llame pueda decidir qué hacer al
   * fallar: el modal del tick se queda abierto en vez de cerrarse como si nada.
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
      return true;
    } catch (e) {
      setFallo(e.message);
      return false;
    } finally {
      setGuardando(null);
    }
  }

  /**
   * La tarea entera en texto, lista para pegar.
   *
   * Sale de aquí y no de la pantalla porque la pantalla la parte en trozos —el
   * título arriba, el cliente en una etiqueta, el cuerpo dentro del desplegable,
   * la solución más abajo— y seleccionarlos a mano es justo lo que este botón
   * viene a evitar. El orden es el de siempre: qué pasa, de quién es, el detalle,
   * y lo que ya hemos pensado.
   *
   * Sin markdown: se pega en un chat, no en un fichero.
   */
  function comoTexto(t) {
    const trozos = [t.titulo];
    if (t.quien) trozos.push(`Cliente: ${t.quien}`);
    if (t.cuerpo?.trim()) trozos.push("", t.cuerpo.trim());
    if (t.solucion?.trim()) trozos.push("", "Solución propuesta:", t.solucion.trim());
    return trozos.join("\n");
  }

  async function copiar(t) {
    try {
      await navigator.clipboard.writeText(comoTexto(t));
      setCopiada(t.clave);
      setFallo(null);
      // Se apaga sola: un «copiado» que se queda fijo deja de significar nada
      // cuando copias la siguiente.
      setTimeout(() => setCopiada((c) => (c === t.clave ? null : c)), 2000);
    } catch {
      // El portapapeles necesita HTTPS y permiso del navegador. Si lo niega hay
      // que decirlo: un botón que no hace nada y no se queja es peor que no
      // tenerlo.
      setFallo("El navegador no ha dejado copiar. Abre la tarea y cópiala a mano.");
    }
  }

  /** Guarda la solución escrita a mano y cierra el cuadro. */
  async function guardarSolucion(t) {
    await tocar(t, { solucion: borrador });
    setEditando(null);
    setBorrador("");
  }

  /**
   * El tick, con la fuente delante.
   *
   * Solo se guarda lo que se DESVÍA del Registro publicado: marcar una tarea que
   * ya está en Resuelto no necesita fila (vuelve a `null`, «manda el texto»), y
   * lo mismo al devolver a pendiente una que está en el backlog.
   * Así el estado guardado no acumula filas que no dicen nada.
   */
  function alternarTick(t, estaResuelta) {
    const quiero = !estaResuelta;
    const loQueDiceElFichero = t.fuente === "resuelto";
    return tocar(t, { marcada: quiero === loQueDiceElFichero ? null : quiero });
  }

  /** Lo que pasa al aceptar el modal. Solo se cierra si el guardado ha ido bien. */
  async function confirmarTick() {
    const { tarea, resuelta } = confirmando;
    if (await alternarTick(tarea, resuelta)) setConfirmando(null);
  }

  /**
   * Cambiar una tarea de sección, que es cambiarle la prioridad.
   *
   * Sin confirmación a propósito: es reversible con otro clic y es el gesto que
   * más se va a hacer desde el móvil. Publica una versión igual, y eso se acepta.
   */
  async function moverA(t, seccion) {
    setGuardando(t.clave);
    setFallo(null);
    try {
      await moverTareaA(t, seccion);
      await cargar();
    } catch (e) {
      setFallo(e.message);
    } finally {
      setGuardando(null);
    }
  }

  /** Cerrar el modal que sea y recargar: el documento ha cambiado por debajo. */
  const trasEscribir = useCallback(async () => {
    setApuntando(false);
    setReescribiendo(null);
    setCerrandoTarea(null);
    setBorrando(null);
    await cargar();
  }, [cargar]);

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
          /*
           * El nombre de HOY, no el que esté escrito en el documento. Mientras
           * el texto publicado siga en `P0`…`P3`, la cabecera decía «P1 — esta
           * semana» y la etiqueta de cada fila «ALTA»: la misma cosa con dos
           * nombres, en la misma pantalla. `seccionDeHoy` deja pasar tal cual lo
           * que ya está en su nombre nuevo y los dos bloques que se inventa el
           * endpoint («Marcadas desde el Registro» y su pareja).
           */
          titulo: seccionDeHoy(s.titulo),
          etiqueta: tono.etiqueta,
          color: tono.color,
          tareas: ordenarTareas(
            s.tareas.map((t) => ({ ...t, tono, deSeccion: null })),
            orden
          ),
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
      .map(([titulo, tareas]) => ({
        titulo,
        etiqueta: null,
        color: "var(--tenue)",
        tareas: ordenarTareas(tareas, orden),
      }))
      .sort((a, b) => {
        const ga = NO_ES_CLIENTE.has(a.titulo) ? 1 : 0;
        const gb = NO_ES_CLIENTE.has(b.titulo) ? 1 : 0;
        if (ga !== gb) return ga - gb;
        return b.tareas.length - a.tareas.length || a.titulo.localeCompare(b.titulo);
      });
  }, [visibles, agrupacion, orden]);

  const cuantas = (clave) => (datos?.[clave] ?? []).reduce((n, s) => n + s.tareas.length, 0);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div style={{ fontFamily: "var(--admin-display)" }} className="text-3xl mb-3">
            No se puede mostrar
          </div>
          <p className="text-[13px]" style={{ color: "var(--dim)" }}>
            {error}
          </p>
        </div>
      </main>
    );
  }

  if (!datos) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <span
          className="text-[12px] tracking-[0.2em] uppercase animate-pulse"
          style={{ color: "var(--tenue)" }}
        >
          Leyendo el registro
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
          Qué hay
          <br />
          <span style={{ fontStyle: "italic", color: "var(--ok)" }}>que hacer</span>
        </h1>

        {/* De dónde sale el texto: la versión publicada, con fecha y quién. Si
            en producción se está leyendo de un fichero, es que nadie ha
            publicado todavía, y eso hay que verlo sin abrir nada. */}
        <Procedencia documentos={datos.documentos} />

        {datos.faltan?.length > 0 && (
          <p className="mt-4 text-[12px]" style={{ color: "var(--alerta)" }}>
            No se ha podido leer: {datos.faltan.join(", ")}. Ni hay versión publicada ni fichero de
            respaldo — el registro está incompleto.
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

          {/* Agrupar y ordenar. Los dos se conservan al cambiar de pestaña,
              igual que el filtro: «¿cómo vamos con Aumenta?» incluye lo
              entregado, y «¿qué es lo último que entró?» también.

              Son DOS ejes y no uno con cuatro valores: agrupar dice en qué
              montones cae la lista, ordenar dice en qué orden va cada montón.
              Se combinan — por cliente + antiguas contesta «¿qué le llevamos
              debiendo más tiempo a Aumenta?», que agrupando solo no se ve. */}
          <div className="flex items-center gap-5 flex-wrap">
            <Selector
              etiqueta="Agrupar por"
              valor={agrupacion}
              onElegir={setAgrupacion}
              opciones={[
                ["urgencia", "Urgencia", "Un bloque por prioridad"],
                ["cliente", "Cliente", "Un bloque por cliente"],
              ]}
            />
            <Selector
              etiqueta="Ordenar"
              valor={orden}
              onElegir={setOrden}
              opciones={[
                ["prioridad", "Prioridad", "El orden del propio Registro"],
                ["recientes", "Recientes", "Lo último que se apuntó, arriba"],
                ["antiguas", "Antiguas", "Lo que lleva más tiempo esperando, arriba"],
              ]}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar por cliente — p. ej. «aumenta», «nutri_laura»"
            className="flex-1 min-w-[240px] max-w-md rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              color: "var(--text)",
            }}
          />
          {/*
            APUNTAR (24/08/2026). Va aquí arriba y con color porque es lo que la
            pantalla no podía hacer: el tablero se hizo para mirarlo desde el
            móvil —desde ahí se reparte y se marca— pero lo que se piensa en el
            coche no entraba en el Registro, se quedaba en un WhatsApp.

            No sale en la pestaña de Resuelto: ahí no se apunta nada, y un botón
            que abre un formulario para escribir en el otro documento sería una
            trampa.
          */}
          {pestaña === "pendiente" && (
            <button
              type="button"
              onClick={() => {
                setFallo(null);
                setApuntando(true);
              }}
              className="px-3.5 py-2 rounded-lg text-[13px] transition-colors cursor-pointer"
              style={{ background: "var(--ok)", color: "#fff", border: "1px solid var(--ok)" }}
            >
              Apuntar una tarea
            </button>
          )}
        </div>
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
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      aria-hidden="true"
                      className="shrink-0 mt-[4px] w-3 h-3 transition-transform group-open:rotate-90"
                      style={{ color: "var(--apagado)" }}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <Tick
                      marcada={pestaña === "resuelto"}
                      ocupada={guardando === t.clave}
                      onToggle={() => {
                        // Se limpia el fallo anterior: si no, el modal se abre
                        // enseñando el error de otra cosa.
                        setFallo(null);
                        setConfirmando({ tarea: t, resuelta: pestaña === "resuelto" });
                      }}
                    />
                    <span
                      className="inline-block w-[3px] rounded-full shrink-0 self-stretch"
                      style={{ background: t.tono.color }}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="text-[14px]">{t.titulo}</span>
                      {/*
                        LA PRIORIDAD, EN LA FILA Y SIN ABRIR NADA (24/08/2026,
                        Jorge: «que no haya que meterse dentro de ella para
                        verla»).

                        Antes esta etiqueta solo salía agrupando por CLIENTE
                        —cuando la cabecera del bloque dejaba de decir la
                        urgencia— y agrupando por urgencia se fiaba de la barrita
                        de 3 px de la izquierda. Tres píxeles de color no son una
                        etiqueta: hay que saberse el código para leerlos, y la
                        pregunta que se hace mirando esta lista es exactamente
                        «¿cuál corre prisa?».

                        Ahora va SIEMPRE, con el color de su prioridad y en una
                        cajita, para que se lea de un vistazo en la fila cerrada.
                        `t.seccion` es dónde está escrita de verdad; `deSeccion`
                        solo lo llevan las que el tick ha movido de lado.
                      */}
                      {t.tono.etiqueta && (
                        <span
                          className="ml-2 text-[10px] uppercase tracking-[0.14em] whitespace-nowrap px-1.5 py-0.5 rounded"
                          style={{
                            color: t.tono.color,
                            border: `1px solid ${t.tono.color}`,
                          }}
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
                      {/*
                        CUÁNDO SE APUNTÓ (26/08/2026, Jorge).

                        Va SIN cajita, a diferencia de la prioridad y del
                        cliente, y es a propósito: la fila ya lleva dos
                        recuadros y un tercero la convierte en un formulario.
                        Esto es un dato de apoyo — se busca cuando se busca — y
                        con que se lea de refilón basta.

                        Y va aunque se esté ordenando por prioridad: sin la
                        fecha delante, un orden por fecha es un salto de fe.
                        Si no la hay se calla — no se escribe «sin fecha» en
                        veinte filas para decir lo mismo veinte veces.
                      */}
                      {fechaCorta(t.apuntadaEn) && (
                        <span
                          className="ml-2 text-[11px] tabular-nums whitespace-nowrap"
                          style={{ color: "var(--tenue)" }}
                          title={`Apuntada el ${fechaLarga(t.apuntadaEn)}`}
                        >
                          {fechaCorta(t.apuntadaEn)}
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
                  {/* Las capturas, justo debajo del cuerpo: son la prueba de lo
                      que dice el texto, no un anexo. Van antes que la solución
                      por lo mismo — primero qué pasa, después qué se hace.
                      ⚠️ Pueden llevar datos de un paciente y no se recortan
                      (Jorge, 24/08/2026): una captura recortada de la pantalla
                      que falla deja de ser la prueba de lo que falla. */}
                  <Capturas
                    tarea={t}
                    documento={t.fuente ?? "backlog"}
                    ocupada={guardando === t.clave}
                    onCambio={cargar}
                    onFallo={setFallo}
                  />

                  {/* La solución escrita a mano. Se enseña SIEMPRE que exista, y
                      no escondida detrás del botón: para eso se escribió. */}
                  {t.solucion && editando !== t.clave && (
                    <div
                      className="mt-3 ml-[15px] rounded px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap"
                      style={{ background: "var(--panel-alto)", color: "var(--dim)" }}
                    >
                      <span
                        className="block text-[10px] uppercase tracking-[0.16em] mb-1"
                        style={{ color: "var(--tenue)" }}
                      >
                        Solución propuesta
                      </span>
                      {t.solucion}
                    </div>
                  )}

                  {/*
                    LA PRIORIDAD, EN LA PROPIA TARJETA (24/08/2026).
                    La prioridad ES la sección del documento, así que cambiarla
                    obligaba a bajar el Registro, cortar y pegar el bloque entero
                    y publicar una versión: hacía falta el ordenador con el repo.
                    Y se nota en el historial — la v10 se publicó, entre otras
                    cosas, «para bajar a P3 la del embudo de Aumenta», o sea que
                    un cambio de prioridad se coló dentro de una publicación que
                    iba a otra cosa.

                    Solo en Pendiente: en Resuelto la sección es una fecha y no
                    hay prioridad que cambiar.
                  */}
                  {pestaña === "pendiente" && t.seccion && (
                    <div className="mt-3 ml-[15px] flex items-center gap-2 flex-wrap">
                      <span
                        className="text-[10px] uppercase tracking-[0.16em]"
                        style={{ color: "var(--tenue)" }}
                      >
                        Prioridad
                      </span>
                      <SelectorSeccion
                        seccion={seccionDeHoy(t.seccion)}
                        ocupada={guardando === t.clave}
                        onElegir={(s) => moverA(t, s)}
                        compacto
                      />
                    </div>
                  )}

                  {editando === t.clave ? (
                    <div className="mt-3 ml-[15px]">
                      <textarea
                        value={borrador}
                        onChange={(e) => setBorrador(e.target.value)}
                        rows={5}
                        autoFocus
                        placeholder="Cómo se arregla. Lo que sepas ahora vale: dónde está, qué hay que tocar, con qué se comprueba."
                        className="w-full rounded px-3 py-2 text-[12.5px] leading-relaxed outline-none"
                        style={{
                          background: "var(--panel-alto)",
                          border: "1px solid var(--line)",
                          color: "var(--text)",
                        }}
                      />
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <BotonTarjeta
                          onClick={() => guardarSolucion(t)}
                          ocupada={guardando === t.clave}
                          destacado
                        >
                          {guardando === t.clave ? "Guardando…" : "Guardar"}
                        </BotonTarjeta>
                        <BotonTarjeta
                          onClick={() => {
                            setEditando(null);
                            setBorrador("");
                          }}
                        >
                          Cancelar
                        </BotonTarjeta>
                        {/* Vaciar el cuadro y guardar la borra: se dice, porque
                            si no nadie lo descubre. */}
                        {t.solucion && (
                          <span className="text-[11px]" style={{ color: "var(--tenue)" }}>
                            Déjalo en blanco para borrarla.
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 ml-[15px] flex items-center gap-2 flex-wrap">
                      <BotonTarjeta
                        onClick={() => {
                          setEditando(t.clave);
                          setBorrador(t.solucion ?? "");
                        }}
                        ocupada={guardando === t.clave}
                      >
                        {t.solucion ? "Editar solución" : "Solución"}
                      </BotonTarjeta>
                      {/* Copia título, cliente, descripción y solución de un
                          golpe, para poder pegarle la tarea entera a Claude. */}
                      <BotonTarjeta onClick={() => copiar(t)}>
                        {copiada === t.clave ? "Copiado ✓" : "Copiar"}
                      </BotonTarjeta>

                      {/*
                        Los tres que TOCAN EL DOCUMENTO. Van detrás de los dos
                        de siempre y no destacados: los de arriba son gestos de
                        todos los días, estos publican una versión del Registro.

                        «Cerrar» y «Borrar» están pegados y significan cosas
                        opuestas —una deja la tarea escrita en Resuelto y la otra
                        la quita sin rastro—, así que los dos preguntan antes, y
                        el modal de borrar lo dice con esas palabras. Es el mismo
                        problema que ya obligó a poner confirmación en el tick el
                        17/08: el fallo no es dudar, es la fila de al lado.
                      */}
                      {pestaña === "pendiente" && (
                        <>
                          <BotonTarjeta
                            onClick={() => {
                              setFallo(null);
                              setReescribiendo(t);
                            }}
                            ocupada={guardando === t.clave}
                          >
                            Reescribir
                          </BotonTarjeta>
                          <BotonTarjeta
                            onClick={() => {
                              setFallo(null);
                              setCerrandoTarea(t);
                            }}
                            ocupada={guardando === t.clave}
                          >
                            Cerrar
                          </BotonTarjeta>
                          <BotonTarjeta
                            onClick={() => {
                              setFallo(null);
                              setBorrando(t);
                            }}
                            ocupada={guardando === t.clave}
                          >
                            Borrar
                          </BotonTarjeta>
                        </>
                      )}
                    </div>
                  )}

                  {t.tocadaPor && t.marcada !== null && (
                    <p className="mt-2 ml-[15px] text-[11px]" style={{ color: "var(--tenue)" }}>
                      {t.marcada ? "Marcada" : "Reabierta"} aquí por {t.tocadaPor} — sin publicarlo
                      en el Registro.
                    </p>
                  )}
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-10 text-[11px] leading-relaxed" style={{ color: "var(--tenue)" }}>
        El texto de cada tarea es la última versión publicada del Registro. Apuntar, mover,
        reescribir, cerrar y borrar se hace desde aquí y publica una versión nueva, con tu nombre y
        el motivo; para editar a mano sigue estando{" "}
        <code>node scripts/registro.mjs bajar</code> / <code>subir</code>, y el manual es{" "}
        <code>docs/como-apuntar-en-el-tablero.md</code>. Las dos puertas son la misma: mismos frenos
        de formato, misma versión, mismo historial.
        <br />
        Lo apuntado sobre la marcha cae en <strong>Sin comprobar</strong> hasta que alguien lo vea en
        producción; darle prioridad es justo el gesto de haberlo comprobado.
        <br />
        El tick y el reparto se guardan aparte y no tocan el documento: marcar una tarea la mueve de
        pestaña para que los dos sepáis por dónde va, y no sustituye a cerrarla.
      </p>

      {/* Fuera de la lista a propósito: dentro del `<details>` heredaría el clic
          que despliega la tarjeta. */}
      {confirmando && (
        <ConfirmarTick
          tarea={confirmando.tarea}
          resuelta={confirmando.resuelta}
          ocupada={guardando === confirmando.tarea.clave}
          fallo={fallo}
          onConfirmar={confirmarTick}
          onCancelar={() => setConfirmando(null)}
        />
      )}

      {/* Los cuatro que escriben en el documento. Fuera de la lista por lo mismo
          que el de arriba: dentro del `<details>` heredarían el clic que
          despliega la tarjeta. */}
      {apuntando && <ModalApuntar onHecho={trasEscribir} onCerrar={() => setApuntando(false)} />}
      {reescribiendo && (
        <ModalEditar
          tarea={reescribiendo}
          /* La versión que tenemos delante. El servidor la exige SOLO para
             reescribir, que es lo único que sustituye texto escrito por una
             persona: si alguien publicó mientras tanto, lo rechaza y lo dice. */
          version={datos.documentos?.backlog?.version}
          onHecho={trasEscribir}
          onCerrar={() => setReescribiendo(null)}
        />
      )}
      {cerrandoTarea && (
        <ModalCerrar
          tarea={cerrandoTarea}
          onHecho={trasEscribir}
          onCerrar={() => setCerrandoTarea(null)}
        />
      )}
      {borrando && (
        <ModalBorrar tarea={borrando} onHecho={trasEscribir} onCerrar={() => setBorrando(null)} />
      )}
    </main>
  );
}
