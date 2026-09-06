"use client";

/**
 * ListaModule — a quién se escribe: las fichas con la casilla de novedades
 * (que se leen de la ficha, no se copian) y los correos SUELTOS, con su
 * consentimiento, su alta a mano, su confirmación por correo y la
 * importación de un CSV.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useDialogo } from "@/components/ui/Dialogo.jsx";
import Cabecera from "./Cabecera.jsx";
import { api, botonPrimario, botonSecundario, estiloPrimario, fecha, inputCls, num } from "./api.js";

const ESTADO_CONTACTO = {
  activo: "bg-emerald-100 text-emerald-700",
  pendiente: "bg-amber-100 text-amber-700",
  baja: "bg-neutral-200 text-neutral-600",
};

function Panel({ titulo, children, derecha }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-800">{titulo}</h2>
        {derecha}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function ListaModule({ vocab, conClientes }) {
  const { confirmar, pedirTexto, dialogo } = useDialogo();
  const [estado, setEstado] = useState(null);
  const [audiencia, setAudiencia] = useState(null);
  const [contactos, setContactos] = useState(null);
  const [porEstado, setPorEstado] = useState({});
  const [filtro, setFiltro] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  // Alta a mano
  const [nuevo, setNuevo] = useState({ email: "", nombre: "", origen: "", confirmar: false });
  const [creando, setCreando] = useState(false);

  // Importación
  const [csv, setCsv] = useState("");
  const [origenCsv, setOrigenCsv] = useState("");
  const [modoCsv, setModoCsv] = useState("activos");
  const [ensayo, setEnsayo] = useState(null);
  const [importando, setImportando] = useState(false);

  const cargarContactos = useCallback(async () => {
    try {
      const c = await api(`/contactos?q=${encodeURIComponent(q)}&estado=${filtro}`);
      setContactos(c.contactos);
      setPorEstado(c.porEstado);
    } catch (err) {
      setError(err.message);
    }
  }, [q, filtro]);

  useEffect(() => {
    (async () => {
      try {
        const [e, a] = await Promise.all([api("/estado"), api("/audiencia")]);
        setEstado(e);
        setAudiencia(a);
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);
  useEffect(() => {
    const t = setTimeout(cargarContactos, 250);
    return () => clearTimeout(t);
  }, [cargarContactos]);

  const crear = async () => {
    setCreando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await api("/contactos", {
        metodo: "POST",
        body: { email: nuevo.email, nombre: nuevo.nombre, consentimiento: { origen: nuevo.origen }, confirmarPorCorreo: nuevo.confirmar },
      });
      setNuevo({ email: "", nombre: "", origen: "", confirmar: false });
      setAviso(
        r.confirmacion ? (r.confirmacion.ok ? "Añadido y correo de confirmación enviado." : `Añadido, pero la confirmación no salió: ${r.confirmacion.error}`) : "Añadido a la lista."
      );
      cargarContactos();
      api("/audiencia").then(setAudiencia).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setCreando(false);
    }
  };

  const reconfirmar = async (c) => {
    try {
      await api(`/contactos/${c.id}/confirmar`, { metodo: "POST" });
      setAviso(`Confirmación enviada a ${c.email}.`);
      cargarContactos();
    } catch (err) {
      setError(err.message);
    }
  };

  const apuntarConsentimiento = async (c) => {
    const origen = await pedirTexto({
      titulo: "¿De dónde sale el sí?",
      texto: `Escribe la prueba de que ${c.email} aceptó recibir novedades (hoja de inscripción, correo, llamada con fecha…).`,
      etiqueta: "Origen del consentimiento",
    });
    if (!origen?.trim()) return;
    try {
      await api(`/contactos/${c.id}`, { metodo: "PATCH", body: { consentimiento: { origen: origen.trim() } } });
      cargarContactos();
      api("/audiencia").then(setAudiencia).catch(() => {});
    } catch (err) {
      setError(err.message);
    }
  };

  const borrar = async (c) => {
    const ok = await confirmar({ titulo: `¿Quitar ${c.email} de la lista?`, texto: c.estado === "baja" ? "Su baja se mantiene en la lista de supresión." : "Se borra el contacto suelto.", tono: "peligro" });
    if (!ok) return;
    try {
      await api(`/contactos/${c.id}`, { metodo: "DELETE" });
      cargarContactos();
      api("/audiencia").then(setAudiencia).catch(() => {});
    } catch (err) {
      setError(err.message);
    }
  };

  const leerFichero = (f) => {
    if (!f) return;
    const lector = new FileReader();
    lector.onload = () => setCsv(String(lector.result ?? ""));
    lector.readAsText(f, "utf-8");
  };

  const importar = async (simular) => {
    setImportando(true);
    setError(null);
    try {
      const r = await api("/contactos/importar", { metodo: "POST", body: { csv, origen: origenCsv, modo: modoCsv, simular } });
      setEnsayo(r);
      if (!simular) {
        setCsv("");
        setAviso(`Importados ${num(r.creados)} correos.${r.confirmacionesEnviadas ? ` ${num(r.confirmacionesEnviadas)} confirmaciones enviadas.` : ""}`);
        cargarContactos();
        api("/audiencia").then(setAudiencia).catch(() => {});
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImportando(false);
    }
  };

  const plural = vocab?.plural?.toLowerCase() ?? "clientes";

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Cabecera titulo="Lista" subtitulo="Quién recibe las campañas: solo quien ha dicho que sí." estado={estado} />

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error} <button className="underline ml-2" onClick={() => setError(null)}>Cerrar</button></div>}
      {aviso && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{aviso} <button className="underline ml-2" onClick={() => setAviso(null)}>Cerrar</button></div>}

      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Reciben campañas</div>
          <div className="text-2xl font-semibold text-gray-900">{audiencia ? num(audiencia.total) : "…"}</div>
          {audiencia && <div className="text-xs text-gray-500">{num(audiencia.clientes)} {plural} · {num(audiencia.contactos)} sueltos</div>}
        </div>
        {conClientes && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{vocab?.plural ?? "Clientes"} sin la casilla</div>
            <div className="text-2xl font-semibold text-gray-900">{audiencia ? num(audiencia.sinCasilla) : "…"}</div>
            <div className="text-xs text-gray-500">Tienen correo pero no han marcado «novedades». Se marca en su ficha o en su área privada; aquí no.</div>
          </div>
        )}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">En la lista de bajas</div>
          <div className="text-2xl font-semibold text-gray-900">{audiencia ? num(audiencia.suprimidos) : "…"}</div>
          <div className="text-xs text-gray-500">Tenían casilla o eran sueltos, pero se dieron de baja, rebotaron o se quejaron. <Link href="/mailing/bajas" className="underline">Ver</Link></div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px] items-start">
        <div className="space-y-6">
          <Panel
            titulo="Correos sueltos"
            derecha={
              <div className="flex items-center gap-2">
                <select className={`${inputCls} py-1 w-auto`} value={filtro} onChange={(e) => setFiltro(e.target.value)}>
                  <option value="">Todos ({num(Object.values(porEstado).reduce((a, b) => a + b, 0))})</option>
                  <option value="activo">Activos ({num(porEstado.activo ?? 0)})</option>
                  <option value="pendiente">Pendientes ({num(porEstado.pendiente ?? 0)})</option>
                  <option value="baja">Baja ({num(porEstado.baja ?? 0)})</option>
                </select>
                <input className={`${inputCls} py-1 max-w-[220px]`} placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            }
          >
            {contactos === null ? (
              <p className="text-sm text-gray-500">Cargando…</p>
            ) : contactos.length === 0 ? (
              <p className="text-sm text-gray-500">No hay correos sueltos{filtro || q ? " con ese filtro" : ""}. Los {plural} con la casilla de novedades ya cuentan sin estar aquí.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200">
                      <th className="py-2 pr-3">Correo</th>
                      <th className="py-2 pr-3">Estado</th>
                      <th className="py-2 pr-3">Consentimiento</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {contactos.map((c) => (
                      <tr key={c.id} className="border-b border-gray-100 align-top">
                        <td className="py-2 pr-3">
                          <div className="text-gray-900">{c.email}</div>
                          <div className="text-[11px] text-gray-500">{c.nombre ?? ""}{c.origen === "csv" ? " · CSV" : ""} · {fecha(c.creadoEn, false)}</div>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${ESTADO_CONTACTO[c.estado] ?? ""}`}>{c.estado}</span>
                        </td>
                        <td className="py-2 pr-3 text-xs text-gray-600 max-w-[320px]">
                          {c.consentimiento?.granted ? (
                            <>
                              <span className="text-gray-800">{c.consentimiento.origen}</span>
                              <div className="text-[11px] text-gray-400">{c.consentimiento.by === "confirmacion" ? "confirmado por la persona" : c.consentimiento.by === "csv" ? "declarado en la importación" : "apuntado por el equipo"} · {fecha(c.consentimiento.at, false)}</div>
                            </>
                          ) : (
                            <span className="text-amber-700">Pendiente de confirmar{c.confirmacionEnviadaAt ? ` (correo enviado el ${fecha(c.confirmacionEnviadaAt, false)})` : ""}</span>
                          )}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap text-xs">
                          {c.estado === "pendiente" && (
                            <>
                              <button type="button" className="underline text-gray-500 hover:text-gray-800 mr-3" onClick={() => apuntarConsentimiento(c)}>Ya tengo su sí</button>
                              {!estado?.demo && <button type="button" className="underline text-gray-500 hover:text-gray-800 mr-3" onClick={() => reconfirmar(c)}>Reenviar confirmación</button>}
                            </>
                          )}
                          <button type="button" className="underline text-gray-400 hover:text-red-600" onClick={() => borrar(c)}>Quitar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel titulo="Importar un CSV">
            <p className="text-xs text-gray-500 mb-3">
              Vale lo que exporta Excel, Sheets o Mailchimp: una columna con el correo y, si la hay, otra con el nombre. Separado por punto y coma, coma o tabulador. Lo que ya esté en la lista, en una ficha de {vocab?.singular ?? "cliente"} o en bajas se salta.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] items-end mb-3">
              <label className="block">
                <span className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-1">De dónde sale el consentimiento (obligatorio)</span>
                <input className={inputCls} value={origenCsv} onChange={(e) => setOrigenCsv(e.target.value)} placeholder="Hoja de inscripción del taller del 12/05/2026" maxLength={300} />
              </label>
              <label className={`${botonSecundario} cursor-pointer`}>
                Elegir fichero
                <input type="file" accept=".csv,text/csv,text/plain" className="hidden" onChange={(e) => leerFichero(e.target.files?.[0])} />
              </label>
            </div>
            <textarea className={`${inputCls} font-mono text-xs h-32`} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"Nombre;Email\nAna García;ana@ejemplo.com"} />
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="radio" name="modoCsv" checked={modoCsv === "activos"} onChange={() => setModoCsv("activos")} />
                Ya tengo su consentimiento (entran activos)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="radio" name="modoCsv" checked={modoCsv === "confirmar"} onChange={() => setModoCsv("confirmar")} disabled={estado?.demo} />
                Pedirles confirmación por correo (hasta 200)
              </label>
            </div>
            <div className="flex gap-2 mt-3">
              <button type="button" className={botonSecundario} disabled={importando || !csv.trim() || !origenCsv.trim()} onClick={() => importar(true)}>Comprobar sin importar</button>
              <button type="button" className={botonPrimario} style={estiloPrimario} disabled={importando || !csv.trim() || !origenCsv.trim() || !ensayo?.simulado} onClick={() => importar(false)}>
                Importar {ensayo?.simulado ? `${num(ensayo.creados)} correos` : ""}
              </button>
            </div>
            {ensayo && (
              <div className="mt-3 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-xs text-gray-700 space-y-0.5">
                <div><strong>{num(ensayo.leidas)}</strong> filas leídas{ensayo.cabecera ? " (con cabecera)" : ""} · <strong>{num(ensayo.creados)}</strong> {ensayo.simulado ? "se crearían" : "creados"}</div>
                {ensayo.yaEstaban > 0 && <div>{num(ensayo.yaEstaban)} ya estaban en la lista</div>}
                {ensayo.deFicha > 0 && <div>{num(ensayo.deFicha)} son de una ficha de {vocab?.singular ?? "cliente"}: se marcan en su ficha, no aquí</div>}
                {ensayo.suprimidos > 0 && <div>{num(ensayo.suprimidos)} están en la lista de bajas: no entran</div>}
                {ensayo.duplicadosEnFichero > 0 && <div>{num(ensayo.duplicadosEnFichero)} repetidos dentro del fichero</div>}
                {ensayo.invalidosTotal > 0 && (
                  <div>
                    {num(ensayo.invalidosTotal)} filas sin correo válido{ensayo.invalidos?.length ? `: ${ensayo.invalidos.slice(0, 3).join(" · ")}${ensayo.invalidosTotal > 3 ? "…" : ""}` : ""}
                  </div>
                )}
                {ensayo.confirmacionesEnviadas > 0 && <div>{num(ensayo.confirmacionesEnviadas)} confirmaciones enviadas{ensayo.confirmacionesFallidas ? `, ${ensayo.confirmacionesFallidas} fallidas` : ""}</div>}
              </div>
            )}
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel titulo="Añadir un correo suelto">
            <div className="space-y-3">
              <label className="block">
                <span className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-1">Correo</span>
                <input className={inputCls} value={nuevo.email} onChange={(e) => setNuevo((n) => ({ ...n, email: e.target.value }))} placeholder="persona@ejemplo.com" />
              </label>
              <label className="block">
                <span className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-1">Nombre (opcional)</span>
                <input className={inputCls} value={nuevo.nombre} onChange={(e) => setNuevo((n) => ({ ...n, nombre: e.target.value }))} />
              </label>
              <label className="block">
                <span className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-1">De dónde sale su sí</span>
                <input className={inputCls} value={nuevo.origen} onChange={(e) => setNuevo((n) => ({ ...n, origen: e.target.value }))} placeholder="Lo pidió en la charla del 12/05" maxLength={300} />
                <span className="block text-[11px] text-neutral-400 mt-0.5">Es la prueba del consentimiento (RGPD). Si no la tienes, pide confirmación por correo.</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={nuevo.confirmar} disabled={estado?.demo} onChange={(e) => setNuevo((n) => ({ ...n, confirmar: e.target.checked }))} />
                Mandarle un correo para que confirme
              </label>
              <button type="button" className={`${botonPrimario} w-full justify-center`} style={estiloPrimario} disabled={creando || !nuevo.email.trim() || (!nuevo.origen.trim() && !nuevo.confirmar)} onClick={crear}>
                Añadir
              </button>
            </div>
          </Panel>

          {conClientes && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600 space-y-2">
              <p className="font-semibold text-gray-800">¿Y los {plural}?</p>
              <p>No se añaden aquí. Reciben campañas los que tienen marcada la casilla «Novedades y actividades del centro» en su ficha (pestaña de comunicaciones) o en su área privada. Es UNA verdad, no dos.</p>
              <p>Si alguien se da de baja desde un correo, la casilla de su ficha se desmarca sola y queda en la lista de bajas.</p>
            </div>
          )}
        </aside>
      </div>
      {dialogo}
    </div>
  );
}
