"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Las MISMAS reglas que aplica el endpoint. Se puede importar aquí porque
// `lib/buzon/buzon.js` no importa nada (ni BD, ni Next): así el motivo que se
// enseña en pantalla y el que devolvería el servidor son literalmente la misma
// frase, y no dos textos parecidos que se separan con el tiempo.
import {
  validarAvisoNuevo,
  LIMITES,
  MB_POR_ADJUNTO,
  EVENTO_SIN_VER,
} from "../../lib/buzon/buzon.js";

/**
 * Lee la respuesta SIN dar por hecho que es JSON.
 *
 * ── POR QUÉ NO BASTA CON `res.json()` ───────────────────────────────────────
 * Porque no todas las respuestas las escribe nuestra app. Cuando el cuerpo de
 * la petición se pasa de tamaño, quien contesta es **nginx**, que corta antes de
 * llegar a Next y devuelve una página HTML. `res.json()` se atraganta con ella y
 * lanza «Unexpected token '<', "<html> <h"... is not valid JSON», que es lo que
 * acaba viendo el usuario en la pantalla de Ayuda. Es decir: la pantalla que
 * existe para que nos cuenten los fallos, fallando con un error de programador.
 *
 * Lo encontró Jorge el 13/08/2026 adjuntando un PNG normal, con el bloque del
 * CRM en el 1 MB por defecto de nginx.
 */
async function leerRespuesta(res) {
  const texto = await res.text();
  try {
    return JSON.parse(texto);
  } catch {
    if (res.status === 413) {
      return {
        ok: false,
        error:
          `Esa captura pesa demasiado para enviarla. El tope es ${MB_POR_ADJUNTO} MB por archivo ` +
          `y hasta ${LIMITES.adjuntos}. Recórtala, o mándanos el aviso sin ella y nos la pasas aparte.`,
      };
    }
    return { ok: false, error: `No se ha podido enviar (error ${res.status}). Vuelve a intentarlo.` };
  }
}

/**
 * Ayuda — lo que el cliente ve para escribirnos y para seguir lo que nos mandó.
 *
 * ── DOS DECISIONES DE PANTALLA QUE NO SON DE ADORNO ──────────────────────────
 *
 * 1. El formulario está ARRIBA y abierto, no detrás de un botón «nuevo». Quien
 *    entra aquí viene con un problema en la cabeza y con prisa; hacerle buscar
 *    dónde se escribe es la forma más barata de que cierre la pestaña y nos
 *    llame por teléfono.
 *
 * 2. El aviso de no escribir nombres de pacientes va PEGADO al cuadro de texto,
 *    no en un pie de página. Es la contrapartida de que estos avisos se guarden
 *    en nuestra base y no en la suya, así que tiene que leerse justo cuando se
 *    está escribiendo, que es el único momento en que sirve de algo.
 */

