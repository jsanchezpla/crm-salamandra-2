"use client";

/**
 * components/admin/TableroEditor.jsx — escribir en el Registro desde la pantalla.
 *
 * ── POR QUÉ ESTÁ FUERA DE `app/admin/tablero/page.jsx` ────────────────────
 * Esa pantalla ya son 900 líneas y es la que Jorge y Rodrigo miran todos los
 * días. Lo de aquí —apuntar, mover, reescribir, cerrar y borrar— es media
 * pantalla más, y metida dentro dejaría un fichero que nadie se atreve a tocar
 * (que es, literalmente, una de las tareas del propio Registro: «cuatro
 * pantallas pasan de las 1.800 líneas y cada cambio ahí es a ciegas»). Aquí
 * dentro no hay ninguna decisión sobre CÓMO se lee el tablero: solo sobre cómo
 * se escribe.
 *
 * ── LO QUE ESTA PANTALLA NO DECIDE ────────────────────────────────────────
 * Nada de lo de aquí sabe escribir markdown ni conoce el formato del Registro.
 * Manda lo que la persona ha escrito a `/api/admin/tablero/tareas` y es el
 * servidor quien reescribe el documento y publica la versión, con los mismos
 * frenos que `scripts/registro.mjs`. Si esta pantalla supiera componer el texto,
 * habría dos sitios que saben el formato y solo uno se acordaría de cambiarlo.
 *
 * ── LOS DOS AVISOS QUE SE DAN EN VOZ ALTA ─────────────────────────────────
 * Cada botón de aquí PUBLICA UNA VERSIÓN del Registro, y eso no es lo mismo que
 * guardar un tick: queda en el historial con quién y por qué. Y borrar no es
 * cerrar — se pregunta con otras palabras y con otro color, porque son la misma
 * fila y el resbalón es el de siempre.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { PRIORIDADES, SECCIONES_BACKLOG } from "../../lib/tablero/parser.js";
import { tonoDe } from "./tableroTonos.js";

/** Lo que se ofrece al mover: las tres prioridades y las dos salas de espera. */
export const SECCIONES = SECCIONES_BACKLOG;

/** Cuáles llevan color. Las otras se pintan en gris, que es lo que significan. */
const ES_PRIORIDAD = new Set(PRIORIDADES);

/* ── Hablar con el endpoint ──────────────────────────────────────────────── */

