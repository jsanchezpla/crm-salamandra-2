"use client";

import { useCallback, useEffect, useState } from "react";

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

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    try {
      const res = await fetch("/api/ayuda");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se ha podido cargar");
      setAvisos(json.data.avisos ?? []);
      setTipos(json.data.tipos ?? []);
      setSoloLectura(!!json.data.soloLectura);
      setFallo(null);
    } catch (e) {
      setFallo(e.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function enviar(e) {
    e.preventDefault();
    if (enviando) return;
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
      const json = await res.json();
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
      <div className="px-4 lg:px-8 pt-5 lg:pt-7 pb-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-gray-400 mb-1">Salamandra Solutions</div>
        <h1 className="text-gray-900 text-xl lg:text-2xl font-semibold">Ayuda</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl leading-relaxed">
          Si algo del CRM no funciona, no lo entiendes o se te ocurre cómo mejorarlo, cuéntanoslo
          aquí. Lo leemos nosotros.
        </p>
      </div>

      <div className="px-4 lg:px-8 pb-10 max-w-3xl">
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
                <span className="font-normal text-gray-400">(opcional, hasta 3)</span>
              </label>
              <input
                id="ayuda-ficheros"
                type="file"
                multiple
                accept="image/*,.pdf"
                onChange={(e) => {
                  const elegidos = Array.from(e.target.files ?? []).slice(0, 3);
                  const grande = elegidos.find((f) => f.size > 5 * 1024 * 1024);
                  if (grande) {
                    // Se avisa AQUÍ y no al enviar: descubrir que la captura no
                    // cabe después de escribirlo todo es la peor forma de
                    // enterarse.
                    setFallo(`«${grande.name}» pasa de 5 MB. Recórtala o mándala aparte.`);
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

              <button
                type="submit"
                disabled={enviando || asunto.trim().length < 3 || cuerpo.trim().length < 10}
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
          <h2 className="text-[13px] font-semibold text-gray-700 mb-3">Lo que nos has mandado</h2>
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
                    className="w-full text-left bg-white border border-gray-200 rounded-lg px-4 py-3 hover:border-gray-300 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-gray-900 font-medium truncate">{a.asunto}</div>
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          {a.ref} · {fecha(a.createdAt)}
                          {a.mensajes.length > 0 && ` · ${a.mensajes.length} respuesta${a.mensajes.length > 1 ? "s" : ""}`}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border ${
                          ESTADO_COLOR[a.estado] ?? ESTADO_COLOR.nuevo
                        }`}
                      >
                        {a.estadoLabel}
                      </span>
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

function Recibido({ aviso, onOtro }) {
  return (
    <div className="bg-white border border-emerald-200 rounded-xl p-6">
      <div className="text-sm font-semibold text-emerald-800">Recibido</div>
      <p className="text-[13px] text-neutral-600 mt-1.5 leading-relaxed">
        Le hemos puesto la referencia <strong>{aviso.ref}</strong>. Te contestamos aquí mismo, y lo
        verás en esta pantalla.
      </p>
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
 * El hilo. Panel lateral, y respeta la barra móvil del dashboard (`top-14
 * lg:top-0`, regla #13) y la escala de capas: fondo z-40, panel z-50.
 */
function Detalle({ avisoId, onCerrar }) {
  const [aviso, setAviso] = useState(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/ayuda/${avisoId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se ha podido cargar");
      setAviso(json.data);
    } catch (e) {
      setFallo(e.message);
    }
  }, [avisoId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function responder(e) {
    e.preventDefault();
    if (enviando || texto.trim().length === 0) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/ayuda/${avisoId}/mensajes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuerpo: texto }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se ha podido enviar");
      setAviso(json.data);
      setTexto("");
      setFallo(null);
    } catch (e) {
      setFallo(e.message);
    } finally {
      setEnviando(false);
    }
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
          {fallo && <div className="text-[13px] text-red-700">{fallo}</div>}
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
                <div className="text-[11px] text-gray-400 mb-1">Tú · {fechaHora(aviso.createdAt)}</div>
                <p className="text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">{aviso.cuerpo}</p>
                {aviso.adjuntos?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {aviso.adjuntos.map((ad) => (
                      <li key={ad.id}>
                        <a
                          href={`/api/ayuda/adjuntos/${ad.id}`}
                          className="text-[12px] underline underline-offset-2 text-gray-600 hover:text-gray-900"
                        >
                          {ad.nombre}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {aviso.mensajes.map((m) => (
                <div key={m.id} className={m.autorTipo === "salamandra" ? "" : "text-right"}>
                  <div className="text-[11px] text-gray-400 mb-1">
                    {m.autorTipo === "salamandra" ? m.autorNombre || "Salamandra" : "Tú"} ·{" "}
                    {fechaHora(m.createdAt)}
                  </div>
                  <p
                    className={`text-[13px] whitespace-pre-wrap leading-relaxed inline-block text-left rounded-lg px-3 py-2 ${
                      m.autorTipo === "salamandra" ? "bg-gray-100 text-gray-800" : "bg-gray-50 text-gray-700"
                    }`}
                  >
                    {m.cuerpo}
                  </p>
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
    </>
  );
}
