/**
 * Iconos del calendario global (12/09/2026): SVG en línea, trazo 1,5, del
 * tamaño del texto. Los mismos trazos que ya usa el resto del CRM; nada de
 * librería de iconos para cinco dibujos.
 *
 * Todos son decorativos (`aria-hidden`): el botón que los lleva tiene que
 * decir con texto o `aria-label` lo que hace.
 */

function Svg({ className = "w-4 h-4", strokeWidth = 1.5, children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconoCerrar(props) {
  return (
    <Svg {...props}>
      <path d="M6 18 18 6M6 6l12 12" />
    </Svg>
  );
}

export function IconoBuscar(props) {
  return (
    <Svg {...props}>
      <path d="m20 20-4.2-4.2M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z" />
    </Svg>
  );
}

export function IconoCheck(props) {
  return (
    <Svg {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Svg>
  );
}

export function IconoExterno(props) {
  return (
    <Svg {...props}>
      <path d="M13.5 6H18v4.5M18 6l-7.5 7.5M16 13.5V18H6V8h4.5" />
    </Svg>
  );
}

export function IconoLista(props) {
  return (
    <Svg {...props}>
      <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </Svg>
  );
}
