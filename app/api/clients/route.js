import { withTenant } from "../../../lib/tenant/withTenant.js";
import { auditar, datosPeticion, resumen } from "../../../lib/utils/auditoria.js";
import { ok, created, forbidden, error } from "../../../lib/utils/apiResponse.js";
import { Op, Sequelize } from "sequelize";
import {
  normalizeContactValue,
  setPrimaryContactValue,
  isMissingTable,
} from "../../../lib/clients/contactMethods.js";
import { applyAutoAssignments, marcarProfesionalDesdeLead } from "../../../lib/clients/moduleAssignments.js";
import {
  normalizarPacientes,
  normalizarProgenitores,
  tipoPorDefecto,
  perfilDeAlta,
  fechaONull,
} from "../../../lib/clients/formularioAlta.js";
import { normalizeGuardians } from "../../../lib/clients/guardians.js";
import { entrarEnListaEspera } from "../../../lib/clients/listaEspera.js";
import { filtroDeVisibilidad, normalizarCategoria, veTodasLasExternas } from "../../../lib/clients/consultaExterna.js";
import { resolveCurrentTeamMemberId } from "../../../lib/team/currentTeamMember.js";

export const GET = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client } = tenantModels;
  const { searchParams } = new URL(request.url);

  /*
   * «Consultas externas» (07/08/2026, Rodrigo): los pacientes que Laura atiende
   * por un acuerdo con una empresa solo los ven admin y la profesional que los
   * lleve. El porqué de esa regla, en `lib/clients/consultaExterna.js`.
   *
   * Se resuelve ANTES de montar el `where` para que el filtro entre en la MISMA
   * consulta: aplicarlo después, sobre las filas ya traídas, descuadraría el
   * total y la paginación —la página 1 saldría con 47 de 50—.
   */
  const rolQuienMira = request.headers.get("x-user-role") ?? "user";
  const soyDelEquipo = hasModule("team") ? await resolveCurrentTeamMemberId(request, tenantModels) : null;
  const filtroExternas = filtroDeVisibilidad(rolQuienMira, soyDelEquipo);

  const search = searchParams.get("search");
  const status = searchParams.get("status");
  const country = searchParams.get("country");
  // Filtro por módulo asignado (sprint Clientes↔módulos): clientes con una
  // asignación activa a ese módulo (p.ej. assignedTo=nutricion).
  const assignedTo = searchParams.get("assignedTo");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const offset = (page - 1) * limit;

  const where = {};

  if (status) where.customFields = { [Op.contains]: { seStatus: status } };
  if (country && !status) where.customFields = { [Op.contains]: { country } };
  if (country && status) where.customFields = { [Op.contains]: { seStatus: status, country } };

  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
      { phone: { [Op.iLike]: `%${search}%` } },
    ];
  }

  // ── Ordenación (04/08/2026) ───────────────────────────────────────────────
  //
  // Antes solo ordenaba por fecha de alta, así que buscar «los García» en una
  // lista de 1.110 obligaba a pasar 22 páginas. Ahora la pantalla puede ordenar
  // por cualquier columna.
  //
  // Lista blanca deliberada: `order` acaba en el SQL, y aceptar un nombre de
  // columna del cliente es cómo se cuelan cosas raras. Lo que no esté aquí, se
  // ignora y manda el orden por defecto.
  const ORDENABLES = { nombre: "name", email: "email", telefono: "phone", alta: "createdAt", estado: "customFields" };
  const pedido = ORDENABLES[searchParams.get("orden") ?? ""] ?? "createdAt";
  const dir = (searchParams.get("dir") ?? "").toLowerCase() === "asc" ? "ASC" : "DESC";
  // NULLS LAST siempre: una lista ordenada por teléfono que empieza con
  // trescientas filas vacías no está ordenada por teléfono, para quien la mira.
  const order = pedido === "customFields"
    ? [[Sequelize.literal(`custom_fields->>'seStatus' ${dir} NULLS LAST`)]]
    : [[pedido, `${dir} NULLS LAST`]];

  /*
   * El filtro se combina con `Op.and` y NO se mete en el `where` de arriba: ese
   * ya usa `Op.or` para el buscador, y dos `Op.or` en el mismo objeto se pisan
   * —el segundo gana en silencio— y dejarían el listado sin filtrar.
   */
  const whereFinal = filtroExternas ? { [Op.and]: [where, filtroExternas] } : where;
  const queryOpts = { where: whereFinal, limit, offset, order };
  if (assignedTo) {
    const { ClientModuleAssignment } = tenantModels;
    queryOpts.include = [
      {
        model: ClientModuleAssignment,
        as: "moduleAssignments",
        attributes: [],
        where: { moduleKey: assignedTo, enabled: true },
        required: true,
      },
    ];
    queryOpts.distinct = true; // cuenta clientes distintos, no filas del JOIN
  }

  let result;
  try {
    result = await Client.findAndCountAll(queryOpts);
  } catch (err) {
    // Tenant con schema parcial sin la tabla client_module_assignments (42P01):
    // el filtro no puede cumplirse → lista vacía en vez de 500.
    const isMissingTable = err?.parent?.code === "42P01" || err?.original?.code === "42P01";
    if (assignedTo && isMissingTable) {
      return ok({ clients: [], total: 0, page, pages: 0 });
    }
    throw err;
  }

  const { rows, count } = result;
  return ok({ clients: rows, total: count, page, pages: Math.ceil(count / limit) });
});

