import { Op, Sequelize } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { fusionarTutoresDeFicha, tutoresDeLaFamilia, signersOf } from "../../../../../lib/clients/guardians.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /api/pacientes/[id]/tutores — padres y tutores de la familia de un paciente,
 * ESCRITOS DESDE LA FICHA DEL PACIENTE (18/09/2026, ficha «Datos tutor» de
 * Aumenta: «que desde pacientes en la ficha de pacientes se le pueda añadir el
 * tutor/tutores»).
 *
 * ── POR QUÉ NO SE REUSA /api/clients/[id]/guardians ─────────────────────────
 * Porque su puerta es `ctx.hasModule("clients")`, que es la del USUARIO, y en
 * Aumenta 13 de los usuarios —las terapeutas, rol `user`— no tienen Clientes
 * en su `moduleAccess`: desde la ficha del paciente ese endpoint responde 403.
 * Es exactamente la piedra con la que ya se tropezó el 05/09 (vuelta de
 * AV-0023), cuando el bloque de tutores quedó cerrado con llave justo para
 * quien lo había pedido.
 *
 * Abrir aquel gate al centro habría enseñado de paso el DNI de los 1.621
 * tutores que lo tienen y las casillas de quién firma el contrato. Así que
 * esta es otra puerta, con las reglas de la pantalla que la abre: entra quien
 * puede abrir la ficha del paciente (Clínica o Pacientes), ve y escribe los
 * CUATRO campos que esa ficha enseña —nombre, parentesco, teléfono, correo— y
 * el DNI y quién firma se conservan intactos por debajo
 * (`fusionarTutoresDeFicha`, lib/clients/guardians.js).
 *
 * Sigue siendo la MISMA columna: `clients.guardians`. No hay tutor por
 * paciente; los hermanos comparten padres, que es lo que dicen los datos (de
 * 1.106 familias de Aumenta, 82 tienen más de un hijo y ninguna los tiene con
 * padres distintos).
 */

function gate(ctx) {
  return ctx.hasModule("clinica") || ctx.hasModule("pacientes");
}

/*
 * Un correo no puede abrir dos casas.
 *
 * El área privada resuelve a qué familia entra alguien buscando su correo en
 * `clients.email` y, si no, entre los tutores de cualquier ficha. Un correo
 * repetido —el genérico del centro, el de la vecina— le abre a alguien la
 * documentación clínica de un menor que no es suyo. Es la misma comprobación
 * que hace el alta de clientes, y aquí hace más falta todavía: quien escribe
 * es una terapeuta que no ve el resto de fichas.
 */
async function correoQueYaAbreOtraCasa(Client, clientId, correos) {
  if (!correos.length) return null;
  const escapados = correos.map((c) => Client.sequelize.escape(c)).join(",");
  const chocan = await Client.findAll({
    attributes: ["id", "name"],
    where: {
      id: { [Op.ne]: clientId },
      [Op.or]: [
        { email: { [Op.in]: correos } },
        Sequelize.literal(
          `jsonb_typeof(guardians) = 'array' AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(guardians) AS g
             WHERE lower(g->>'email') IN (${escapados})
           )`
        ),
      ],
    },
    limit: 3,
  });
  if (!chocan.length) return null;
  return (
    `Ese correo ya está en la ficha de ${chocan.map((c) => c.name).join(", ")}. ` +
    `El correo de un tutor da acceso al área privada de SU familia, así que no puede estar en dos.`
  );
}

export const PUT = withTenant(async (request, rc, ctx) => {
  try {
    if (!gate(ctx)) return forbidden("Módulo Clínica/Pacientes no activo");
    // La familia vive en Clientes. Se mira el módulo del CENTRO y no el del
    // usuario, por lo mismo que el include de la ficha (05/09/2026).
    if (!ctx.tenantHasModule("clients")) return forbidden("Módulo clients no activo");

    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Patient, Client } = ctx.tenantModels;
    if (!Client) return forbidden("Módulo clients no activo");

    const paciente = await Patient.findByPk(id, { attributes: ["id", "clientId"] });
    if (!paciente) return notFound("Paciente no encontrado");
    if (!paciente.clientId) {
      return error("Este paciente no tiene familia asociada. Los tutores se apuntan en la ficha de la familia.", 422);
    }

    const cliente = await Client.findByPk(paciente.clientId);
    if (!cliente) return notFound("La familia de este paciente no existe");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }

    const antes = Array.isArray(cliente.guardians) ? cliente.guardians : [];
    const { guardians, error: fallo } = fusionarTutoresDeFicha(antes, body.tutores);
    if (fallo) return error(fallo, 422);

    const choque = await correoQueYaAbreOtraCasa(
      Client,
      cliente.id,
      guardians.map((g) => g.email).filter(Boolean)
    );
    if (choque) return error(choque, 422);

    await cliente.update({ guardians });

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "client.guardians.updated",
      entity: "Client",
      entityId: cliente.id,
      // Solo el recuento y de dónde vino: nombres, DNI y teléfonos de los
      // padres son datos personales de terceros y `master.audit_log` es un
      // schema compartido por todos los clientes.
      before: { tutores: antes.length },
      after: { tutores: guardians.length, firmantes: signersOf(guardians).length, desde: "ficha_paciente" },
    });

    // Se devuelve lo MISMO que pinta la ficha, titular incluido, para que la
    // pantalla no tenga que recomponer la lista por su cuenta.
    return ok({ tutores: tutoresDeLaFamilia({ ...cliente.toJSON(), guardians }) });
  } catch (err) {
    return serverError(err);
  }
});
