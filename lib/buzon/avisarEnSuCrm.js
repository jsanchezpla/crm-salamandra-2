/**
 * lib/buzon/avisarEnSuCrm.js — la campana del cliente cuando le contestamos.
 *
 * (Fichero nuevo en /lib, regla #2.)
 *
 * ── ESTE ES EL ÚNICO SITIO DEL BACK-OFFICE QUE ABRE EL SCHEMA DE UN CLIENTE ──
 * Y hay que dejarlo así. Hasta el 13/08/2026, NINGÚN endpoint de `/api/admin`
 * tocaba el schema de nadie: el panel vive de `master` y ese aislamiento es
 * media razón de que exista la separación por host. Se hace la excepción porque
 * la campana es donde la gente mira, y una respuesta que solo está en `/ayuda`
 * se queda sin leer.
 *
 * Si mañana hace falta escribir otra cosa en el CRM de un cliente desde el
 * panel, que pase por aquí. Dos sitios haciendo esto es como se pierde de vista.
 *
 * ── LAS TRES CONDICIONES, QUE NO SON NEGOCIABLES ────────────────────────────
 *
 * 1. SE COMPRUEBA EL CLIENTE EN `master.tenants` ANTES DE TOCAR NADA, y con
 *    `status: 'active'`. Con un cliente dado de baja el schema ya no se llama
 *    igual (`borrar-tenant.js` lo renombra) y el INSERT reventaría con un
 *    `3F000`; con uno SUSPENDIDO es peor, porque el schema sigue ahí y el
 *    INSERT funciona: escribiríamos una campana que nadie va a poder leer
 *    jamás, porque `loadTenantConfig` no le deja entrar.
 *
 * 2. BEST-EFFORT SIEMPRE. Esto no puede tumbar la respuesta. Lo importante es
 *    que quede escrita en el buzón; la campana es un extra, y el cliente tiene
 *    además el correo y su pantalla de Ayuda.
 *
 * 3. SOLO SE AVISA A QUIEN ESCRIBIÓ. Solo esa persona ve el aviso en `/ayuda`
 *    (el filtro es por `usuario_id`), así que avisar a otro sería mandarle a una
 *    pantalla donde no hay nada.
 */

import { getMasterModels } from "../db/masterDb.js";
import { getTenantDb } from "../db/tenantDb.js";
import { notifyUsers } from "../notifications/notifyUsers.js";
import { referencia } from "./buzon.js";

export async function avisarEnSuCrm({ aviso }) {
  try {
    if (!aviso?.tenantId || !aviso?.usuarioId) {
      return { ok: false, motivo: "sin destinatario" };
    }

    const { Tenant } = getMasterModels();
    const tenant = await Tenant.findOne({
      where: { id: aviso.tenantId, status: "active" },
      attributes: ["id", "slug"],
    });
    if (!tenant) {
      // Ni error ni ruido: un cliente de baja o suspendido no tiene campana que
      // tocar, y su aviso sigue guardado y contestado en el buzón.
      return { ok: false, motivo: "cliente no activo" };
    }

    const { models } = getTenantDb(tenant.slug);
    await notifyUsers({
      tenantModels: models,
      userIds: [aviso.usuarioId],
      type: "buzon_respuesta",
      title: "Salamandra te ha contestado",
      // El asunto y no el texto de la respuesta: la campana es un aviso, no el
      // sitio donde se lee la conversación.
      body: `${referencia(aviso.numero)} · ${aviso.asunto}`,
      entityType: "BuzonAviso",
      entityId: aviso.id,
    });

    return { ok: true };
  } catch (err) {
    process.stderr.write(`[buzon:campana] no se pudo avisar en su CRM: ${err.message}\n`);
    return { ok: false, motivo: err.message };
  }
}
