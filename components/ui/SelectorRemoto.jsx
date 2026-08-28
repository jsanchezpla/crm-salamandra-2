"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Select from "./Select.jsx";
import { ESPERA_MS, hayMasDeLasQueCaben } from "../../lib/clients/buscarFichas.js";

/**
 * SelectorRemoto — un desplegable que PREGUNTA AL SERVIDOR según se escribe.
 *
 * ─── POR QUÉ EXISTE (28/08/2026) ────────────────────────────────────────────
 *
 * Doce pantallas se bajaban una lista al abrirse y filtraban encima. Como el
 * servidor corta (200 fichas, 300 pacientes), con los datos de Aumenta eso
 * dejaba fuera al 82% de las familias y al 74% de los pacientes — y la caja
 * contestaba «Sin opciones», lo mismo que si esa persona no existiera.
 *
 * **Un techo callado se lee como una ausencia.** De ahí las dos reglas de esta
 * pieza: se pregunta al servidor, y cuando hay más de las que caben, SE DICE.
 *
 * Esto es lo genérico. Quien sabe A QUÉ se pregunta son sus dos envoltorios:
 *
 *   components/clients/SelectorCliente.jsx   → fichas de cliente
 *   components/citas/SelectorPaciente.jsx    → pacientes
 *
 * Se extrajo al escribir el segundo. El primero se hizo esa misma mañana para
 * once pantallas, y copiarlo para el segundo habría sido repetir el error que
 * lo causó: arreglar una pantalla y dejar las demás atrás.
 *
 * ─── LO QUE HAY QUE PASARLE ─────────────────────────────────────────────────
 *
 *   buscar(texto)   → Promise<{ items, total }>  · total = cuántas casan EN TODA
 *                     la base, no cuántas se traen. Es lo que permite avisar.
 *   traerUna(id)    → Promise<item|null>  · la ya elegida, por su id
 *   etiqueta(item)  → texto de la línea
 *   plural          → «fichas» / «pacientes», para el aviso
 *   dondeSeCrean    → «Clientes» / «Pacientes», para cuando no hay ninguna
 *
 * Y los de siempre: value, onChange(id, item), onElegida(item), placeholder,
 * className, disabled, id, aria-label, opcionesFijas.
 */
export default function SelectorRemoto({
  value,
  onChange,
  onElegida,
  buscar,
  traerUna,
  etiqueta,
  plural = "fichas",
  dondeSeCrean = "Clientes",
  placeholder = "— Seleccionar —",
  className = "",
  disabled = false,
  id,
  "aria-label": ariaLabel,
  opcionesFijas = [],
}) {
  const [texto, setTexto] = useState("");
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [buscando, setBuscando] = useState(false);
  // La elegida se guarda aparte: puede no estar en la página que se ve, y sin
  // ella el botón enseñaría el placeholder aunque haya una elegida de verdad.
  const [elegida, setElegida] = useState(null);

  // Cada consulta lleva número: si una lenta contesta después de otra más
  // nueva, se tira. Sin esto, escribir deprisa deja en pantalla un resultado
  // viejo — y aquí eso significa elegir a quien no era.
  const consulta = useRef(0);

  // `buscar` suele venir escrita en el JSX, así que es una función nueva en
  // cada render. En las dependencias del efecto pediría la lista en bucle; se
  // guarda en una ref y el efecto depende solo de lo tecleado.
  const buscarRef = useRef(buscar);
  buscarRef.current = buscar;

  useEffect(() => {
    const q = texto.trim();
    const mia = ++consulta.current;
    setBuscando(true);
    const t = setTimeout(() => {
      Promise.resolve()
        .then(() => buscarRef.current(q))
        .then((r) => {
          if (mia !== consulta.current) return; // llegó tarde: manda la última
          setItems(r?.items || []);
          setTotal(r?.total ?? 0);
          setBuscando(false);
        })
        .catch(() => {
          if (mia === consulta.current) setBuscando(false);
        });
    }, ESPERA_MS);
    return () => clearTimeout(t);
  }, [texto]);

  /*
   * La ya elegida se pide POR SU ID. Buscarla dentro de la lista descargada era
   * justo el fallo: una que no estuviera en lo que cupo salía como «sin elegir»
   * aunque el registro estuviera bien guardado — y en el alta de una cita, eso
   * es pintar «Sin paciente asignado» con la cita a punto de nacer con él.
   */
  const traerRef = useRef(traerUna);
  traerRef.current = traerUna;
  useEffect(() => {
    if (!value) {
      setElegida(null);
      return;
    }
    let vigente = true;
    Promise.resolve()
      .then(() => traerRef.current(value))
      .then((item) => {
        if (vigente && item) setElegida(item);
      })
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [value]);

  // La elegida, hacia fuera. En un efecto para que llegue también cuando se
  // resuelve por id al abrir la pantalla, no solo cuando alguien la pulsa.
  useEffect(() => {
    onElegida?.(elegida);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elegida]);

  const opciones = useMemo(() => {
    const lista = items.map((x) => ({ value: x.id, label: etiqueta(x) }));
    // La elegida va siempre, aunque no esté en lo que se ve ahora.
    if (elegida && !lista.some((o) => String(o.value) === String(elegida.id))) {
      lista.unshift({ value: elegida.id, label: etiqueta(elegida) });
    }
    return [...opcionesFijas.map((o) => ({ ...o, pinned: true })), ...lista];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, elegida, opcionesFijas]);

  // `total` es cuántas casan en TODA la base, no cuántas se han traído: por eso
  // se puede decir la verdad y no una estimación.
  const hayMás = !buscando && hayMasDeLasQueCaben(total, items.length);
  const pie = hayMás ? (
    <p className="px-3 py-2 text-[11px] leading-snug text-neutral-500 border-t border-neutral-100">
      {total} {plural} coinciden; se enseñan {items.length}. Escribe un poco más para afinar.
    </p>
  ) : null;

  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      value={value ?? ""}
      onChange={(v) => {
        const item = items.find((x) => String(x.id) === String(v)) || null;
        if (item) setElegida(item);
        onChange?.(v, item);
      }}
      options={opciones}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      searchable
      filtrarEnCliente={false}
      onQueryChange={setTexto}
      // Tres silencios distintos, y confundirlos es justo lo que hacía daño:
      // «estoy mirando», «he mirado y no está» y «aquí todavía no hay nada».
      mensajeVacio={
        buscando
          ? "Buscando…"
          : texto.trim()
            ? `Ninguna coincidencia`
            : `Aún no hay ${plural}. Se crean en ${dondeSeCrean}.`
      }
      pie={pie}
    />
  );
}
