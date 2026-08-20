/**
 * lib/buzon/quienEscribe.js — la foto de quién nos está escribiendo.
 *
 * (Fichero en /lib, regla #2: lo usan los DOS endpoints del lado del cliente
 * que escriben —`POST /api/ayuda`, que abre el aviso, y
 * `POST /api/ayuda/[id]/mensajes`, que sigue el hilo—. Los que solo leen
 * (`GET /api/ayuda`, `GET /api/ayuda/[id]`, `GET /api/ayuda/adjuntos/[adjuntoId]`)
 * no necesitan esta foto. Está aparte porque la parte importante —de dónde sale
 * el correo— es justo la que se hace mal si cada uno lo resuelve por su cuenta.)
 *
 * ── DE DÓNDE SALE EL CORREO, QUE NO ES DE DONDE PARECE ──────────────────────
 * `ctx.user` NO tiene email: `loadUserAccess` (`lib/tenant/tenantResolver.js`)
 * hace `attributes: ["id", "role", "moduleAccess"]` y nada más. Escribir
 * `ctx.user.email` compila, no da error y guarda `null` para siempre. La fuente
 * buena es la cabecera `x-user-email` que inyecta el middleware, y si el token
 * no la trae, `master.users`.
 *
 * Aquí eso importa más que en otros sitios: el correo es lo ÚNICO que nos
 * permite contestarle a alguien cuyo cliente ya no exista, que es precisamente
 * el caso para el que se diseñó el buzón.
 *
 * El nombre es un extra: sale de su ficha de equipo si la tiene. Que un tenant
 * no tenga tabla de equipo, o que esa persona no esté dada de alta en ella, no
 * puede impedir que nos avise.
 */

import { getMasterModels } from "../db/masterDb.js";

export async function quienEscribe(request, ctx) {
  const id = request.headers.get("x-user-id") || null;

  let email = request.headers.get("x-user-email") || null;
  if (!email && id) {
    try {
      const { User } = getMasterModels();
      const u = await User.findByPk(id, { attributes: ["email"] });
      email = u?.email ?? null;
    } catch {
      /* sin correo se puede guardar el aviso; sin aviso, no */
    }
  }

  let nombre = null;
  try {
    const { TeamMember } = ctx.tenantModels ?? {};
    if (TeamMember && id) {
      const tm = await TeamMember.findOne({ where: { userId: id }, attributes: ["displayName"] });
      nombre = tm?.displayName ?? null;
    }
  } catch {
    /* un tenant sin ficha de equipo también tiene derecho a avisarnos */
  }

  return { id, email, nombre, rol: ctx.user?.role ?? null };
}
