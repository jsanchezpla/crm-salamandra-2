"use client";

/**
 * CampanaEditor — una campaña: el editor por bloques con la vista previa al
 * lado, la audiencia, la prueba, la programación, el envío con su progreso y,
 * cuando ya ha salido, las métricas.
 *
 * ── LO QUE SE GUARDA Y CUÁNDO ─────────────────────────────────────────────
 * Cada cambio se guarda solo (PATCH con un segundo de calma) mientras la
 * campaña se puede editar; el indicador de arriba dice si está guardado. La
 * vista previa se pide al servidor (`/vista`, en un iframe con sandbox): es
 * el MISMO render que el envío, así que lo que se ve es lo que sale.
 *
 * ── EL ENVÍO NO MIENTE ────────────────────────────────────────────────────
 * «Enviar» pregunta a cuánta gente va a salir, prepara las filas y manda un
 * primer lote; después la pantalla va pidiendo lotes (`/avanzar`) hasta
 * terminar, y si se cierra el navegador el temporizador del VPS sigue. Lo
 * que se enseña son los contadores reales de `mailing_sends`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Select from "@/components/ui/Select.jsx";
import { useDialogo } from "@/components/ui/Dialogo.jsx";
import Cabecera from "./Cabecera.jsx";
import { ListaDeBloques } from "./Bloques.jsx";
import { api, botonPrimario, botonSecundario, Chip, estiloPrimario, fecha, inputCls, num } from "./api.js";

const EDITABLES = new Set(["borrador", "programada", "pausada", "cancelada"]);

function Indicador({ estado }) {
  const m = {
    idle: { dot: "bg-neutral-300", text: "" },
    sucio: { dot: "bg-amber-400", text: "Cambios sin guardar" },
    guardando: { dot: "bg-amber-400 animate-pulse", text: "Guardando…" },
    guardado: { dot: "bg-emerald-500", text: "Guardado" },
    error: { dot: "bg-rose-500", text: "Error al guardar" },
  }[estado] ?? { dot: "bg-neutral-300", text: "" };
  return (
    <span className="inline-flex items-center gap-2 text-xs text-neutral-500">
      <span className={`w-2 h-2 rounded-full ${m.dot}`} />
      {m.text}
    </span>
  );
}

function Campo({ label, children, ayuda }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-1">{label}</span>
      {children}
      {ayuda && <span className="block text-[11px] text-neutral-400 mt-0.5">{ayuda}</span>}
    </label>
  );
}

export default function CampanaEditor({ id, vocab }) {
  const router = useRouter();
  const { confirmar, pedirTexto, avisar, dialogo } = useDialogo();
  const [estadoModulo, setEstadoModulo] = useState(null);
  const [campana, setCampana] = useState(null);
  const [segmentos, setSegmentos] = useState([]);
  const [firmas, setFirmas] = useState([]);
  const [error, setError] = useState(null);
  const [guardado, setGuardado] = useState("idle");
  const [audiencia, setAudiencia] = useState(null);
  const [vistaTs, setVistaTs] = useState(Date.now());
  const [formatoVista, setFormatoVista] = useState("html");
  const [emailPrueba, setEmailPrueba] = useState("");
  const [resultadoPrueba, setResultadoPrueba] = useState(null);
  const [fechaProgramar, setFechaProgramar] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [metricas, setMetricas] = useState(null);
  const [busquedaEnvios, setBusquedaEnvios] = useState("");

  // Lo que está en pantalla (puede ir por delante de lo guardado).
  const [form, setForm] = useState(null);
  const pendiente = useRef(null);
  const timer = useRef(null);

  const editable = campana && EDITABLES.has(campana.estado);

  const cargar = useCallback(async () => {
    try {
      const [e, c, s, f] = await Promise.all([api("/estado?comprobar=1"), api(`/campanas/${id}`), api("/segmentos"), api("/plantillas?tipo=firma")]);
      setEstadoModulo(e);
      setCampana(c.campana);
      setForm({
        nombre: c.campana.nombre,
        asunto: c.campana.asunto,
        preheader: c.campana.preheader,
        replyTo: c.campana.replyTo ?? "",
        audiencia: c.campana.audiencia,
        segmentId: c.campana.segmentId ?? "",
        bloques: c.campana.bloques,
      });
      setSegmentos(s.segmentos);
      setFirmas(f.plantillas);
    } catch (err) {
      setError(err.message);
    }
  }, [id]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  // ── Recuento de la audiencia ──────────────────────────────────────────────
  useEffect(() => {
    if (!form) return;
    let vivo = true;
    (async () => {
      try {
        let reglas = {};
        if (form.audiencia === "segmento") {
          if (!form.segmentId) return setAudiencia(null);
          reglas = segmentos.find((s) => s.id === form.segmentId)?.reglas ?? {};
        }
        const r = await api("/audiencia", { metodo: "POST", body: { reglas } });
        if (vivo) setAudiencia(r);
      } catch {
        if (vivo) setAudiencia(null);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [form?.audiencia, form?.segmentId, segmentos]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Guardado automático ───────────────────────────────────────────────────
  const guardarAhora = useCallback(async () => {
    const cambios = pendiente.current;
    if (!cambios) return;
    pendiente.current = null;
    setGuardado("guardando");
    try {
      const r = await api(`/campanas/${id}`, { metodo: "PATCH", body: cambios });
      setCampana(r.campana);
      setGuardado("guardado");
      setVistaTs(Date.now());
    } catch (err) {
      setGuardado("error");
      setError(err.message);
    }
  }, [id]);

  const cambiar = (parcial) => {
    if (!editable) return;
    setForm((f) => ({ ...f, ...parcial }));
    const cuerpo = { ...(pendiente.current ?? {}), ...parcial };
    if ("segmentId" in parcial || "audiencia" in parcial) {
      cuerpo.audiencia = parcial.audiencia ?? form.audiencia;
      cuerpo.segmentId = parcial.segmentId ?? form.segmentId ?? null;
      if (cuerpo.audiencia === "segmento" && !cuerpo.segmentId) {
        // Sin segmento elegido todavía no se guarda nada: el servidor lo rechazaría.
        pendiente.current = { ...(pendiente.current ?? {}), ...parcial };
        setGuardado("sucio");
        return;
      }
    }
    pendiente.current = cuerpo;
    setGuardado("sucio");
    clearTimeout(timer.current);
    timer.current = setTimeout(guardarAhora, 1000);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const pedirEnlace = async ({ soloAviso } = {}) => {
    if (soloAviso) {
      await avisar({ titulo: "Selecciona el texto", texto: "Marca primero las palabras que quieres convertir en enlace y luego pulsa «Enlace»." });
      return null;
    }
    const url = await pedirTexto({ titulo: "Enlace", texto: "La dirección completa, con https://", etiqueta: "URL", placeholder: "https://" });
    if (!url) return null;
    return /^(https?:\/\/|mailto:|tel:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
  };

  const guardarFirma = async (bloque) => {
    const nombre = await pedirTexto({ titulo: "Guardar firma", texto: "Un nombre para encontrarla («Firma de Ana», «Firma del centro»).", etiqueta: "Nombre" });
    if (!nombre?.trim()) return;
    try {
      const r = await api("/plantillas", { metodo: "POST", body: { tipo: "firma", nombre: nombre.trim(), bloques: [bloque] } });
      setFirmas((prev) => [...prev, r.plantilla]);
    } catch (err) {
      setError(err.message);
    }
  };

  // ── Acciones ──────────────────────────────────────────────────────────────
  const accion = async (fn) => {
    setOcupado(true);
    setError(null);
    try {
      clearTimeout(timer.current);
      await guardarAhora();
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  const enviarPrueba = () =>
    accion(async () => {
      const r = await api(`/campanas/${id}/prueba`, { metodo: "POST", body: { emails: emailPrueba.split(/[,\s;]+/).filter(Boolean) } });
      setResultadoPrueba(r.resultados);
    });

  const avanzando = useRef(false);
  const avanzar = useCallback(async () => {
    if (avanzando.current) return;
    avanzando.current = true;
    try {
      let seguir = true;
      while (seguir) {
        const r = await api(`/campanas/${id}/avanzar`, { metodo: "POST" });
        setCampana(r.campana);
        seguir = r.campana.estado === "enviando" && r.lote && (r.lote.pendientes ?? 0) > 0 && !r.lote.pausada;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      avanzando.current = false;
    }
  }, [id]);

  useEffect(() => {
    if (campana?.estado === "enviando" && !estadoModulo?.demo) avanzar();
  }, [campana?.estado, estadoModulo?.demo, avanzar]);

  const enviar = () =>
    accion(async () => {
      const n = audiencia?.total ?? 0;
      const ok = await confirmar({
        titulo: `¿Enviar «${campana.nombre}» ahora?`,
        texto: `Va a salir a ${num(n)} persona${n === 1 ? "" : "s"} desde ${estadoModulo?.ses?.fromEmail}. Coste aproximado: ${(n / 1000 * 0.1).toFixed(2)} $. No se puede deshacer.`,
      });
      if (!ok) return;
      const r = await api(`/campanas/${id}/enviar`, { metodo: "POST" });
      setCampana(r.campana);
    });

  const programar = () =>
    accion(async () => {
      if (!fechaProgramar) throw new Error("Elige fecha y hora");
      const r = await api(`/campanas/${id}/programar`, { metodo: "POST", body: { fecha: new Date(fechaProgramar).toISOString() } });
      setCampana(r.campana);
    });

  const desprogramar = () =>
    accion(async () => {
      const r = await api(`/campanas/${id}/programar`, { metodo: "DELETE" });
      setCampana(r.campana);
    });

  const cambiarEstado = (acc) =>
    accion(async () => {
      if (acc === "cancelar") {
        const ok = await confirmar({ titulo: "¿Cancelar la campaña?", texto: "Lo que quede pendiente no saldrá. Lo ya enviado, enviado está.", tono: "peligro" });
        if (!ok) return;
      }
      const r = await api(`/campanas/${id}/estado`, { metodo: "POST", body: { accion: acc } });
      setCampana(r.campana);
    });

  const cargarMetricas = useCallback(async () => {
    try {
      const m = await api(`/campanas/${id}/metricas${busquedaEnvios ? `?q=${encodeURIComponent(busquedaEnvios)}` : ""}`);
      setMetricas(m);
    } catch {
      /* sin métricas todavía */
    }
  }, [id, busquedaEnvios]);
  useEffect(() => {
    if (campana && !["borrador", "cancelada"].includes(campana.estado)) cargarMetricas();
  }, [campana?.estado, campana?.enviados, cargarMetricas]); // eslint-disable-line react-hooks/exhaustive-deps

  const lista = useMemo(() => {
    if (!form) return { ok: false, motivo: "" };
    if (!String(form.asunto ?? "").trim()) return { ok: false, motivo: "Falta el asunto" };
    if (!form.bloques?.length) return { ok: false, motivo: "El correo está vacío" };
    if (form.audiencia === "segmento" && !form.segmentId) return { ok: false, motivo: "Elige un segmento" };
    return { ok: true, motivo: "" };
  }, [form]);

  const puedeEnviar = !!(estadoModulo?.ses?.configurado && !estadoModulo?.demo && lista.ok && (audiencia?.total ?? 0) > 0 && guardado !== "guardando");

  if (error && !campana) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Cabecera titulo="Campaña" />
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      </div>
    );
  }
  if (!campana || !form) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Cabecera titulo="Campaña" />
        <div className="text-sm text-gray-500">Cargando…</div>
      </div>
    );
  }

  const progreso = campana.totalDestinatarios
    ? Math.round(((campana.enviados + campana.fallidos + campana.suprimidos) / campana.totalDestinatarios) * 100)
    : 0;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Cabecera
        titulo={form.nombre || "Campaña"}
        subtitulo={
          <span className="inline-flex items-center gap-3">
            <Chip estado={campana.estado} />
            <Indicador estado={guardado} />
            <Link href="/mailing" className="underline text-gray-500">← Todas las campañas</Link>
          </span>
        }
        estado={estadoModulo}
      />

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error} <button className="underline ml-2" onClick={() => setError(null)}>Cerrar</button>
        </div>
      )}

      {!editable && campana.estado !== "enviada" && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          La campaña se está enviando: no se edita. Si hay que cambiar algo, páusala.
        </div>
      )}
      {campana.estado === "enviada" && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Esta campaña ya salió el {fecha(campana.terminadaAt)}. No se edita: para volver a mandarla, duplícala desde la lista.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_420px] items-start">
        {/* ── Izquierda: el correo ─────────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Nombre interno">
                <input className={inputCls} value={form.nombre} maxLength={160} disabled={!editable} onChange={(e) => cambiar({ nombre: e.target.value })} />
              </Campo>
              <Campo label="Responder a (opcional)" ayuda="A dónde llega si alguien contesta. Si no, al remitente.">
                <input className={inputCls} value={form.replyTo} disabled={!editable} onChange={(e) => cambiar({ replyTo: e.target.value })} placeholder={estadoModulo?.ses?.fromEmail ?? ""} />
              </Campo>
            </div>
            <Campo label="Asunto">
              <input className={inputCls} value={form.asunto} maxLength={200} disabled={!editable} onChange={(e) => cambiar({ asunto: e.target.value })} placeholder="Taller de gestión emocional, plazas abiertas" />
            </Campo>
            <Campo label="Texto de previsualización" ayuda="Lo que el buzón enseña debajo del asunto. Si se deja vacío, coge las primeras palabras del correo.">
              <input className={inputCls} value={form.preheader} maxLength={200} disabled={!editable} onChange={(e) => cambiar({ preheader: e.target.value })} />
            </Campo>
          </div>

          <ListaDeBloques
            bloques={form.bloques}
            onChange={(bloques) => cambiar({ bloques })}
            pedirEnlace={pedirEnlace}
            disabled={!editable}
            firmasGuardadas={firmas}
            onGuardarFirma={guardarFirma}
          />
        </section>

        {/* ── Derecha: vista previa y envío ─────────────────────────────────── */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Vista previa</span>
              <div className="flex gap-1">
                {["html", "texto"].map((f) => (
                  <button key={f} type="button" onClick={() => setFormatoVista(f)} className={`px-2 py-0.5 rounded text-[11px] ${formatoVista === f ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-200"}`}>
                    {f === "html" ? "Correo" : "Texto plano"}
                  </button>
                ))}
                <button type="button" onClick={() => setVistaTs(Date.now())} className="px-2 py-0.5 rounded text-[11px] text-gray-500 hover:bg-gray-200" title="Refrescar">↻</button>
              </div>
            </div>
            <iframe
              key={`${formatoVista}-${vistaTs}`}
              title="Vista previa del correo"
              // `allow-same-origin` SIN `allow-scripts`: hace falta el origen del CRM
              // para que la petición lleve la cookie de sesión (con origen opaco el
              // navegador no la manda y el iframe se queda en gris); sin scripts, el
              // HTML del correo no puede ejecutar nada ni tocar la sesión.
              sandbox="allow-same-origin"
              src={`/api/mailing/campanas/${id}/vista${formatoVista === "texto" ? "?formato=texto&" : "?"}t=${vistaTs}`}
              className="w-full h-[520px] bg-[#F3F4F6]"
            />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <Campo label="A quién">
              <Select
                value={form.audiencia}
                disabled={!editable}
                onChange={(v) => cambiar({ audiencia: v, segmentId: v === "segmento" ? form.segmentId || "" : "" })}
                options={[
                  { value: "todos", label: "Todos los que han dicho que sí" },
                  { value: "segmento", label: "Un segmento" },
                ]}
              />
            </Campo>
            {form.audiencia === "segmento" && (
              <Campo label="Segmento">
                <Select
                  value={form.segmentId}
                  disabled={!editable}
                  onChange={(v) => cambiar({ audiencia: "segmento", segmentId: v })}
                  options={[{ value: "", label: segmentos.length ? "— Elige —" : "— Aún no hay segmentos —" }, ...segmentos.map((s) => ({ value: s.id, label: s.nombre }))]}
                />
                <Link href="/mailing/segmentos" className="text-[11px] underline text-gray-500">Gestionar segmentos</Link>
              </Campo>
            )}
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm">
              {audiencia ? (
                <>
                  <span className="font-semibold text-gray-900">{num(audiencia.total)}</span> destinatario{audiencia.total === 1 ? "" : "s"}
                  <span className="text-gray-500"> · {num(audiencia.clientes)} {vocab?.plural?.toLowerCase() ?? "clientes"} · {num(audiencia.contactos)} sueltos</span>
                  {audiencia.suprimidos > 0 && <div className="text-[11px] text-gray-500">{num(audiencia.suprimidos)} en la lista de bajas, que no reciben</div>}
                  {audiencia.sinCasilla > 0 && (
                    <div className="text-[11px] text-gray-500">
                      {num(audiencia.sinCasilla)} {vocab?.plural?.toLowerCase() ?? "clientes"} con correo pero SIN la casilla de novedades: no reciben. <Link href="/mailing/lista" className="underline">Ver</Link>
                    </div>
                  )}
                </>
              ) : (
                <span className="text-gray-500">Calculando…</span>
              )}
            </div>

            {/* Prueba */}
            <div className="border-t border-gray-100 pt-3">
              <Campo label="Enviar una prueba" ayuda="Al equipo, con «[PRUEBA]» en el asunto. Hasta 5 direcciones separadas por comas.">
                <div className="flex gap-2">
                  <input className={inputCls} value={emailPrueba} onChange={(e) => setEmailPrueba(e.target.value)} placeholder="tu@correo.com" />
                  <button type="button" className={botonSecundario} disabled={ocupado || !emailPrueba.trim() || !estadoModulo?.ses?.configurado || estadoModulo?.demo} onClick={enviarPrueba}>
                    Probar
                  </button>
                </div>
              </Campo>
              {resultadoPrueba && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {resultadoPrueba.map((r) => (
                    <li key={r.email} className={r.ok ? "text-emerald-700" : "text-red-700"}>
                      {r.ok ? "✓" : "✗"} {r.email} {r.error ? `— ${r.error}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Estado / progreso */}
            {(campana.estado === "enviando" || campana.estado === "pausada" || campana.estado === "enviada") && (
              <div className="border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                  <span>{num(campana.enviados)} enviados de {num(campana.totalDestinatarios)}</span>
                  <span>{progreso} %</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full transition-all" style={{ width: `${progreso}%`, ...estiloPrimario }} />
                </div>
                {(campana.fallidos > 0 || campana.suprimidos > 0) && (
                  <div className="text-[11px] text-gray-500 mt-1">{num(campana.fallidos)} fallidos · {num(campana.suprimidos)} suprimidos</div>
                )}
                {campana.ultimoError && <div className="text-[11px] text-red-600 mt-1">{campana.ultimoError}</div>}
                <div className="flex flex-wrap gap-2 mt-3">
                  {campana.estado === "enviando" && <button type="button" className={botonSecundario} disabled={ocupado} onClick={() => cambiarEstado("pausar")}>Pausar</button>}
                  {campana.estado === "pausada" && (
                    <>
                      <button type="button" className={botonPrimario} style={estiloPrimario} disabled={ocupado || estadoModulo?.demo} onClick={() => cambiarEstado("reanudar")}>Reanudar</button>
                      <button type="button" className={botonSecundario} disabled={ocupado} onClick={() => cambiarEstado("cancelar")}>Cancelar el resto</button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Programar / enviar */}
            {editable && (
              <div className="border-t border-gray-100 pt-3 space-y-3">
                {campana.estado === "programada" ? (
                  <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-sm text-sky-900">
                    Programada para el <strong>{fecha(campana.programadaPara)}</strong>.{" "}
                    <button type="button" className="underline" disabled={ocupado} onClick={desprogramar}>Quitar la programación</button>
                  </div>
                ) : (
                  <Campo label="Programar para" ayuda="Sale sola a esa hora (como mucho un minuto después).">
                    <div className="flex gap-2">
                      <input type="datetime-local" className={inputCls} value={fechaProgramar} onChange={(e) => setFechaProgramar(e.target.value)} />
                      <button type="button" className={botonSecundario} disabled={!puedeEnviar || !fechaProgramar || ocupado} onClick={programar}>Programar</button>
                    </div>
                  </Campo>
                )}
                <button type="button" className={`${botonPrimario} w-full justify-center`} style={estiloPrimario} disabled={!puedeEnviar || ocupado} onClick={enviar}>
                  {ocupado ? "Un momento…" : `Enviar ahora a ${num(audiencia?.total ?? 0)}`}
                </button>
                {!lista.ok && <p className="text-[11px] text-amber-700">{lista.motivo}.</p>}
                {lista.ok && audiencia && audiencia.total === 0 && <p className="text-[11px] text-amber-700">No hay nadie a quien enviar todavía.</p>}
                {editable && campana.estado !== "cancelada" && (
                  <button type="button" className="text-[11px] underline text-gray-400 hover:text-red-600" disabled={ocupado} onClick={() => cambiarEstado("cancelar")}>
                    Cancelar la campaña
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── Métricas ─────────────────────────────────────────────────────────── */}
      {metricas && (
        <section className="mt-8 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-lg font-semibold text-gray-900">Cómo ha ido</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 mt-3">
            {[
              ["Entregados", num(metricas.resumen.entregados), `de ${num(metricas.resumen.total)}`],
              ["Clics", `${metricas.resumen.tasaClics} %`, `${num(metricas.resumen.clicaron)} personas · la métrica que vale`],
              ["Aperturas", `${metricas.resumen.tasaAperturas} %`, `${num(metricas.resumen.abrieron)} personas · orientativo`],
              ["Rebotes", num(metricas.resumen.porEstado.rebotado ?? 0), "direcciones que no existen"],
              ["Quejas", num(metricas.resumen.porEstado.queja ?? 0), "marcaron como spam"],
            ].map(([t, v, d]) => (
              <div key={t} className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{t}</div>
                <div className="text-xl font-semibold text-gray-900">{v}</div>
                <div className="text-[11px] text-gray-500">{d}</div>
              </div>
            ))}
          </div>

          {metricas.porEnlace.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Qué se pinchó</h3>
              <table className="w-full text-sm">
                <tbody>
                  {metricas.porEnlace.map((e) => (
                    <tr key={`${e.indice}-${e.url}`} className="border-t border-gray-100">
                      <td className="py-1.5 pr-3 text-gray-700 truncate max-w-[520px]" title={e.url}>{e.url}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-900 font-medium">{num(e.clics)} clics</td>
                      <td className="py-1.5 pl-3 text-right tabular-nums text-gray-500">{num(e.personas)} personas</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-sm font-semibold text-gray-800">Destinatarios</h3>
              <input className={`${inputCls} max-w-[260px]`} placeholder="Buscar por correo o nombre" value={busquedaEnvios} onChange={(e) => setBusquedaEnvios(e.target.value)} />
            </div>
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-gray-100 rounded-lg">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">Correo</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2 text-right">Abierto</th>
                    <th className="px-3 py-2 text-right">Clics</th>
                    <th className="px-3 py-2">Enviado</th>
                  </tr>
                </thead>
                <tbody>
                  {metricas.envios.map((e) => (
                    <tr key={e.id} className="border-t border-gray-100">
                      <td className="px-3 py-1.5">
                        <div className="text-gray-900">{e.email}</div>
                        <div className="text-[11px] text-gray-500">{e.nombre ?? ""}{e.origen === "contacto" ? " · suelto" : ""}</div>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className={`text-[11px] font-semibold ${e.estado === "enviado" ? "text-emerald-700" : e.estado === "pendiente" || e.estado === "procesando" ? "text-amber-700" : "text-red-700"}`}>{e.estado}</span>
                        {e.error && <div className="text-[11px] text-gray-500 truncate max-w-[260px]" title={e.error}>{e.error}</div>}
                      </td>
                      <td className="px-3 py-1.5 text-right">{e.aperturas > 0 ? "✓" : "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{e.clics || "—"}</td>
                      <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{fecha(e.enviadoAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
      {dialogo}
    </div>
  );
}
