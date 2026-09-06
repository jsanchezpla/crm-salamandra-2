import { promises as fs } from "node:fs";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { auditar, datosPeticion, resumen } from "../../../../lib/utils/auditoria.js";
import { ok, noContent, forbidden, notFound, error } from "../../../../lib/utils/apiResponse.js";
import { puedeVerFicha, normalizarCategoria, veTodasLasExternas } from "../../../../lib/clients/consultaExterna.js";
import { esAdmin, rolDe } from "../../../../lib/auth/permisos.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { getClientDir } from "../../../../lib/clients/attachmentStorage.js";
import { borrarRastroDelCliente } from "../../../../lib/clients/borrarRastro.js";
import { entradaDeCliente } from "../../../../lib/clients/listaEspera.js";
import { terapeutaAPacientesDeFamilia } from "../../../../lib/clients/profesionalFamilia.js";
import { fechaONull } from "../../../../lib/clients/formularioAlta.js";
import { categoriaONull } from "../../../../lib/booking/categorias.js";
import { esEstadoDeFicha } from "../../../../lib/clients/estados.js";
import { bonosDeCliente } from "../../../../lib/citas/packs.js";
import {
  normalizeContactValue,
  validateContactValue,
  setPrimaryContactValue,
  isMissingTable,
} from "../../../../lib/clients/contactMethods.js";
import { normalizeGuardians } from "../../../../lib/clients/guardians.js";
import { limpiarRazonSocialPorDefecto, limpiarRepartoEntreTutores } from "../../../../lib/billing/razonSocial.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client, Interaction, WaitlistEntry } = tenantModels;
  const { id } = await params;

  // Si la familia está esperando plaza, la ficha lo dice en su primera
  // pantalla: es lo que pregunta cualquiera que la abra («¿desde cuándo llevan
  // esperando?»), y hasta ahora había que ir a otra pantalla a buscarlo.
  const enCola = hasModule("clients_avanzado") ? await entradaDeCliente(WaitlistEntry, id) : null;
  const listaEspera = enCola
    ? { desde: enCola.createdAt, posicion: enCola.position, id: enCola.id }
    : null;

  // Intento principal: cliente + interactions (timeline legacy usado por el
  // ClientDetailModule default). Si la tabla `interactions` no existe en el
  // schema del tenant (sucede p. ej. en crm_nutri_laura, donde el módulo
  // legacy nunca se sembró) → Postgres devuelve 42P01 "undefined_table" y
  // Sequelize lo envuelve en SequelizeDatabaseError. En ese caso degradamos
  // a un fetch sin include y devolvemos interactions:[] para no romper la
  // ficha completa por una sección opcional.
  let client;
  try {
    client = await Client.findByPk(id, {
      include: [{ model: Interaction, as: "interactions", order: [["date", "DESC"]] }],
    });
  } catch (err) {
    const isMissingTable =
      err?.parent?.code === "42P01" ||
      err?.original?.code === "42P01";
    if (!isMissingTable) throw err;
    process.stderr.write(
      `[clients:detail] interactions table missing for tenant ${tenant.slug} — degrading to no-include\n`
    );
    client = await Client.findByPk(id);
    if (client) {
      // Sequelize no añade el alias 'interactions' si no hay include; lo
      // emulamos en el JSON serializado para que el cliente reciba siempre
      // la misma forma (default module lee data.data.interactions).
      const json = client.toJSON();
      json.interactions = [];
      json.listaEspera = listaEspera;
      json.bonos = await bonosDeCliente(tenantModels, client);
      return ok(json);
    }
  }

  if (!client) return notFound("Cliente no encontrado");

  /*
   * «Consulta externa»: solo admin y quien la tenga asignada (07/08/2026). Se
   * comprueba AQUÍ y no solo en el listado porque esto se pide por id: filtrar
   * la lista sin cerrar el detalle deja la ficha accesible con la URL a mano.
   *
   * Se devuelve 404 y no 403: decir «existe pero no es para ti» ya cuenta algo
   * de un paciente que no le corresponde a quien pregunta.
   */
  const rolQuienMira = request.headers.get("x-user-role") ?? "user";
  const soyDelEquipo = hasModule("team") ? await resolveCurrentTeamMemberId(request, tenantModels) : null;
  if (!puedeVerFicha(client, rolQuienMira, soyDelEquipo)) return notFound("Cliente no encontrado");

  // Bonos de sesiones y lo que le queda de cada uno (04/08/2026). Devuelve []
  // en cuanto falte algo: la ficha no se cae por una sección de más.
  const bonos = await bonosDeCliente(tenantModels, client);
  return ok({ ...client.toJSON(), listaEspera, bonos });
});

