/**
 * lib/clinica/marcaInforme.js — la paleta del PDF del informe, sacada de la
 * marca del cliente.
 *
 * (Fichero nuevo en /lib, regla #2: es una función pura que comparten el
 * generador del PDF y su prueba, y es justo la pieza que evita que el rediseño
 * de Aumenta llegue con sus morados escritos a mano dentro del generador.)
 *
 * ── POR QUÉ NO SE ESCRIBEN LOS COLORES ─────────────────────────────────────
 * El informe rediseñado (28/08/2026, Rodrigo y Jorge) es un documento de color:
 * portada a sangre con fondo teñido y dos manchas, números de apartado en un
 * tono medio, filetes de acento. Si esos ocho tonos se escriben en el generador,
 * el informe de Aumenta sale morado y el del siguiente centro TAMBIÉN — y el
 * generador es del módulo base, lo usan las cuatro demos y cualquier clínica que
 * venga detrás.
 *
 * Así que se derivan de `tenant.settings.brand`, que es donde ya vive la marca
 * de cada cliente y de donde salen los `--color-primary` de la interfaz. Un
 * centro con marca verde tiene un informe verde sin que nadie toque código: es
 * el peldaño 2 de la escalera (un dato declarado por cliente que el base LEE),
 * no un override.
 *
 * ── LA MARCA PUEDE NO ESTAR, Y ENTONCES NO SE CAE NADA ─────────────────────
 * Medido el 28/08/2026: de los tenants con módulo clínico, las demos por oficio
 * no tienen marca ninguna. Sin `brand` la paleta sale en pizarra neutra, que es
 * un documento sobrio y correcto. Un informe clínico no puede dejar de
 * generarse porque falte un color.
 */

const NEUTRA = { principal: "#334155", oscuro: "#0F172A" };

// Tonos que NO son de la marca: el gris del texto, el filete y el papel. Son
// los mismos en todos los clientes a propósito — un informe se lee, y el
// contraste del cuerpo no se negocia con el color corporativo.
const FIJOS = {
  tinta: "#1F2937",
  suave: "#6B7280",
  filete: "#E5E7EB",
  blanco: "#FFFFFF",
};

/**
 * "#RGB" o "#RRGGBB" → {r,g,b}, o null si no es un color que se entienda.
 *
 * Solo acepta CADENAS a propósito. Con `String(hex)` por delante, el número
 * 123 se leía como el atajo «#123» y entraba como color válido — lo cazó
 * `_smoke-informe-marca.mjs` con un brand que traía un número dentro.
 */
export function leerHex(hex) {
  if (typeof hex !== "string") return null;
  const t = hex.trim().replace(/^#/, "");
  const seis = t.length === 3 ? t.split("").map((c) => c + c).join("") : t;
  if (!/^[0-9a-fA-F]{6}$/.test(seis)) return null;
  return {
    r: parseInt(seis.slice(0, 2), 16),
    g: parseInt(seis.slice(2, 4), 16),
    b: parseInt(seis.slice(4, 6), 16),
  };
}

/**
 * El mismo color en su forma canónica `#RRGGBB` en mayúsculas, o null.
 *
 * Es lo que se guarda en la paleta: lo que llega de la base puede venir en
 * atajo o con espacios, y el generador tiene que poder comparar y pintar sin
 * pensar. Todo lo que sale de `paletaDeInforme` pasa por aquí.
 */
export function normalizarHex(hex) {
  const c = leerHex(hex);
  return c ? aHex(c) : null;
}

const aHex = ({ r, g, b }) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();

/**
 * Mezcla dos colores. `t` es cuánto del SEGUNDO se pone: 0 devuelve el primero,
 * 1 el segundo. Se mezcla en sRGB directamente y no en un espacio perceptual
 * porque aquí solo se hacen tintes muy claros sobre blanco, donde la diferencia
 * no se ve y la cuenta simple se puede leer y probar.
 */
export function mezclar(hexA, hexB, t) {
  const a = leerHex(hexA);
  const b = leerHex(hexB);
  if (!a || !b) return null;
  const k = Math.max(0, Math.min(1, Number(t) || 0));
  return aHex({ r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k });
}

/** El color aclarado hacia el blanco. `p` = 1 es blanco del todo. */
export const aclarar = (hex, p) => mezclar(hex, "#FFFFFF", p);

/**
 * La paleta completa del informe a partir de `settings.brand`.
 *
 * Acepta el objeto `brand` tal cual está en la base (`primaryColor`,
 * `secondaryColor` y un `accentColor` opcional que hoy no usa nadie), y tolera
 * que venga a null, incompleto o con basura dentro: cada color que no se
 * entienda cae al neutro, uno a uno. No lanza nunca.
 */
export function paletaDeInforme(brand) {
  const principal = normalizarHex(brand?.primaryColor) ?? NEUTRA.principal;
  const oscuro = normalizarHex(brand?.secondaryColor) ?? NEUTRA.oscuro;
  // El acento es el filete bajo cada titular y la mancha cálida de la portada.
  // Sin acento propio se usa el principal: el documento sale a un solo color,
  // que es sobrio, en vez de inventarle al cliente un tono que no es suyo.
  const acento = normalizarHex(brand?.accentColor) ?? principal;

  return {
    ...FIJOS,
    oscuro,                                 // titulares grandes y el tipo de informe
    principal,                              // subtítulos y viñetas
    principalMedio: aclarar(principal, 0.34), // la línea de contexto bajo el titular
    acento,                                 // filete corto bajo cada apartado
    tinte: aclarar(principal, 0.9),         // manchas de la portada
    tinteSuave: aclarar(principal, 0.965),  // fondo de la portada, a sangre
    tinteFuerte: aclarar(principal, 0.72),  // el número grande de cada apartado
    calido: aclarar(acento, 0.9),           // la segunda mancha de la portada
  };
}
