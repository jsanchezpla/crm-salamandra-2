/**
 * Layout de la landing pública del módulo Citas.
 *
 * Se renderiza dentro del `<body>` del layout raíz (`app/layout.js`), que ya
 * carga las fuentes globales. Aquí solo encapsulamos un wrapper neutro para
 * que la página se vea bien embebida en un iframe (sin chrome de dashboard).
 *
 * CSP `frame-ancestors *` se añade en `middleware.js`.
 */
export const metadata = {
  title: "Reserva tu cita",
  robots: { index: false, follow: false },
};

export default function WidgetLayout({ children }) {
  return (
    <div className="min-h-screen bg-[var(--widget-bg,#FAFAF7)] text-neutral-900 font-poppins">
      {children}
    </div>
  );
}
