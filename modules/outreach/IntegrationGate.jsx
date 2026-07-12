"use client";

import Link from "next/link";

// Qué acción desbloquea cada clave y cómo se llama en Configuración → IA.
const KEY_INFO = {
  googlePlaces: { action: "Buscar nuevos (Google Maps)", label: "Google Places" },
  anthropic: { action: "Analizar con IA", label: "Anthropic (Claude)" },
  resend: { action: "Enviar correos", label: "Resend" },
};

/**
 * Aviso de "faltan claves" para Captación. De entre las claves que necesitan las
 * acciones de esta página (`require`), lista las que el tenant NO tiene puestas,
 * con un enlace a Configuración → IA. No renderiza nada mientras no sabemos el
 * estado (`status` null → optimista) ni cuando está todo configurado.
 */
export default function IntegrationGate({ status, require }) {
  if (!status) return null;
  const missing = require.filter((k) => !status[k]);
  if (missing.length === 0) return null;

  return (
    <div className="mb-5 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="text-sm text-amber-800 min-w-0">
        <p className="font-medium">Para usar Captación necesitas configurar tus claves de IA.</p>
        <ul className="mt-1.5 space-y-0.5 text-xs text-amber-700">
          {missing.map((k) => (
            <li key={k}>
              <span className="font-semibold">{KEY_INFO[k].action}</span> — falta la clave de {KEY_INFO[k].label}
            </li>
          ))}
        </ul>
      </div>
      <Link
        href="/configuracion"
        className="shrink-0 self-start sm:self-auto px-3 py-1.5 rounded-md text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 transition-colors whitespace-nowrap"
      >
        Ir a Configuración →
      </Link>
    </div>
  );
}
