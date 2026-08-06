"use client";

/**
 * BienvenidaGate — «¿a qué entras?», lo PRIMERO del área privada
 * (04/08/2026, Rodrigo).
 *
 * ── POR QUÉ VA DELANTE DE LOS CONTRATOS ─────────────────────────────────────
 * Hasta hoy, quien entraba se encontraba de golpe el contrato del centro
 * tapando la pantalla. A alguien que solo quiere una PRIMERA VISITA para
 * conocer a la nutricionista, pedirle que firme el acuerdo de servicio antes
 * de haber hablado con nadie lo espanta en la puerta: todavía no ha decidido
 * si empieza.
 *
 * Así que se pregunta antes:
 *   · «Vengo a una valoración inicial» → a reservarla, SIN firmar nada.
 *   · «Entro a mi perfil»              → el camino de siempre, con contratos.
 *
 * ── CUÁNDO NO SE PREGUNTA ───────────────────────────────────────────────────
 * Esta pantalla NO sale si:
 *   · el centro no ha marcado ningún tipo de cita como valoración inicial
 *     (Citas → Tipos de cita), o
 *   · esta persona YA tiene su valoración cogida —próxima o pasada—. Quien ya
 *     la reservó no vuelve a la casilla de salida cada vez que entra: pasa
 *     directo a su perfil.
 *
 * Es una bifurcación, no un muro: la valoración no exige contrato, pero el
 * perfil sigue exigiéndolo igual que antes.
 */

/*
 * ── POR QUÉ ARRIBA Y NO CENTRADO (06/08/2026, Rodrigo: «parece que lleve una
 * cabecera invisible») ──────────────────────────────────────────────────────
 * Estas pantallas viven dentro de un iframe de 820 px de alto incrustado en la
 * web. Centrarlas verticalmente las centra en ESOS 820 px, no en la pantalla:
 * como el iframe empieza por debajo de la cabecera del sitio y termina por
 * debajo del borde inferior, la tarjeta salía hundida y cortada, con un vacío
 * enorme encima que parecía una cabecera en blanco.
 *
 * Arriba y con aire (`items-start` + padding) se ve entera y sin scroll en
 * cualquier alto de pantalla. Es lo que ya hacían la pantalla de la puerta y la
 * del contrato; ahora lo hacen todas igual.
 */
const headingStyle = { fontFamily: "var(--widget-font-display)", fontWeight: 500 };

export default function BienvenidaGate({ profesional, valoracion, hrefValoracion, onEntrarPerfil }) {
  const nombre = profesional || "el centro";

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[var(--widget-bg)]">
      <div className="min-h-full flex items-start justify-center px-4 py-8 sm:py-10">
        <div className="w-full max-w-lg bg-[var(--widget-card)] rounded-2xl border border-[var(--widget-border)] p-6 lg:p-8 shadow-sm">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--widget-text-faint)] mb-2">
            Hola
          </div>
          <h1
            className="text-[24px] lg:text-[28px] leading-tight text-[var(--widget-text)] tracking-tight mb-3"
            style={headingStyle}
          >
            ¿A qué entras hoy?
          </h1>
          <p className="text-[14px] text-[var(--widget-text-muted)] leading-relaxed mb-6">
            Si es tu primera vez con {nombre}, empieza por la valoración inicial: es una consulta
            para conocerte y no hay que firmar nada todavía.
          </p>

          <div className="space-y-3">
            <a
              href={hrefValoracion}
              className="block w-full text-left px-5 py-4 rounded-xl text-white transition bg-[var(--brand-primary,var(--widget-button))] hover:bg-[var(--widget-button-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              <span className="block text-[15px] font-semibold">
                Vengo a una {(valoracion?.name || "valoración inicial").toLowerCase()}
              </span>
              <span className="block text-[12.5px] opacity-80 mt-0.5">
                Reservas tu primera consulta ahora. Sin contratos ni papeleo.
              </span>
            </a>

            <button
              type="button"
              onClick={onEntrarPerfil}
              className="block w-full text-left px-5 py-4 rounded-xl border border-[var(--widget-border)] text-[var(--widget-text)] transition hover:bg-[var(--widget-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--widget-focus)]"
            >
              <span className="block text-[15px] font-semibold">Entro a mi perfil</span>
              <span className="block text-[12.5px] text-[var(--widget-text-faint)] mt-0.5">
                Tus citas, tus documentos y tus datos.
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
