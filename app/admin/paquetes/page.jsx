"use client";

import { useEffect, useMemo, useState } from "react";
import { anchoPanel } from "@/components/admin/anchoPanel.js";

/**
 * Paquetes — lo que se vende con un nombre.
 *
 * ── LO PRIMERO QUE TIENE QUE DEJAR CLARO ESTA PANTALLA ──────────────────────
 * Que un paquete es una PLANTILLA, no una etiqueta que se le pega a un cliente.
 * Ningún tenant «tiene» un paquete: todos tienen sus módulos puestos a mano
 * (Jorge, 12/08/2026). Por eso editar uno aquí no le cambia nada a nadie, ni
 * siquiera a quien se dio de alta con él — y por eso el aviso de arriba lo dice
 * con esas palabras. Sin él, la primera pregunta al abrir esto sería «¿si toco
 * esto, a quién se lo cambio?».
 *
 * Hasta hoy los dos paquetes que había estaban escritos en
 * `lib/provisioning/catalogo.js` y hacía falta desplegar para tocarlos.
 *
 * El formulario NO completa las dependencias solo: si faltan módulos lo dice y
 * ofrece añadirlos, igual que el alta. Es la decisión del 10/08/2026 — lo que
 * entra en la lista entra en lo que paga el cliente, así que no puede entrar
 * sin que alguien lo marque.
 */

function Etiqueta({ children, tono = "tenue" }) {
  const color = tono === "alerta" ? "var(--alerta)" : tono === "ok" ? "var(--ok)" : "var(--tenue)";
  return (
    <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color }}>
      {children}
    </span>
  );
}

const inputCls = "w-full rounded px-2.5 py-1.5 text-[13px] focus:outline-none";
const inputStyle = { background: "var(--panel)", border: "1px solid var(--line)", color: "var(--text)" };

