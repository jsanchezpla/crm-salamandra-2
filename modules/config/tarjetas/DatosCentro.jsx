"use client";

/*
 * modules/config/tarjetas/DatosCentro.jsx — la tarjeta «Datos del centro» de la
 * pestaña «Empresa» (28/08/2026).
 *
 * Es de dónde saca el informe clínico lo que imprime en la portada y en el pie:
 * razón social, CIF, teléfonos, las sedes con su nº de Registro Sanitario y el
 * párrafo de protección de datos. Hasta hoy el CRM no guardaba nada de esto.
 *
 * TODO ES OPCIONAL, y la pantalla tiene que decirlo: no hay ni un campo
 * obligatorio, ni un asterisco, ni un «—» de relleno. Lo que se deje en blanco
 * no se guarda (`lib/tenant/normalizarCentro.js` lo tira) y no se imprime.
 *
 * La forma de lo que se guarda la manda el servidor: aquí se manda el borrador
 * tal cual y se vuelve a pintar con lo que él devuelve ya normalizado —sedes
 * vacías fuera, textos recortados—, para que lo que se ve sea lo que se
 * imprimirá y no lo que se tecleó.
 */

import { useEffect, useState } from "react";
import { LIMITES } from "../../../lib/tenant/normalizarCentro.js";
import { Field, inputCls } from "./ui.jsx";

const SEDE_VACIA = Object.freeze({
  nombre: "",
  direccion: "",
  cp: "",
  ciudad: "",
  registroSanitario: "",
  telefono: "",
});

/**
 * Lo guardado → el borrador que se edita.
 *
 * Los teléfonos arrancan con UNA fila en blanco cuando no hay ninguno: si no,
 * la única forma de poner el primero sería descubrir el botón de añadir.
 */
function desdeProps(centro) {
  const telefonos = Array.isArray(centro?.telefonos) ? centro.telefonos.filter((t) => typeof t === "string") : [];
  return {
    razonSocial: centro?.razonSocial ?? "",
    cif: centro?.cif ?? "",
    telefonos: telefonos.length ? [...telefonos] : [""],
    proteccionDatos: centro?.proteccionDatos ?? "",
    sedes: Array.isArray(centro?.sedes) ? centro.sedes.map((s) => ({ ...SEDE_VACIA, ...s })) : [],
  };
}

