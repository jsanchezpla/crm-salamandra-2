import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { getMasterModels } from "../../../../lib/db/masterDb.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { whereClientesVisibles } from "../../../../lib/provisioning/clientesVisibles.js";
import { CATALOGO, CLAVES_VALIDAS, moduloPorClave } from "../../../../lib/provisioning/catalogo.js";
import { textoNecesita, seVendeSolo } from "../../../../lib/provisioning/dependencias.js";
import { FICHAS, FUERA_DEL_CATALOGO } from "../../../../lib/provisioning/queHaceCadaModulo.js";

const ADMIN_ROLES = new Set(["admin", "superadmin"]);

/**
 * GET /api/admin/modulos — qué tiene contratado cada cliente y qué lleva a medida.
 *
 * POR QUÉ EXISTE (08/08/2026)
 * Esto no se podía saber sin abrir la base de datos. La pregunta «¿cuántos
 * módulos tiene Aumenta?» tenía tres respuestas distintas —CLAUDE.md decía 13,
 * el entorno local 12 y los documentos del sprint ~17— y ninguna era la buena:
 * eran 20. Es la base de lo que se le factura a un cliente y de cualquier
 * conversación con él, así que tiene que poder mirarse sin consultar a mano.
 *
 * QUÉ CUENTA COMO «A MEDIDA», y por qué se distinguen cuatro cosas
 * No es lo mismo que un cliente tenga una PANTALLA propia (que hay que mantener
 * aparte cada vez que se toca la base) que un ajuste de comportamiento o un
 * campo extra. Se separan porque el coste de cada una es muy distinto, y desde
 * el 18/08/2026 son los peldaños de la escalera de la regla #16 (CLAUDE.md):
 *   · pantalla     — peldaño 5: un fichero en modules/overrides/, se queda
 *                    atrás solo cada vez que se toca la base
 *   · lógica       — peldaño 4: un parámetro (logicOverrides), el módulo se
 *                    comporta distinto para ese cliente
 *   · interruptor  — peldaño 3: un «esto sí / esto no» (featureFlags), p. ej.
 *                    «formación abierta» en Aumenta
 *   · campos       — datos extra en su schema (schemaExtensions)
 * Los peldaños 1 y 2 (palabras y datos por cliente que viven en el CÓDIGO:
 * «Interesados», los embudos de Leads, las columnas del Excel) NO salen aquí:
 * la imagen de producción no lleva el código, y una lista copiada a mano
 * mentiría en una semana. Se ven en el repo (regla #16 dice dónde).
 *
 * NO devuelve el CONTENIDO de esas personalizaciones, solo si las hay: dentro
 * puede haber configuración sensible del cliente, y para saber a quién hay que
 * mantener basta con saber que existe.
 *
 * DESDE EL 18/09/2026 DEVUELVE TAMBIÉN EL CATÁLOGO, con la ficha interna de
 * cada módulo (`lib/provisioning/queHaceCadaModulo.js`) y quién lo tiene
 * encendido. Las claves crudas de la tabla no dicen qué es `productos_avanzado`
 * a nadie que no lleve el CLAUDE.md en la cabeza.
 *
 * Mismos tres candados que el resto del back-office: módulo `provisioning` (que
 * solo tiene nuestro tenant), rol admin leído fresco de la base, y nunca desde
 * la demo.
 */
function candado(ctx) {
  if (!ctx.hasModule("provisioning")) return forbidden("Este panel es solo para Salamandra Solutions");
  if (!ADMIN_ROLES.has(ctx.user?.role)) return forbidden("Solo admin");
  if (isDemoTenant(ctx)) return forbidden("No disponible en la demo");
  return null;
}

/** ¿Tiene algo dentro este JSONB? `{}` y null cuentan como vacío. */
function tieneAlgo(valor) {
  if (!valor) return false;
  if (typeof valor === "object") return Object.keys(valor).length > 0;
  const s = String(valor);
  return s !== "{}" && s !== "null" && s !== "";
}

