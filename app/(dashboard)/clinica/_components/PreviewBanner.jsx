"use client";

/**
 * PreviewBanner — DESACTIVADO (2026-07).
 *
 * Anunciaba que Clínica/Pacientes era "una maqueta con datos ficticios" y que la
 * IA/dictado/incentivos "se implementarían en fases posteriores". Eso ya NO es
 * cierto: el módulo tiene backend real (sesiones, transcripción audio→Whisper +
 * resumen con Claude, informes, coordinaciones y desempeño). El cartel daba
 * impresión de producto sin terminar en la demo y en producción.
 *
 * Se conserva el componente (y sus imports en las páginas) para poder reactivarlo
 * puntualmente si hiciera falta; hoy no renderiza nada.
 */
export default function PreviewBanner() {
  return null;
}
