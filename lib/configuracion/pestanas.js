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
  /*
   * ── «TU CUENTA», Y POR QUÉ ES UNA PESTAÑA APARTE (24/08/2026) ─────────────
   * Las otras seis contestan «cómo funciona la EMPRESA», y por eso están
   * enteras en solo-lectura para quien no es admin, con su aviso arriba. Esta
   * contesta «quién soy YO», y es justo al revés: la única de la pantalla que
   * cualquiera puede tocar, admin o no.
   *
   * Va la última a propósito. Se pensó ponerla la primera —para las 15
   * personas de Aumenta que no son admin sería lo único que pueden usar—, pero
   * eso movería de sitio la pestaña que abren cada día los que sí administran.
   * En su lugar, el aviso de «solo los administradores pueden modificar la
   * configuración» las manda aquí, que es más barato y no despista a nadie.
   */
  { clave: "cuenta", titulo: "Tu cuenta", resumen: "Tu correo y tu contraseña. Lo único de aquí que no es de la empresa" },
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
  /*
   * Los datos del centro que se imprimen en los informes clínicos (28/08/2026):
   * razón social, CIF, teléfonos, sedes con su nº de Registro Sanitario y el
   * párrafo de protección de datos del pie.
   *
   * `requiere: null` —universal— aunque hoy quien los imprime sea el informe de
   * Clínica: es la identidad del centro, la quiere cualquiera que saque un
   * documento con membrete, y la Configuración es universal (regla #14).
   *
   * Va la PRIMERA de la pestaña a propósito: las otras dos de «Empresa» se
   * esconden solas (`seEsconde`) sin `billing` ni `outreach`, así que a un
   * cliente sin esos dos módulos esta pestaña se le abría COMPLETAMENTE VACÍA.
   */
  datosCentro: { pestana: "empresa", requiere: null },
  // `rotulo: false`: su propia sección ya se titula «Facturación», con la misma
  // tipografía que llevaría el rótulo. Serían dos líneas seguidas diciendo lo
  // mismo.
  fiscal: { pestana: "empresa", requiere: ["billing"], seEsconde: true, rotulo: false },
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
  // Las credenciales de GoCardless Bank Account Data, que alimentan el extracto
  // y la conciliación de /facturacion/banco. Quien las LEE es el submódulo
  // `billing_banco` (lib/banco/gocardlessConfig.js → app/api/banco/**), y solo él.
  gocardless: { pestana: "conexiones", requiere: ["billing_banco"] },
  // Las credenciales OAuth de Google Calendar. Quien las LEE es el módulo
  // Calendario (lib/calendar/googleCalendar.js → app/api/calendar/google/**);
  // la función exige además `team` —es quien pone a las personas—, pero el
  // módulo que se compra y el que se anuncia aquí es Calendario.
  googleCalendar: { pestana: "conexiones", requiere: ["calendar"] },

  // ── Agenda ────────────────────────────────────────────────────────────────
  recordatorios: { pestana: "agenda", requiere: ["citas"] },
  agendaCompartida: { pestana: "agenda", requiere: ["citas"] },
  colorBloqueos: { pestana: "agenda", requiere: ["citas"] },
  categoriasBloqueo: { pestana: "agenda", requiere: ["citas"] },
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
  // Los apartados de los informes y de los registros de sesión (29/08/2026).
  // Misma puerta que las derivaciones: quien tiene la clínica los usa.
  plantillasClinica: { pestana: "modulos", requiere: ["clinica", "pacientes"], seEsconde: true },
  // A quién se le abre una incidencia al marcar una falta en la agenda
  // (01/09/2026). Va en «Módulos» y no en «Agenda» por lo que ENCIENDE: una
  // incidencia, que es del módulo asistencial (misma puerta que derivaciones y
  // plantillas; `lib/citas/incidenciaPorFalta.js` pregunta igual). En «Agenda»
  // habría roto además el aviso único de esa pestaña, que entera cuelga de Citas.
  incidenciaPorFalta: { pestana: "modulos", requiere: ["clinica", "pacientes"] },
  // Quién coordina al equipo (02/09/2026, AV-0022): abre la bandeja de
  // cualquiera y los informes vencidos de todo el centro. Misma puerta que la
  // incidencia por falta: es del módulo asistencial.
  coordinadoras: { pestana: "modulos", requiere: ["clinica", "pacientes"] },
  consultasExternas: { pestana: "modulos", requiere: ["clients"] },
  permisosIa: { pestana: "modulos", requiere: null },

  // ── Tu cuenta ─────────────────────────────────────────────────────────────
  // `requiere: null` de verdad: la contraseña la tiene todo el mundo, no
  // depende de ningún módulo contratado y no se atenúa nunca.
  contrasena: { pestana: "cuenta", requiere: null },
  // Y el correo de la cuenta, por lo mismo (26/08/2026). Va aquí y no en Equipo
  // porque las cuentas de ADMINISTRADOR no se gestionan desde allí —ni la de
  // uno mismo—, así que el administrador único de un cliente no tenía ningún
  // sitio donde ponerse el suyo. Ver `app/api/auth/correo/route.js`.
  correoCuenta: { pestana: "cuenta", requiere: null },
});

/**
 * Cómo se llama cada módulo para una persona. Las mismas palabras que el menú
 * (`components/layout/Sidebar.jsx`) y la tabla de CLAUDE.md: un aviso que diga
 * «requiere el módulo analytics» obliga a traducir del inglés a quien lo lee.
 */
export const NOMBRE_MODULO = Object.freeze({
  billing: "Facturación",
  billing_banco: "Banco (de Facturación)",
  calendar: "Calendario",
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

/**
 * De qué módulo es una tarjeta, para rotularla encima.
 *
 * A diferencia del aviso, esto NO depende de lo que tenga contratado el
 * cliente: es qué ES la tarjeta, no si le sirve. Por eso se rotulan también las
 * que se esconden solas — cuando se ven, se ven.
 *
 * ── LAS UNIVERSALES NO SE ROTULAN (23/08/2026) ──────────────────────────────
 * Nació solo para «Módulos», donde conviven Clínica, Clientes y una que vale
 * para todos, y allí las universales decían «Todo el CRM» para que su hueco no
 * pareciera un olvido. Al extenderlo a TODA la pantalla (Rodrigo: «que salga a
 * qué módulo pertenece cada configuración cuando no pertenecen a todo el CRM»)
 * eso deja de hacer falta y estorba: con el rótulo en todas partes, **la
 * ausencia de rótulo YA significa universal**, y repetir «TODO EL CRM» sobre la
 * clave de Anthropic, la de Resend y el remitente es ruido que no distingue
 * nada.
 *
 * `rotulo: false` es la excepción de las tarjetas que ya se presentan solas:
 * poner «FACTURACIÓN» encima de una sección titulada «Facturación» es decir dos
 * veces lo mismo con la misma tipografía.
 */
export function etiquetaDeModulo(clave) {
  const tarjeta = TARJETAS[clave];
  if (!tarjeta || !tarjeta.requiere || tarjeta.rotulo === false) return null;
  return enumerar(tarjeta.requiere.map((m) => NOMBRE_MODULO[m] ?? m));
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