export default function DatosCentro({ centro, readOnly, onGuardar }) {
  const [borrador, setBorrador] = useState(() => desdeProps(centro));
  const [guardando, setGuardando] = useState(false);

  /*
   * El borrador se rehace cuando cambia lo GUARDADO, no en cada render.
   *
   * La dependencia es el JSON y no el objeto a propósito: `patchTenant` hace
   * `setCfg({...c, ...data})`, así que guardar CUALQUIER otra tarjeta de la
   * pantalla trae un `centro` nuevo —igual por dentro— y con el objeto como
   * dependencia eso borraría lo que se estuviera escribiendo aquí.
   */
  const guardado = JSON.stringify(centro ?? null);
  useEffect(() => {
    setBorrador(desdeProps(JSON.parse(guardado)));
  }, [guardado]);

  const cambia = (campo, valor) => setBorrador((b) => ({ ...b, [campo]: valor }));

  const cambiaTelefono = (i, valor) =>
    setBorrador((b) => ({ ...b, telefonos: b.telefonos.map((t, n) => (n === i ? valor : t)) }));

  const quitaTelefono = (i) =>
    setBorrador((b) => {
      const quedan = b.telefonos.filter((_, n) => n !== i);
      return { ...b, telefonos: quedan.length ? quedan : [""] };
    });

  const anadeTelefono = () =>
    setBorrador((b) => (b.telefonos.length >= LIMITES.telefonos ? b : { ...b, telefonos: [...b.telefonos, ""] }));

  const cambiaSede = (i, campo, valor) =>
    setBorrador((b) => ({
      ...b,
      sedes: b.sedes.map((s, n) => (n === i ? { ...s, [campo]: valor } : s)),
    }));

  const quitaSede = (i) => setBorrador((b) => ({ ...b, sedes: b.sedes.filter((_, n) => n !== i) }));

  const anadeSede = () =>
    setBorrador((b) => (b.sedes.length >= LIMITES.sedes ? b : { ...b, sedes: [...b.sedes, { ...SEDE_VACIA }] }));

  async function guardar() {
    setGuardando(true);
    try {
      // Se manda tal cual: limpiar aquí sería tener la misma regla escrita en
      // dos sitios, y el que manda es el servidor.
      await onGuardar(borrador);
    } finally {
      setGuardando(false);
    }
  }

  const largoAviso = borrador.proteccionDatos.length;
  const cercaDelTope = largoAviso > LIMITES.proteccionDatos - 100;

  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-5">
      <div className="text-sm font-semibold text-neutral-800">Datos del centro</div>
      <p className="text-xs text-neutral-400 mt-0.5 max-w-lg">
        Lo que sale <strong>impreso en los informes clínicos</strong>: la cabecera, los datos de
        contacto y el aviso legal del pie. Todo es opcional — lo que dejes en blanco no se imprime,
        el informe se genera igual.
      </p>

      {/* ── Identidad ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        <Field label="Razón social">
          <input
            disabled={readOnly}
            maxLength={LIMITES.razonSocial}
            value={borrador.razonSocial}
            onChange={(e) => cambia("razonSocial", e.target.value)}
            placeholder="Nombre fiscal completo del centro"
            className={inputCls}
          />
        </Field>
        <Field label="CIF / NIF">
          <input
            disabled={readOnly}
            maxLength={LIMITES.cif}
            value={borrador.cif}
            onChange={(e) => cambia("cif", e.target.value)}
            placeholder="B00000000"
            className={inputCls}
          />
        </Field>
      </div>

      {/* ── Teléfonos ─────────────────────────────────────────────────────── */}
      <div className="mt-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
            Teléfonos
          </span>
          {!readOnly && borrador.telefonos.length < LIMITES.telefonos && (
            <button
              type="button"
              onClick={anadeTelefono}
              className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-800 transition-colors"
            >
              + Añadir teléfono
            </button>
          )}
        </div>
        <p className="text-[11px] text-neutral-400 mt-0.5">
          El primero es el principal: es el que sale en la cabecera del informe.
        </p>
        <div className="mt-2 space-y-2">
          {borrador.telefonos.map((tel, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                disabled={readOnly}
                maxLength={LIMITES.telefono}
                value={tel}
                onChange={(e) => cambiaTelefono(i, e.target.value)}
                placeholder={i === 0 ? "Teléfono principal" : "Otro teléfono"}
                inputMode="tel"
                className={inputCls}
              />
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => quitaTelefono(i)}
                  className="shrink-0 text-neutral-400 hover:text-red-600 px-2 py-2 text-sm"
                  aria-label={`Quitar el teléfono ${i + 1}`}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Sedes ─────────────────────────────────────────────────────────── */}
      <div className="mt-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
            Sedes
          </span>
          {!readOnly && borrador.sedes.length < LIMITES.sedes && (
            <button
              type="button"
              onClick={anadeSede}
              className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-800 transition-colors"
            >
              + Añadir sede
            </button>
          )}
        </div>
        <p className="text-[11px] text-neutral-400 mt-0.5">
          Cada local, con su número de Registro Sanitario: es de la sede, no del centro, y el
          informe imprime el de donde se atendió. Máximo {LIMITES.sedes}. Pon al menos el nombre o
          la dirección — una sede sin ninguno de los dos se guarda, pero no llega a imprimirse.
        </p>

        {borrador.sedes.length === 0 ? (
          <p className="text-xs text-neutral-400 py-3">
            Todavía no has añadido ninguna. Sin sedes, el informe sale sin ese bloque.
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {borrador.sedes.map((sede, i) => (
              <div key={i} className="border border-neutral-200 rounded-lg p-3 bg-neutral-50/60">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest">
                    Sede {i + 1}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => quitaSede(i)}
                      className="text-[11px] font-semibold text-neutral-400 hover:text-red-600 transition-colors"
                    >
                      Quitar
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Nombre de la sede">
                    <input
                      disabled={readOnly}
                      maxLength={LIMITES.nombre}
                      value={sede.nombre}
                      onChange={(e) => cambiaSede(i, "nombre", e.target.value)}
                      placeholder="Ej. Sede centro"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Nº de Registro Sanitario">
                    <input
                      disabled={readOnly}
                      maxLength={LIMITES.registroSanitario}
                      value={sede.registroSanitario}
                      onChange={(e) => cambiaSede(i, "registroSanitario", e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Dirección" full>
                    <input
                      disabled={readOnly}
                      maxLength={LIMITES.direccion}
                      value={sede.direccion}
                      onChange={(e) => cambiaSede(i, "direccion", e.target.value)}
                      placeholder="Calle, número, piso"
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Código postal">
                    <input
                      disabled={readOnly}
                      maxLength={LIMITES.cp}
                      value={sede.cp}
                      onChange={(e) => cambiaSede(i, "cp", e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Ciudad">
                    <input
                      disabled={readOnly}
                      maxLength={LIMITES.ciudad}
                      value={sede.ciudad}
                      onChange={(e) => cambiaSede(i, "ciudad", e.target.value)}
                      className={inputCls}
                    />
                  </Field>
                  <Field label="Teléfono de la sede" full>
                    <input
                      disabled={readOnly}
                      maxLength={LIMITES.telefono}
                      value={sede.telefono}
                      onChange={(e) => cambiaSede(i, "telefono", e.target.value)}
                      inputMode="tel"
                      className={inputCls}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Protección de datos ───────────────────────────────────────────── */}
      <div className="mt-5">
        <Field label="Aviso de protección de datos (pie del informe)" full>
          <textarea
            disabled={readOnly}
            rows={6}
            maxLength={LIMITES.proteccionDatos}
            value={borrador.proteccionDatos}
            onChange={(e) => cambia("proteccionDatos", e.target.value)}
            placeholder="El párrafo que tu asesoría te haya dado para los documentos con datos de salud. Se imprime tal cual al pie de cada informe."
            className={inputCls}
          />
        </Field>
        <div className="flex items-center justify-between gap-2 mt-1">
          <p className="text-[11px] text-neutral-400">
            Si lo dejas en blanco, el informe sale sin pie legal.
          </p>
          <span className={`text-[11px] tabular-nums ${cercaDelTope ? "text-amber-600" : "text-neutral-400"}`}>
            {largoAviso} / {LIMITES.proteccionDatos}
          </span>
        </div>
      </div>

      {!readOnly && (
        <div className="flex justify-end mt-4">
          <button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-50"
            style={{ background: "var(--color-primary, #1B3A2D)" }}
          >
            {guardando ? "Guardando…" : "Guardar datos del centro"}
          </button>
        </div>
      )}
    </div>
  );
}
