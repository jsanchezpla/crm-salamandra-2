"use client";

/**
 * PuertaScreen — «un paso antes» (05/08/2026).
 *
 * La pantalla que se le enseña a quien todavía no puede reservar. Nació dentro
 * de `/book`, donde salía DESPUÉS de elegir hueco y rellenar los datos: quien
 * acababa de crearse la cuenta veía la agenda entera y solo al final se
 * enteraba de que antes hacía falta el formulario.
 *
 * Se saca aquí porque ahora la enseñan tres sitios —la agenda, el área privada
 * y la propia `/book`— y son la MISMA pantalla. Copiada tres veces, el día que
 * se cambie el texto quedarían dos versiones distintas del mismo aviso.
 *
 * No es un error, así que no se pinta en rojo: es alguien a quien le falta un
 * paso y hay que decirle cuál y por dónde.
 */

export default function PuertaScreen({ aviso, urlFormulario, hrefPortal, brandStyle }) {
  if (!aviso) return null;

  return (
    <div className="min-h-screen bg-[var(--widget-bg)] px-4 py-10" style={brandStyle}>
      <div className="max-w-md mx-auto">
        <div className="rounded-lg border border-[var(--widget-border)] bg-[var(--widget-card)] p-6">
          <p className="text-[11px] tracking-[0.14em] uppercase text-[var(--widget-text-faint)] mb-2">
            Un paso antes
          </p>
          <h1
            className="text-[26px] leading-tight text-[var(--widget-text)] mb-3"
            style={{ fontFamily: "var(--widget-font-display)", fontWeight: 500 }}
          >
            {aviso.titulo}
          </h1>
          <p className="text-[13px] leading-relaxed text-[var(--widget-text-muted)] mb-6">
            {aviso.texto}
          </p>

          {/* `target="_top"`: el widget va dentro de un iframe en la web del
              centro, y sin esto el formulario se abriría DENTRO del recuadro. */}
          {urlFormulario && (
            <a
              href={urlFormulario}
              target="_top"
              rel="noopener"
              className="inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              Ir al formulario
              <span aria-hidden="true">→</span>
            </a>
          )}

          {hrefPortal && (
            <a
              href={hrefPortal}
              target="_top"
              rel="noopener"
              className="inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              Ir a mi área privada
              <span aria-hidden="true">→</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