async function pedir(metodo, cuerpo) {
  const r = await fetch("/api/admin/tablero/tareas", {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
  return j.data;
}

/**
 * Cómo se le dice al servidor de qué tarea hablamos: por ficha si la tiene, y si
 * no por su título normalizado.
 *
 * La ficha es lo único que sobrevive a que alguien reescriba el título; las
 * tareas escritas antes del 24/08/2026 no la llevan y van por clave hasta que se
 * las toque una vez desde aquí.
 */
const referirse = (t) => (t.id ? { id: t.id } : { clave: t.clave });

/* ── El armazón de los modales ───────────────────────────────────────────── */

/**
 * Ventana modal, con las tres cosas que se olvidan siempre: Escape cierra, el
 * clic en el fondo cierra, y el foco arranca DENTRO (si no, un Enter de más se
 * lo come la página de detrás).
 *
 * Las capas son las de la regla 13 de CLAUDE.md: fondo en `z-40`, panel en
 * `z-50`. Y `max-h-[85dvh] overflow-auto` porque el formulario de apuntar no cabe
 * en un móvil en horizontal.
 */
function Modal({ titulo, etiqueta, acento, children, onCerrar, ocupada }) {
  const primero = useRef(null);

  useEffect(() => {
    primero.current?.focus();
  }, []);

  useEffect(() => {
    const alPulsar = (e) => {
      if (e.key === "Escape" && !ocupada) onCerrar();
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [ocupada, onCerrar]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center px-4"
      style={{ background: "rgba(21,20,15,0.45)" }}
      onClick={ocupada ? undefined : onCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="relative z-50 w-full max-w-lg rounded-xl p-5 max-h-[85dvh] overflow-auto"
        style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          boxShadow: "0 18px 50px -12px rgba(21,20,15,0.28)",
        }}
      >
        <span
          className="text-[10px] uppercase tracking-[0.18em]"
          style={{ color: acento ?? "var(--tenue)" }}
        >
          {etiqueta}
        </span>
        <h2 className="mt-2 text-[19px] leading-snug" style={{ fontFamily: "var(--admin-display)" }}>
          {titulo}
        </h2>
        <span ref={primero} tabIndex={-1} />
        {children}
      </div>
    </div>
  );
}

/** Los dos botones del pie de un modal, siempre en el mismo orden. */
function PieDeModal({ acento, hacer, etiqueta, ocupada, onCerrar, puede = true }) {
  return (
    <div className="mt-5 flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={onCerrar}
        disabled={ocupada}
        className="text-[12px] px-3 py-1.5 rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ background: "var(--panel-alto)", color: "var(--dim)", border: "1px solid var(--line)" }}
      >
        Cancelar
      </button>
      <button
        type="button"
        onClick={hacer}
        disabled={ocupada || !puede}
        className="text-[12px] px-3 py-1.5 rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ background: acento, color: "#fff", border: `1px solid ${acento}` }}
      >
        {ocupada ? "Publicando…" : etiqueta}
      </button>
    </div>
  );
}

/** El aviso de que esto publica una versión. Se repite en los cuatro modales. */
function AvisoDePublicacion({ children }) {
  return (
    <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: "var(--tenue)" }}>
      {children} Publica una versión nueva del Registro, con tu nombre y el motivo, y queda en el
      historial.
    </p>
  );
}

function Fallo({ children }) {
  if (!children) return null;
  return (
    <p className="mt-3 text-[12px]" style={{ color: "var(--alerta)" }}>
      {children}
    </p>
  );
}

/* ── Los campos ──────────────────────────────────────────────────────────── */

const ESTILO_CAMPO = {
  background: "var(--panel-alto)",
  border: "1px solid var(--line)",
  color: "var(--text)",
};

function Campo({ etiqueta, ayuda, children }) {
  return (
    <label className="block mt-3">
      <span className="block text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--tenue)" }}>
        {etiqueta}
      </span>
      {ayuda && (
        <span className="block mt-0.5 text-[11.5px] leading-relaxed" style={{ color: "var(--tenue)" }}>
          {ayuda}
        </span>
      )}
      <span className="block mt-1.5">{children}</span>
    </label>
  );
}

/**
 * Elegir sección, que es elegir prioridad.
 *
 * Botones y no un desplegable: son cinco, se leen de un vistazo con su color, y
 * el gesto que más se hace aquí es «esto es lo primero» — un clic, no dos.
 */