export const POST = withTenant(async (request, _ctx, { tenant, tenantModels, tenantSequelize, hasModule, tenantHasModule, user }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client, ClientContactMethod } = tenantModels;
  const body = await request.json();

  const { name, email, phone, notes, type } = body;
  if (!name?.trim()) return error("El nombre es obligatorio", 422);

  // Merge: campos explícitos (spain-enzymes-style) + customFields libres
  // que la ruta acepta tal cual (p.ej. nutri-laura usa edad/motivo/info_adicional).
  // El spread va primero para que los campos explícitos siempre ganen al merge.
  //
  // ⚠️ ARREGLO 2026-08-08: ganar NO puede significar «borrar». Estas claves se
  // escribían con `body.x?.trim() || null`, así que una petición que NO mandaba
  // el campo en plano lo ponía a null POR ENCIMA del valor que venía anidado en
  // `customFields`. Y el camino principal de nutri_laura —convertir un lead en
  // paciente— manda justo eso: `customFields: { edad, motivo, info_adicional }`
  // y ningún `body.motivo` (modules/overrides/nutri-laura/LeadsModule.jsx:224).
  // Resultado: cada paciente convertida desde el embudo perdía el motivo de
  // consulta que había escrito ella misma, y la pantalla decía «guardado».
  const extraCustom =
    body.customFields && typeof body.customFields === "object" ? body.customFields : {};
  /** "" y null significan «no me lo has mandado», no «bórralo». */
  const texto = (v, max = 2000) => {
    if (v == null) return undefined;
    const s = String(v).trim();
    return s === "" ? undefined : s.slice(0, max);
  };
  const propioOHeredado = (propio, heredado, max) => texto(propio, max) ?? texto(heredado, max) ?? null;
  const customFields = {
    ...extraCustom,
    company: propioOHeredado(body.company, extraCustom.company),
    country: propioOHeredado(body.country, extraCustom.country),
    city: propioOHeredado(body.city, extraCustom.city),
    // Código postal (01/08/2026). Va a `customFields` con ciudad y país, y no a
    // `fiscalZip`: recepción apunta dónde vive la familia, no dónde factura.
    postalCode: propioOHeredado(body.postalCode, extraCustom.postalCode),
    // Domicilio (04/08/2026): una línea de texto, la que pide el contrato. Va
    // aquí y NO a `Client.address`, que es JSONB — ver formularioAlta.js.
    domicilio: propioOHeredado(body.domicilio, extraCustom.domicilio),
    // Motivo de consulta (08/08/2026, petición del Centro Aumenta). Se acepta
    // también en PLANO —hasta hoy solo llegaba anidado— porque es lo que manda
    // el formulario de alta. Donde hay módulo `pacientes` el motivo fino va por
    // hijo en `Patient.referralReason`; este es el de la familia, el que cuenta
    // por teléfono quien llama pidiendo información.
    motivo: propioOHeredado(body.motivo, extraCustom.motivo),
    // Qué es el titular del paciente (madre, padre, tutor…). Con esto la ficha
    // ya sabe que esta persona es uno de los progenitores, sin duplicar su
    // nombre, su DNI y su teléfono dentro de `guardians`.
    parentescoTitular: propioOHeredado(body.parentescoTitular, extraCustom.parentescoTitular, 20),
    edad: propioOHeredado(body.edad, extraCustom.edad, 40),
    info_adicional: propioOHeredado(body.info_adicional, extraCustom.info_adicional, 5000),
    origin: body.origin || "manual",
    leadId: body.leadId || null,
    seStatus: body.status || "new",
  };

  const emailN = normalizeContactValue("email", email);
  const phoneN = normalizeContactValue("phone", phone);
  // Los pacientes se validan ANTES de tocar la base de datos: si a uno le falta
  // el nombre, recepción tiene que enterarse antes de que exista media familia.
  const perfil = perfilDeAlta(hasModule);
  // La cola es de `clients_avanzado`: sin ese módulo la casilla ni se pinta, y
  // si alguien la manda a mano se ignora en silencio en vez de crear filas en
  // una tabla que ese cliente no usa.
  const enListaEspera = !!body.listaEspera && hasModule("clients_avanzado") && !!tenantModels.WaitlistEntry;
  const { pacientes, error: errorPacientes } = hasModule("pacientes")
    ? normalizarPacientes(body.pacientes)
    : { pacientes: [] };
  if (errorPacientes) return error(errorPacientes, 422);

  /*
   * El otro progenitor o tutor (08/08/2026, petición del Centro Aumenta).
   *
   * ⚠️ La puerta es el módulo `pacientes` y NO el perfil `salud`. El perfil
   * incluye también `nutricion`, y por ahí el bloque le saldría a una consulta
   * donde el paciente ES el cliente —no hay ningún menor ni ningún segundo
   * progenitor que apuntar—. Es además la consulta que tiene el área privada
   * encendida con pacientes reales: el correo de un tutor es una LLAVE de esa
   * área (lib/citas/portalClient.js), así que ahí no se toca nada.
   */
  const { progenitores, error: errorProgenitores } = hasModule("pacientes")
    ? normalizarProgenitores(body.progenitores)
    : { progenitores: [] };
  if (errorProgenitores) return error(errorProgenitores, 422);

  /*
   * Un correo no puede abrir dos casas.
   *
   * El área privada resuelve a QUÉ familia entra alguien buscando su correo en
   * `clients.email` y, si no lo encuentra, dentro de los tutores de cualquier
   * ficha, con un `findOne` sin orden. Un correo repetido en dos fichas hace
   * que a esa persona le salga una u otra según le toque, y un correo tecleado
   * mal —el genérico del centro, el de la vecina— le abre a alguien la
   * documentación clínica de un menor que no es suyo.
   *
   * Validar solo «que no se repitan entre sí» no cubre nada de eso: hay que
   * mirar las fichas que ya existen. Se hace ANTES de abrir la transacción.
   */
  const correosDeTutores = progenitores.map((g) => g.email).filter(Boolean);
  if (correosDeTutores.length) {
    const chocan = await Client.findAll({
      attributes: ["id", "name"],
      where: {
        [Op.or]: [
          { email: { [Op.in]: correosDeTutores } },
          Sequelize.literal(
            `jsonb_typeof(guardians) = 'array' AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(guardians) AS g
               WHERE lower(g->>'email') IN (${correosDeTutores.map((c) => Client.sequelize.escape(c)).join(",")})
             )`
          ),
        ],
      },
      limit: 3,
    });
    if (chocan.length) {
      const nombres = chocan.map((c) => c.name).join(", ");
      return error(
        `Ese correo ya está en la ficha de ${nombres}. El correo de un progenitor da acceso al área privada de SU familia, ` +
        `así que no puede repetirse en dos fichas. Comprueba si es la misma familia o si hay una errata.`,
        422
      );
    }
  }

  /*
   * «Consulta externa» ya desde el alta (07/08/2026, Rodrigo): así el paciente
   * de un acuerdo con una empresa nace ya marcado, sin pasar por un momento en
   * que es visible para todo el equipo.
   *
   * ⚠️ Solo admin puede marcarlo — es lo que decide quién lo ve. A quien no lo
   * sea se le ignora la marca en silencio en vez de rechazarle el alta: perder
   * un paciente recién tecleado por un campo que ni siquiera se le enseña sería
   * peor, y sin la marca el paciente queda visible, que es el estado seguro
   * (nadie pierde de vista a nadie) y se corrige desde la ficha.
   */
  const rolQuienCrea = request.headers.get("x-user-role") ?? "user";
  const esExterna = veTodasLasExternas(rolQuienCrea) && body.esConsultaExterna === true;

  const clientPayload = {
    esConsultaExterna: esExterna,
    categoriaExterna: normalizarCategoria(body.categoriaExterna),
    name: name.trim(),
    // En un centro de salud el cliente es una FAMILIA, no una empresa. El alta
    // manual creaba `company` siempre, mientras la lista de espera y los
    // formularios web creaban `individual`: la misma familia salía de un tipo o
    // de otro según por dónde hubiera entrado.
    type: type === "individual" || type === "company" ? type : tipoPorDefecto(perfil),
    email: emailN,
    phone: phoneN,
    // Fecha de nacimiento (04/08/2026): en un centro de nutrición el paciente
    // ES el cliente. Se guarda como columna, no en customFields, porque decide
    // si hace falta el consentimiento del tutor legal.
    birthDate: fechaONull(body.birthDate),
    // Los tutores entran en el MISMO INSERT que la ficha: `guardians` es una
    // columna JSONB del cliente, no una tabla aparte, así que no hace falta ni
    // una escritura más ni un paso que pueda quedarse a medias.
    ...(progenitores.length ? { guardians: normalizeGuardians(progenitores) } : {}),
    notes: notes?.trim() || null,
    // Datos fiscales opcionales — necesarios para emitir facturas a este
    // cliente, pero permitidos como null en el alta para no bloquear la
    // captura inicial. Se completan después vía PUT.
    taxId: body.taxId?.trim() || null,
    fiscalName: body.fiscalName?.trim() || null,
    fiscalAddress: body.fiscalAddress?.trim() || null,
    fiscalCity: body.fiscalCity?.trim() || null,
    fiscalZip: body.fiscalZip?.trim() || null,
    fiscalCountry: body.fiscalCountry?.trim()?.toUpperCase() || "ES",
    customFields,
  };

  try {
    // Transacción: crea el cliente y materializa el email/teléfono como métodos
    // de contacto PRINCIPALES (así la ficha muestra desde el inicio los mismos
    // datos que el resto del CRM lee de Client.email/phone).
    const client = await tenantSequelize.transaction(async (t) => {
      const c = await Client.create(clientPayload, { transaction: t });
      if (emailN) await setPrimaryContactValue({ client: c, ClientContactMethod, kind: "email", value: emailN, transaction: t });
      if (phoneN) await setPrimaryContactValue({ client: c, ClientContactMethod, kind: "phone", value: phoneN, transaction: t });
      // DENTRO de la transacción: una familia sin los pacientes que recepción
      // acaba de teclear es peor que un alta que falla y se repite.
      if (pacientes.length && tenantModels.Patient) {
        await tenantModels.Patient.bulkCreate(
          pacientes.map((p) => ({ ...p, clientId: c.id })),
          { transaction: t }
        );
      }
      // A la cola de admisión desde el propio mostrador (01/08/2026), en vez de
      // crear la ficha aquí y apuntarla a mano en la otra pantalla.
      if (enListaEspera) {
        await entrarEnListaEspera({
          WaitlistEntry: tenantModels.WaitlistEntry,
          client: c,
          notes: notes?.trim() || null,
          transaction: t,
        });
      }
      return c;
    });
    // Fuera de la transacción a propósito: el marcado automático de módulos
    // (p. ej. "Paciente Nutrición" en tenants de nutrición) es un extra y no
    // puede tumbar un alta ya hecha.
    await applyAutoAssignments({ tenantModels, clientId: client.id, tenantHasModule, userId: user?.id ?? null });
    // Y si viene de un lead del formulario de profesionales, hereda la marca
    // que le abre los tipos de cita reservados (12/08/2026). Se lee del LEAD,
    // no del cuerpo: ver `marcarProfesionalDesdeLead`.
    if (body.leadId) {
      await marcarProfesionalDesdeLead({
        tenantModels,
        clientId: client.id,
        leadId: body.leadId,
        userId: user?.id ?? null,
      });
    }
    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "client.created",
      entity: "Client",
      entityId: client.id,
      // Solo RECUENTOS de los tutores y pacientes: sus nombres, DNIs y
      // teléfonos son datos personales de menores y de terceros, y
      // `master.audit_log` es un schema compartido por todos los clientes.
      after: {
        ...resumen(client, ["name", "email", "phone", "type", "status"]),
        tutores: progenitores.length,
        pacientes: pacientes.length,
      },
    });
    return created(client);
  } catch (err) {
    if (err?.name === "SequelizeValidationError" || err?.name === "SequelizeUniqueConstraintError") {
      const msg = err.errors?.[0]?.message || err.message;
      return error(`Datos inválidos: ${msg}`, 422);
    }
    // Tenant sin la tabla client_contact_methods todavía (pre-migración): la tx
    // hizo rollback → creamos el cliente sin métodos (comportamiento legacy).
    if (isMissingTable(err)) {
      const c = await Client.create(clientPayload);
      await applyAutoAssignments({ tenantModels, clientId: c.id, tenantHasModule, userId: user?.id ?? null });
      return created(c);
    }
    throw err;
  }
});
