/**
 * /soporte — placeholder digno mientras el módulo Soporte no está construido.
 * Se llega desde la llave inglesa del pie del sidebar (visible en todos los
 * tenants), así que no puede dar 404: de momento, canal de contacto directo.
 */
export const metadata = { title: "Soporte" };

export default function SoportePage() {
  return (
    <div className="p-4 lg:p-8 max-w-3xl mx-auto">
      <div className="mb-6 lg:mb-8">
        <div className="eyebrow mb-1.5 lg:mb-2">Ayuda · Soporte</div>
        <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mb-3">
          Soporte <span className="font-display-italic text-[var(--ink-400)]">— ¿en qué te ayudamos?</span>
        </h1>
        <p className="text-sm text-[var(--ink-500)] max-w-xl leading-relaxed">
          El módulo de tickets está en camino. Mientras tanto, escríbenos y te respondemos en el día.
        </p>
      </div>

      <div className="bg-white border border-neutral-100 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg grid place-items-center shrink-0 text-white" style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-800">Escríbenos</h2>
            <p className="text-[13px] text-neutral-500 mt-1">
              Incidencias, dudas o mejoras del CRM:
            </p>
            <a href="mailto:info@salamandrasolutions.com" className="inline-block mt-2 text-sm font-medium underline underline-offset-2" style={{ color: "var(--color-primary, #1B3A2D)" }}>
              info@salamandrasolutions.com
            </a>
            <p className="text-[11px] text-neutral-400 mt-3">
              Cuéntanos qué pasaba, en qué pantalla y, si puedes, adjunta una captura: se arregla antes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
