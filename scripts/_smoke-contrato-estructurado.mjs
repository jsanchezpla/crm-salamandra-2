/**
 * _smoke-contrato-estructurado.mjs — el contrato pide datos, anexo a anexo.
 *
 * Firmar en el portal era dibujar una raya: no se guardaba ni un dato. El
 * contrato de tunutrilaura pide ocho y sus tres anexos «se firman de forma
 * independiente al documento principal», así que hace falta una aceptación por
 * anexo y no una para todo el paquete.
 *
 * Lo que se fija aquí:
 *   · sin los datos obligatorios NO se firma, y se dice cuál falta;
 *   · un DNI con la letra cambiada se rechaza, pero un pasaporte extranjero
 *     pasa (rechazarlo dejaría sin empezar a una paciente de fuera);
 *   · aceptar el contrato NO arrastra a los anexos: faltando uno, no hay firma;
 *   · el PDF generado lleva DENTRO los datos y el clausulado entero, no un
 *     resumen — es la copia de quien firma;
 *   · una fecha de nacimiento de menor encadena el consentimiento parental, y
 *     una de adulta NO lo pide;
 *   · el mismo firmante puede firmar los DOS documentos (el índice único viejo,
 *     sin `template_key`, lo impedía);
 *   · y el control: sin plantillas activas, el contrato de Aumenta sigue siendo
 *     el de siempre, con una sola firma y sin datos.
 *
 * No toca ningún dato real: crea su propia ficha y la borra al terminar.
 *
 * Uso: node --env-file=.env.local scripts/_smoke-contrato-estructurado.mjs [slug]
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import {
  validarDatos,
  validarAceptaciones,
  esMenor,
  letraDocumentoCorrecta,
  situacionDocumentos,
  serializarPlantilla,
  camposDe,
} from "../lib/clients/contratoFirma.js";
import {
  camposQueFaltan,
  actualizacionDeFicha,
  datosDeFicha,
  tutorDeclarado,
} from "../lib/clients/datosFicha.js";
import { effectiveSigners } from "../lib/clients/clientContract.js";
import { buildContratoFirmadoPdf } from "../lib/documents/contratoFirmadoPdf.js";

const SLUG = process.argv[2] || "demo";
const EMAIL = "smoke-contrato@example.com";

let fallos = 0;
const ok = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const paso = (m) => process.stdout.write(`\n▶ ${m}\n`);
const esperar = (c, m) => (c ? ok(m) : mal(m));

// PNG 1×1 real: `bufferFromDataUrl` comprueba los magic bytes, no se cree la
// cabecera del dataURL.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const DATOS_OK = {
  nombre: "Paciente De Prueba",
  dni: "12345678Z", // 12345678 % 23 = 14 → 'Z'
  domicilio: "Calle Falsa 123, Barcelona",
  email: "paciente@example.com",
  telefono: "600123456",
  fechaNacimiento: "1990-05-14",
  lugarFirma: "Barcelona",
  fechaFirma: "2026-08-04",
};

async function main() {
  process.stdout.write(`\n═══ Smoke: contrato con datos y anexos (${SLUG}) ═══\n`);

  getMasterDb();
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`no existe el tenant ${SLUG}`);

  const { models } = getTenantDb(SLUG);
  const { Client, ContractSignature, ContractTemplate } = models;
  if (!ContractTemplate) throw new Error("falta el modelo ContractTemplate");

  const plantilla = await ContractTemplate.findOne({ where: { key: "paciente", active: true } });
  const parental = await ContractTemplate.findOne({ where: { key: "parental", active: true } });
  if (!plantilla || !parental) {
    throw new Error(
      "este tenant no tiene el clausulado cargado.\n" +
        `  Cárgalo antes:  $env:TENANT_SLUG="${SLUG}"; node --env-file=.env.local scripts/seed-contrato-tunutrilaura.js`
    );
  }

  let cliente;
  try {
    // ── Validación de los datos ───────────────────────────────────────────────
    paso("Los datos que pide el contrato");

    const sinDni = validarDatos(plantilla, { ...DATOS_OK, dni: "" });
    esperar(!!sinDni.error && /DNI/i.test(sinDni.error), `sin DNI no pasa y lo dice: ${sinDni.error ?? "—"}`);

    const letraMal = validarDatos(plantilla, { ...DATOS_OK, dni: "12345678A" });
    esperar(!!letraMal.error && /letra/i.test(letraMal.error), "un DNI con la letra cambiada se rechaza");

    esperar(letraDocumentoCorrecta("X1234567L") === true, "un NIE bien calculado se acepta");
    esperar(letraDocumentoCorrecta("AB123456") === null, "un pasaporte extranjero no se juzga (pasa)");

    const emailMal = validarDatos(plantilla, { ...DATOS_OK, email: "esto-no-es-un-correo" });
    esperar(!!emailMal.error, "un correo mal escrito se rechaza");

    const bien = validarDatos(plantilla, DATOS_OK);
    esperar(!bien.error && Object.keys(bien.datos).length === 8, "con los ocho datos completos, adelante");

    const colado = validarDatos(plantilla, { ...DATOS_OK, campoInventado: "lo que sea" });
    esperar(colado.datos && !("campoInventado" in colado.datos), "un campo que la plantilla no declara se tira");

    // ── Aceptación anexo a anexo ─────────────────────────────────────────────
    paso("Cada anexo se acepta por separado");

    const soloContrato = validarAceptaciones(plantilla, ["contrato"]);
    esperar(
      !!soloContrato.error && /Anexo/i.test(soloContrato.error),
      `aceptar el contrato NO arrastra a los anexos: ${soloContrato.error ?? "—"}`
    );

    const faltaUno = validarAceptaciones(plantilla, ["contrato", "anexo1", "anexo3"]);
    esperar(!!faltaUno.error && /Anexo II/.test(faltaUno.error), "faltando el Anexo II, no hay firma");

    const todas = validarAceptaciones(plantilla, ["contrato", "anexo1", "anexo2", "anexo3"]);
    esperar(!todas.error && todas.aceptaciones.length === 4, "con los cuatro aceptados, adelante");
    esperar(
      todas.aceptaciones.every((a) => a.id && a.title && a.acceptedAt),
      "cada aceptación guarda qué se aceptó y cuándo"
    );

    // ── Mayoría de edad ──────────────────────────────────────────────────────
    paso("Quién necesita el consentimiento del tutor");
    const REF = new Date("2026-08-04T00:00:00Z");
    esperar(esMenor("2012-01-01", REF) === true, "con 14 años, es menor");
    esperar(esMenor("2008-08-04", REF) === false, "el día que cumple 18, ya no");
    esperar(esMenor("2008-08-05", REF) === true, "un día antes de cumplirlos, todavía sí");
    esperar(esMenor("", REF) === false, "sin fecha legible no se le pide un tutor a una adulta");

    // ── El PDF que se lleva quien firma ──────────────────────────────────────
    paso("El PDF firmado");
    const pdf = await buildContratoFirmadoPdf({
      plantilla,
      firma: {
        signerName: DATOS_OK.nombre,
        signerData: bien.datos,
        acceptances: todas.aceptaciones,
        signedAt: new Date(),
        ip: "203.0.113.7",
        userAgent: "Smoke/1.0",
        templateVersion: plantilla.version,
      },
      imagenFirma: PNG,
      tenantName: tenant.name,
      brand: tenant.settings?.brand,
    });
    esperar(Buffer.isBuffer(pdf) && pdf.subarray(0, 4).toString() === "%PDF", "sale un PDF de verdad");
    // El texto va comprimido dentro del PDF, así que no se puede buscar a pelo;
    // el tamaño sí distingue "el clausulado entero" de "cuatro títulos".
    esperar(pdf.length > 20_000, `lleva el clausulado dentro, no un resumen (${Math.round(pdf.length / 1024)} KB)`);

    // ── El encadenado de los dos documentos ──────────────────────────────────
    paso("Contrato y consentimiento parental, encadenados");

    cliente = await Client.create({
      type: "individual",
      name: "Smoke Contrato",
      email: EMAIL,
      portalAccess: true,
      portalEmail: EMAIL,
      status: "active",
    });

    // Lo mismo que hace `estadoContrato` en el portal, sin levantar servidor:
    // lee las plantillas y las firmas y pregunta qué toca ahora.
    const estado = async () => {
      await cliente.reload();
      const plantillas = await ContractTemplate.findAll({
        where: { active: true },
        order: [["onlyMinors", "ASC"], ["createdAt", "ASC"]],
      });
      const firmas = await ContractSignature.findAll({ where: { clientId: cliente.id } });
      const firmantes = effectiveSigners(cliente);
      return situacionDocumentos({ plantillas, firmas, firmantes, firmante: firmantes[0], client: cliente });
    };

    const estado0 = await estado();
    esperar(estado0.siguiente?.key === "paciente", "lo primero es el contrato");
    esperar(estado0.completo === false, "hasta firmarlo, el portal se queda tapado");
    const visto0 = serializarPlantilla(estado0.siguiente, cliente);
    esperar(visto0.fields.length === 8 && visto0.blocks.length === 4, "y viaja con sus 8 campos y sus 4 documentos");

    // ── Los datos van a la FICHA, antes de firmar ────────────────────────────
    paso("«Completa tus datos»: a la ficha, y solo los huecos");

    const camposPaciente = camposDe(estado0.siguiente);
    const faltanAntes = camposQueFaltan(camposPaciente, cliente);
    esperar(
      faltanAntes.some((c) => c.key === "dni") && faltanAntes.some((c) => c.key === "fechaNacimiento"),
      `se le piden los huecos de la ficha (${faltanAntes.map((c) => c.key).join(", ")})`
    );
    esperar(
      !faltanAntes.some((c) => c.key === "lugarFirma"),
      "la localidad de la firma NO: es del acto de firmar, no de la persona"
    );
    esperar(
      !faltanAntes.some((c) => c.key === "email"),
      "ni el correo, que la ficha ya tiene: lo que hay no se vuelve a preguntar"
    );

    // Guarda lo declarado en la ficha, con un correo DISTINTO del que ya tiene.
    const declarado = { ...DATOS_OK, fechaNacimiento: "2012-03-02", email: "otro-correo@example.com" };
    const update = actualizacionDeFicha(camposPaciente, cliente, declarado);
    await cliente.update(update);
    await cliente.reload();

    esperar(cliente.taxId === DATOS_OK.dni, "el DNI entra en la ficha (columna taxId)");
    esperar(String(cliente.birthDate).slice(0, 10) === "2012-03-02", "la fecha de nacimiento también");
    esperar(cliente.customFields?.domicilio === DATOS_OK.domicilio, "y el domicilio, en customFields");
    esperar(cliente.email === EMAIL, "el correo que YA tenía la ficha NO se ha pisado");

    const faltanDespues = camposQueFaltan(camposPaciente, cliente);
    esperar(faltanDespues.length === 0, "ya no falta nada por rellenar");

    // ── El contrato lee de la ficha ──────────────────────────────────────────
    paso("El contrato ya no pregunta: lee la ficha");
    const visto1 = serializarPlantilla(estado0.siguiente, cliente);
    const deFicha = visto1.fields.filter((f) => f.desdeFicha);
    esperar(deFicha.length === 6, `seis datos llegan resueltos de la ficha (${deFicha.length})`);
    esperar(
      visto1.fields.filter((f) => !f.desdeFicha).every((f) => /Firma/i.test(f.label) || /localidad/i.test(f.label)),
      "y lo único que se sigue preguntando es la localidad y la fecha de la firma"
    );
    esperar(
      datosDeFicha(camposPaciente, cliente).dni === DATOS_OK.dni,
      "el DNI que se imprimirá sale de la ficha, no de lo que llegue del navegador"
    );

    // Con la fecha ya en la ficha, la minoría de edad se sabe ANTES de firmar.
    const estadoAntesDeFirmar = await estado();
    esperar(
      estadoAntesDeFirmar.aplican.some((p) => p.key === "parental"),
      "y como la ficha dice que es menor, el consentimiento parental ya está previsto"
    );

    // Firma el contrato. Los datos ya no vienen del formulario: son los de la
    // ficha, que es lo que se imprimirá en el PDF.
    await ContractSignature.create({
      clientId: cliente.id,
      guardianId: cliente.id, // sin tutores en la ficha firma el titular
      templateKey: "paciente",
      templateVersion: plantilla.version,
      signerName: cliente.name,
      signerData: { ...datosDeFicha(camposPaciente, cliente), lugarFirma: "Barcelona", fechaFirma: "2026-08-04" },
      acceptances: todas.aceptaciones,
      signaturePath: `${SLUG}/signatures/${cliente.id}/smoke.png`,
      signedAt: new Date(),
    });

    const estado1 = await estado();
    esperar(estado1.siguiente?.key === "parental", "firmado el contrato, toca el consentimiento parental");
    esperar(estado1.completo === false, "y el contrato todavía NO está completo");
    esperar(
      String(estado1.siguiente?.secondSignatureLabel).includes("menor"),
      "el consentimiento trae la segunda firma opcional de la menor"
    );

    // En el parental, los datos de la MENOR salen ya rellenos de la ficha y los
    // del TUTOR se preguntan, porque son de otra persona.
    const vistoParental = serializarPlantilla(estado1.siguiente, cliente);
    const menorResuelto = vistoParental.fields.filter((f) => f.desdeFicha).map((f) => f.key);
    esperar(
      menorResuelto.includes("menorNombre") && menorResuelto.includes("menorFechaNacimiento"),
      "los datos de la menor vienen de su ficha"
    );
    esperar(
      !menorResuelto.includes("nombre") && !menorResuelto.includes("dni"),
      "los del tutor NO: es otra persona y hay que preguntárselos"
    );

    // ── El tutor entra en la ficha ───────────────────────────────────────────
    paso("El tutor que firma queda en la ficha de la menor");
    const camposParental = camposDe(estado1.siguiente);
    const datosTutor = {
      nombre: "Carmen Ruiz Soler",
      dni: "12345678Z",
      relacion: "Madre",
      domicilio: "Carrer de Mallorca 210, Barcelona",
      telefono: "600999888",
      email: "carmen.ruiz@example.com",
    };
    const tutor = tutorDeclarado(camposParental, cliente, datosTutor, crypto.randomUUID());
    esperar(tutor?.name === "Carmen Ruiz Soler" && tutor?.relationship === "madre", "se traduce a la forma de la ficha");
    esperar(
      tutor?.signer === false,
      "y NO como firmante: si no, cambiaría quién debe firmar y pediría de nuevo lo ya firmado"
    );

    await cliente.update({ guardians: [tutor] });
    await cliente.reload();
    esperar(cliente.guardians?.[0]?.dni === "12345678Z", "queda guardado en la ficha");
    esperar(
      tutorDeclarado(camposParental, cliente, datosTutor, crypto.randomUUID()) === null,
      "y firmar otra vez no lo duplica"
    );
    esperar(
      effectiveSigners(cliente)[0]?.titular === true,
      "quien debe firmar sigue siendo la titular, no el tutor recién añadido"
    );

    // El mismo firmante firma el SEGUNDO documento: es justo lo que el índice
    // único viejo (client_id, guardian_id) impedía.
    await ContractSignature.create({
      clientId: cliente.id,
      guardianId: cliente.id,
      templateKey: "parental",
      templateVersion: parental.version,
      signerName: datosTutor.nombre,
      signerData: datosTutor,
      acceptances: [{ id: "parental", title: "Consentimiento parental", acceptedAt: new Date().toISOString() }],
      signaturePath: `${SLUG}/signatures/${cliente.id}/smoke2.png`,
      signedAt: new Date(),
    });
    ok("el mismo firmante puede firmar los dos documentos");

    const estado2 = await estado();
    esperar(estado2.siguiente === null, "ya no queda nada por firmar");
    esperar(estado2.completo === true, "el contrato queda completo y el portal se abre");

    // Control: con fecha de ADULTA en la ficha, el parental no aparece.
    paso("Control: una adulta no ve el consentimiento parental");
    await ContractSignature.destroy({ where: { clientId: cliente.id } });
    await cliente.update({ birthDate: "1990-05-14" });
    await cliente.reload();
    await ContractSignature.create({
      clientId: cliente.id,
      guardianId: cliente.id,
      templateKey: "paciente",
      templateVersion: plantilla.version,
      signerName: cliente.name,
      signerData: datosDeFicha(camposPaciente, cliente),
      acceptances: todas.aceptaciones,
      signaturePath: `${SLUG}/signatures/${cliente.id}/smoke3.png`,
      signedAt: new Date(),
    });
    const estado3 = await estado();
    esperar(estado3.siguiente === null, "firmado el contrato, no se le pide nada más");
    esperar(estado3.completo === true, "su contrato está completo");
  } finally {
    if (cliente) {
      await ContractSignature.destroy({ where: { clientId: cliente.id } }).catch(() => {});
      await cliente.destroy().catch(() => {});
      process.stdout.write("\n  · ficha de prueba borrada\n");
    }
  }

  process.stdout.write(
    fallos === 0 ? "\n═══ ✓ Todo en orden ═══\n\n" : `\n═══ ✗ ${fallos} fallo(s) ═══\n\n`
  );
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
