"use client";

/**
 * SecuenciasModule — los correos que salen solos cuando pasa algo en el CRM
 * (sprint 2): bienvenida al alta, cumpleaños, «hace tiempo que no vienes».
 *
 * Cada secuencia se edita como una campaña (asunto, bloques, vista previa) y
 * lleva un interruptor. Antes de encenderla se enseña a quién le tocaría hoy,
 * con el mismo cálculo que hará el temporizador.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Select from "@/components/ui/Select.jsx";
import { useDialogo } from "@/components/ui/Dialogo.jsx";
import Cabecera from "./Cabecera.jsx";
import { ListaDeBloques } from "./Bloques.jsx";
import { api, botonPrimario, botonSecundario, estiloPrimario, fecha, inputCls, num } from "./api.js";

function Campo({ label, children, ayuda }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-1">{label}</span>
      {children}
      {ayuda && <span className="block text-[11px] text-neutral-400 mt-0.5">{ayuda}</span>}
    </label>
  );
}

export default function SecuenciasModule({ vocab, conClientes, conCitas }) {
  const { confirmar, pedirTexto, avisar, dialogo } = useDialogo();
  const [estado, setEstado] = useState(null);
  const [secuencias, setSecuencias] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [firmas, setFirmas] = useState([]);
  const [abierta, setAbierta] = useState(null); // la secuencia en edición (serializada)
  const [form, setForm] = useState(null);
  const [guardado, setGuardado] = useState("idle");
  const [prevision, setPrevision] = useState(null);
  const [vistaTs, setVistaTs] = useState(Date.now());
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const pendiente = useRef(null);
  const timer = useRef(null);

  const cargar = useCallback(async () => {
    try {
      const [e, s, f] = await Promise.all([api("/estado"), api("/secuencias"), api("/plantillas?tipo=firma")]);
      setEstado(e);
      setSecuencias(s.secuencias);
      setEventos(s.eventos);
      setFirmas(f.plantillas);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const abrir = async (id) => {
    try {
      const r = await api(`/secuencias/${id}`);
      setAbierta(r.secuencia);
      setForm({ nombre: r.secuencia.nombre, dias: r.secuencia.dias, hora: r.secuencia.hora, asunto: r.secuencia.asunto, preheader: r.secuencia.preheader, bloques: r.secuencia.bloques, replyTo: r.secuencia.replyTo ?? "" });
      setGuardado("idle");
      setVistaTs(Date.now());
      api(`/secuencias/${id}/previsualizar`).then(setPrevision).catch(() => setPrevision(null));
    } catch (err) {
      setError(err.message);
    }
  };

  const guardarAhora = useCallback(async () => {
    const cambios = pendiente.current;
    if (!cambios || !abierta) return;
    pendiente.current = null;
    setGuardado("guardando");
    try {
      const r = await api(`/secuencias/${abierta.id}`, { metodo: "PATCH", body: cambios });
      setAbierta(r.secuencia);
      setSecuencias((prev) => prev.map((s) => (s.id === r.secuencia.id ? { ...s, ...r.secuencia } : s)));
      setGuardado("guardado");
      setVistaTs(Date.now());
      if ("dias" in cambios || "hora" in cambios) api(`/secuencias/${abierta.id}/previsualizar`).then(setPrevision).catch(() => {});
    } catch (err) {
      setGuardado("error");
      setError(err.message);
    }
  }, [abierta]);

  const cambiar = (parcial) => {
    setForm((f) => ({ ...f, ...parcial }));
    pendiente.current = { ...(pendiente.current ?? {}), ...parcial };
    setGuardado("sucio");
    clearTimeout(timer.current);
    timer.current = setTimeout(guardarAhora, 1000);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const nueva = async (evento) => {
    const ev = eventos.find((e) => e.key === evento);
    const nombre = await pedirTexto({ titulo: `Nueva secuencia: ${ev?.label ?? evento}`, texto: ev?.ayuda, etiqueta: "Nombre", valorInicial: ev?.label ?? "" });
    if (!nombre?.trim()) return;
    try {
      const r = await api("/secuencias", { metodo: "POST", body: { nombre: nombre.trim(), evento } });
      await cargar();
      abrir(r.secuencia.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const alternar = async (s) => {
    setOcupado(true);
    setError(null);
    try {
      clearTimeout(timer.current);
      await guardarAhora();
      if (!s.activa) {
        const p = await api(`/secuencias/${s.id}/previsualizar`).catch(() => null);
        const ok = await confirmar({
          titulo: `¿Encender «${s.nombre}»?`,
          texto: p ? `A partir de ahora saldrá sola. Hoy le tocaría a ${num(p.hoy)} persona${p.hoy === 1 ? "" : "s"}${p.saldriaHoy ? "" : ` (a partir de las ${String(s.hora).padStart(2, "0")}:00)`}.` : "A partir de ahora saldrá sola.",
        });
        if (!ok) return;
      }
      const r = await api(`/secuencias/${s.id}`, { metodo: "PATCH", body: { activa: !s.activa } });
      setSecuencias((prev) => prev.map((x) => (x.id === s.id ? { ...x, ...r.secuencia } : x)));
      if (abierta?.id === s.id) setAbierta(r.secuencia);
    } catch (err) {
      setError(err.message);
    } finally {
      setOcupado(false);
    }
  };

  const borrar = async (s) => {
    const ok = await confirmar({ titulo: `¿Borrar «${s.nombre}»?`, texto: "Se borra con su histórico de envíos. La lista de bajas no se toca.", tono: "peligro" });
    if (!ok) return;
    try {
      await api(`/secuencias/${s.id}`, { metodo: "DELETE" });
      if (abierta?.id === s.id) {
        setAbierta(null);
        setForm(null);
      }
      cargar();
    } catch (err) {
      setError(err.message);
    }
  };

  const pedirEnlace = async ({ soloAviso } = {}) => {
    if (soloAviso) {
      await avisar({ titulo: "Selecciona el texto", texto: "Marca primero las palabras que quieres convertir en enlace y luego pulsa «Enlace»." });
      return null;
    }
    const url = await pedirTexto({ titulo: "Enlace", texto: "La dirección completa, con https://", etiqueta: "URL", placeholder: "https://" });
    if (!url) return null;
    return /^(https?:\/\/|mailto:|tel:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
  };

  const eventoDe = (key) => eventos.find((e) => e.key === key);
  const disponibles = eventos.filter((e) => (e.key === "sin_cita" ? conCitas : true) && conClientes);
  const plural = vocab?.plural?.toLowerCase() ?? "clientes";

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Cabecera
        titulo="Secuencias"
        subtitulo="Correos que salen solos cuando pasa algo en el CRM. Solo a quien ha dicho que sí, y nunca dos veces por lo mismo."
        estado={estado}
        derecha={
          disponibles.length > 0 && (
            <div className="min-w-[240px]">
              <Select value="" onChange={(v) => v && nueva(v)} placeholder="+ Nueva secuencia…" options={disponibles.map((e) => ({ value: e.key, label: e.label }))} />
            </div>
          )
        }
      />
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error} <button className="underline ml-2" onClick={() => setError(null)}>Cerrar</button></div>}
      {!conClientes && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Las secuencias se disparan por lo que pasa en las fichas de {plural} (alta, cumpleaños, citas). Sin el módulo de Clientes no hay de dónde leerlo.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr] items-start">
        <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          {secuencias === null ? (
            <div className="p-6 text-sm text-gray-500">Cargando…</div>
          ) : secuencias.length === 0 ? (
            <div className="p-8 text-sm text-gray-500">
              <p className="font-medium text-gray-700">Todavía no hay secuencias.</p>
              <p className="mt-1">Las tres que trae el módulo: bienvenida al alta, cumpleaños y «hace tiempo que no vienes». Crea una arriba.</p>
            </div>
          ) : (
            <ul>
              {secuencias.map((s) => (
                <li key={s.id} className={`border-b border-gray-100 px-4 py-3 cursor-pointer hover:bg-gray-50 ${abierta?.id === s.id ? "bg-gray-50" : ""}`} onClick={() => abrir(s.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{s.nombre}</div>
                      <div className="text-xs text-gray-500">
                        {eventoDe(s.evento)?.label ?? s.evento}
                        {eventoDe(s.evento)?.usaDias ? ` · ${s.dias} ${eventoDe(s.evento).etiquetaDias}` : ""} · a las {String(s.hora).padStart(2, "0")}:00
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); alternar(s); }}
                      disabled={ocupado}
                      title={s.activa ? "Apagar" : "Encender"}
                      className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition ${s.activa ? "bg-emerald-500" : "bg-neutral-300"}`}
                    >
                      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition ${s.activa ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                  </div>
                  {s.activa && s.activadaDesde && <div className="text-[11px] text-emerald-700 mt-1">Encendida desde el {fecha(s.activadaDesde, false)}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {abierta && form ? (
          <section className="space-y-4">
            <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-900">{form.nombre}</h2>
                <span className="text-xs text-neutral-500">{{ sucio: "Cambios sin guardar", guardando: "Guardando…", guardado: "Guardado", error: "Error al guardar" }[guardado] ?? ""}</span>
              </div>
              <p className="text-xs text-gray-500">{eventoDe(abierta.evento)?.ayuda}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Campo label="Nombre interno">
                  <input className={inputCls} value={form.nombre} maxLength={160} onChange={(e) => cambiar({ nombre: e.target.value })} />
                </Campo>
                {eventoDe(abierta.evento)?.usaDias ? (
                  <Campo label={eventoDe(abierta.evento).etiquetaDias}>
                    <input type="number" min={0} max={3650} className={inputCls} value={form.dias} onChange={(e) => cambiar({ dias: Number(e.target.value) })} />
                  </Campo>
                ) : (
                  <div />
                )}
                <Campo label="Hora de envío (Madrid)" ayuda="Sale a partir de esa hora, el día que toque.">
                  <Select value={String(form.hora)} onChange={(v) => cambiar({ hora: Number(v) })} options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }))} />
                </Campo>
              </div>
              <Campo label="Asunto">
                <input className={inputCls} value={form.asunto} maxLength={200} onChange={(e) => cambiar({ asunto: e.target.value })} placeholder={abierta.evento === "cumpleanos" ? "¡Felicidades, {{nombre}}!" : abierta.evento === "alta" ? "Bienvenida a {{centro}}" : "Te echamos de menos, {{nombre}}"} />
              </Campo>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo label="Texto de previsualización">
                  <input className={inputCls} value={form.preheader} maxLength={200} onChange={(e) => cambiar({ preheader: e.target.value })} />
                </Campo>
                <Campo label="Responder a (opcional)">
                  <input className={inputCls} value={form.replyTo} onChange={(e) => cambiar({ replyTo: e.target.value })} placeholder={estado?.ses?.fromEmail ?? ""} />
                </Campo>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm">
                {prevision ? (
                  <>
                    Hoy le tocaría a <span className="font-semibold text-gray-900">{num(prevision.hoy)}</span> persona{prevision.hoy === 1 ? "" : "s"}
                    {prevision.muestra?.length > 0 && <span className="text-gray-500"> · {prevision.muestra.map((m) => m.nombre || m.email).join(", ")}{prevision.hoy > prevision.muestra.length ? "…" : ""}</span>}
                    {!abierta.activa && <div className="text-[11px] text-gray-500">Contando desde el momento en que se encienda: el histórico anterior no se dispara.</div>}
                  </>
                ) : (
                  <span className="text-gray-500">Calculando a quién le tocaría hoy…</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={abierta.activa ? botonSecundario : botonPrimario} style={abierta.activa ? undefined : estiloPrimario} disabled={ocupado || estado?.demo} onClick={() => alternar(abierta)}>
                  {abierta.activa ? "Apagar" : "Encender"}
                </button>
                <button type="button" className="text-xs underline text-gray-400 hover:text-red-600 self-center" onClick={() => borrar(abierta)}>Borrar secuencia</button>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1fr_380px] items-start">
              <ListaDeBloques bloques={form.bloques} onChange={(bloques) => cambiar({ bloques })} pedirEnlace={pedirEnlace} disabled={false} firmasGuardadas={firmas} />
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden lg:sticky lg:top-4">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Vista previa</span>
                  <button type="button" onClick={() => setVistaTs(Date.now())} className="px-2 py-0.5 rounded text-[11px] text-gray-500 hover:bg-gray-200">↻</button>
                </div>
                <iframe key={vistaTs} title="Vista previa" sandbox="allow-same-origin" src={`/api/mailing/secuencias/${abierta.id}/vista?t=${vistaTs}`} className="w-full h-[460px] bg-[#F3F4F6]" />
              </div>
            </div>

            {abierta.historial?.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Envíos de esta secuencia</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {abierta.historial.map((h) => (
                      <tr key={h.id} className="border-t border-gray-100">
                        <td className="py-1.5 text-gray-700">{h.periodo === "unica" ? "Desde que se encendió" : h.periodo}</td>
                        <td className="py-1.5 text-right tabular-nums">{num(h.enviados)} enviados{h.fallidos ? ` · ${num(h.fallidos)} fallidos` : ""}</td>
                        <td className="py-1.5 text-right text-xs text-gray-500">
                          <Link href={`/mailing/${h.id}`} className="underline">ver métricas</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <section className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">
            Elige una secuencia de la lista o crea una nueva. Cada una se escribe como una campaña y se enciende cuando esté lista.
          </section>
        )}
      </div>
      {dialogo}
    </div>
  );
}
