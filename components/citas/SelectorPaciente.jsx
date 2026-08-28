"use client";

import { useCallback } from "react";
import SelectorRemoto from "../ui/SelectorRemoto.jsx";
import { urlDePacientes } from "../../lib/citas/buscarPacientes.js";

/**
 * SelectorPaciente — elegir un paciente preguntando al SERVIDOR.
 *
 * ─── DE QUÉ FALLO NACE (28/08/2026) ─────────────────────────────────────────
 *
 * El alta manual de una cita se bajaba la lista de pacientes de una vez, y ese
 * listado corta en 300 por diseño. Aumenta tiene 1.174, así que **874 pacientes
 * —el 74%— no estaban en el desplegable**, y escribir su nombre contestaba «Sin
 * opciones»: exactamente lo mismo que contesta cuando ese paciente no existe.
 *
 * El tope NO se sube: la pantalla de Pacientes calcula sus indicadores sobre
 * todo lo que recibe y bajarlo le rompería el buscador. Lo que hace falta es
 * preguntar según se escribe, que es lo que hace esto.
 *
 * ─── DOS COSAS PROPIAS DE PACIENTES ─────────────────────────────────────────
 *
 * El parámetro de búsqueda es `q`, no `search` como en fichas de cliente. Y la
 * búsqueda parte lo escrito en palabras y las exige todas, así que «hugo
 * castro» encuentra a «Hugo Castro Díaz» aunque el nombre viva partido en dos
 * columnas (ver `app/api/pacientes/route.js` y `lib/utils/busqueda.js`).
 *
 * `familia` acota a los pacientes de esa ficha. No es un adorno: en el alta de
 * una cita, con la familia ya elegida lo que se quiere ver son SUS hijos, no
 * los 1.174 del centro.
 *
 * Cada paciente llega con SU FAMILIA colgada (`client`), que es lo que hace que
 * elegir al hijo rellene el correo y el teléfono de la cita. Se pasa entera
 * hacia arriba en `onChange`: quien la reciba no tiene que volver a pedirla.
 *
 * La dirección se arma en `lib/clients/../citas/buscarPacientes.js`, que es un
 * `.js` a propósito: así se puede probar de verdad que el parámetro se llama
 * `q` y no `search`. Equivocarse ahí no da error — el servidor lo ignora y
 * devuelve los primeros, o sea que parecería que busca.
 */

export default function SelectorPaciente({
  value,
  onChange,
  onPaciente,
  familia = null,
  placeholder = "— Seleccionar paciente —",
  className = "",
  disabled = false,
  id,
  "aria-label": ariaLabel,
  opcionesFijas = [],
}) {
  const buscar = useCallback(
    async (texto) => {
      const r = await fetch(urlDePacientes(texto, familia), { cache: "no-store" });
      if (!r.ok) return { items: [], total: 0 };
      const j = await r.json();
      return { items: j?.data?.patients || [], total: j?.data?.total ?? 0 };
    },
    [familia]
  );

  const traerUno = useCallback(async (idPaciente) => {
    const r = await fetch(`/api/pacientes/${idPaciente}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.data ?? null;
  }, []);

  return (
    <SelectorRemoto
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={onChange}
      onElegida={onPaciente}
      buscar={buscar}
      traerUna={traerUno}
      etiqueta={(p) => p.name || `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "(sin nombre)"}
      plural="pacientes"
      dondeSeCrean="Pacientes"
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      opcionesFijas={opcionesFijas}
    />
  );
}
