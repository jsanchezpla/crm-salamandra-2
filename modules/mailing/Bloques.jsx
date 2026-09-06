"use client";

/**
 * Bloques — la lista de bloques del editor y el formulario de cada tipo.
 * El catálogo es el de `lib/mailing/bloques.js` (seis tipos y ninguno más).
 */

import { useState } from "react";
import Select from "@/components/ui/Select.jsx";
import EditorTexto from "./EditorTexto.jsx";
import { api, botonSecundario, inputCls } from "./api.js";

export const TIPOS_BLOQUE = [
  { tipo: "titulo", label: "Título", icono: "T" },
  { tipo: "texto", label: "Texto", icono: "¶" },
  { tipo: "imagen", label: "Imagen", icono: "🖼" },
  { tipo: "boton", label: "Botón", icono: "▭" },
  { tipo: "separador", label: "Separador", icono: "—" },
  { tipo: "firma", label: "Firma", icono: "✍" },
];

function idNuevo() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `b${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

export function bloqueNuevo(tipo) {
  const base = { id: idNuevo(), tipo };
  switch (tipo) {
    case "titulo":
      return { ...base, texto: "", nivel: 1, alineacion: "izquierda" };
    case "texto":
      return { ...base, html: "<p></p>" };
    case "imagen":
      return { ...base, url: "", alt: "", enlace: "", ancho: "completa" };
    case "boton":
      return { ...base, texto: "Más información", url: "", alineacion: "centro" };
    case "firma":
      return { ...base, nombre: "", cargo: "", empresa: "", telefono: "", email: "", web: "", imagenUrl: "" };
    default:
      return base;
  }
}

const ALINEACIONES = [
  { value: "izquierda", label: "Izquierda" },
  { value: "centro", label: "Centro" },
  { value: "derecha", label: "Derecha" },
];

function Campo({ label, children, ayuda }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-widest text-neutral-400 mb-1">{label}</span>
      {children}
      {ayuda && <span className="block text-[11px] text-neutral-400 mt-0.5">{ayuda}</span>}
    </label>
  );
}

function SubidaImagen({ url, onUrl, disabled }) {
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState(null);
  const subir = async (fichero) => {
    if (!fichero) return;
    setSubiendo(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("fichero", fichero);
      const r = await api("/imagenes", { metodo: "POST", form });
      onUrl(r.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubiendo(false);
    }
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-16 w-auto rounded border border-neutral-200 bg-neutral-50" />
        ) : (
          <div className="h-16 w-24 rounded border border-dashed border-neutral-300 grid place-items-center text-[11px] text-neutral-400">sin imagen</div>
        )}
        <label className={`${botonSecundario} cursor-pointer ${disabled ? "pointer-events-none opacity-50" : ""}`}>
          {subiendo ? "Subiendo…" : url ? "Cambiar imagen" : "Subir imagen"}
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" disabled={disabled || subiendo} onChange={(e) => subir(e.target.files?.[0])} />
        </label>
        {url && !disabled && (
          <button type="button" className="text-xs underline text-neutral-400 hover:text-red-600" onClick={() => onUrl("")}>Quitar</button>
        )}
      </div>
      <p className="text-[11px] text-neutral-400 mt-1">png, jpg, gif o webp · hasta 2 MB · 600 px de ancho es de sobra. Muchos buzones bloquean las imágenes: el correo tiene que entenderse sin verlas.</p>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

function FormularioBloque({ bloque, onChange, pedirEnlace, disabled, firmasGuardadas, onGuardarFirma }) {
  const set = (campo, valor) => onChange({ ...bloque, [campo]: valor });
  switch (bloque.tipo) {
    case "titulo":
      return (
        <div className="grid gap-3 sm:grid-cols-[1fr_140px_140px]">
          <Campo label="Texto">
            <input className={inputCls} value={bloque.texto} maxLength={200} disabled={disabled} onChange={(e) => set("texto", e.target.value)} placeholder="Hola {{nombre}}" />
          </Campo>
          <Campo label="Tamaño">
            <Select value={String(bloque.nivel)} disabled={disabled} onChange={(v) => set("nivel", Number(v))} options={[{ value: "1", label: "Grande" }, { value: "2", label: "Mediano" }]} />
          </Campo>
          <Campo label="Alineación">
            <Select value={bloque.alineacion} disabled={disabled} onChange={(v) => set("alineacion", v)} options={ALINEACIONES} />
          </Campo>
        </div>
      );
    case "texto":
      return <EditorTexto html={bloque.html} onChange={(html) => set("html", html)} pedirEnlace={pedirEnlace} disabled={disabled} />;
    case "imagen":
      return (
        <div className="space-y-3">
          <SubidaImagen url={bloque.url} onUrl={(u) => set("url", u)} disabled={disabled} />
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_140px]">
            <Campo label="Texto alternativo" ayuda="Lo que se lee si la imagen no carga.">
              <input className={inputCls} value={bloque.alt} maxLength={200} disabled={disabled} onChange={(e) => set("alt", e.target.value)} />
            </Campo>
            <Campo label="Enlace al pulsar (opcional)">
              <input className={inputCls} value={bloque.enlace} disabled={disabled} onChange={(e) => set("enlace", e.target.value)} placeholder="https://…" />
            </Campo>
            <Campo label="Ancho">
              <Select value={bloque.ancho} disabled={disabled} onChange={(v) => set("ancho", v)} options={[{ value: "completa", label: "Completo" }, { value: "media", label: "Mitad" }]} />
            </Campo>
          </div>
        </div>
      );
    case "boton":
      return (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_140px]">
          <Campo label="Texto del botón">
            <input className={inputCls} value={bloque.texto} maxLength={80} disabled={disabled} onChange={(e) => set("texto", e.target.value)} />
          </Campo>
          <Campo label="Enlace">
            <input className={inputCls} value={bloque.url} disabled={disabled} onChange={(e) => set("url", e.target.value)} placeholder="https://…" />
          </Campo>
          <Campo label="Alineación">
            <Select value={bloque.alineacion} disabled={disabled} onChange={(v) => set("alineacion", v)} options={ALINEACIONES} />
          </Campo>
        </div>
      );
    case "separador":
      return <p className="text-xs text-neutral-400">Una línea fina entre dos partes del correo.</p>;
    case "firma":
      return (
        <div className="space-y-3">
          {(firmasGuardadas?.length > 0 || onGuardarFirma) && (
            <div className="flex flex-wrap items-center gap-2">
              {firmasGuardadas?.length > 0 && (
                <div className="min-w-[220px]">
                  <Select
                    value=""
                    disabled={disabled}
                    onChange={(id) => {
                      const f = firmasGuardadas.find((x) => x.id === id);
                      const b = f?.bloques?.find((x) => x.tipo === "firma");
                      if (b) onChange({ ...b, id: bloque.id });
                    }}
                    options={[{ value: "", label: "— Usar una firma guardada —" }, ...firmasGuardadas.map((f) => ({ value: f.id, label: f.nombre }))]}
                  />
                </div>
              )}
              {onGuardarFirma && !disabled && (
                <button type="button" className="text-xs underline text-neutral-500 hover:text-neutral-800" onClick={() => onGuardarFirma(bloque)}>
                  Guardar esta firma para otras campañas
                </button>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="Nombre"><input className={inputCls} value={bloque.nombre} maxLength={100} disabled={disabled} onChange={(e) => set("nombre", e.target.value)} /></Campo>
            <Campo label="Cargo"><input className={inputCls} value={bloque.cargo} maxLength={100} disabled={disabled} onChange={(e) => set("cargo", e.target.value)} /></Campo>
            <Campo label="Empresa o centro"><input className={inputCls} value={bloque.empresa} maxLength={100} disabled={disabled} onChange={(e) => set("empresa", e.target.value)} /></Campo>
            <Campo label="Teléfono"><input className={inputCls} value={bloque.telefono} maxLength={40} disabled={disabled} onChange={(e) => set("telefono", e.target.value)} /></Campo>
            <Campo label="Correo"><input className={inputCls} value={bloque.email} maxLength={120} disabled={disabled} onChange={(e) => set("email", e.target.value)} /></Campo>
            <Campo label="Web"><input className={inputCls} value={bloque.web} disabled={disabled} onChange={(e) => set("web", e.target.value)} placeholder="https://…" /></Campo>
          </div>
          <Campo label="Foto o logo (opcional)">
            <SubidaImagen url={bloque.imagenUrl} onUrl={(u) => set("imagenUrl", u)} disabled={disabled} />
          </Campo>
        </div>
      );
    default:
      return null;
  }
}

export function ListaDeBloques({ bloques, onChange, pedirEnlace, disabled, firmasGuardadas, onGuardarFirma }) {
  const mover = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= bloques.length) return;
    const copia = [...bloques];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    onChange(copia);
  };
  const quitar = (i) => onChange(bloques.filter((_, k) => k !== i));
  const cambiar = (i, b) => onChange(bloques.map((x, k) => (k === i ? b : x)));
  const anadir = (tipo) => onChange([...bloques, bloqueNuevo(tipo)]);

  return (
    <div className="space-y-3">
      {bloques.length === 0 && (
        <div className="rounded-lg border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          El correo está vacío. Añade un título y un texto para empezar.
        </div>
      )}
      {bloques.map((b, i) => (
        <div key={b.id} className="rounded-xl border border-neutral-200 bg-white">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-neutral-100 bg-neutral-50 rounded-t-xl">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              {TIPOS_BLOQUE.find((t) => t.tipo === b.tipo)?.label ?? b.tipo}
            </span>
            {!disabled && (
              <div className="flex items-center gap-1 text-neutral-500">
                <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} title="Subir" className="px-1.5 py-0.5 rounded hover:bg-neutral-200 disabled:opacity-30">↑</button>
                <button type="button" onClick={() => mover(i, 1)} disabled={i === bloques.length - 1} title="Bajar" className="px-1.5 py-0.5 rounded hover:bg-neutral-200 disabled:opacity-30">↓</button>
                <button type="button" onClick={() => quitar(i)} title="Quitar" className="px-1.5 py-0.5 rounded hover:bg-red-100 hover:text-red-700">✕</button>
              </div>
            )}
          </div>
          <div className="p-3">
            <FormularioBloque bloque={b} onChange={(nb) => cambiar(i, nb)} pedirEnlace={pedirEnlace} disabled={disabled} firmasGuardadas={firmasGuardadas} onGuardarFirma={onGuardarFirma} />
          </div>
        </div>
      ))}
      {!disabled && (
        <div className="flex flex-wrap gap-2 pt-1">
          <span className="text-xs text-neutral-500 self-center mr-1">Añadir:</span>
          {TIPOS_BLOQUE.map((t) => (
            <button key={t.tipo} type="button" onClick={() => anadir(t.tipo)} className={botonSecundario}>
              <span className="text-neutral-400">{t.icono}</span> {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
