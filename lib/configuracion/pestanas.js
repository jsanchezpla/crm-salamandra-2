/**
 * lib/configuracion/pestanas.js — cómo se reparte la pantalla de Configuración
 * y qué módulo hace útil cada tarjeta.
 *
 * (Fichero nuevo en /lib, regla #2. El motivo: quién tiene cada módulo lo sabe
 * el SERVIDOR, y `ConfigModule.jsx` es un "use client" que no puede
 * preguntarlo. Escrito dentro del componente sería un `if` suelto por el JSX;
 * aquí es una regla por módulos, como `piezasFicha.js` decide qué paneles monta
 * la ficha y `vocabulario.js` cómo se llaman las cosas.)
 *
 * ── POR QUÉ HAY PESTAÑAS (23/08/2026) ───────────────────────────────────────
 * La pantalla creció hasta 28 tarjetas en UNA sola columna, y peor: desde la
 * clave de Anthropic hasta las cuatro puertas de la agenda, todo colgaba del
 * mismo bloque titulado «Inteligencia Artificial». La API de Claude y el botón
 * de «reserva online cerrada» acababan pegados sin tener nada que ver, y
 * encontrar algo era bajar con la rueda hasta reconocerlo de vista.
 *
 * El reparto es por PREGUNTA, no por orden de llegada: quién soy (Empresa), con
 * qué me conecto (Conexiones), cómo funciona mi agenda (Agenda), qué puede
 * reservar la gente sola (Reserva online), qué ve luego en su área (Portal) y
 * lo que solo aplica a ciertos módulos (Módulos).
 *
 * ── LO QUE ESTO **NO** CAMBIA ───────────────────────────────────────────────
 * La regla #14 sigue en pie: **la Configuración es universal**. Todas las
 * tarjetas se ven en todos los clientes y todas se pueden rellenar. Lo que
 * gatea el módulo es la FUNCIÓN, no dónde se pegan las credenciales — un
 * cliente puede dejar puesta su clave de Stripe hoy y contratar Citas el mes
 * que viene.
 *
 * Lo único que aporta el mapa de abajo es un AVISO: la tarjeta se atenúa y dice
 * de qué módulo depende, para que nadie rellene una clave esperando que pase
 * algo que no va a pasar. Se sigue pudiendo escribir en ella.
 *
 * ── DE DÓNDE SALE CADA `requiere` ───────────────────────────────────────────
 * De quién LEE esa credencial o ese ajuste, comprobado uno a uno, no de por
 * dónde cae en la pantalla:
 *
 *   · `openai` → solo `app/api/clinica/sessions/transcribe`. Whisper transcribe
 *     audio clínico y nada más; sin Clínica, esa clave no la usa nadie.
 *   · `anthropic` → ocho endpoints de seis módulos distintos (asistente,
 *     calendario, citas, clínica, captación, proyectos). Universal de verdad.
 *   · `stripe` → `citas`, **no `billing`**. Todo lo que cobra pasa por
 *     `hasModule("citas")` (`/book`, `/pagar/[token]`, los `bookings`) y no
 *     reutiliza `Payment` ni genera factura (`docs/modules/pagos.md`). Es el
 *     que más se presta a error, porque «cobrar» suena a Facturación.
 *   · `googlePlaces` → `outreach` (`/outreach/leads/buscar-nuevos`).
 *   · `cloudflare` → `analytics` (`/api/analiticas`).
 *   · `resend` → billing, citas, formularios, nutrición, captación y la reserva
 *     pública. Transversal: sin módulo.
 *   · `whatsapp` → sin módulo a propósito. No es un módulo, es una integración
 *     universal (regla #14), y así se documentó al conectarla.
 *   · la puerta de admisión → `formularios`, no `citas`: exigir el formulario
 *     antes de reservar solo tiene efecto si hay bandeja donde caiga
 *     (`lib/citas/puertaFormulario.js`).
 *   · las derivaciones → `clinica` **o** `pacientes`, que es exactamente lo que
 *     mira su endpoint.
 */

/** Las seis pestañas, en el orden en que se enseñan. */
export const PESTANAS = Object.freeze([
  { clave: "empresa", titulo: "Empresa", resumen: "Quién eres: datos fiscales y a qué te dedicas" },
  { clave: "conexiones", titulo: "Conexiones", resumen: "Las claves de los servicios que usa el CRM" },
  { clave: "agenda", titulo: "Agenda", resumen: "Cómo funciona tu agenda por dentro" },
  { clave: "reservas", titulo: "Reserva online", resumen: "Qué puede reservar la gente por su cuenta" },
  { clave: "portal", titulo: "Portal del cliente", resumen: "Lo que ve cada persona en su área privada" },
  { clave: "modulos", titulo: "Módulos", resumen: "Ajustes que solo aplican a ciertos módulos" },
]);

/** La primera, que es la que se abre si no se pide otra. */
export const PESTANA_POR_DEFECTO = PESTANAS[0].clave;

/** ¿Existe esta pestaña? Filtra lo que llegue por la URL. */
export function esPestanaValida(clave) {
  return PESTANAS.some((p) => p.clave === clave);
}

/**
 * Cada tarjeta: en qué pestaña vive y qué módulo la hace útil.
 *
 * `requiere: null` = universal, no depende de nada. Una lista con varios
 * módulos significa **o** (basta uno), que es como gatea su endpoint.
 *
 * `seEsconde: true` marca las que YA desaparecen solas sin su módulo, porque
 * su endpoint responde 403 y el componente devuelve `null`
 * (`CompanyDescriptionSection`, `DerivacionesCard`). Esas no se anotan: el
 * aviso se quedaría flotando en la pantalla sin tarjeta debajo a la que
 * referirse. Pasó en la primera captura del reparto, el 23/08/2026.
 */
