import { NextResponse } from "next/server";
import { getTenantContext } from "../../../../lib/tenant/tenantResolver.js";
import { aceptaEtapa } from "../../../../lib/leads/embudos.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

export async function POST(request) {
  try {
    const context = await getTenantContext(request);
    if (!context) {
      return NextResponse.json({ ok: false, error: "Tenant no encontrado" }, { status: 401 });
    }

    const role = request.headers.get("x-user-role");
    if (!ADMIN_ROLES.has(role)) {
      return NextResponse.json(
        { ok: false, error: "Solo administradores pueden importar leads" },
        { status: 403 }
      );
    }

    const { tenantModels, hasModule } = context;

    if (!hasModule("leads")) {
      return NextResponse.json({ ok: false, error: "Módulo no habilitado" }, { status: 403 });
    }

    const { leads: rows } = await request.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "No hay filas para importar" }, { status: 400 });
    }

    if (rows.length > 1000) {
      return NextResponse.json(
        { ok: false, error: "Máximo 1000 leads por importación" },
        { status: 400 }
      );
    }

    const { Lead } = tenantModels;

    // `etapasCorregidas`: cuántas filas traían una etapa que este embudo no
    // ofrece y han entrado en «Nuevo». Se CUENTA en vez de callarlo: un import
    // que cambia etapas sin decirlo deja a quien lo lanzó creyendo otra cosa.
    const results = { imported: 0, skipped: 0, etapasCorregidas: 0, errors: [] };
    /**
     * La etapa que le toca a esta fila.
     *
     * Se pregunta al EMBUDO DE ESTE CLIENTE y no a la lista canónica: aquella
     * dice qué etapas existen en el CRM (veinte), no cuáles ofrece este embudo.
     * Con la general, un Excel podía dejar interesados en una etapa que su
     * pantalla no tiene: chip de color, sin fila donde ponerse, y los contadores
     * de la cabecera sin sumar el total.
     *
     * Lo que NO se hace es rechazar la fila entera: un import es masivo y tirar
     * a alguien por una columna de estado sería peor. Entra en «Nuevo» —que está
     * en todos los embudos— y se CUENTA, para que la respuesta lo diga en vez de
     * dejar a quien lo lanzó creyendo que respetó su Excel.
     */
    const etapaDeLaFila = (etapa) => {
      if (etapa == null || etapa === "") return "new";
      if (aceptaEtapa(context.slug, etapa, hasModule)) return etapa;
      results.etapasCorregidas += 1;
      return "new";
    };


    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        const cf = row.customFields || {};

        const payload = {
          name: row.name?.toString().trim() || null,
          email: row.email?.toString().trim().toLowerCase() || null,
          phone: row.phone?.toString().trim() || null,
          notes: row.notes?.toString().trim() || null,
          source: row.source?.toString().trim() || "csv_import",
          stage: etapaDeLaFila(row.stage),
          customFields: {},
        };

        const _v = (top, nested) => (top || nested || "").toString().trim() || null;
        const empresa = _v(row.empresa, cf.empresa);
        const experience = _v(row.experience, cf.experience || cf.experiencia);
        const zone = _v(row.zone, cf.zone);
        const cargo = _v(row.cargo, cf.cargo);
        const empresa_actual = _v(row.empresa_actual, cf.empresa_actual);
        const zona = _v(row.zona, cf.zona);
        const linkedin = _v(row.linkedin, cf.linkedin);
        const pais = _v(row.pais, cf.pais);
        const ciudad = _v(row.ciudad, cf.ciudad);
        const asunto = _v(row.asunto, cf.asunto);
        const instagram_user = _v(row.instagram_user, cf.instagram_user);
        const respuesta = _v(row.respuesta, cf.respuesta);
        const demo_agendada = _v(row.demo_agendada, cf.demo_agendada);
        const fecha_demo = _v(row.fecha_demo, cf.fecha_demo);
        const prioridad = _v(row.prioridad, cf.prioridad);

        if (empresa) payload.customFields.empresa = empresa;
        if (experience) payload.customFields.experience = experience;
        if (zone) payload.customFields.zone = zone;
        if (cargo) payload.customFields.cargo = cargo;
        if (empresa_actual) payload.customFields.empresa_actual = empresa_actual;
        if (zona) payload.customFields.zona = zona;
        if (linkedin) payload.customFields.linkedin = linkedin;
        if (pais) payload.customFields.pais = pais;
        if (ciudad) payload.customFields.ciudad = ciudad;
        if (asunto) payload.customFields.asunto = asunto;
        if (instagram_user) payload.customFields.instagram_user = instagram_user;
        if (respuesta) payload.customFields.respuesta = respuesta;
        if (demo_agendada) payload.customFields.demo_agendada = demo_agendada;
        if (fecha_demo) payload.customFields.fecha_demo = fecha_demo;
        if (prioridad) payload.customFields.prioridad = prioridad.toLowerCase();

        if (!payload.name && !payload.email && !payload.phone) {
          results.skipped++;
          continue;
        }

        await Lead.create(payload);
        results.imported++;
      } catch {
        results.errors.push({ row: i + 2, message: "Error al crear el lead" });
      }
    }

    return NextResponse.json({ ok: true, data: results }, { status: 201 });
  } catch (err) {
    console.error("[leads/import] Error:", err);
    return NextResponse.json({ ok: false, error: "Error interno del servidor" }, { status: 500 });
  }
}
