import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import {
  INTEGRACIONES,
  NOMBRES_MODULO,
  TIPOS,
  necesitaDestino,
} from "../../../../lib/provisioning/integraciones.js";
import {
  matrizCompleta,
  discrepanciasConCatalogo,
  NIVELES,
} from "../../../../lib/provisioning/dependencias.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * GET /api/admin/integraciones — por dónde se tocan los módulos entre sí.
 *
 * POR QUÉ EXISTE (09/08/2026, a petición de Jorge)
 * El catálogo de venta (`lib/provisioning/catalogo.js`) dice qué módulo NECESITA
 * a otro para existir —clínica necesita pacientes— y eso ya se usaba en el alta.
 * Pero no dice nada de la otra capa, que es la que se nota a diario: que un lead
 * se convierta en ficha de cliente, que una cita quede colgada de esa ficha, que
 * una factura sepa de qué persona del equipo es. Eso no estaba escrito en ningún
 * sitio y solo lo sabía quien había leído ese trozo de código.
 *
 * NO ES UNA LISTA ESTÁTICA, y ahí está la gracia
 * El mapa por sí solo es documentación. Cruzado con lo que cada cliente tiene
 * contratado contesta las preguntas que se hacen de verdad al teléfono:
 *   · «si a Aumenta le apago Pacientes, ¿qué se le rompe?»
 *   · «¿por qué a este cliente no le sale el botón de convertir en ficha?»
 *   · «¿qué gana este si le vendemos Facturación?»
 *
 * A MEDIAS ≠ ROTO
 * Un cliente con el módulo de origen y sin el de destino tiene la integración a
 * medias. A veces es deliberado (Quality Energy tiene leads y no quiere fichas
 * de cliente) y a veces es un olvido. La pantalla lo enseña como un aviso, nunca
 * como un error.
 *
 * Y solo avisa de las que se NOTAN, que se comprobaron una a una: si sin el
 * módulo de destino el botón ni se pinta —que es lo normal, y lo correcto— no
 * sale nada. La primera versión lo deducía del tipo de integración y daba 33
 * avisos de los que la mayoría eran falsos; el detalle está en
 * `lib/provisioning/integraciones.js`.
 *
 * DOS CAPAS DESDE EL 10/08/2026
 * A lo anterior —«por dónde se tocan»— se le añade «qué necesita cada uno»
 * (`lib/provisioning/dependencias.js`), que es la pregunta de ANTES de vender:
 * ¿esto se puede vender solo? Salió de repasar los 22 módulos contra el VPS y
 * encontrar que el alta deja marcar Facturación sola, y que un cliente con
 * Facturación y sin Clientes no puede emitir ni una factura.
 *
 * Aquí esa matriz se cruza dos veces: contra el CATÁLOGO —para avisar de los
 * módulos que el alta permite vender mal— y contra la BD —para avisar de un
 * cliente que ya esté pagando por algo que no puede usar—.
 *
 * Mismos tres candados que el resto del back-office.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

export const GET = withTenant(async (_request, _ctx, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { Tenant, TenantModule } = getMasterModels();

    const [tenants, modulos] = await Promise.all([
      Tenant.findAll({ attributes: ["id", "name", "slug", "status"], order: [["name", "ASC"]] }),
      TenantModule.findAll({ attributes: ["tenantId", "moduleKey", "enabled"] }),
    ]);

    /** slug → Set de moduleKey encendidos. */
    const activos = new Map();
    const nombrePorSlug = new Map();
    for (const t of tenants) {
      activos.set(t.slug, new Set());
      nombrePorSlug.set(t.slug, t.name);
    }
    const slugPorId = new Map(tenants.map((t) => [t.id, t.slug]));
    for (const m of modulos) {
      if (!m.enabled) continue;
      const slug = slugPorId.get(m.tenantId);
      if (slug) activos.get(slug).add(m.moduleKey);
    }

    // Nuestro propio tenant no cuenta: tiene el panel, no es un cliente al que
    // se le venda nada. Colarlo en los recuentos hacía parecer que una
    // integración la usaba un cliente más de los que la usan.
    const clientes = [...activos.keys()].filter((s) => s !== ctx.tenant?.slug);

    const integraciones = INTEGRACIONES.map((i) => {
      const vivas = [];
      const aMedias = [];

      for (const slug of clientes) {
        const tiene = activos.get(slug);
        const conOrigen = tiene.has(i.desde);
        const conDestino = tiene.has(i.hacia);
        if (conOrigen && conDestino) vivas.push(slug);
        else if (conOrigen && necesitaDestino(i)) aMedias.push(slug);
      }

      return { ...i, vivas, aMedias };
    });

    // Primero lo que más clientes están usando: es lo que más se rompe si se
    // toca y lo que antes hay que saber explicar por teléfono.
    integraciones.sort((a, b) => b.vivas.length - a.vivas.length);

    // La misma lista vista por cliente, para el «¿cómo va lo de Aumenta?».
    const porCliente = clientes
      .map((slug) => ({
        slug,
        nombre: nombrePorSlug.get(slug),
        modulos: activos.get(slug).size,
        vivas: integraciones.filter((i) => i.vivas.includes(slug)).length,
        aMedias: integraciones.filter((i) => i.aMedias.includes(slug)).length,
      }))
      .sort((a, b) => b.vivas - a.vivas);

    // ── Qué necesita cada módulo, cruzado con quién lo tiene ────────────────
    //
    // La matriz sola es documentación. Lo que la hace útil es esta pasada: un
    // cliente que tenga un módulo y NO tenga su dependencia obligatoria está
    // pagando por algo que no puede usar, y eso no lo detecta nadie hoy. Se
    // calcula aquí y no en el fichero de datos porque depende de la BD.
    const cumple = (tiene, dep) =>
      dep.cualquiera ? dep.claves.some((k) => tiene.has(k)) : dep.claves.every((k) => tiene.has(k));

    const rotos = [];
    const matriz = matrizCompleta().map((fila) => {
      const loTienen = clientes.filter((s) => activos.get(s).has(fila.modulo));

      const necesita = fila.necesita.map((dep) => {
        const incumplen = loTienen.filter((s) => !cumple(activos.get(s), dep));
        if (dep.nivel === "obligatorio") {
          for (const slug of incumplen) {
            rotos.push({
              slug,
              modulo: fila.modulo,
              faltan: dep.claves.filter((k) => !activos.get(slug).has(k)),
              porque: dep.porque,
            });
          }
        }
        return { ...dep, incumplen };
      });

      return { ...fila, necesita, loTienen };
    });

    return ok({
      integraciones,
      porCliente,
      nombresModulo: NOMBRES_MODULO,
      tipos: TIPOS,
      dependencias: {
        matriz,
        niveles: NIVELES,
        // Módulos que el alta deja marcar solos y que no funcionarían: el
        // catálogo no declara su `requiere`. Se calcula, así que el día que
        // alguien lo arregle el aviso se va solo.
        discrepancias: discrepanciasConCatalogo(),
        rotos,
      },
      totales: {
        integraciones: integraciones.length,
        // Cuántas no las usa NADIE hoy: o son de un módulo que no ha vendido
        // nadie, o están escritas de más. Las dos cosas conviene verlas.
        sinNadie: integraciones.filter((i) => i.vivas.length === 0).length,
        aMedias: integraciones.reduce((n, i) => n + i.aMedias.length, 0),
        seVendenSolos: matriz.filter((m) => m.soloSeVendeSolo).length,
        modulos: matriz.length,
        rotos: rotos.length,
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