/** El formulario de crear y de editar, que es el mismo. */
function Formulario({ inicial, catalogo, onGuardar, onCancelar, guardando, fallo, faltan }) {
  const [f, setF] = useState(() => ({
    nombre: inicial?.nombre ?? "",
    descripcion: inicial?.desc ?? "",
    modulos: [...(inicial?.modulos ?? [])],
    orden: inicial?.orden ?? 0,
  }));

  const planos = useMemo(() => (catalogo ?? []).flatMap((g) => g.modulos ?? []), [catalogo]);
  const nombreDe = (k) => planos.find((m) => m.key === k)?.nombre ?? k;

  function alternar(key) {
    setF((p) => ({
      ...p,
      modulos: p.modulos.includes(key) ? p.modulos.filter((k) => k !== key) : [...p.modulos, key],
    }));
  }

  return (
    <div
      className="rounded-lg p-4 lg:p-5 space-y-4"
      style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
    >
      <div className="grid md:grid-cols-[1fr_auto] gap-3">
        <label className="block">
          <Etiqueta>Nombre</Etiqueta>
          <input
            value={f.nombre}
            onChange={(e) => setF((p) => ({ ...p, nombre: e.target.value }))}
            placeholder="Paquete Clínica"
            className={inputCls + " mt-1"}
            style={inputStyle}
          />
        </label>
        <label className="block">
          <Etiqueta>Orden</Etiqueta>
          <input
            type="number"
            value={f.orden}
            onChange={(e) => setF((p) => ({ ...p, orden: parseInt(e.target.value, 10) || 0 }))}
            className={inputCls + " mt-1 w-24"}
            style={inputStyle}
          />
        </label>
      </div>

      <label className="block">
        <Etiqueta>Para qué es</Etiqueta>
        <textarea
          value={f.descripcion}
          onChange={(e) => setF((p) => ({ ...p, descripcion: e.target.value }))}
          rows={2}
          placeholder="Lo que tiene un centro de nutrición: agenda con área privada, fichas…"
          className={inputCls + " mt-1 resize-y"}
          style={inputStyle}
        />
      </label>

      <div>
        <Etiqueta>Qué lleva ({f.modulos.length})</Etiqueta>
        <div className="mt-2 space-y-3">
          {(catalogo ?? []).map((g) => (
            <div key={g.grupo}>
              <div className="text-[11px] mb-1" style={{ color: "var(--tenue)" }}>{g.grupo}</div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
                {g.modulos.map((m) => (
                  <label key={m.key} className="flex items-center gap-2 text-[13px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={f.modulos.includes(m.key)}
                      onChange={() => alternar(m.key)}
                      className="accent-[var(--ok)]"
                    />
                    <span style={{ color: "var(--text)" }}>{m.nombre}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {fallo && (
        <div
          className="text-[12px] rounded px-3 py-2 space-y-2"
          style={{ background: "color-mix(in srgb, var(--alerta) 8%, transparent)", color: "var(--alerta)" }}
        >
          <div>{fallo}</div>
          {/* El servidor NUNCA completa la lista solo. Dice qué falta y aquí se
              ofrece añadirlo de un clic, que es lo mismo que hace el alta. */}
          {faltan?.length > 0 && (
            <button
              type="button"
              onClick={() => setF((p) => ({ ...p, modulos: [...new Set([...p.modulos, ...faltan])] }))}
              className="underline underline-offset-2 hover:no-underline"
            >
              añadir también {faltan.map(nombreDe).join(" y ")}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          disabled={guardando}
          onClick={() => onGuardar(f)}
          className="px-3 py-1.5 rounded text-[12px] font-semibold text-white disabled:opacity-40"
          style={{ background: "var(--ok)" }}
        >
          {guardando ? "Guardando…" : inicial ? "Guardar cambios" : "Crear paquete"}
        </button>
        <button type="button" onClick={onCancelar} className="text-[12px]" style={{ color: "var(--tenue)" }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export default function PaquetesPage() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState(null);
  const [faltan, setFaltan] = useState([]);
  const [confirmarBorrado, setConfirmarBorrado] = useState(null);

  useEffect(() => {
    document.title = "Paquetes — Salamandra";
  }, []);

  function cargar() {
    fetch("/api/admin/paquetes", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.error || `Error ${r.status}`);
        return j.data;
      })
      .then(setDatos)
      .catch((e) => setError(e.message));
  }

  useEffect(cargar, []);

  const planos = useMemo(() => (datos?.catalogo ?? []).flatMap((g) => g.modulos ?? []), [datos]);
  const nombreDe = (k) => planos.find((m) => m.key === k)?.nombre ?? k;

  async function guardar(form, id) {
    setGuardando(true);
    setFallo(null);
    setFaltan([]);
    try {
      const r = await fetch(id ? `/api/admin/paquetes/${id}` : "/api/admin/paquetes", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) {
        setFaltan(Array.isArray(j?.faltan) ? j.faltan : []);
        throw new Error(j?.error || `Error ${r.status}`);
      }
      setCreando(false);
      setEditando(null);
      cargar();
    } catch (e) {
      setFallo(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActivo(p) {
    await fetch(`/api/admin/paquetes/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !p.activo }),
    });
    cargar();
  }

  async function borrar(p) {
    await fetch(`/api/admin/paquetes/${p.id}`, { method: "DELETE" });
    setConfirmarBorrado(null);
    cargar();
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-[28px]" style={{ fontFamily: "var(--admin-display)", color: "var(--alerta)" }}>
            No se pudo leer
          </h1>
          <p className="text-[13px] mt-2" style={{ color: "var(--tenue)" }}>{error}</p>
        </div>
      </main>
    );
  }

  if (!datos) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <p className="text-[11px] uppercase tracking-[0.2em] animate-pulse" style={{ color: "var(--tenue)" }}>
          Leyendo paquetes
        </p>
      </main>
    );
  }

  return (
    <main className={anchoPanel()}>
      <Etiqueta>Salamandra · panel interno</Etiqueta>
      <h1
        className="text-[42px] lg:text-[58px] leading-[0.95] tracking-tight mt-2"
        style={{ fontFamily: "var(--admin-display)" }}
      >
        Paquetes
        <br />
        <span style={{ fontStyle: "italic", color: "var(--ok)" }}>de módulos</span>
      </h1>

      <p className="text-[13px] mt-5 max-w-xl leading-relaxed" style={{ color: "var(--dim)" }}>
        Un paquete es un <b>atajo para el alta</b>: marca sus módulos de una vez y desde ahí se
        añade o se quita lo que haga falta. <b>Ningún cliente «tiene» un paquete</b> — todos tienen
        sus módulos puestos a su gusto, así que tocar esto no le cambia nada a nadie, ni siquiera a
        quien se dio de alta con él.
      </p>

      {datos.soloLectura && (
        <div
          className="mt-5 text-[12px] rounded px-3 py-2.5"
          style={{ background: "color-mix(in srgb, var(--alerta) 8%, transparent)", color: "var(--alerta)" }}
        >
          Falta crear la tabla, así que lo de abajo son los dos paquetes escritos en el código y no
          se pueden tocar. En el VPS:{" "}
          <code>docker exec crm-salamandra-app-1 node scripts/migrate-paquetes-modulos.js</code>
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-4">
        <Etiqueta>{datos.paquetes.length} paquete(s)</Etiqueta>
        {!creando && !datos.soloLectura && (
          <button
            type="button"
            onClick={() => { setCreando(true); setEditando(null); setFallo(null); }}
            className="px-3 py-1.5 rounded text-[12px] font-semibold text-white"
            style={{ background: "var(--ok)" }}
          >
            + Nuevo paquete
          </button>
        )}
      </div>

      {creando && (
        <div className="mt-4">
          <Formulario
            inicial={null}
            catalogo={datos.catalogo}
            onGuardar={(f) => guardar(f, null)}
            onCancelar={() => { setCreando(false); setFallo(null); }}
            guardando={guardando}
            fallo={fallo}
            faltan={faltan}
          />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {datos.paquetes.length === 0 && !creando && (
          <p className="text-[13px]" style={{ color: "var(--tenue)" }}>
            No hay ningún paquete. El alta de clientes enseñará solo las casillas de módulos, que es
            como se ha dado de alta a todos los clientes de hoy.
          </p>
        )}

        {datos.paquetes.map((p) => (
          <div
            key={p.key}
            className="rounded-lg p-4"
            style={{ background: "var(--panel)", border: "1px solid var(--line)", opacity: p.activo ? 1 : 0.55 }}
          >
            {editando === p.key ? (
              <Formulario
                inicial={p}
                catalogo={datos.catalogo}
                onGuardar={(f) => guardar(f, p.id)}
                onCancelar={() => { setEditando(null); setFallo(null); }}
                guardando={guardando}
                fallo={fallo}
                faltan={faltan}
              />
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <span className="text-[15px] font-semibold">{p.nombre}</span>
                    <span className="text-[11px] ml-2 font-mono" style={{ color: "var(--tenue)" }}>{p.key}</span>
                    {!p.activo && <span className="ml-2"><Etiqueta tono="alerta">retirado</Etiqueta></span>}
                  </div>
                  {!datos.soloLectura && (
                    <div className="flex items-center gap-3 shrink-0 text-[11px] font-semibold uppercase tracking-wide">
                      <button onClick={() => { setEditando(p.key); setCreando(false); setFallo(null); }} style={{ color: "var(--dim)" }}>
                        Editar
                      </button>
                      <button onClick={() => alternarActivo(p)} style={{ color: "var(--dim)" }}>
                        {p.activo ? "Retirar" : "Reactivar"}
                      </button>
                      <button onClick={() => setConfirmarBorrado(p.key)} style={{ color: "var(--alerta)" }}>
                        Borrar
                      </button>
                    </div>
                  )}
                </div>

                {p.desc && (
                  <p className="text-[12px] mt-1.5 max-w-2xl leading-relaxed" style={{ color: "var(--dim)" }}>
                    {p.desc}
                  </p>
                )}
                <p className="text-[11px] mt-2" style={{ color: "var(--tenue)" }}>
                  {p.modulos.length} módulos · {p.modulos.map(nombreDe).join(" · ")}
                </p>
                {p.tocadoPor && (
                  <p className="text-[10px] mt-1" style={{ color: "var(--apagado)" }}>lo tocó {p.tocadoPor}</p>
                )}

                {confirmarBorrado === p.key && (
                  <div
                    className="mt-3 rounded px-3 py-2.5 text-[12px] flex items-center justify-between gap-3 flex-wrap"
                    style={{ background: "color-mix(in srgb, var(--alerta) 8%, transparent)", color: "var(--alerta)" }}
                  >
                    <span>
                      Se borra la plantilla. <b>A ningún cliente le cambia nada</b>: los que se
                      dieron de alta con ella conservan sus módulos.
                    </span>
                    <span className="flex gap-3 shrink-0">
                      <button onClick={() => setConfirmarBorrado(null)} style={{ color: "var(--dim)" }}>Cancelar</button>
                      <button onClick={() => borrar(p)} className="font-semibold">Sí, borrar</button>
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <p className="text-[11px] mt-8 leading-relaxed" style={{ color: "var(--tenue)" }}>
        Un paquete no se puede guardar con módulos que no existan ni con dependencias que no se
        sostengan — las mismas que exige el alta. Retirar uno lo esconde del alta sin perder qué
        llevaba.
      </p>
    </main>
  );
}