const ESTADO_COLOR = {
  nuevo: "bg-amber-50 text-amber-700 border-amber-200",
  en_curso: "bg-blue-50 text-blue-700 border-blue-200",
  esperando: "bg-gray-100 text-gray-600 border-gray-200",
  resuelto: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function fecha(v) {
  if (!v) return "";
  return new Date(v).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

function fechaHora(v) {
  if (!v) return "";
  return new Date(v).toLocaleString("es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AyudaModule({ esDemo = false }) {
  const [avisos, setAvisos] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [soloLectura, setSoloLectura] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState(null);

  const [tipo, setTipo] = useState("error");
  const [asunto, setAsunto] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [bloquea, setBloquea] = useState(false);
  const [ficheros, setFicheros] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(null);

  const [abierto, setAbierto] = useState(null);

  // Para poder llevar el cursor al campo que falta, y no solo decirlo.
  const refAsunto = useRef(null);
  const refCuerpo = useRef(null);

  // Se pone en cuanto la lista ha llegado UNA vez. Sin él, el aviso al menú de
  // aquí abajo saldría en el primer render con la lista todavía vacía —o sea
  // «cero sin leer»— y apagaría el punto un instante antes de volver a
  // encenderlo.
  const yaCargado = useRef(false);

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    try {
      const res = await fetch("/api/ayuda");
      const json = await leerRespuesta(res);
      if (!res.ok) throw new Error(json.error || "No se ha podido cargar");
      setAvisos(json.data.avisos ?? []);
      setTipos(json.data.tipos ?? []);
      setSoloLectura(!!json.data.soloLectura);
      setFallo(null);
      yaCargado.current = true;
    } catch (e) {
      setFallo(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /**
   * Cuántas respuestas nuestras le quedan por abrir.
   *
   * NO se guarda en su propio estado: se CUENTA de la lista que está viendo. Un
   * contador por un lado y unas filas por otro acaban discrepando el día que a
   * alguien se le olvide actualizar uno de los dos, y el resultado es el peor de
   * los dos mundos: un punto encendido en el menú sin ninguna fila marcada que
   * lo explique.
   *
   * (La lista trae como mucho 100 avisos, así que en teoría alguien con más de
   * 100 sin leer vería el punto quedarse corto. Es preferible a dos números que
   * se contradicen en pantalla, y con avisos que escribe una persona a mano no
   * va a pasar.)
   */
  const sinLeer = avisos.filter((a) => a.sinLeer).length;

  /**
   * Y se le dice al MENÚ, que vive fuera de esta pantalla.
   *
   * El punto verde del pie del sidebar lo pinta el layout del dashboard, que no
   * comparte estado con esta página: sin este aviso el punto se quedaba
   * encendido hasta la siguiente recarga completa, así que quien abría la
   * respuesta la leía, salía, seguía viendo el punto y volvía a entrar a buscar
   * qué se le había escapado (Jorge, 13/08/2026).
   */
  useEffect(() => {
    if (!yaCargado.current) return;
    window.dispatchEvent(new CustomEvent(EVENTO_SIN_VER, { detail: { sinVer: sinLeer } }));
  }, [sinLeer]);

  /**
   * «Este ya lo ha abierto». Lo llama el panel en cuanto el servidor le
   * confirma el hilo — que es el momento en que `/api/ayuda/[id]` ha apuntado la
   * visita en la base. No se hace al pulsar: si la carga falla, la visita no ha
   * quedado escrita en ningún sitio y borrar el aviso en pantalla sería mentir.
   */
  const marcarVisto = useCallback((id) => {
    setAvisos((previos) => previos.map((a) => (a.id === id ? { ...a, sinLeer: false } : a)));
  }, []);

  async function enviar(e) {
    e.preventDefault();
    if (enviando) return;

    // Se comprueba AQUÍ y no apagando el botón: si algo falta hay que decir qué
    // es y llevar el cursor allí. El mensaje sale de la misma función que usa el
    // endpoint, así que es palabra por palabra el que daría el servidor.
    const revision = validarAvisoNuevo({ tipo, asunto, cuerpo, bloquea });
    if (!revision.ok) {
      setFallo(revision.error);
      const campo = asunto.trim().length < LIMITES.asuntoMinimo ? refAsunto : refCuerpo;
      campo.current?.focus();
      return;
    }

    setEnviando(true);
    setFallo(null);
    try {
      // El contexto lo pone el navegador solo: es la mitad de las repreguntas
      // que nos ahorramos («¿en qué pantalla estabas?», «¿con qué navegador?»).
      const contexto = JSON.stringify({
        navegador: typeof navigator !== "undefined" ? navigator.userAgent : null,
        ventana: typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : null,
        idioma: typeof navigator !== "undefined" ? navigator.language : null,
      });
      const pantalla = typeof window !== "undefined" ? window.location.pathname : null;

      // Con capturas va como formulario; sin ellas, como JSON. Se envía lo que
      // haga falta y no siempre multipart, para que el caso normal —solo
      // texto— siga siendo una petición pequeña.
      let peticion;
      if (ficheros.length) {
        const fd = new FormData();
        fd.set("tipo", tipo);
        fd.set("asunto", asunto);
        fd.set("cuerpo", cuerpo);
        fd.set("bloquea", String(bloquea));
        if (pantalla) fd.set("pantalla", pantalla);
        fd.set("contexto", contexto);
        for (const f of ficheros) fd.append("adjuntos", f);
        peticion = { method: "POST", body: fd };
      } else {
        peticion = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo, asunto, cuerpo, bloquea, pantalla, contexto: JSON.parse(contexto) }),
        };
      }

      const res = await fetch("/api/ayuda", peticion);
      const json = await leerRespuesta(res);
      if (!res.ok) throw new Error(json.error || "No se ha podido enviar");
      setEnviado(json.data);
      setAsunto("");
      setCuerpo("");
      setBloquea(false);
      setTipo("error");
      setFicheros([]);
      cargar(true);
    } catch (e) {
      setFallo(e.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-full bg-gray-50">
      <div className="px-4 lg:px-8 pt-5 lg:pt-7 pb-3 max-w-3xl mx-auto w-full">
        <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-1">Salamandra Solutions</div>
        <h1 className="text-gray-900 text-xl lg:text-2xl font-semibold">Ayuda</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl leading-relaxed">
          Si algo del CRM no funciona, no lo entiendes o se te ocurre cómo mejorarlo, cuéntanoslo
          aquí. Lo leemos nosotros.
        </p>
      </div>

      <div className="px-4 lg:px-8 pb-10 max-w-3xl mx-auto w-full">
        {soloLectura && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            Esto acaba de instalarse y todavía le falta un paso en el servidor. Mientras tanto
            escríbenos a{" "}
            <a className="underline font-medium" href="mailto:info@salamandrasolutions.com">
              info@salamandrasolutions.com
            </a>
            .
          </div>
        )}

        {esDemo ? (
          <TarjetaDemo />
        ) : enviado ? (
          <Recibido aviso={enviado} onOtro={() => setEnviado(null)} />
        ) : (
          <form onSubmit={enviar} className="bg-white border border-gray-200 rounded-xl p-4 lg:p-6">
            <fieldset disabled={soloLectura} className="disabled:opacity-50">
              <legend className="sr-only">Escribirnos</legend>

              <div className="flex flex-wrap gap-2 mb-4">
                {(tipos.length ? tipos : [{ key: "error", label: "Algo no funciona" }]).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTipo(t.key)}
                    className={`px-3 py-1.5 rounded-full text-[13px] border transition-colors cursor-pointer ${
                      tipo === t.key
                        ? "text-white border-transparent"
                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                    }`}
                    style={tipo === t.key ? { backgroundColor: "var(--color-primary, #1B3A2D)" } : undefined}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <label className="block text-[13px] font-medium text-gray-700 mb-1.5" htmlFor="ayuda-asunto">
                ¿Qué pasa?
              </label>
              <input
                id="ayuda-asunto"
                ref={refAsunto}
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
                maxLength={200}
                placeholder="Ej.: no se abre la ficha de un cliente"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm mb-4 focus:outline-none focus:border-gray-400"
              />

              <label className="block text-[13px] font-medium text-gray-700 mb-1.5" htmlFor="ayuda-cuerpo">
                Cuéntanoslo con calma
              </label>
              <textarea
                id="ayuda-cuerpo"
                ref={refCuerpo}
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
                rows={6}
                maxLength={5000}
                placeholder="Qué estabas haciendo, qué esperabas que pasara y qué pasó."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
              />
              <p className="text-[11px] text-gray-400 mt-1.5 mb-4 leading-relaxed">
                No hace falta que escribas el nombre de ningún paciente ni de ninguna familia: con
                decirnos en qué pantalla estabas nos sobra para encontrarlo.
              </p>

              <label className="block text-[13px] font-medium text-gray-700 mb-1.5" htmlFor="ayuda-ficheros">
                Una captura ayuda mucho{" "}
                <span className="font-normal text-gray-400">
                  (opcional, hasta {LIMITES.adjuntos} de {MB_POR_ADJUNTO} MB)
                </span>
              </label>
              <input
                id="ayuda-ficheros"
                type="file"
                multiple
                accept="image/*,.pdf"
                onChange={(e) => {
                  const elegidos = Array.from(e.target.files ?? []).slice(0, LIMITES.adjuntos);
                  const grande = elegidos.find((f) => f.size > LIMITES.bytesPorAdjunto);
                  if (grande) {
                    // Se avisa AQUÍ, al elegir el fichero, y no al enviar:
                    // descubrir que la captura no cabe DESPUÉS de haberlo
                    // escrito todo es la peor forma de enterarse. Y se dice el
                    // tope y lo que pesa la suya, para que no tenga que ir
                    // probando.
                    const pesa = (grande.size / (1024 * 1024)).toFixed(1);
                    setFallo(
                      `«${grande.name}» pesa ${pesa} MB y el tope son ${MB_POR_ADJUNTO} MB. ` +
                        `Recórtala, o manda el aviso sin ella y nos la pasas aparte.`
                    );
                    setFicheros([]);
                    e.target.value = "";
                    return;
                  }
                  setFallo(null);
                  setFicheros(elegidos);
                }}
                className="w-full text-[13px] text-gray-600 mb-1 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-200 file:bg-white file:text-[13px] file:text-gray-700 file:cursor-pointer hover:file:border-gray-300"
              />
              {ficheros.length > 0 && (
                <p className="text-[11px] text-gray-500 mb-4">
                  {ficheros.map((f) => f.name).join(" · ")}
                </p>
              )}
              {ficheros.length === 0 && <div className="mb-4" />}

              <label className="flex items-start gap-2.5 mb-5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bloquea}
                  onChange={(e) => setBloquea(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 cursor-pointer"
                />
                <span className="text-[13px] text-gray-600 leading-snug">
                  Esto me impide seguir trabajando
                  <span className="block text-[11px] text-gray-400">
                    Márcalo solo si es así: es lo que usamos para saber qué mirar primero.
                  </span>
                </span>
              </label>

              {/* ⚠️ EL BOTÓN NO SE APAGA POR ESTAR INCOMPLETO, y es lo único
                  importante de este bloque. Antes se desactivaba solo cuando
                  faltaba texto, sin decir nada: escribías «prueba» —seis letras,
                  y el mínimo son diez— y el botón se quedaba gris para siempre
                  sin ninguna explicación. Quien no adivinara qué le faltaba
                  cerraba la pestaña y cogía el teléfono, que es exactamente lo
                  que esta pantalla viene a evitar.

                  Ahora se puede pulsar siempre: al pulsar, `enviar` dice qué
                  falta y pone el foco en el campo. La única razón para apagarlo
                  es que ya se esté enviando. */}
              <button
                type="submit"
                disabled={enviando}
                className="w-full sm:w-auto px-5 py-2.5 rounded-lg text-white text-sm font-medium transition-opacity cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}
              >
                {enviando ? "Enviando…" : "Enviárnoslo"}
              </button>
            </fieldset>
          </form>
        )}

        {fallo && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {fallo}
          </div>
        )}

        <div className="mt-8">
          <h2 className="text-[13px] font-semibold text-gray-700 mb-1">Lo que nos habéis mandado</h2>
          <p className="text-[12px] text-gray-400 mb-3">
            Aquí sale lo de todo tu equipo, para no mandarnos la misma duda dos veces.
          </p>
          {cargando ? (
            <p className="text-[13px] text-gray-400">Cargando…</p>
          ) : avisos.length === 0 ? (
            <p className="text-[13px] text-gray-400">
              Todavía nada. Lo que nos escribas aparecerá aquí con su respuesta.
            </p>
          ) : (
            <ul className="space-y-2">
              {avisos.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => setAbierto(a)}
                    className={`w-full text-left bg-white border rounded-lg px-4 py-3 transition-colors cursor-pointer ${
                      a.sinLeer
                        ? "border-emerald-300 hover:border-emerald-400"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-gray-900 font-medium truncate">{a.asunto}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          {a.ref} · {fecha(a.createdAt)}
                          {/* Desde el 02/09/2026 se ven los de todo el equipo:
                              cada fila dice de quién es cuando no es tuya. */}
                          {a.esMio === false && ` · de ${a.usuarioNombre || "un compañero"}`}
                          {a.mensajes.length > 0 && ` · ${a.mensajes.length} respuesta${a.mensajes.length > 1 ? "s" : ""}`}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        {/* ⚠️ ARRIBA DEL ESTADO, NO EN VEZ DE ÉL. Son dos cosas
                            distintas: «Nueva respuesta» es lo que tiene que
                            hacer él, y el estado es por dónde va el asunto. Con
                            un aviso resuelto y contestado a la vez, quedarse
                            solo con uno de los dos esconde el otro. */}
                        {a.sinLeer && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 font-medium whitespace-nowrap">
                            Nueva respuesta
                          </span>
                        )}
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap ${
                            ESTADO_COLOR[a.estado] ?? ESTADO_COLOR.nuevo
                          }`}
                        >
                          {a.estadoLabel}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {abierto && (
        <Detalle
          avisoId={abierto.id}
          onVisto={marcarVisto}
          onCerrar={() => {
            setAbierto(null);
            cargar(true);
          }}
        />
      )}
    </div>
  );
}

/** Lo que ve el visitante de la demo: la demo no puede escribirnos. */
function TarjetaDemo() {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <h2 className="text-sm font-semibold text-neutral-800">Esto es la demo</h2>
      <p className="text-[13px] text-neutral-500 mt-1.5 leading-relaxed">
        Desde aquí los clientes nos escriben y siguen la respuesta sin salir del CRM. En la demo el
        envío está apagado, porque cualquiera puede entrar.
      </p>
      <a
        href="mailto:info@salamandrasolutions.com"
        className="inline-block mt-3 text-sm font-medium underline underline-offset-2"
        style={{ color: "var(--color-primary, #1B3A2D)" }}
      >
        info@salamandrasolutions.com
      </a>
    </div>
  );
}

/**
 * El acuse. Y, si procede, la mala noticia.
 *
 * ⚠️ EL AVISO DE LA CAPTURA QUE NO ENTRÓ NO ES OPCIONAL. Cuando un adjunto se
 * pasa de tamaño, el aviso SÍ se guarda —perder la captura es molesto, perder lo
 * que nos querían contar es peor— y el endpoint devuelve el motivo en
 * `avisoAdjuntos`. Hasta el 13/08/2026 ese motivo no se pintaba en ninguna
 * parte: la persona veía «Recibido» y se iba convencida de que su captura había
 * llegado. Una imagen que desaparece en silencio es peor que un error.
 */
function Recibido({ aviso, onOtro }) {
  return (
    <div className="bg-white border border-emerald-200 rounded-xl p-6">
      <div className="text-sm font-semibold text-emerald-800">Recibido</div>
      <p className="text-[13px] text-neutral-600 mt-1.5 leading-relaxed">
        Le hemos puesto la referencia <strong>{aviso.ref}</strong>. Te contestamos aquí mismo, y lo
        verás en esta pantalla.
      </p>
      {aviso.avisoAdjuntos && (
        <p className="text-[13px] mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 leading-relaxed">
          Eso sí, <strong>la captura no ha entrado</strong>: {aviso.avisoAdjuntos} El aviso está
          guardado igual; si la necesitamos te la pedimos.
        </p>
      )}
      <button
        onClick={onOtro}
        className="mt-3 text-[13px] underline underline-offset-2 cursor-pointer"
        style={{ color: "var(--color-primary, #1B3A2D)" }}
      >
        Contarnos otra cosa
      </button>
    </div>
  );
}

/**
 * La lista de capturas de un mensaje (o del alta). No pinta nada si no hay.
 *
 * El botón «Ver» solo sale cuando el fichero se puede enseñar de verdad
 * (`verComo`, que lo decide la extensión guardada y NUNCA acepta SVG). Para lo
 * demás queda el nombre, que descarga. Un botón que a veces no hace nada es
 * peor que no tenerlo.
 */
function Capturas({ lista, onVer }) {
  if (!lista?.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {lista.map((ad) => (
        <li key={ad.id} className="flex items-center gap-2 flex-wrap">
          <a
            href={`/api/ayuda/adjuntos/${ad.id}`}
            className="text-[12px] underline underline-offset-2 text-gray-600 hover:text-gray-900"
          >
            {ad.nombre}
          </a>
          {ad.verComo && (
            <button
              type="button"
              onClick={() => onVer(ad)}
              className="text-[11px] px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 hover:border-gray-300 cursor-pointer"
            >
              Ver
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * El visor. Se abre encima de todo, incluido el panel lateral.
 *
 * Sube un escalón sobre la escala de capas del proyecto (widgets z-30, fondo
 * z-40, panel z-50): esto es z-[60] porque se abre DESDE el panel y taparlo es
 * justo lo que tiene que hacer.
 *
 * Pide el fichero con `?ver=1`; sin ese parámetro el endpoint lo sirve como
 * descarga. La imagen y el PDF son lo único que llega aquí, porque el botón que
 * abre esto solo aparece para ellos.
 */
function Visor({ adjunto, base, onCerrar }) {
  useEffect(() => {
    const alPulsar = (e) => {
      if (e.key === "Escape") onCerrar();
    };
    document.addEventListener("keydown", alPulsar);
    return () => document.removeEventListener("keydown", alPulsar);
  }, [onCerrar]);

  if (!adjunto) return null;
  const url = `${base}/${adjunto.id}?ver=1`;
  const esPdf = adjunto.verComo === "application/pdf";

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 flex flex-col"
      onClick={onCerrar}
      role="dialog"
      aria-label={adjunto.nombre}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white shrink-0">
        <span className="text-[13px] truncate">{adjunto.nombre}</span>
        <div className="flex items-center gap-3 shrink-0">
          <a
            href={`${base}/${adjunto.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-[12px] underline underline-offset-2 text-white/80 hover:text-white"
          >
            Descargar
          </a>
          <button
            onClick={onCerrar}
            className="text-white/80 hover:text-white text-2xl leading-none cursor-pointer"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
      </div>
      {/* El clic en el contenido no cierra: solo el de fuera. */}
      <div className="flex-1 min-h-0 px-4 pb-4" onClick={(e) => e.stopPropagation()}>
        {esPdf ? (
          <iframe src={url} title={adjunto.nombre} className="w-full h-full rounded bg-white" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={adjunto.nombre} className="max-w-full max-h-full object-contain rounded" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * El hilo. Panel lateral, y respeta la barra móvil del dashboard (`top-14
 * lg:top-0`, regla #13) y la escala de capas: fondo z-40, panel z-50.
 */
function Detalle({ avisoId, onVisto, onCerrar }) {
  const [aviso, setAviso] = useState(null);
  const [texto, setTexto] = useState("");
  const [ficheros, setFicheros] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState(null);
  const [viendo, setViendo] = useState(null);
  const refFicheros = useRef(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/ayuda/${avisoId}`);
      const json = await leerRespuesta(res);
      if (!res.ok) throw new Error(json.error || "No se ha podido cargar");
      setAviso(json.data);
      // Abrir el hilo ES haberlo leído, y el servidor acaba de apuntarlo (el GET
      // llama a `marcarVistoPorCliente`). Se avisa a la lista para que el
      // «Nueva respuesta» de la fila y el punto del menú se apaguen AHORA, en
      // vez de en la próxima recarga.
      onVisto?.(avisoId);
    } catch (e) {
      setFallo(e.message);
    }
  }, [avisoId, onVisto]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function responder(e) {
    e.preventDefault();
    if (enviando || texto.trim().length === 0) return;
    setEnviando(true);
    try {
      // Con capturas va como formulario; sin ellas, JSON. Igual que el alta.
      let peticion;
      if (ficheros.length) {
        const fd = new FormData();
        fd.set("cuerpo", texto);
        for (const f of ficheros) fd.append("adjuntos", f);
        peticion = { method: "POST", body: fd };
      } else {
        peticion = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cuerpo: texto }),
        };
      }

      const res = await fetch(`/api/ayuda/${avisoId}/mensajes`, peticion);
      const json = await leerRespuesta(res);
      if (!res.ok) throw new Error(json.error || "No se ha podido enviar");
      setAviso(json.data);
      setTexto("");
      setFicheros([]);
      if (refFicheros.current) refFicheros.current.value = "";
      // Si la captura no entró, el mensaje SÍ: hay que decirlo, no callarlo.
      setFallo(
        json.data?.avisoAdjuntos
          ? `El mensaje ha entrado, pero la captura no: ${json.data.avisoAdjuntos}`
          : null
      );
    } catch (e) {
      setFallo(e.message);
    } finally {
      setEnviando(false);
    }
  }

  /** El mismo freno que en el alta: se avisa AL ELEGIR, no al enviar. */
  function elegirFicheros(e) {
    const elegidos = Array.from(e.target.files ?? []).slice(0, LIMITES.adjuntos);
    const grande = elegidos.find((f) => f.size > LIMITES.bytesPorAdjunto);
    if (grande) {
      const pesa = (grande.size / (1024 * 1024)).toFixed(1);
      setFallo(`«${grande.name}» pesa ${pesa} MB y el tope son ${MB_POR_ADJUNTO} MB.`);
      setFicheros([]);
      e.target.value = "";
      return;
    }
    setFallo(null);
    setFicheros(elegidos);
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onCerrar} aria-hidden="true" />
      <aside className="fixed top-14 lg:top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white z-50 shadow-xl flex flex-col">
        <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-gray-400">{aviso?.ref ?? ""}</div>
            <h2 className="text-sm font-semibold text-gray-900 truncate">{aviso?.asunto ?? "…"}</h2>
          </div>
          <button
            onClick={onCerrar}
            className="text-gray-400 hover:text-gray-700 cursor-pointer text-xl leading-none"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* El error del panel se pinta UNA sola vez, abajo junto al botón de
              enviar: es donde está mirando quien acaba de pulsar. Aquí había
              otro igual y salía por duplicado. */}
          {aviso && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${ESTADO_COLOR[aviso.estado]}`}>
                  {aviso.estadoLabel}
                </span>
                {aviso.bloquea && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-700">
                    Te impide trabajar
                  </span>
                )}
              </div>

              <div>
                <div className="text-[11px] text-gray-400 mb-1">
                  {aviso.esMio === false ? aviso.usuarioNombre || "Un compañero" : "Tú"} · {fechaHora(aviso.createdAt)}
                </div>
                <p className="text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">{aviso.cuerpo}</p>
                {/* Las del alta: las que NO cuelgan de ningún mensaje. */}
                <Capturas lista={(aviso.adjuntos ?? []).filter((a) => !a.mensajeId)} onVer={setViendo} />
              </div>

              {aviso.mensajes.map((m) => (
                <div key={m.id} className={m.autorTipo === "salamandra" ? "" : "text-right"}>
                  <div className="text-[11px] text-gray-400 mb-1">
                    {m.autorTipo === "salamandra"
                      ? m.autorNombre || "Salamandra"
                      : m.autorNombre || (aviso.esMio === false ? "Un compañero" : "Tú")} ·{" "}
                    {fechaHora(m.createdAt)}
                  </div>
                  <p
                    className={`text-[13px] whitespace-pre-wrap leading-relaxed inline-block text-left rounded-lg px-3 py-2 ${
                      m.autorTipo === "salamandra" ? "bg-gray-100 text-gray-800" : "bg-gray-50 text-gray-700"
                    }`}
                  >
                    {m.cuerpo}
                  </p>
                  {/* Cada captura se enseña DONDE se mandó, no amontonada
                      arriba: en un hilo con idas y venidas, saber a qué
                      respuesta acompañaba es la mitad de la información. */}
                  <div className="text-left">
                    <Capturas lista={(aviso.adjuntos ?? []).filter((a) => a.mensajeId === m.id)} onVer={setViendo} />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <form onSubmit={responder} className="px-5 py-4 border-t border-gray-200">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            maxLength={5000}
            placeholder="Añadir algo…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
          />
          {/* Hasta el 13/08/2026 solo se podía adjuntar en el aviso inicial: si
              al responder hacía falta una segunda captura, no había forma. */}
          <input
            ref={refFicheros}
            type="file"
            multiple
            accept="image/*,.pdf"
            onChange={elegirFicheros}
            className="w-full text-[12px] text-gray-500 mt-2 file:mr-2 file:py-1 file:px-2 file:rounded file:border file:border-gray-200 file:bg-white file:text-[12px] file:text-gray-700 file:cursor-pointer hover:file:border-gray-300"
          />
          {ficheros.length > 0 && (
            <p className="text-[11px] text-gray-500 mt-1">{ficheros.map((f) => f.name).join(" · ")}</p>
          )}
          {fallo && <p className="text-[12px] text-red-700 mt-2 leading-snug">{fallo}</p>}
          <button
            type="submit"
            disabled={enviando || texto.trim().length === 0}
            className="mt-2 px-4 py-2 rounded-lg text-white text-[13px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}
          >
            {enviando ? "Enviando…" : "Enviar"}
          </button>
        </form>
      </aside>

      <Visor adjunto={viendo} base="/api/ayuda/adjuntos" onCerrar={() => setViendo(null)} />
    </>
  );
}
