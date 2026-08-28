import { Op } from "sequelize";
import { filtroPorNombre } from "../../../../lib/utils/busquedaDb.js";
import { agruparPorFamilia, conPacientes, idsDeFamilia } from "../../../../lib/citas/familiasDePacientes.js";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";

/**
 * GET /api/citas/clientes — a quién se le puede poner una cita.
 *
 * Devuelve las fichas de cliente que tienen ACTIVADO algún módulo asistencial
 * (`nutricion` o `clinica`), que es como el CRM marca "esta persona es
 * paciente" desde su ficha (tabla client_module_assignments). Sirve para que
 * el alta manual de citas sea un buscador en vez de tres campos de texto
 * libre, y para que el email y el teléfono se rellenen solos.
 *
 * Query:
 *   ?q=ana        filtra por nombre, email o teléfono (sin distinguir mayúsculas)
 *   ?limit=20     tope de resultados (por defecto 20, máximo 50)
 *   ?todos=1      ignora el filtro de módulos y devuelve cualquier cliente
 *
 * DEGRADACIÓN DELIBERADA: se devuelven TODOS los clientes, en vez de una lista
 * vacía, cuando el filtro no puede distinguir nada — porque el tenant no tiene
 * la tabla de asignaciones (42P01) o porque no hay ni un cliente marcado. Un
 * desplegable vacío dejaría a la usuaria sin poder crear la cita, y eso es peor
 * que ofrecer de más. `soloPacientes` dice cuál de los dos casos es.
 */

