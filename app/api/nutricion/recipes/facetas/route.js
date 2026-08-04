import { NextResponse } from "next/server";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { TIPOS_RECETA, ALERGENOS, PREFERENCIAS } from "../../../../../lib/nutricion/recipes.js";

/**
 * GET /api/nutricion/recipes/facetas — con qué se puede filtrar el recetario.
 *
 * Devuelve solo los valores que EXISTEN, con cuántas recetas tiene cada uno.
 * Va en su propio endpoint y no dentro del listado porque la pantalla lo carga
 * una vez, mientras que el listado se repite con cada tecla del buscador.
 *
 * Ofrecer la lista fija de los 14 alérgenos legales llenaría el desplegable de
 * opciones que no filtran nada: de los 14, en el recetario de Laura aparecen
 * 10. Y las etiquetas son suyas —110 distintas—, así que no hay lista fija que
 * valga.
 */
export const GET = withTenant(async (_request, _ctx, { tenant, tenantSequelize, hasModule }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const esquema = `crm_${tenant.slug}`;

    // Un solo viaje: las tres columnas son arrays y se desgranan igual.
    const [filas] = await tenantSequelize.query(`
      SELECT 'tag' AS clase, x AS valor, count(*)::int AS n
        FROM ${esquema}.recipes r, unnest(r.tags) x
       WHERE r.is_archived = false GROUP BY 1,2
      UNION ALL
      SELECT 'alergeno', x, count(*)::int
        FROM ${esquema}.recipes r, unnest(r.allergens) x
       WHERE r.is_archived = false GROUP BY 1,2
      UNION ALL
      SELECT 'preferencia', x, count(*)::int
        FROM ${esquema}.recipes r, unnest(r.dietary_preferences) x
       WHERE r.is_archived = false GROUP BY 1,2
      UNION ALL
      SELECT 'tipo', r.recipe_type, count(*)::int
        FROM ${esquema}.recipes r
       WHERE r.is_archived = false AND r.recipe_type IS NOT NULL GROUP BY 1,2
      ORDER BY 3 DESC
    `);

    const de = (clase, dicc) => filas
      .filter((f) => f.clase === clase)
      .map((f) => ({ clave: f.valor, etiqueta: dicc?.[f.valor] ?? f.valor, n: f.n }));

    return NextResponse.json({
      ok: true,
      tipos: de("tipo", TIPOS_RECETA),
      alergenos: de("alergeno", ALERGENOS),
      preferencias: de("preferencia", PREFERENCIAS),
      etiquetas: de("tag", null),
    });
  } catch (err) {
    return serverError(err);
  }
});
