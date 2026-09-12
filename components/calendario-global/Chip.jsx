import { TONOS } from "./estilos.js";

/**
 * Chip de estado del calendario global (12/09/2026): «Pendiente», «En pausa»,
 * «No cumplido». Pequeño, con borde fino y el tono apagado de `estilos.js`.
 *
 * `punto` pinta un círculo de ese color delante (la prioridad, una categoría):
 * el color va en el punto y no en el chip entero, para que un calendario
 * lleno de rojos y naranjas no convierta la ficha en un semáforo.
 */
export default function Chip({ tono = "neutral", punto = null, children, title }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 h-5 px-1.5 rounded-[5px] border text-[11px] font-medium leading-none whitespace-nowrap ${TONOS[tono] ?? TONOS.neutral}`}
    >
      {punto && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: punto }} />}
      {children}
    </span>
  );
}
