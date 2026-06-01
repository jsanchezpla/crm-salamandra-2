/**
 * Layout de la landing pública del módulo Citas.
 *
 * Se renderiza dentro del `<body>` del layout raíz (`app/layout.js`), que ya
 * carga las fuentes globales del CRM. Aquí:
 *  · Cargamos DOS fuentes Google extra dedicadas al widget:
 *      - Cormorant Garamond (titulares) → --widget-font-display
 *      - Manrope (cuerpo)              → --widget-font-body
 *  · Definimos la paleta rosa-marrón del widget en variables CSS.
 *  · Forzamos el wrapper a usar Manrope como fuente por defecto.
 *
 * CSP `frame-ancestors *` se añade en `middleware.js` (Sprint 1).
 */
import { Cormorant_Garamond, Manrope } from "next/font/google";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--widget-font-display",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--widget-font-body",
  display: "swap",
});

export const metadata = {
  title: "Reserva tu cita",
  robots: { index: false, follow: false },
};

export default function WidgetLayout({ children }) {
  return (
    <div
      className={`${cormorant.variable} ${manrope.variable} min-h-screen`}
      style={{
        // Paleta rosa-marrón (defaults — el tenant puede sobreescribir el botón
        // vía settings.brand.primaryColor, que se mapea a --brand-primary en
        // cada página).
        "--widget-text":          "#4B3A36",   // texto principal — marrón cacao
        "--widget-text-muted":    "#7A6A65",   // texto secundario, derivado
        "--widget-text-faint":    "#B5A39C",   // labels, eyebrows
        "--widget-button":        "#A97873",   // rosa maquillaje profundo
        "--widget-button-hover":  "#8E5F5B",   // hover botón
        "--widget-focus":         "#D9B6B3",   // rosa palo elegante (focus ring)
        "--widget-border":        "#EADFD9",   // borde cálido
        "--widget-bg":            "#FAF6F2",   // fondo cálido
        "--widget-card":          "#FFFFFF",   // fondo de cards
        backgroundColor:          "var(--widget-bg)",
        color:                    "var(--widget-text)",
        fontFamily:               "var(--widget-font-body), ui-sans-serif, system-ui, sans-serif",
      }}
    >
      {children}
    </div>
  );
}