export const GET = withTenant(async (_request, _ctx, ctx) => {
  try {
    const veto = candado(ctx);
    if (veto) return veto;

    const { Tenant, TenantModule } = getMasterModels();

    const [tenants, modulos] = await Promise.all([
      Tenant.findAll({
        // Solo los clientes en marcha: un suspendido no tiene módulos que
        // gestionar hoy y aquí solo ensuciaba la matriz. Se reactiva desde
        // /admin/clientes, que sí los sabe pedir.
        //
        // LAS DEMOS SÍ SALEN, y es la excepción entre las pantallas que miran
        // (13/08/2026). En Custodia e Integraciones estorban —no pueden tener
        // credenciales, e inflan «esta integración la usan N clientes» porque
        // tienen medio catálogo encendido—, pero ESTA es la matriz de quién
        // tiene qué, y es donde CLAUDE.md manda mirar cuando hay dudas. Fue
        // aquí donde se vio que la demo tenía `support` en producción y no
        // «solo en local», como decía la tabla escrita a mano. Esconderlas
        // sería quitar justo la información por la que se abre la pantalla.
        where: whereClientesVisibles(false, { incluirDemos: true }),
        attributes: ["id", "name", "slug", "plan", "status"],
        order: [["name", "ASC"]],
      }),
      TenantModule.findAll({
        attributes: [
          "tenantId", "moduleKey", "enabled",
          "uiOverride", "logicOverrides", "featureFlags", "schemaExtensions",
        ],
      }),
    ]);

    const porTenant = new Map();
    for (const m of modulos) {
      if (!porTenant.has(m.tenantId)) porTenant.set(m.tenantId, []);
      porTenant.get(m.tenantId).push(m);
    }

    const clientes = tenants.map((t) => {
      const suyos = porTenant.get(t.id) ?? [];
      const activos = suyos.filter((m) => m.enabled);

      // Solo se listan las personalizaciones de módulos ENCENDIDOS: una pantalla
      // propia de un módulo apagado no la ve nadie y solo hace ruido.
      const aMedida = activos
        .map((m) => ({
          modulo: m.moduleKey,
          pantalla: m.uiOverride ?? null,
          logica: tieneAlgo(m.logicOverrides),
          pruebas: tieneAlgo(m.featureFlags),
          campos: tieneAlgo(m.schemaExtensions),
        }))
        .filter((m) => m.pantalla || m.logica || m.pruebas || m.campos);

      return {
        nombre: t.name,
        slug: t.slug,
        plan: t.plan,
        estado: t.status,
        modulos: activos.map((m) => m.moduleKey).sort(),
        apagados: suyos.filter((m) => !m.enabled).map((m) => m.moduleKey).sort(),
        aMedida,
      };
    });

    // El más grande arriba: es el que más cuesta mantener y del que más se
    // habla. Ordenar por nombre dejaba a los de un módulo mezclados con los de
    // veinte, que es justo lo que esta pantalla viene a distinguir.
    clientes.sort((a, b) => b.modulos.length - a.modulos.length);

    // Dos números para las pantallas propias, porque responden a preguntas
    // distintas (18/08/2026): CUÁNTAS hay que mantener (ficheros: 5 el día que
    // se escribió esto) y a CUÁNTOS clientes afectan (4). Contar solo clientes
    // escondía que Laura tiene dos.
    const pantallasPropias = clientes.reduce((n, c) => n + c.aMedida.filter((m) => m.pantalla).length, 0);

    // ── QUÉ HACE CADA MÓDULO (18/09/2026, Jorge) ─────────────────────────
    // La pantalla enseñaba las claves crudas y no había forma de saber qué era
    // `productos_avanzado` sin abrir docs/. El texto vive en
    // `lib/provisioning/queHaceCadaModulo.js`; aquí se le pega quién lo tiene.
    //
    // Se arma AQUÍ y no en el navegador por dos razones: `activoEn` se calcula
    // con los clientes que esta ruta ya tiene cargados, y `dependencias.js` son
    // 43 KB de matriz con rutas de código que no pintan nada en el bundle.
    // Solo los ENCENDIDOS entran en el índice: la pregunta es «¿quién lo usa?».
    const activoEn = new Map();
    for (const c of clientes) {
      for (const clave of c.modulos) {
        if (!activoEn.has(clave)) activoEn.set(clave, []);
        activoEn.get(clave).push(c.slug);
      }
    }

    const nombreDe = (k) => moduloPorClave(k)?.nombre ?? k;
    const catalogo = {
      grupos: CATALOGO.map((g) => ({
        grupo: g.grupo,
        modulos: g.modulos.map((m) => {
          const ficha = FICHAS[m.key] ?? {};
          const necesita = textoNecesita(m.key, nombreDe);
          return {
            clave: m.key,
            nombre: m.nombre,
            desc: m.desc, // lo que se le dice al CLIENTE; la ficha es lo de dentro
            hace: ficha.hace ?? null,
            trae: ficha.trae ?? [],
            ojo: ficha.ojo ?? [],
            doc: ficha.doc ?? null,
            necesita: necesita && necesita !== "—" ? necesita : null,
            // `textoNecesita` mezcla obligatorias y parciales, y leído a secas
            // «Citas necesita Pacientes» es falso: se apoya en él. La pantalla
            // rotula una cosa u otra según esto.
            necesitaEsObligatorio: !seVendeSolo(m.key),
            activoEn: activoEn.get(m.key) ?? [],
          };
        }),
      })),
      // Claves vivas en tenant_modules que no se venden. Sin esto salen como
      // «desconocidas» y parece un fallo cada vez (`provisioning` es la nuestra).
      sinFicha: [...activoEn.keys()]
        .filter((k) => !CLAVES_VALIDAS.has(k))
        .sort()
        .map((k) => ({ clave: k, porQue: FUERA_DEL_CATALOGO[k] ?? null, activoEn: activoEn.get(k) })),
    };

    return ok({
      clientes,
      catalogo,
      totales: {
        clientes: clientes.length,
        pantallasPropias,
        conPantallaPropia: clientes.filter((c) => c.aMedida.some((m) => m.pantalla)).length,
        personalizaciones: clientes.reduce((n, c) => n + c.aMedida.length, 0),
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
