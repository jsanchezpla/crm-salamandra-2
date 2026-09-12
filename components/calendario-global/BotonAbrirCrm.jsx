"use client";

import { useState } from "react";
import { abrirEnCrm } from "./abrirEnCrm.js";
import { IconoExterno } from "./Iconos.jsx";
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, FOCO } from "./estilos.js";
import { notaDelSalto } from "./formato.js";

/**
 * «Abrir en el CRM ↗» del calendario global (12/09/2026).
 *
 * Decide con la ficha del cliente (`saltoComo`, `saltoEmail`, de
 * `/api/calendario-global/vinculos` o `/eventos`):
 *   - `"cuenta"`: la cuenta vinculada a mano.
 *   - `"admin"`: no hay cuenta vinculada y se entra como el administrador del
 *     cliente (decisión de Rodrigo del 12/09/2026, auditada en SU Actividad).
 *     Esa sesión no se renueva sola a propósito, para no echar a la dirección
 *     del cliente de la suya, y quien pulsa tiene que saberlo antes.
 *   - `null`: no hay con quién entrar. Se dice, sin botón.
 *
 * Debajo del botón va la nota de `notaDelSalto` (`formato.js`): con qué correo
 * se entra y, desde el 12/09/2026 (revisión del calendario global), que el
 * salto CIERRA la sesión del CRM abierta en este navegador —la cookie es del
 * host, no de la pestaña—, también con `"cuenta"`, que antes no avisaba.
 *
 * Props:
 *   ficha     { slug, saltoComo, saltoEmail }
 *   destino   el `destino` del salto (ver `abrirEnCrm.js`)
 *   onError   (mensaje) => void — dónde enseñar un fallo
 *   variante  "primario" (por defecto) | "secundario" | "enlace" (texto, para
 *             cabeceras de lista; la nota va en el `title`) |
 *             "icono" (solo la flecha, para las filas de la lista de
 *             proyectos: el texto y la nota van en `aria-label` y `title`, y
 *             sin cuenta no pinta nada —lo dice una vez la cabecera del
 *             cliente, no cada fila—)
 *   texto     por defecto «Abrir en el CRM»
 *   nota      false para no pintar la nota debajo (va al `title`)
 */
export default function BotonAbrirCrm({
  ficha,
  destino,
  onError,
  variante = "primario",
  texto = "Abrir en el CRM",
  nota = true,
  className = "",
}) {
  const [abriendo, setAbriendo] = useState(false);

  if (!ficha?.saltoComo) {
    if (variante === "icono") return null;
    return <span className={`text-[12px] text-[#8A918E] ${className}`}>Sin cuenta para abrir su CRM</span>;
  }

  const notaSalto = notaDelSalto(ficha);

  function abrir() {
    if (abriendo) return;
    setAbriendo(true);
    // Sin nada que esperar antes: `abrirEnCrm` abre la pestaña en este mismo clic.
    abrirEnCrm({ slug: ficha.slug, destino })
      .catch((e) => onError?.(e?.message || "No se ha podido abrir el CRM de ese cliente."))
      .finally(() => setAbriendo(false));
  }

  const etiqueta = abriendo ? "Abriendo…" : texto;

  if (variante === "icono") {
    const nombre = notaSalto ? `${texto}. ${notaSalto}` : texto;
    return (
      <button
        type="button"
        onClick={abrir}
        disabled={abriendo}
        aria-label={nombre}
        aria-busy={abriendo || undefined}
        title={nombre}
        className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-[#8A918E] hover:bg-[#F2F2EE] hover:text-[#1F3B34] disabled:opacity-50 ${FOCO} ${className}`}
      >
        <IconoExterno className="w-4 h-4" />
      </button>
    );
  }

  if (variante === "enlace") {
    return (
      <button
        type="button"
        onClick={abrir}
        disabled={abriendo}
        title={notaSalto ?? undefined}
        className={`inline-flex items-center gap-1 rounded-sm text-[12px] text-[#3E5C57] hover:text-[#1F3B34] hover:underline underline-offset-2 disabled:opacity-60 ${FOCO} ${className}`}
      >
        {etiqueta}
        <IconoExterno className="w-3.5 h-3.5" />
      </button>
    );
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <button
        type="button"
        onClick={abrir}
        disabled={abriendo}
        title={!nota && notaSalto ? notaSalto : undefined}
        className={variante === "secundario" ? BOTON_SECUNDARIO : BOTON_PRIMARIO}
      >
        {etiqueta}
        <IconoExterno className="w-3.5 h-3.5" />
      </button>
      {nota && notaSalto && <p className="text-[11.5px] leading-snug text-[#8A918E]">{notaSalto}</p>}
    </div>
  );
}
