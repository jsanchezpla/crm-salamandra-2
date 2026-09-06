"use client";

/**
 * SegmentosModule — grupos de destinatarios por REGLAS que se resuelven al
 * enviar: módulo asignado, estado de la ficha y última cita (plan, entregable
 * 3: «el diferencial frente a Mailchimp»). El recuento de la derecha es el
 * mismo cálculo que hará el envío.
 */

import { useCallback, useEffect, useState } from "react";
import { useDialogo } from "@/components/ui/Dialogo.jsx";
import Select from "@/components/ui/Select.jsx";
import Cabecera from "./Cabecera.jsx";
import { api, botonPrimario, botonSecundario, estiloPrimario, inputCls, num } from "./api.js";

const NOMBRE_MODULO = { nutricion: "Nutrición", clinica: "Clínica", profesional_salud: "Profesional de la salud" };
const VACIO = { nombre: "", descripcion: "", reglas: { fuentes: ["clientes", "contactos"], modulos: [], estados: [], ultimaCita: null } };

export default function SegmentosModule({ vocab, conClientes, conCitas }) {
  const { confirmar, dialogo } = useDialogo();
  const [estado, setEstado] = useState(null);
  const [segmentos, setSegmentos] = useState(null);
  const [editando, setEditando] = useState(null); // null | { id?, nombre, descripcion, reglas }
  const [recuento, setRecuento] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [e, s] = await Promise.all([api("/estado"), api("/segmentos")]);
      setEstado(e);
      setSegmentos(s.segmentos);
    } catch (err) {
      setError(err.message);
    }
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);

  // Recuento en vivo mientras se edita.
  useEffect(() => {
    if (!editando) return;
    let vivo = true;
    const t = setTimeout(async () => {
      try {
        const r = await api("/segmentos/previsualizar", { metodo: "POST", body: { reglas: editando.reglas } });
        if (vivo) setRecuento(r);
      } catch {
        if (vivo) setRecuento(null);
      }
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [editando]);

  const setRegla = (parcial) => setEditando((e) => ({ ...e, reglas: { ...e.reglas, ...parcial } }));
  const alternar = (campo, valor) =>
    setRegla({ [campo]: editando.reglas[campo].includes(valor) ? editando.reglas[campo].filter((x) => x !== valor) : [...editando.reglas[campo], valor] });

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      if (editando.id) await api(`/segmentos/${editando.id}`, { metodo: "PATCH", body: editando });
      else await api("/segmentos", { metodo: "POST", body: editando });
      setEditando(null);
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (s) => {
    const ok = await confirmar({ titulo: `¿Borrar «${s.nombre}»?`, texto: "Las campañas ya enviadas con él no cambian.", tono: "peligro" });
    if (!ok) return;
    try {
      await api(`/segmentos/${s.id}`, { metodo: "DELETE" });
      cargar();
    } catch (err) {
      setError(err.message);
    }
  };

  const plural = vocab?.plural?.toLowerCase() ?? "clientes";
  const modulos = estado?.segmentos?.modulos ?? [];
  const estados = estado?.segmentos?.estados ?? [];

  const describir = (r) => {
    const partes = [];
    if (r.fuentes?.length === 1) partes.push(r.fuentes[0] === "clientes" ? `solo ${plural}` : "solo correos sueltos");
    if (r.modulos?.length) partes.push(`con ${r.modulos.map((m) => NOMBRE_MODULO[m] ?? m).join(" o ")}`);
    if (r.estados?.length) partes.push(`estado ${r.estados.map((e) => estados.find((x) => x.key === e)?.label ?? e).join("/")}`);
    if (r.ultimaCita) partes.push(r.ultimaCita.tipo === "nunca" ? "sin ninguna cita" : `última cita hace ${r.ultimaCita.tipo === "hace_menos" ? "menos" : "más"} de ${r.ultimaCita.dias} días`);
    return partes.length ? partes.join(" · ") : "todos los que han dicho que sí";
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <Cabecera
        titulo="Segmentos"
        subtitulo="Grupos por lo que el CRM ya sabe de cada persona. Se calculan al enviar, así que no se quedan viejos."
        estado={estado}
        derecha={
          <button type="button" className={botonPrimario} style={estiloPrimario} onClick={() => setEditando({ ...VACIO, reglas: { ...VACIO.reglas } })}>
            + Nuevo segmento
          </button>
        }
      />
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error} <button className="underline ml-2" onClick={() => setError(null)}>Cerrar</button></div>}

      <div className="grid gap-6 lg:grid-cols-[1fr_420px] items-start">
        <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          {segmentos === null ? (
            <div className="p-6 text-sm text-gray-500">Cargando…</div>
          ) : segmentos.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-500">
              Sin segmentos todavía. Sin ellos, cada campaña va a «todos los que han dicho que sí», que para empezar está bien.
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {segmentos.map((s) => (
                  <tr key={s.id} className="border-b border-gray-100 align-top hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{s.nombre}</div>
                      <div className="text-xs text-gray-500">{describir(s.reglas)}</div>
                      {s.descripcion && <div className="text-xs text-gray-400 mt-0.5">{s.descripcion}</div>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-xs">
                      <button type="button" className="underline text-gray-500 hover:text-gray-800 mr-3" onClick={() => setEditando({ id: s.id, nombre: s.nombre, descripcion: s.descripcion ?? "", reglas: { ...VACIO.reglas, ...s.reglas } })}>Editar</button>
                      <button type="button" className="underline text-gray-400 hover:text-red-600" onClick={() => borrar(s)}>Borrar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {editando && (
          <aside className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
            <h2 className="text-sm font-semibold text-gray-800">{editando.id ? "Editar segmento" : "Nuevo segmento"}</h2>
            <label className="block">
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-1">Nombre</span>
              <input className={inputCls} value={editando.nombre} maxLength={120} onChange={(e) => setEditando((x) => ({ ...x, nombre: e.target.value }))} placeholder="Familias de nutrición activas" />
            </label>
            <label className="block">
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-1">Descripción (opcional)</span>
              <input className={inputCls} value={editando.descripcion} maxLength={1000} onChange={(e) => setEditando((x) => ({ ...x, descripcion: e.target.value }))} />
            </label>

            <div>
              <span className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-1">De dónde</span>
              <div className="flex flex-wrap gap-3 text-sm">
                {conClientes && (
                  <label className="flex items-center gap-2"><input type="checkbox" checked={editando.reglas.fuentes.includes("clientes")} onChange={() => alternar("fuentes", "clientes")} /> {vocab?.plural ?? "Clientes"} con la casilla</label>
                )}
                <label className="flex items-center gap-2"><input type="checkbox" checked={editando.reglas.fuentes.includes("contactos")} onChange={() => alternar("fuentes", "contactos")} /> Correos sueltos activos</label>
              </div>
            </div>

            {conClientes && modulos.length > 0 && (
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-1">Con alguna de estas marcas en la ficha</span>
                <div className="flex flex-wrap gap-3 text-sm">
                  {modulos.map((m) => (
                    <label key={m} className="flex items-center gap-2"><input type="checkbox" checked={editando.reglas.modulos.includes(m)} onChange={() => alternar("modulos", m)} /> {NOMBRE_MODULO[m] ?? m}</label>
                  ))}
                </div>
              </div>
            )}

            {conClientes && estados.length > 0 && (
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-1">Estado de la ficha</span>
                <div className="flex flex-wrap gap-3 text-sm">
                  {estados.map((e) => (
                    <label key={e.key} className="flex items-center gap-2"><input type="checkbox" checked={editando.reglas.estados.includes(e.key)} onChange={() => alternar("estados", e.key)} /> {e.label}</label>
                  ))}
                </div>
                <p className="text-[11px] text-neutral-400 mt-1">Sin marcar ninguno, entran todos.</p>
              </div>
            )}

            {conClientes && conCitas && (
              <div>
                <span className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-1">Última cita</span>
                <div className="grid grid-cols-[1fr_90px] gap-2">
                  <Select
                    value={editando.reglas.ultimaCita?.tipo ?? ""}
                    onChange={(v) => setRegla({ ultimaCita: v ? { tipo: v, dias: editando.reglas.ultimaCita?.dias ?? 180 } : null })}
                    options={[
                      { value: "", label: "Da igual" },
                      { value: "hace_menos", label: "Hace menos de…" },
                      { value: "hace_mas", label: "Hace más de…" },
                      { value: "nunca", label: "Nunca ha tenido cita" },
                    ]}
                  />
                  {editando.reglas.ultimaCita && editando.reglas.ultimaCita.tipo !== "nunca" && (
                    <div className="flex items-center gap-1">
                      <input type="number" min={1} max={3650} className={inputCls} value={editando.reglas.ultimaCita.dias} onChange={(e) => setRegla({ ultimaCita: { ...editando.reglas.ultimaCita, dias: Number(e.target.value) } })} />
                      <span className="text-xs text-gray-500">días</span>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-neutral-400 mt-1">Cuenta la última cita pasada que no se canceló ni fue una falta.</p>
              </div>
            )}

            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm">
              {recuento ? (
                <>
                  <span className="font-semibold text-gray-900">{num(recuento.total)}</span> persona{recuento.total === 1 ? "" : "s"} ahora mismo
                  <span className="text-gray-500"> · {num(recuento.clientes)} {plural} · {num(recuento.contactos)} sueltos</span>
                  {recuento.muestra?.length > 0 && (
                    <div className="text-[11px] text-gray-500 mt-1 truncate">{recuento.muestra.map((m) => m.nombre || m.email).join(", ")}{recuento.total > recuento.muestra.length ? "…" : ""}</div>
                  )}
                </>
              ) : (
                <span className="text-gray-500">Calculando…</span>
              )}
            </div>

            <div className="flex gap-2">
              <button type="button" className={botonPrimario} style={estiloPrimario} disabled={guardando || !editando.nombre.trim() || !editando.reglas.fuentes.length} onClick={guardar}>
                {editando.id ? "Guardar cambios" : "Crear segmento"}
              </button>
              <button type="button" className={botonSecundario} onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          </aside>
        )}
      </div>
      {dialogo}
    </div>
  );
}