export const PUT = withTenant(async (request, { params }, { tenant, tenantModels, tenantSequelize, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client, ClientContactMethod } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  /*
   * La misma puerta que el GET (10/08/2026). No estaba: el detalle cerraba las
   * consultas externas ajenas al LEERLAS, pero este PUT no, y como responde con
   * la ficha entera, un PUT vacío contra un id conocido la devolvía completa a
   * quien no debía verla. Cerrar la lectura y dejar abierta la escritura es no
   * cerrar nada.
   *
   * 404 y no 403, igual que en el GET: decir «existe pero no es para ti» ya
   * cuenta algo de un paciente que no le corresponde a quien pregunta.
   */
  const rolQuienEdita = request.headers.get("x-user-role") ?? "user";
  const miTeamMemberId = hasModule("team") ? await resolveCurrentTeamMemberId(request, tenantModels) : null;
  if (!puedeVerFicha(client, rolQuienEdita, miTeamMemberId)) return notFound("Cliente no encontrado");

  // ARREGLO 2026-07-22: este bloque solo contemplaba ocho claves con nombre
  // propio, así que un `customFields` enviado por la UI con cualquier otra
  // (edad, motivo, info_adicional… las que usa la ficha de nutrición) se
  // perdía EN SILENCIO: la pantalla decía "guardado" y el valor no cambiaba.
  // Ahora se admite el objeto entero y las claves con nombre siguen mandando
  // encima, así que el comportamiento anterior no varía para nadie.
  const entrantes =
    body.customFields && typeof body.customFields === "object" && !Array.isArray(body.customFields)
      ? body.customFields
      : {};
  const base = { ...client.customFields, ...entrantes };

  const customFields = {
    ...base,
    company: body.company?.trim() ?? base.company ?? null,
    country: body.country?.trim() ?? base.country ?? null,
    city: body.city?.trim() ?? base.city ?? null,
    postalCode: body.postalCode?.trim() ?? base.postalCode ?? null,
    // Domicilio (04/08/2026): línea de texto, no `Client.address` (JSONB).
    domicilio: body.domicilio?.trim() ?? base.domicilio ?? null,
    // Motivo de consulta (08/08/2026): la ficha ya lo pinta, así que también
    // tiene que poder corregirlo. Va en plano igual que el domicilio.
    motivo: body.motivo?.trim().slice(0, 2000) ?? base.motivo ?? null,
    // Qué es el titular del paciente (madre, padre, tutor…).
    parentescoTitular: body.parentescoTitular?.trim().slice(0, 20) ?? base.parentescoTitular ?? null,
    // ⚠️ `origin` YA NO se inventa (08/08/2026). El `?? "manual"` solo alcanzaba
    // a las fichas que NO lo traían, que son exactamente las nacidas de una
    // solicitud web: la primera vez que alguien las editaba, una familia que
    // había llegado por el formulario quedaba registrada como alta a mano. El
    // alta manual sí lo estampa al crear (app/api/clients/route.js), así que
    // aquí no hace falta ningún valor por defecto.
    origin: body.origin ?? base.origin ?? null,
    leadId: body.leadId ?? base.leadId ?? null,
    // ⚠️ El embudo TAMPOCO se inventa, por lo mismo que `origin` aquí arriba
    // (26/08/2026). El `?? "new"` alcanzaba a las fichas que no lo traían, que
    // en un centro clínico son TODAS: en Aumenta las 1.083 tienen `seStatus`
    // vacío, así que cualquier guardado —incluido el del estado nuevo, que se
    // va a usar en 90 fichas seguidas— les estampaba un embudo comercial que
    // allí no se enseña ni se mira. Quien lo usa lo manda, y entonces se guarda.
    ...(body.status !== undefined || base.seStatus !== undefined
      ? { seStatus: body.status ?? base.seStatus }
      : {}),
    // El tipo de contratante (01/09/2026). Se mira `"categoria" in body` y no
    // el valor por lo mismo que el embudo de aquí arriba: quien no lo pregunta
    // —la ficha de una clínica, el botón que avanza el estado— no lo manda y no
    // tiene por qué pisarlo. Cuando SÍ viene, `""` borra (es «Sin especificar»,
    // la única forma de deshacer un tipo mal puesto) y una clave inventada no
    // entra: `categoriaONull` la deja en null.
    ...("categoria" in body ? { categoria: categoriaONull(body.categoria) } : {}),
  };

  // Datos fiscales (solo si vienen explícitos en el body).
  //
  // ⚠️ `fiscalTaxId` TIENE que estar en esta lista (08/08/2026). Sin él, la
  // sección de facturación de la ficha manda el CIF, la pantalla dice
  // «guardado» y el servidor lo tira en silencio: el mismo fallo que se acaba
  // de arreglar para el motivo de consulta, reintroducido en otro campo.
  const fiscalUpdates = {};
  for (const k of ["fiscalName", "fiscalTaxId", "fiscalAddress", "fiscalCity", "fiscalZip", "fiscalCountry", "taxId"]) {
    if (k in body) {
      const v = body[k];
      fiscalUpdates[k] = typeof v === "string" ? (v.trim() || null) : v;
    }
  }

  /*
   * La razón social POR DEFECTO de la familia (04/09/2026, Rodrigo): un tutor
   * de ESTA ficha, o null para facturar a nombre de la ficha. Se sanea contra
   * sus propios tutores —los que vengan en este mismo guardado, si vienen— para
   * que no quede apuntando a nadie. Reglas en `lib/billing/razonSocial.js`.
   */
  if ("fiscalGuardianId" in body) {
    const tutores = Array.isArray(body.guardians) ? normalizeGuardians(body.guardians) : client.guardians;
    fiscalUpdates.fiscalGuardianId = limpiarRazonSocialPorDefecto(body.fiscalGuardianId, tutores);
  }
  // Y el reparto entre tutores (06/09/2026): saneado contra los tutores de la
  // ficha; lo que no cuadra (uno solo, un ajeno, una suma que no es 100) se
  // guarda como «sin reparto» en vez de dejar una ficha a medias.
  if ("fiscalSplit" in body) {
    const tutores = Array.isArray(body.guardians) ? normalizeGuardians(body.guardians) : client.guardians;
    fiscalUpdates.fiscalSplit = limpiarRepartoEntreTutores(body.fiscalSplit, tutores);
  }

  // El campo email/teléfono único de la ficha edita el CONTACTO PRINCIPAL: sólo
  // se toca si viene un valor no vacío (compat con el "|| client.email" legacy).
  const emailN = normalizeContactValue("email", body.email);
  const phoneN = normalizeContactValue("phone", body.phone);
  if (emailN) {
    const invalid = validateContactValue("email", emailN);
    if (invalid) return error(invalid, 422);
  }

  const baseUpdate = {
    name: body.name?.trim() || client.name,
    notes: "notes" in body ? (body.notes?.trim() || null) : client.notes,
    customFields,
    ...fiscalUpdates,
  };
  // Fecha de nacimiento (04/08/2026). Solo si viene explícita, como los datos
  // fiscales: un PUT parcial de otra sección no puede borrarla por omisión.
  if ("birthDate" in body) baseUpdate.birthDate = fechaONull(body.birthDate);
  // Flag "padres separados" (tutor). Sólo se toca si viene explícito en el body
  // (permite un PUT parcial { separated } sin arrastrar el resto de campos).
  if ("separated" in body) baseUpdate.separated = body.separated == null ? null : !!body.separated;
  // Citas autoconfirmadas para ESTA persona (06/08/2026, Rodrigo). Igual que
  // arriba: solo si viene explícito, para que un guardado de otra sección de la
  // ficha no lo apague sin querer.
  if ("autoConfirmBookings" in body) baseUpdate.autoConfirmBookings = !!body.autoConfirmBookings;

  /*
   * El estado de la ficha (25/08/2026 archivar; 26/08/2026 los tres estados).
   * La llave es `estado` —o `archivada`, que sigue valiendo—, NUNCA `status`.
   *
   * ⚠️ En este endpoint `body.status` YA está cogido: es el embudo comercial y
   * acaba en `customFields.seStatus` (unas líneas más arriba). La columna de
   * verdad, `clients.status`, es otra cosa —`active` / `inactive` / `prospect`—
   * y es la que decide si la ficha está dada de baja. Con la misma llave para
   * las dos, un guardado del embudo se llevaría por delante el archivo.
   *
   * Solo se toca si el valor CAMBIA, para que un `archivada:false` de paso no
   * ascienda a `active` a un `prospect` que nadie había archivado. (Si de
   * verdad se archiva un `prospect` y luego se reactiva, vuelve como `active`:
   * el archivo es de ida y vuelta, pero solo recuerda dos estados.)
   *
   * Lo único que archivar esconde es «Fichas a completar»
   * (`lib/clients/urgentes.js`), que es justo lo que se pidió y tiene su
   * casilla para volver a verlas. En ningún otro sitio desaparece, y hubo que
   * arreglar un caso para que eso fuera verdad: `app/api/citas/clientes`
   * filtraba por `status <> 'inactive'` y se llevaba las archivadas del
   * buscador del alta de citas. Desde el 25/08/2026 las ofrece marcadas.
   *
   * No es de admin: archivar se deshace con un clic. Borrar, que no se deshace,
   * sí lo es (ver el DELETE de abajo).
   */
  if ("estado" in body) {
    /*
     * EL ESTADO DE LA FICHA, en la columna (26/08/2026, Lau).
     *
     * Lau quería marcar «no vino» a quien llamó y nunca llegó a empezar. El
     * valor ya existía sin estrenar en el ENUM (`prospect`), así que esto no
     * añade ni una columna. Los rótulos y quién lo usa, en
     * `lib/clients/estados.js`.
     *
     * ⚠️ Se valida contra la lista, no se pasa tal cual: `status` es un ENUM de
     * PostgreSQL, y un valor de fuera no guarda un dato raro — revienta la
     * consulta con «la sintaxis de entrada no es válida para el enum».
     *
     * Manda sobre `archivada` si vinieran los dos: el estado es el campo de
     * verdad y el interruptor solo sabía decir dos de los tres.
     */
    if (!esEstadoDeFicha(body.estado)) return error("Estado de ficha desconocido", 422);
    baseUpdate.status = String(body.estado).trim();
  } else if ("archivada" in body) {
    const quiereArchivada = !!body.archivada;
    if (quiereArchivada !== (client.status === "inactive")) {
      baseUpdate.status = quiereArchivada ? "inactive" : "active";
    }
  }

  /*
   * «Consulta externa» y su empresa (07/08/2026, Rodrigo). Solo si vienen
   * explícitos, como el resto: un guardado de otra sección de la ficha no puede
   * desmarcarlo sin querer — y desmarcarlo significa que el paciente aparece de
   * golpe para todo el equipo.
   *
   * ⚠️ SOLO ADMIN PUEDE MARCARLO O QUITARLO. Es lo que decide quién ve a esa
   * persona; si lo pudiera cambiar cualquiera, la regla de visibilidad no
   * valdría nada. La categoría sí la puede tocar quien ya ve la ficha: es una
   * etiqueta, no un permiso.
   */
  if ("esConsultaExterna" in body) {
    if (!veTodasLasExternas(rolQuienEdita)) {
      return error("Solo un administrador puede marcar una consulta externa", 403);
    }
    baseUpdate.esConsultaExterna = !!body.esConsultaExterna;
  }
  if ("categoriaExterna" in body) baseUpdate.categoriaExterna = normalizarCategoria(body.categoriaExterna);

  /*
   * Su profesional de referencia (10/08/2026, Rodrigo). El campo se ponía solo
   * al aceptar la solicitud en la bandeja y ya no se podía tocar; ahora se
   * cambia desde la ficha, que es donde se mira cuando alguien pregunta «¿esta
   * con quién va?».
   *
   * Solo si viene explícito, como el resto: un guardado de otra sección de la
   * ficha no puede dejar a nadie sin profesional por omisión.
   *
   * ⚠️ EN UNA CONSULTA EXTERNA, SOLO ADMIN. Ahí el profesional asignado no es
   * un dato: es QUIÉN VE a esa persona (lib/clients/consultaExterna.js). Si lo
   * pudiera cambiar cualquiera, bastaría con ponerse a uno mismo para abrir una
   * ficha que no le corresponde. Se mira la marca que va a QUEDAR, no la que
   * había, por si en el mismo PUT viniera también el interruptor.
   */
  if ("assignedTeamMemberId" in body) {
    const { TeamMember } = tenantModels;
    if (!hasModule("team") || !TeamMember) {
      return error("Este centro no tiene el módulo de Equipo: no hay a quién asignar", 422);
    }
    const seraExterna = "esConsultaExterna" in body ? !!body.esConsultaExterna : !!client.esConsultaExterna;
    if (seraExterna && !veTodasLasExternas(rolQuienEdita)) {
      return error("Solo un administrador puede cambiar el profesional de una consulta externa", 403);
    }
    const valor = body.assignedTeamMemberId ? String(body.assignedTeamMemberId).trim() : null;
    if (valor) {
      // El formato se comprueba ANTES de preguntar a la base: un id que no es
      // un UUID revienta la consulta con un 22P02 y saldría como error 500.
      if (!UUID_RE.test(valor)) return error("Profesional no válido", 422);
      const miembro = await TeamMember.findByPk(valor, { attributes: ["id"] });
      if (!miembro) return error("Ese miembro del equipo ya no existe", 422);
    }
    baseUpdate.assignedTeamMemberId = valor;
  }
  /*
   * Asignar profesional a la FAMILIA llega también a sus PACIENTES (31/08/2026,
   * Rodrigo: «es confuso que no esté en los dos lados igual»). La regla y su
   * límite —solo a los pacientes que no tengan terapeuta, nunca pisando uno
   * puesto a propósito— viven en lib/clients/profesionalFamilia.js. Se decide
   * AQUÍ, antes del update, comparando con lo que había: re-guardar la ficha
   * con el mismo profesional no tiene que re-propagar nada.
   */
  const profesionalNuevo =
    baseUpdate.assignedTeamMemberId && baseUpdate.assignedTeamMemberId !== (client.assignedTeamMemberId ?? null)
      ? baseUpdate.assignedTeamMemberId
      : null;

  // Transacción: datos base + upsert del principal (email/phone) → espejo en
  // Client.email/phone. Si el tenant aún no tiene client_contact_methods (42P01),
  // la tx hace rollback y degradamos a un update directo (comportamiento legacy).
  try {
    await tenantSequelize.transaction(async (t) => {
      await client.update(baseUpdate, { transaction: t });
      if (emailN) await setPrimaryContactValue({ client, ClientContactMethod, kind: "email", value: emailN, transaction: t });
      if (phoneN) await setPrimaryContactValue({ client, ClientContactMethod, kind: "phone", value: phoneN, transaction: t });
    });
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    await client.update({
      ...baseUpdate,
      email: emailN ?? client.email,
      phone: phoneN ?? client.phone,
    });
  }

  await client.reload();

  // El profesional nuevo, a los pacientes de la familia que no tengan terapeuta.
  // DESPUÉS del guardado y en su propia transacción: si esto fallara, la ficha
  // ya está guardada y volver a elegir al profesional lo reintenta.
  let pacientesConProfesional = 0;
  if (profesionalNuevo) {
    pacientesConProfesional = await tenantSequelize.transaction((t) =>
      terapeutaAPacientesDeFamilia({
        ctx: { tenantModels, tenantSequelize, hasModule },
        clientId: client.id,
        terapeutaId: profesionalNuevo,
        transaction: t,
      })
    );
  }

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "client.updated",
    entity: "Client",
    entityId: client.id,
    // `assignedTeamMemberId` en el resumen (10/08/2026): en una consulta externa
    // ese id decide quién ve la ficha, así que un cambio de profesional tiene
    // que dejar rastro de a quién se le pasó.
    after: {
      ...resumen(client, ["name", "email", "phone", "type", "status", "assignedTeamMemberId"]),
      ...(profesionalNuevo ? { pacientesConProfesional } : {}),
    },
  });
  return ok(client);
});