export const TARJETAS = Object.freeze({
  // ── Empresa ───────────────────────────────────────────────────────────────
  fiscal: { pestana: "empresa", requiere: ["billing"], seEsconde: true },
  descripcionEmpresa: { pestana: "empresa", requiere: ["outreach"], seEsconde: true },

  // ── Conexiones ────────────────────────────────────────────────────────────
  anthropic: { pestana: "conexiones", requiere: null },
  openai: { pestana: "conexiones", requiere: ["clinica"] },
  googlePlaces: { pestana: "conexiones", requiere: ["outreach"] },
  resend: { pestana: "conexiones", requiere: null },
  remitente: { pestana: "conexiones", requiere: null },
  cloudflare: { pestana: "conexiones", requiere: ["analytics"] },
  whatsapp: { pestana: "conexiones", requiere: null },
  stripe: { pestana: "conexiones", requiere: ["citas"] },

  // ── Agenda ────────────────────────────────────────────────────────────────
  recordatorios: { pestana: "agenda", requiere: ["citas"] },
  agendaCompartida: { pestana: "agenda", requiere: ["citas"] },
  colorBloqueos: { pestana: "agenda", requiere: ["citas"] },
  videollamada: { pestana: "agenda", requiere: ["citas"] },
  avisosWhatsapp: { pestana: "agenda", requiere: ["citas"] },

  // ── Reserva online ────────────────────────────────────────────────────────
  reservaOnline: { pestana: "reservas", requiere: ["citas"] },
  cancelacion: { pestana: "reservas", requiere: ["citas"] },
  puertaAdmision: { pestana: "reservas", requiere: ["formularios"] },
  puertaContrato: { pestana: "reservas", requiere: ["citas"] },
  puertaIdentidad: { pestana: "reservas", requiere: ["citas"] },
  puertaCaja: { pestana: "reservas", requiere: ["citas"] },
  paginaReservas: { pestana: "reservas", requiere: ["citas"] },

  // ── Portal del cliente ────────────────────────────────────────────────────
  areaPrivada: { pestana: "portal", requiere: ["citas"] },
  bloqueoImpago: { pestana: "portal", requiere: ["citas"] },

  // ── Módulos ───────────────────────────────────────────────────────────────
  derivaciones: { pestana: "modulos", requiere: ["clinica", "pacientes"], seEsconde: true },
  consultasExternas: { pestana: "modulos", requiere: ["clients"] },
  permisosIa: { pestana: "modulos", requiere: null },
});

/**
 * Cómo se llama cada módulo para una persona. Las mismas palabras que el menú
 * (`components/layout/Sidebar.jsx`) y la tabla de CLAUDE.md: un aviso que diga
 * «requiere el módulo analytics» obliga a traducir del inglés a quien lo lee.
 */
export const NOMBRE_MODULO = Object.freeze({
  billing: "Facturación",
  outreach: "Captación",
  clinica: "Clínica",
  pacientes: "Pacientes",
  analytics: "Analíticas",
  citas: "Citas",
  formularios: "Comerciales (formularios)",
  clients: "Clientes",
});

/** «Citas», «Clínica o Pacientes» — la lista tal y como se lee en voz alta. */
function enumerar(nombres) {
  if (nombres.length <= 1) return nombres[0] ?? "";
  return `${nombres.slice(0, -1).join(", ")} o ${nombres[nombres.length - 1]}`;
}

/**
 * El aviso de una tarjeta, o `null` si no hace falta ninguno.
 *
 * `tieneModulo` es `hasModule` del contexto de servidor o un `Set.has`. Sin
 * saber los módulos (la consulta falló, por ejemplo) NO se avisa: un aviso
 * falso —«requiere Citas» a quien tiene Citas— es peor que ninguno, porque
 * manda a la persona a pedir algo que ya tiene.
 */
export function avisoDeTarjeta(clave, tieneModulo) {
  const tarjeta = TARJETAS[clave];
  if (!tarjeta || !tarjeta.requiere || typeof tieneModulo !== "function") return null;
  // Las que ya desaparecen solas no se anotan: sin tarjeta debajo, el aviso se
  // queda flotando en medio de la pantalla hablando de algo que no está.
  if (tarjeta.seEsconde) return null;
  if (tarjeta.requiere.some((m) => tieneModulo(m))) return null;

  const nombres = tarjeta.requiere.map((m) => NOMBRE_MODULO[m] ?? m);
  return `Necesita el módulo ${enumerar(nombres)}. Puedes dejarlo puesto igual: se aplicará en cuanto lo tengas.`;
}

/** Las claves de las tarjetas de una pestaña, en el orden en que se declaran. */
export function tarjetasDe(clave) {
  return Object.entries(TARJETAS)
    .filter(([, t]) => t.pestana === clave)
    .map(([k]) => k);
}

/**
 * El aviso de una PESTAÑA entera, cuando todas sus tarjetas piden lo mismo.
 *
 * «Agenda» son cinco tarjetas y las cinco dependen de Citas: a quien no tenga
 * Citas le saldría cinco veces la misma frase, que es ruido y encima esconde el
 * caso interesante —una tarjeta suelta que pide algo distinto—. Cuando la
 * pestaña entera cuelga de un módulo se dice UNA vez arriba; si dentro hay
 * mezcla, devuelve `null` y cada tarjeta se explica sola.
 */
export function avisoDePestana(clave, tieneModulo) {
  const avisos = tarjetasDe(clave).map((c) => avisoDeTarjeta(c, tieneModulo));
  if (!avisos.length || avisos.some((a) => !a)) return null;
  return avisos.every((a) => a === avisos[0]) ? avisos[0] : null;
}
