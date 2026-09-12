/**
 * Clases compartidas de la interfaz del calendario global (12/09/2026).
 *
 * Rodrigo dijo de la pantalla de antes que «la UI es un poco fea, está mal
 * hecha, menos la parte del calendario puro». Parte de lo feo era que cada
 * botón llevaba su propio verde, su propio gris y su propio tamaño, escritos a
 * mano en el JSX. Aquí se fijan UNA vez, con la marca de Salamandra, y las dos
 * pestañas (Calendario y Proyectos) los importan: así no pueden separarse.
 *
 * Marca: verde profundo #1F3B34, verde medio #3E5C57, dorado #D9B93E (solo
 * como acento: la pestaña activa), fondo hueso #F7F7F4. Bordes finos #E7E7E1.
 *
 * Son cadenas LITERALES a propósito: Tailwind 4 descubre las clases leyendo
 * los ficheros, y una clase montada a trozos (`bg-[${color}]`) no la vería.
 */

/** Anillo de foco visible, el mismo en todos los controles claros. */
export const FOCO =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3E5C57]";

/** Acción principal de un panel: una por bloque, como mucho. */
export const BOTON_PRIMARIO =
  "inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md bg-[#1F3B34] text-white text-[13px] font-medium whitespace-nowrap hover:bg-[#2B4B43] disabled:opacity-50 disabled:cursor-not-allowed " +
  FOCO;

/** Acción secundaria: con borde, fondo blanco. */
export const BOTON_SECUNDARIO =
  "inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md border border-[#DADAD3] bg-white text-[#1C2B27] text-[13px] whitespace-nowrap hover:bg-[#F2F2EE] disabled:opacity-50 disabled:cursor-not-allowed " +
  FOCO;

/** Acción discreta: sin borde, se ve al pasar el ratón. */
export const BOTON_FANTASMA =
  "inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-md text-[#5C6461] text-[13px] whitespace-nowrap hover:bg-[#F2F2EE] hover:text-[#1C2B27] disabled:opacity-50 disabled:cursor-not-allowed " +
  FOCO;

/**
 * Tonos de los chips de estado. Pocos y apagados: un chip informa, no grita.
 * `apagado` es para lo cancelado (se lee, pero no pide atención).
 */
export const TONOS = {
  neutral: "border-[#E7E7E1] bg-[#F7F7F4] text-[#4F5754]",
  verde: "border-[#CFDDD6] bg-[#EEF4F1] text-[#2F5A4B]",
  ambar: "border-[#EBDDB0] bg-[#FBF6E6] text-[#7A5E12]",
  rojo: "border-[#F0D5D2] bg-[#FBEFEE] text-[#8A2A24]",
  apagado: "border-[#EDEDE8] bg-white text-[#8A918E]",
};