export const DELETE = withTenant(async (request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  /*
   * BORRAR UNA FICHA ES DE ADMIN (14/08/2026, Rodrigo). Ver `lib/auth/permisos.js`:
   * el equipo edita, pero lo que no se puede deshacer lo decide quien dirige.
   *
   * Aquí no se borra «un cliente»: se borra su historia clínica, sus archivos y
   * sus citas futuras, y a la paciente le llega un correo de cancelación (ver
   * `borrarRastroDelCliente` unas líneas más abajo). Ni el propio botón puede
   * prometer que eso se deshace.
   *
   * La comprobación va ANTES de tocar nada. Y va aquí y no solo en la pantalla:
   * las dos fichas esconden el botón a quien no es admin, pero esconder un
   * botón no cierra una puerta.
   */
  if (!esAdmin(rolDe(request))) {
    return forbidden("Solo un administrador puede eliminar una ficha");
  }

  const { Client, Invoice } = tenantModels;
  const { id } = await params;

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  // No permitir borrar si tiene facturas (preservar histórico fiscal).
  // Si la tabla `invoices` no existe en este tenant (caso nutri_laura, donde
  // el módulo billing no se sembró) → Postgres devuelve 42P01. Degradamos
  // a "no hay bloqueo por facturas" y seguimos con el borrado: el cliente
  // claramente no puede tener facturas si la tabla no existe. Mismo patrón
  // defensivo que el GET con `interactions`.
  if (Invoice) {
    try {
      const invoiceCount = await Invoice.count({ where: { clientId: id } });
      if (invoiceCount > 0) {
        return error(`No se puede borrar: el cliente tiene ${invoiceCount} factura(s). Márcalo como inactivo en su lugar.`, 409);
      }
    } catch (err) {
      const isMissingTable =
        err?.parent?.code === "42P01" ||
        err?.original?.code === "42P01";
      if (!isMissingTable) throw err;
      process.stderr.write(
        `[clients:delete] invoices table missing for tenant ${tenant.slug} — skipping invoice guard\n`
      );
    }
  }

  // Borrar un cliente se lleva por delante sus adjuntos y su historial:
  // tiene que quedar constancia de quién lo hizo.
  const antesBorrar = resumen(client, ["name", "email", "phone", "type", "status"]);
  const idBorrado = client.id;

  // ANTES de destruir la ficha, no después: al borrarla, los documentos y las
  // citas se quedan con la FK a NULL y ya no hay forma de saber de quién eran.
  const rastro = await borrarRastroDelCliente({
    tenantModels,
    tenant,
    clientId: client.id,
    clientEmail: client.email,
  });

  await client.destroy();

  // GC del directorio físico de adjuntos. El CASCADE ya borró client_attachments
  // en BD pero los archivos en disco quedarían huérfanos. Best-effort: si la
  // limpieza falla, el cliente queda borrado igual y el GC periódico (apuntado
  // al backlog) se encargará de los huérfanos.
  try {
    const dir = getClientDir(tenant.slug, id);
    await fs.rm(dir, { recursive: true, force: true });
    process.stdout.write(`[clients:attachment] cleanup dir tenant=${tenant.slug} client=${id}\n`);
  } catch (err) {
    process.stderr.write(`[clients:attachment] cleanup dir failed: ${err.message}\n`);
  }

  await auditar({
    tenantId: tenant.id,
    ...datosPeticion(request),
    action: "client.deleted",
    entity: "Client",
    entityId: idBorrado,
    before: antesBorrar,
    // Cuánto se llevó por delante. Sin esto, un borrado que se lleva 14
    // documentos y 3 citas queda en el registro igual que uno que no se lleva
    // nada, y luego no hay forma de reconstruir qué pasó.
    after: {
      documentosBorrados: rastro.documentos,
      citasFuturasBorradas: rastro.citasFuturas,
      citasAvisadas: rastro.avisadas,
    },
  });
  return noContent();
});
