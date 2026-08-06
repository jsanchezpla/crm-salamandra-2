/**
 * El cupo de peticiones del PORTAL de la paciente (06/08/2026, Rodrigo).
 *
 * ── QUÉ PASABA ──────────────────────────────────────────────────────────────
 * Todos los endpoints públicos de un centro compartían el cupo por defecto:
 * **30 peticiones por minuto y por IP**, contando juntos la web pública, la
 * agenda y el área privada. Y abrir «Mi perfil» dispara de golpe siete u ocho
 * llamadas —contrato, citas, documentos, comunicaciones, permiso de imagen,
 * avisos, sus datos—, más las tres de arranque. Dos o tres vueltas por el
 * portal en un minuto y saltaba el 429: a la paciente se le llenaba la pantalla
 * de recuadros rojos («No pudimos cargar tus citas», «No pudimos cargar tus
 * documentos») que no dicen la verdad de lo que ha pasado.
 *
 * Y no hace falta ser un impaciente: una familia entera detrás del mismo router
 * comparte IP, y una madre y su hija mirando sus citas a la vez suman.
 *
 * ── POR QUÉ SE PUEDE SUBIR ──────────────────────────────────────────────────
 * Estas rutas NO son la superficie que el cupo protege. Todas verifican una
 * sesión del portal firmada por el CRM antes de tocar nada, y solo devuelven lo
 * de esa persona. Quien quiera abusar no gana nada repitiéndolas: necesita
 * primero un token válido, y el canje de token tiene su propio cupo, estrecho
 * (10/min). Lo que sí conviene es que compartan UN cupo entre ellas —esta misma
 * clave— para que el conjunto siga teniendo techo.
 *
 * Lo que escribe de verdad conserva cupo propio y más ajustado: firmar el
 * contrato y cancelar una cita.
 */

/** Lecturas del portal (y escrituras livianas): un solo cupo, holgado. */
export const CUPO_PORTAL = { limit: 120, windowMs: 60_000, key: "citas-portal" };

/** Firmar el contrato: escribe, genera PDF y guarda imágenes. */
export const CUPO_PORTAL_FIRMA = { limit: 20, windowMs: 60_000, key: "citas-portal-firma" };

/** Cancelar una cita: escribe y puede mover dinero (reembolsos). */
export const CUPO_PORTAL_CANCELAR = { limit: 20, windowMs: 60_000, key: "citas-portal-cancelar" };