const MODULOS_ASISTENCIALES = ["nutricion", "clinica"];

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("citas")) return forbidden("Módulo citas no activo");

    const { Client, ClientModuleAssignment } = tenantModels;
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    const todos = url.searchParams.get("todos") === "1";
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 50);

    /*
     * ⚠️ AQUÍ NO SE FILTRA POR ESTADO (25/08/2026, Jorge).
     *
     * Hasta hoy esto empezaba por `status <> 'inactive'`, así que una ficha
     * archivada desaparecía del buscador. Sonaba razonable —quien ya no viene no
     * tiene por qué salir— hasta que se pudo archivar desde la ficha: se archiva
     * a una familia, vuelve a los dos meses a pedir hora, recepción teclea el
     * nombre y no sale nadie. Y como el buscador tiene salida a mano a
     * propósito, la cita se crea igual pero con `client_id = null`: suelta de su
     * familia, que es justo el fallo que este buscador vino a arreglar en
     * julio.
     *
     * Ahora salen, marcadas «Archivada» (por eso `status` va en los atributos) y
     * detrás de las vivas, pero CON CUPO PROPIO — ver abajo, que es la parte
     * que casi se hace mal.
     *
     * Con esto, el único sitio del CRM donde archivar sigue escondiendo una
     * ficha es «Fichas a completar» (`lib/clients/urgentes.js`), y allí es a
     * propósito: es justo lo que se pidió, y tiene su casilla para volver a
     * verlas.
     */
    /*
     * ── TAMBIÉN POR EL NOMBRE DEL HIJO (28/08/2026, Lau de Aumenta) ─────────
     *
     * Esta caja se llama «Cliente (la familia)» y buscaba SOLO entre fichas de
     * cliente. Pero quien viene a la sesión es el hijo, y recepción teclea su
     * nombre: escribir «thiago» —un paciente dado de alta— respondía «Nadie con
     * ese nombre». Medido en producción ese día: de los 1.174 pacientes de
     * Aumenta, 934 (el 80%) no se podían encontrar por su nombre, porque su
     * familia no se apellida como ellos.
     *
     * Y no era solo incomodidad: esta caja tiene salida a mano a propósito, así
     * que quien no encontraba a alguien escribía el nombre y creaba la cita
     * SUELTA de su ficha — el mismo fallo que este buscador vino a arreglar en
     * julio, entrando por otra puerta.
     *
     * Se busca primero entre los pacientes, y sus familias se suman a las que
     * coinciden por su propio nombre. El reparto (qué familia sale por qué
     * paciente) lo hace `lib/citas/familiasDePacientes.js`, que tiene prueba.
     */
    const { Patient } = tenantModels;
    let porFamilia = new Map();
    if (q && Patient && (hasModule("pacientes") || hasModule("clinica"))) {
      try {
        const filtroPaciente = await filtroPorNombre(Patient.sequelize, q, [
          "Patient.first_name", "Patient.last_name",
        ]);
        if (filtroPaciente) {
          const encontrados = await Patient.findAll({
            where: filtroPaciente,
            attributes: ["id", "firstName", "lastName", "clientId"],
            // Tope alto y propio: no compite con el de las fichas, y con 1.174
            // pacientes una palabra corta puede traer muchos.
            limit: 200,
            raw: true,
          });
          porFamilia = agruparPorFamilia(encontrados);
        }
      } catch (err) {
        // Mismo criterio que abajo: un tenant con citas pero sin tabla de
        // pacientes se queda como estaba, no se cae el buscador.
        const code = err?.parent?.code || err?.original?.code;
        if (code !== "42P01") throw err;
      }
    }

    const where = {};
    // Todas las palabras, cada una en cualquiera de los campos (28/08/2026): en
    // recepción se teclea el nombre como lo dice quien llama, y antes «castro
    // hugo» o «diaz» sin tilde no encontraban la ficha.
    if (q) {
      const porNombre = await filtroPorNombre(Client.sequelize, q, [
        "Client.name", "Client.email", "Client.phone",
      ]);
      const familias = idsDeFamilia(porFamilia);
      /*
       * ⚠️ La lista de familias SOLO se añade si tiene algo. Un `IN ()` vacío no
       * devuelve nada, y metido en el `Op.or` se llevaría por delante la
       * búsqueda por el nombre de la familia — que es la que funcionaba.
       */
      const alternativas = [porNombre, familias.length ? { id: { [Op.in]: familias } } : null].filter(Boolean);
      if (alternativas.length === 1) (where[Op.and] ||= []).push(alternativas[0]);
      else if (alternativas.length > 1) (where[Op.and] ||= []).push({ [Op.or]: alternativas });
    }

    // Restricción a quienes son pacientes de algún módulo asistencial.
    let idsAsistenciales = null;
    if (!todos && ClientModuleAssignment) {
      try {
        const filas = await ClientModuleAssignment.findAll({
          where: { moduleKey: { [Op.in]: MODULOS_ASISTENCIALES }, enabled: true },
          attributes: ["clientId"],
          raw: true,
        });
        idsAsistenciales = [...new Set(filas.map((f) => f.clientId).filter(Boolean))];
      } catch (err) {
        // Tenant con citas pero sin la tabla de asignaciones: mejor de más que
        // dejar el desplegable vacío y bloquear el alta de la cita.
        const code = err?.parent?.code || err?.original?.code;
        if (code !== "42P01") throw err;
        idsAsistenciales = null;
      }
    }

    /*
     * ⚠️ NADIE MARCADO ≠ NADIE A QUIEN DAR CITA (12/08/2026, Rodrigo: «¿por qué
     * no me deja poner pacientes en la cita manual?»).
     *
     * La marca de módulo asistencial vive en la ficha del CLIENTE, y en un
     * centro clínico el cliente es la FAMILIA que paga: quien es paciente es el
     * hijo, que tiene su propia tabla y su propio selector en el alta. Aumenta
     * tiene 1.083 familias y CERO con esa marca puesta, así que el buscador
     * devolvía la lista vacía y un cartel («aún no hay pacientes con módulo
     * asistencial activado») que sonaba a que faltaba configurar algo.
     *
     * Si NADIE la tiene, la marca no está en uso en este centro y filtrar por
     * ella no distingue nada: se ofrecen todos los clientes. Es la misma
     * degradación deliberada que cuando falta la tabla — un desplegable vacío
     * deja a recepción sin poder dar la cita, y eso es peor que ofrecer de más.
     * Donde sí se usa (nutri_laura) no cambia nada: la lista sigue acotada.
     */
    if (idsAsistenciales && idsAsistenciales.length === 0) idsAsistenciales = null;

    if (idsAsistenciales) {
      where.id = { [Op.in]: idsAsistenciales };
    }

    /*
     * DOS CONSULTAS CON CUPO PROPIO, Y NO UNA ORDENADA.
     *
     * La primera versión de esto traía todas juntas con un
     * `ORDER BY (status = 'inactive') ASC`, para que las archivadas quedaran
     * detrás. Parecía suficiente hasta hacer la cuenta: el tope es 20 y Aumenta
     * tiene 1.083 fichas. Recepción teclea «garcía» para darle hora a la
     * familia que archivó hace dos meses, las coincidencias VIVAS llenan las 20
     * plazas, y la archivada —que por ese orden va siempre detrás de todas las
     * vivas— no entra nunca. O sea: el mismo agujero que este cambio venía a
     * tapar, con más pasos.
     *
     * Con cupo propio no compiten. Las vivas se llevan el tope de siempre y las
     * archivadas tienen sus cinco plazas garantizadas, detrás.
     */
    const CUPO_ARCHIVADAS = 5;

    const buscar = (estado, tope) =>
      Client.findAll({
        where: { ...where, status: estado },
        attributes: ["id", "name", "email", "phone", "status"],
        order: [["name", "ASC"]],
        limit: tope,
      });

    const [vivas, archivadas] = await Promise.all([
      buscar({ [Op.ne]: "inactive" }, limit),
      buscar("inactive", CUPO_ARCHIVADAS),
    ]);

    return ok({
      // Cada ficha lleva colgados los pacientes por los que ha salido, para que
      // el desplegable pueda decir POR QUÉ aparece esa familia y el alta pueda
      // dejar elegido a ese paciente.
      clientes: conPacientes([...vivas, ...archivadas].map((c) => c.toJSON()), porFamilia),
      soloPacientes: Boolean(idsAsistenciales),
      totalPacientes: idsAsistenciales ? idsAsistenciales.length : null,
      /*
       * «Hay más de los que caben». Sin esto, una lista llena y una lista
       * completa se ven igual, y quien no encuentra a alguien tira de la salida
       * a mano — que es como nacen las citas sin ficha.
       */
      hayMas: vivas.length === limit,
    });
  } catch (err) {
    return serverError(err);
  }
});