export function SelectorSeccion({ seccion, ocupada, onElegir, compacto = false }) {
  return (
    <span className="flex items-center gap-1 flex-wrap">
      {SECCIONES.map((s) => {
        const tono = tonoDe(s);
        const puesta = seccion === s;
        const etiqueta = compacto && !ES_PRIORIDAD.has(s) ? abreviar(s) : s;
        return (
          <button
            key={s}
            type="button"
            disabled={ocupada || puesta}
            title={puesta ? `Ya está en ${s}` : `Mover a ${s}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onElegir(s);
            }}
            className="px-2 py-0.5 rounded-md text-[11px] transition-colors disabled:cursor-default"
            style={{
              background: puesta ? "var(--panel-alto)" : "transparent",
              color: puesta ? tono.color : "var(--tenue)",
              border: `1px solid ${puesta ? tono.color : "transparent"}`,
              opacity: ocupada ? 0.4 : 1,
            }}
          >
            {etiqueta}
          </button>
        );
      })}
    </span>
  );
}

/** «Pendiente de una decisión suya» no cabe en una tarjeta; ahí se dice corto. */
function abreviar(seccion) {
  if (seccion === "Pendiente de una decisión suya") return "decisión";
  if (seccion === "Sin comprobar") return "sin comprobar";
  return seccion;
}

/* ── Apuntar ─────────────────────────────────────────────────────────────── */

/**
 * Apuntar una tarea nueva.
 *
 * Nace en «Sin comprobar» y eso es lo que hace que este botón sirva de algo: lo
 * que se apunta desde el móvil no ha pasado por producción, y la regla de
 * siempre («si no puedes comprobarlo, no lo apuntes») dejaría fuera justo lo que
 * se piensa en el coche. Entra, pero entra diciendo que nadie lo ha verificado.
 * Si de verdad se ha comprobado, se le pone prioridad aquí mismo.
 */
export function ModalApuntar({ onHecho, onCerrar }) {
  const [seccion, setSeccion] = useState("Sin comprobar");
  const [titulo, setTitulo] = useState("");
  const [quien, setQuien] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [ocupada, setOcupada] = useState(false);
  const [fallo, setFallo] = useState(null);

  const apuntar = useCallback(async () => {
    setOcupada(true);
    setFallo(null);
    try {
      await pedir("POST", { seccion, titulo, quien, cuerpo });
      await onHecho();
    } catch (e) {
      setFallo(e.message);
    } finally {
      setOcupada(false);
    }
  }, [seccion, titulo, quien, cuerpo, onHecho]);

  return (
    <Modal
      titulo="Apuntar una tarea"
      etiqueta="Se escribe en el Registro"
      acento="var(--ok)"
      ocupada={ocupada}
      onCerrar={onCerrar}
    >
      <Campo etiqueta="Qué pasa" ayuda="Qué pasa HOY, no qué hay que programar. Es lo que se leerá dentro de seis meses.">
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          autoFocus
          placeholder="El buscador de pacientes no encuentra por apellido"
          className="w-full rounded px-3 py-2 text-[13px] outline-none"
          style={ESTILO_CAMPO}
        />
      </Campo>

      <Campo etiqueta="De quién es" ayuda="El slug de base de datos (nutri_laura, no «Laura»), o «interno», «producto», «todos».">
        <input
          value={quien}
          onChange={(e) => setQuien(e.target.value)}
          placeholder="`aumenta`"
          className="w-full rounded px-3 py-2 text-[13px] outline-none"
          style={ESTILO_CAMPO}
        />
      </Campo>

      <Campo etiqueta="El detalle" ayuda="Lo que sepas ahora. Sin «##» ni «###»: eso partiría la tarea en dos.">
        <textarea
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          rows={6}
          placeholder={"**Lo que pasa.** …\n\n**Cuánto duele.** …"}
          className="w-full rounded px-3 py-2 text-[12.5px] leading-relaxed outline-none"
          style={ESTILO_CAMPO}
        />
      </Campo>

      <Campo etiqueta="Dónde va" ayuda="«Sin comprobar» si la apuntas sobre la marcha y nadie la ha visto en producción.">
        <SelectorSeccion seccion={seccion} ocupada={ocupada} onElegir={setSeccion} />
      </Campo>

      <AvisoDePublicacion>La tarea entra en el documento de verdad.</AvisoDePublicacion>
      <Fallo>{fallo}</Fallo>
      <PieDeModal
        acento="var(--ok)"
        hacer={apuntar}
        etiqueta="Apuntar"
        ocupada={ocupada}
        onCerrar={onCerrar}
        puede={titulo.trim().length > 0}
      />
    </Modal>
  );
}

/* ── Reescribir ──────────────────────────────────────────────────────────── */

/**
 * Reescribir una tarea ya escrita.
 *
 * Es la única acción que SUSTITUYE texto que escribió una persona, y por eso es
 * la única que manda la versión que tenía delante: si alguien publicó mientras
 * tanto, el servidor lo rechaza y dice que recargues. Mover o cerrar no lo
 * necesitan — van por ficha y no tocan lo que dice la tarea.
 */
export function ModalEditar({ tarea, version, onHecho, onCerrar }) {
  const [titulo, setTitulo] = useState(tarea.titulo);
  const [quien, setQuien] = useState(tarea.quien ?? "");
  const [cuerpo, setCuerpo] = useState(tarea.cuerpo ?? "");
  const [ocupada, setOcupada] = useState(false);
  const [fallo, setFallo] = useState(null);

  const guardar = useCallback(async () => {
    setOcupada(true);
    setFallo(null);
    try {
      await pedir("PATCH", {
        accion: "editar",
        ...referirse(tarea),
        base: version,
        titulo,
        quien,
        cuerpo,
      });
      await onHecho();
    } catch (e) {
      setFallo(e.message);
    } finally {
      setOcupada(false);
    }
  }, [tarea, version, titulo, quien, cuerpo, onHecho]);

  return (
    <Modal
      titulo="Reescribir la tarea"
      etiqueta="Se reescribe en el Registro"
      acento="#B45309"
      ocupada={ocupada}
      onCerrar={onCerrar}
    >
      <Campo etiqueta="Qué pasa">
        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          autoFocus
          className="w-full rounded px-3 py-2 text-[13px] outline-none"
          style={ESTILO_CAMPO}
        />
      </Campo>
      <Campo etiqueta="De quién es">
        <input
          value={quien}
          onChange={(e) => setQuien(e.target.value)}
          className="w-full rounded px-3 py-2 text-[13px] outline-none"
          style={ESTILO_CAMPO}
        />
      </Campo>
      <Campo etiqueta="El detalle">
        <textarea
          value={cuerpo}
          onChange={(e) => setCuerpo(e.target.value)}
          rows={12}
          className="w-full rounded px-3 py-2 text-[12.5px] leading-relaxed outline-none"
          style={ESTILO_CAMPO}
        />
      </Campo>

      {!tarea.id && (
        <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: "var(--tenue)" }}>
          Esta tarea se escribió antes de que existieran las fichas. Al guardar gana una, y a partir
          de ahí cambiarle el título deja de perderle el tick, el reparto y las capturas.
        </p>
      )}

      <AvisoDePublicacion>Sustituye lo que dice la tarea.</AvisoDePublicacion>
      <Fallo>{fallo}</Fallo>
      <PieDeModal
        acento="#B45309"
        hacer={guardar}
        etiqueta="Guardar"
        ocupada={ocupada}
        onCerrar={onCerrar}
        puede={titulo.trim().length > 0}
      />
    </Modal>
  );
}

/* ── Cerrar ──────────────────────────────────────────────────────────────── */

/**
 * Cerrar de verdad: sale del backlog y queda escrita en Resuelto, bajo la fecha
 * de hoy.
 *
 * Esto NO es el tick. El tick mueve la tarea de pestaña para que los dos sepáis
 * por dónde va y no toca el documento; esto lo cierra y lo publica. Se pide qué
 * lo arregló porque sin eso Resuelto es una lista de títulos que dentro de seis
 * meses no explica nada — y es literalmente lo único que se le pide.
 */
export function ModalCerrar({ tarea, onHecho, onCerrar }) {
  const [comoSeArreglo, setComoSeArreglo] = useState(tarea.solucion ?? "");
  const [ocupada, setOcupada] = useState(false);
  const [fallo, setFallo] = useState(null);

  const cerrar = useCallback(async () => {
    setOcupada(true);
    setFallo(null);
    try {
      await pedir("PATCH", { accion: "cerrar", ...referirse(tarea), comoSeArreglo });
      await onHecho();
    } catch (e) {
      setFallo(e.message);
    } finally {
      setOcupada(false);
    }
  }, [tarea, comoSeArreglo, onHecho]);

  return (
    <Modal
      titulo={tarea.titulo}
      etiqueta="Vas a cerrarla y publicarlo"
      acento="var(--ok)"
      ocupada={ocupada}
      onCerrar={onCerrar}
    >
      <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: "var(--dim)" }}>
        Sale de Pendiente y queda escrita en Resuelto, bajo la fecha de hoy. Esto sí la cierra: no es
        el tick.
      </p>

      <Campo
        etiqueta="Qué la arregló"
        ayuda="El commit, el despliegue, o por qué ha dejado de pasar. Se guarda debajo de lo que se apuntó en su día, sin sustituirlo."
      >
        <textarea
          value={comoSeArreglo}
          onChange={(e) => setComoSeArreglo(e.target.value)}
          rows={5}
          autoFocus
          placeholder="Lo arregló el commit 6ffb4f5, desplegado el 24/08."
          className="w-full rounded px-3 py-2 text-[12.5px] leading-relaxed outline-none"
          style={ESTILO_CAMPO}
        />
      </Campo>

      <AvisoDePublicacion>Toca los DOS documentos: sale de uno y entra en el otro.</AvisoDePublicacion>
      <Fallo>{fallo}</Fallo>
      <PieDeModal
        acento="var(--ok)"
        hacer={cerrar}
        etiqueta="Cerrar y publicar"
        ocupada={ocupada}
        onCerrar={onCerrar}
        puede={comoSeArreglo.trim().length > 0}
      />
    </Modal>
  );
}

/* ── Borrar ──────────────────────────────────────────────────────────────── */

/**
 * Borrar: quitarla sin dejar rastro en Resuelto.
 *
 * Es para lo que nunca debió apuntarse —un duplicado, algo mal entendido—, y por
 * eso pregunta con otras palabras y en rojo. La confusión que hay que evitar es
 * con «Cerrar»: son la misma fila de botones y significan cosas opuestas.
 *
 * Se dice en voz alta que no se pierde: la tabla guarda 50 versiones y una tarea
 * borrada por error se rescata. Sin decirlo, este botón da miedo y no se usa.
 */
export function ModalBorrar({ tarea, onHecho, onCerrar }) {
  const [ocupada, setOcupada] = useState(false);
  const [fallo, setFallo] = useState(null);

  const borrar = useCallback(async () => {
    setOcupada(true);
    setFallo(null);
    try {
      await pedir("DELETE", referirse(tarea));
      await onHecho();
    } catch (e) {
      setFallo(e.message);
    } finally {
      setOcupada(false);
    }
  }, [tarea, onHecho]);

  return (
    <Modal
      titulo={tarea.titulo}
      etiqueta="Vas a borrarla del Registro"
      acento="var(--alerta)"
      ocupada={ocupada}
      onCerrar={onCerrar}
    >
      <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: "var(--dim)" }}>
        Desaparece del Registro y <strong>no</strong> queda escrita en Resuelto. Si lo que quieres es
        darla por hecha, eso es <strong>Cerrar</strong>.
      </p>
      <p className="mt-2 text-[11.5px] leading-relaxed" style={{ color: "var(--tenue)" }}>
        No se pierde del todo: se guardan las últimas 50 versiones del documento, así que se puede
        rescatar con <code>node scripts/registro.mjs restaurar</code>.
      </p>

      <Fallo>{fallo}</Fallo>
      <PieDeModal
        acento="var(--alerta)"
        hacer={borrar}
        etiqueta="Borrar"
        ocupada={ocupada}
        onCerrar={onCerrar}
      />
    </Modal>
  );
}

/* ── Capturas ────────────────────────────────────────────────────────────── */

/*
 * ── QUÉ SE PUEDE VER Y QUÉ NO: LO DICE EL SERVIDOR ────────────────────────
 * Aquí había una lista de extensiones escrita a mano, y estaba MAL: llevaba
 * `avif`, que la lista blanca del servidor no acepta. O sea que un `.avif` se
 * habría subido, la pantalla habría pintado un `<img>` apuntando a él, y el
 * servidor lo habría mandado como descarga: imagen rota, sin ningún error que
 * lo explicara.
 *
 * Ahora cada captura llega con `verComo`: el tipo con el que se va a servir, o
 * `null` si solo se puede descargar. Sale de la MISMA función con la que se
 * sirve el fichero, así que las dos no pueden discrepar. Es el mismo campo que
 * usa el Buzón, y por lo mismo.
 */
const esImagen = (c) => String(c.verComo ?? "").startsWith("image/");
const esPdf = (c) => c.verComo === "application/pdf";

/** La dirección de una captura. `ver=1` la enseña; sin él, se descarga. */
const enlaceDe = (c, ver) => `/api/admin/tablero/adjuntos/${c.id}${ver ? "?ver=1" : ""}`;

const pesa = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;

/**
 * Las capturas de una tarea: las que tiene y el botón de añadir.
 *
 * ── POR QUÉ ESTO NO EXISTÍA ───────────────────────────────────────────────
 * El cuerpo de una tarea se pinta como texto plano, así que una imagen escrita
 * al estilo markdown salía con sus corchetes a la vista; y por detrás el
 * documento es un TEXTO versionado, donde un fichero no cabe. Medido el
 * 24/08/2026: cero imágenes y cero enlaces en las 133 tareas publicadas. No es
 * que se usara poco — es que no se podía, y lo que se hacía era describir con
 * palabras lo que se entiende en un segundo mirando.
 *
 * ── LO QUE HAY QUE SABER AL MIRARLAS ──────────────────────────────────────
 * Pueden llevar datos de un paciente dentro y NO se recortan: una captura
 * recortada de la pantalla que falla deja de ser la prueba de lo que falla. Por
 * eso no salen nunca del back-office —los tres candados de siempre, incluido el
 * de la demo— y viven lo que viva la tarea.
 *
 * La miniatura apunta al mismo sitio que el enlace: son capturas de pantalla, no
 * hay una versión pequeña que generar, y generarla sería guardar dos veces lo
 * mismo para ahorrar unos kilobytes en una pantalla que ven dos personas.
 */
export function Capturas({ tarea, documento, ocupada, onCambio, onFallo }) {
  const [subiendo, setSubiendo] = useState(false);
  // La que se está mirando en grande, o null. Una a la vez.
  const [mirando, setMirando] = useState(null);
  const entrada = useRef(null);
  const capturas = tarea.capturas ?? [];
  const quedan = 3 - capturas.length;

  const subir = useCallback(
    async (ficheros) => {
      if (!ficheros?.length) return;
      setSubiendo(true);
      try {
        const form = new FormData();
        for (const f of ficheros) form.append("capturas", f);
        form.append("documento", documento);
        // Por ficha si la tiene; si no, por título, y el servidor le DA una ficha
        // publicando una versión. Es como se curan las tareas viejas sin
        // reescribirlas todas de golpe.
        if (tarea.id) form.append("id", tarea.id);
        else form.append("clave", tarea.clave);

        const r = await fetch("/api/admin/tablero/adjuntos", { method: "POST", body: form });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
        await onCambio();
      } catch (e) {
        onFallo(e.message);
      } finally {
        setSubiendo(false);
        if (entrada.current) entrada.current.value = "";
      }
    },
    [tarea, documento, onCambio, onFallo]
  );

  const quitar = useCallback(
    async (id) => {
      setSubiendo(true);
      try {
        const r = await fetch(`/api/admin/tablero/adjuntos/${id}`, { method: "DELETE" });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
        await onCambio();
      } catch (e) {
        onFallo(e.message);
      } finally {
        setSubiendo(false);
      }
    },
    [onCambio, onFallo]
  );

  return (
    <div className="mt-3 ml-[15px]">
      {capturas.length > 0 && (
        <div className="flex items-start gap-2 flex-wrap">
          {capturas.map((c) => (
            <Miniatura
              key={c.id}
              captura={c}
              ocupada={ocupada || subiendo}
              onAbrir={() => setMirando(c)}
              onQuitar={() => quitar(c.id)}
            />
          ))}
        </div>
      )}

      {/* El visor. Fuera de la lista de miniaturas: dentro del `<details>` de la
          tarjeta heredaría el clic que la despliega, igual que los otros modales. */}
      {mirando && <Visor captura={mirando} onCerrar={() => setMirando(null)} />}

      {quedan > 0 && (
        <label className="mt-2 inline-flex items-center gap-2 cursor-pointer">
          <input
            ref={entrada}
            type="file"
            multiple
            /* Los mismos cinco que la lista blanca del servidor sabe enseñar en
               pantalla, ni uno más: `avif` estaba aquí y NO está allí, así que
               una captura en ese formato se subía y salía rota. Sin SVG, que
               lleva scripts dentro. */
            accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
            className="hidden"
            disabled={ocupada || subiendo}
            onChange={(e) => subir([...e.target.files])}
          />
          <span
            className="text-[11.5px] px-2.5 py-1 rounded transition-colors"
            style={{ background: "var(--panel)", color: "var(--dim)", border: "1px solid var(--line)" }}
          >
            {subiendo ? "Subiendo…" : capturas.length ? "Otra captura" : "Añadir captura"}
          </span>
          <span className="text-[11px]" style={{ color: "var(--tenue)" }}>
            {quedan} más, {MB_POR_CAPTURA} MB cada una
          </span>
        </label>
      )}
    </div>
  );
}

/** El mismo número que el servidor. Aquí solo se dice; quien lo aplica es él. */
const MB_POR_CAPTURA = 10;

/**
 * Una captura en pequeño, con su botón de quitar.
 *
 * Tres formas según lo que sea, y las tres las decide `verComo`, que viene del
 * servidor:
 *
 *   · imagen → la propia imagen. No hay versión pequeña que generar: son
 *     capturas de pantalla, y guardar dos copias de cada una para ahorrar unos
 *     kilobytes en una pantalla que miran dos personas no sale a cuenta.
 *   · PDF → una tarjeta con su nombre. Un PDF metido en 220×128 px no se lee, y
 *     una miniatura ilegible es peor que ninguna: parece que se puede leer.
 *     Para eso está el visor, que lo abre entero.
 *   · lo demás → una tarjeta que DESCARGA al pulsarla, sin visor. Si el servidor
 *     no lo va a enseñar en línea, la pantalla tampoco finge que puede.
 */
function Miniatura({ captura: c, ocupada, onAbrir, onQuitar }) {
  const sePuedeVer = esImagen(c) || esPdf(c);
  const titulo = `${c.nombre} · ${pesa(c.bytes)}`;

  const dentro = esImagen(c) ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={enlaceDe(c, true)}
      alt={c.nombre}
      className="block h-32 w-auto max-w-[240px] object-cover"
    />
  ) : (
    <span
      className="flex h-32 w-[150px] flex-col items-center justify-center gap-1.5 px-2 text-center"
      style={{ color: "var(--dim)" }}
    >
      <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--tenue)" }}>
        {esPdf(c) ? "PDF" : "fichero"}
      </span>
      <span className="text-[11px] leading-tight break-all line-clamp-3">{c.nombre}</span>
    </span>
  );

  return (
    <span
      className="relative rounded overflow-hidden"
      style={{ border: "1px solid var(--line)", background: "var(--panel-alto)" }}
    >
      {sePuedeVer ? (
        <button
          type="button"
          title={titulo}
          aria-label={`Ver ${c.nombre}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAbrir();
          }}
          className="block cursor-zoom-in"
        >
          {dentro}
        </button>
      ) : (
        // Sin visor: esto se descarga. `download` y no `target=_blank` para que
        // no se abra una pestaña en blanco que descarga y se cierra sola.
        <a href={enlaceDe(c, false)} download={c.nombre} title={titulo} className="block">
          {dentro}
        </a>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onQuitar();
        }}
        disabled={ocupada}
        title={`Quitar «${c.nombre}»`}
        aria-label={`Quitar ${c.nombre}`}
        className="absolute top-1 right-1 w-5 h-5 rounded grid place-items-center text-[11px] disabled:opacity-40"
        style={{ background: "rgba(21,20,15,0.65)", color: "#fff" }}
      >
        ×
      </button>
    </span>
  );
}

/**
 * Verla en grande sin salir del Registro.
 *
 * Antes el enlace abría una pestaña nueva, y eso es lo que convertía «hay
 * captura» en «hay que ir a buscarla»: se pierde el sitio en la lista, hay que
 * volver, y para comparar dos capturas de la misma tarea son cuatro pestañas.
 *
 * Escape cierra, el clic en el fondo cierra, y el foco arranca en el botón de
 * cerrar. Las capas son las de la regla 13 de CLAUDE.md: fondo `z-40`, panel
 * `z-50`.
 *
 * El PDF va en un `<object>` y no en un `<iframe>`: el navegador usa su propio
 * visor, y si no puede, enseña lo de dentro —el enlace— en vez de un cuadro
 * blanco. Es el único caso donde el respaldo se ve.
 */
function Visor({ captura: c, onCerrar }) {
  const cerrar = useRef(null);

  useEffect(() => {
    cerrar.current?.focus();
  }, []);

  useEffect(() => {
    const alPulsar = (e) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [onCerrar]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(21,20,15,0.72)" }}
      onClick={onCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={c.nombre}
        onClick={(e) => e.stopPropagation()}
        className="relative z-50 flex max-h-full w-full max-w-5xl flex-col rounded-xl overflow-hidden"
        style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
      >
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--line)" }}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px]">{c.nombre}</span>
            <span className="block text-[11px]" style={{ color: "var(--tenue)" }}>
              {pesa(c.bytes)}
              {c.subidoPor && ` · ${c.subidoPor}`}
            </span>
          </span>
          <a
            href={enlaceDe(c, false)}
            download={c.nombre}
            className="shrink-0 text-[11.5px] px-2.5 py-1 rounded"
            style={{ background: "var(--panel-alto)", color: "var(--dim)", border: "1px solid var(--line)" }}
          >
            Descargar
          </a>
          <button
            type="button"
            ref={cerrar}
            onClick={onCerrar}
            aria-label="Cerrar"
            className="shrink-0 w-7 h-7 rounded grid place-items-center text-[14px]"
            style={{ background: "var(--panel-alto)", color: "var(--dim)", border: "1px solid var(--line)" }}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-auto grid place-items-center p-3" style={{ minHeight: "40vh" }}>
          {esImagen(c) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={enlaceDe(c, true)} alt={c.nombre} className="max-h-[78dvh] max-w-full" />
          ) : (
            <object
              data={enlaceDe(c, true)}
              type="application/pdf"
              className="w-full"
              style={{ height: "78vh" }}
              aria-label={c.nombre}
            >
              <p className="text-[12.5px] p-4" style={{ color: "var(--dim)" }}>
                Tu navegador no puede enseñar este PDF aquí dentro.{" "}
                <a href={enlaceDe(c, true)} target="_blank" rel="noreferrer" style={{ color: "var(--ok)" }}>
                  Ábrelo en otra pestaña
                </a>
                .
              </p>
            </object>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Mover, que no necesita modal ────────────────────────────────────────── */

/**
 * Cambiar de sección es cambiar de prioridad, y es el gesto que más se va a
 * hacer aquí. No lleva confirmación a propósito: es reversible con otro clic, se
 * ve el resultado al instante y preguntarlo cada vez lo volvería inútil.
 *
 * Publica una versión igual. Se acepta: el historial con veinte «mover una tarea
 * a Alta» sigue siendo más barato que no poder priorizar desde el móvil, que era
 * el problema.
 */
export async function moverTareaA(tarea, aSeccion) {
  return pedir("PATCH", { accion: "mover", ...referirse(tarea), aSeccion });
}
