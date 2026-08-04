/**
 * seed-contrato-tunutrilaura.js
 *
 * El clausulado de tunutrilaura en `contract_templates`: lo que las pacientes
 * de Laura leen y firman nada más entrar a su área privada.
 *
 * Dos documentos, tal cual los mandó ella (04/08/2026):
 *   - `paciente`  → Contrato de prestación de servicios + Anexos I, II y III.
 *                   Cada anexo con SU casilla: el contrato dice que «se firman
 *                   de forma independiente al documento principal».
 *   - `parental`  → Consentimiento del tutor legal. Solo sale si la fecha de
 *                   nacimiento declarada en el contrato dice que es menor.
 *
 * El texto va aquí y no en el código de la app a propósito: el módulo lo
 * comparten Aumenta y Laura, y cambiar una cláusula (la colaboradora del Anexo
 * II, un plazo) no puede exigir un despliegue.
 *
 * IDEMPOTENTE: reescribe las dos filas por `key`. Si se cambia el clausulado
 * hay que SUBIR `version` a mano —está al principio de cada plantilla—, porque
 * es lo que distingue lo que aceptó quien firmó antes de lo que acepta quien
 * firme después.
 *
 * Uso local:  node --env-file=.env.local scripts/seed-contrato-tunutrilaura.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/seed-contrato-tunutrilaura.js
 */

import { Sequelize } from "sequelize";

const SLUG = process.env.TENANT_SLUG || "nutri_laura";
const SCHEMA = `crm_${SLUG}`;
const PIE = "Tunutrilaura · tunutrilaura.com · info@tunutrilaura.com · Colegiada CAT2732";

// ── Contrato de prestación de servicios ──────────────────────────────────────

const CONTRATO = `PARTES

DE UNA PARTE, Laura Barbero Mora, mayor de edad, con DNI 49586690R, dietista-nutricionista colegiada en el Colegio de Dietistas-Nutricionistas de Cataluña (CoDiNuCat) con el número de colegiada CAT2732, con correo de contacto profesional info@tunutrilaura.com, que actúa en el ejercicio de su actividad profesional bajo la marca comercial "Tunutrilaura" (en adelante, "la Profesional").

DE OTRA PARTE, la persona cuyos datos se identifican en el apartado anterior (en adelante, "la Paciente").

Ambas partes, en la calidad en que intervienen, se reconocen mutuamente la capacidad legal necesaria para la firma del presente contrato, y

EXPONEN

I. Que la Profesional presta, bajo la marca Tunutrilaura, servicios profesionales de nutrición y dietética, entre ellos un programa de acompañamiento individual especializado en la recuperación de los Trastornos de la Conducta Alimentaria (TCA) y en la mejora de la relación con la comida y el cuerpo.

II. Que la Paciente ha solicitado voluntariamente dicho servicio, ha recibido información previa sobre su contenido, duración y honorarios, y ha procedido al pago correspondiente a través del sitio web tunutrilaura.com con carácter previo a la firma del presente documento.

III. Que ambas partes desean formalizar por escrito los términos y condiciones que regirán la prestación del servicio, así como recoger el consentimiento informado de la Paciente y la información relativa a la protección de sus datos personales, por lo que acuerdan suscribir el presente contrato con arreglo a las siguientes

CLÁUSULAS

1. Objeto del contrato

El presente contrato tiene por objeto regular la prestación, por parte de la Profesional a favor de la Paciente, del servicio de acompañamiento nutricional individual especializado en la recuperación de los TCA y en la relación con la comida y el cuerpo, conforme al programa, contenido y condiciones informados a la Paciente con carácter previo a la contratación.

2. Naturaleza sanitaria del servicio

2.1. El servicio prestado tiene naturaleza sanitaria en el ámbito de la nutrición y la dietética, y es realizado por profesional colegiada, de conformidad con la normativa vigente y el Código Deontológico de la profesión.

2.2. El servicio no sustituye la atención médica, psiquiátrica o psicológica que la Paciente pudiera requerir. Cuando la Profesional lo considere necesario, podrá recomendar o derivar a la Paciente a otros profesionales sanitarios (médicos, psicólogos, psiquiatras), pudiendo condicionar la continuidad del acompañamiento a dicha valoración cuando así lo exija la seguridad de la Paciente.

2.3. La Paciente se compromete a informar a la Profesional, de forma veraz y completa, sobre su historial médico y psicológico relevante, tratamientos en curso, medicación, diagnósticos previos y cualquier otra circunstancia que pueda afectar al desarrollo del servicio.

3. Consentimiento informado

3.1. La Paciente declara haber sido informada, de forma clara y comprensible, sobre:

• El contenido, los objetivos y la metodología del acompañamiento.
• La naturaleza progresiva y no lineal del proceso de recuperación, pudiendo experimentar, especialmente en las primeras semanas, un incremento temporal del malestar emocional como parte propia del proceso terapéutico.
• La posibilidad de derivación a otros profesionales sanitarios cuando se considere necesario.
• Que los resultados del proceso dependen, en gran medida, de la implicación activa y la comunicación honesta de la Paciente, por lo que la Profesional no puede garantizar resultados concretos ni plazos determinados de recuperación.

3.2. La Paciente presta su consentimiento libre, voluntario e informado para la realización del servicio descrito, pudiendo revocarlo en cualquier momento mediante comunicación a la Profesional, sin que ello genere derecho a devolución de las sesiones ya prestadas.

4. Descripción del servicio contratado

El acompañamiento incluye, con carácter general, los siguientes elementos, que se detallan y adaptan a cada caso en la información remitida a la Paciente antes de la contratación:

• Sesiones individuales 1:1 de seguimiento, con la periodicidad y duración informadas en el programa contratado.
• Acompañamiento por WhatsApp durante la vigencia del programa, para dudas y seguimiento entre sesiones.
• Materiales de apoyo personalizados (audios, vídeos, lecturas y ejercicios).
• Pautas alimentarias personalizadas y hoja de ruta adaptada al momento de cada persona.
• Respaldo profesional de psicólogas especializadas, mediante derivación o consulta, cuando el proceso lo requiera.
• Coordinación con familiares o personas de confianza del entorno de la Paciente, cuando se considere necesario.

5. Comunicación entre sesiones

5.1. El canal de WhatsApp incluido en el acompañamiento tiene como finalidad dar apoyo y contención en el día a día de la Paciente, y forma parte del servicio contratado.

5.2. Dicho canal no constituye un servicio de urgencias ni de atención continuada 24 horas, y no debe emplearse para comunicar situaciones de riesgo vital o urgencia médica o psicológica. En tales casos, la Paciente se compromete a contactar con los servicios de emergencia (112) o con el recurso sanitario que corresponda.

5.3. La Profesional (o la profesional colaboradora asignada) atenderá dicho canal dentro de un plazo razonable, de lunes a viernes, sin que ello implique disponibilidad inmediata o permanente.

6. Honorarios y forma de pago

6.1. El importe del servicio contratado ha sido abonado por la Paciente con carácter previo a la firma del presente contrato, a través de la pasarela de pago del sitio web tunutrilaura.com, conforme a las condiciones allí informadas.

6.2. La verificación del pago y la firma del presente contrato son requisito previo al inicio del servicio.

6.3. Las condiciones de cancelación y reembolso son las informadas a la Paciente en el sitio web en el momento de la contratación, y quedan incorporadas al presente contrato por referencia.

7. Cancelación y reprogramación de sesiones

7.1. La Paciente podrá solicitar la cancelación o el cambio de una sesión con al menos 24 horas de antelación, sin coste adicional.

7.2. Las cancelaciones comunicadas con menos de 24 horas de antelación, o la inasistencia sin previo aviso, podrán computar como sesión realizada, salvo causa justificada valorada por la Profesional.

8. Confidencialidad y secreto profesional

8.1. La Profesional guardará el más absoluto secreto profesional respecto de toda la información facilitada por la Paciente, de conformidad con el Código Deontológico del Colegio de Dietistas-Nutricionistas y la normativa de protección de datos vigente.

8.2. Dicha información únicamente podrá ser compartida con terceros (profesional colaboradora asignada, psicólogas de referencia) cuando resulte necesario para la correcta prestación del servicio, quedando dichos terceros sujetos al mismo deber de confidencialidad, o cuando exista obligación legal de comunicarlo.

9. Protección de datos personales

9.1. Responsable del tratamiento: Laura Barbero Mora (Tunutrilaura), DNI 49586690R, correo de contacto info@tunutrilaura.com.

9.2. Finalidad: gestión de la relación contractual y prestación del servicio de acompañamiento nutricional, incluyendo el tratamiento de datos relativos a la salud de la Paciente, estrictamente necesarios para dicha finalidad.

9.3. Base legal: el consentimiento explícito de la Paciente (artículo 9.2.a del Reglamento (UE) 2016/679, RGPD, al tratarse de datos de categoría especial relativos a la salud) y la ejecución del presente contrato.

9.4. Conservación: los datos se conservarán durante la vigencia del servicio y, posteriormente, durante los plazos legalmente exigidos por la normativa fiscal, mercantil y de responsabilidad profesional aplicable.

9.5. Destinatarios: no se cederán datos a terceros salvo obligación legal o cuando resulte necesario para la prestación del servicio (profesional colaboradora asignada, psicóloga de referencia), y a los encargados del tratamiento necesarios para la actividad (herramientas de gestión, mensajería y almacenamiento en la nube), con los que se mantienen los correspondientes contratos de encargo de tratamiento conforme al artículo 28 RGPD.

9.6. Derechos: la Paciente podrá ejercer en cualquier momento sus derechos de acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad, dirigiéndose a info@tunutrilaura.com, así como presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD, www.aepd.es) si lo considera oportuno.

9.7. La Paciente presta su consentimiento expreso para el tratamiento de sus datos de salud con la finalidad descrita en la presente cláusula, pudiendo revocarlo en cualquier momento, sin efectos retroactivos.

10. Responsabilidad civil profesional

10.1. La Profesional se encuentra al corriente en el seguro de responsabilidad civil profesional suscrito colectivamente a través del Colegio de Dietistas-Nutricionistas de Cataluña (CoDiNuCat), vigente durante toda la prestación del servicio.

10.2. La responsabilidad de la Profesional queda limitada a la correcta praxis profesional conforme a los estándares de la profesión, sin que pueda garantizarse un resultado concreto, dado que este depende de múltiples factores ajenos a su control, incluida la evolución clínica individual y el grado de implicación de la Paciente en el proceso.

11. Derivación a otros profesionales

En caso de detectarse indicios de riesgo para la salud física o mental de la Paciente que excedan el ámbito de actuación de la nutrición (por ejemplo, riesgo de autolesión, ideación suicida o inestabilidad clínica grave), la Profesional podrá recomendar, o exigir como condición para la continuidad del acompañamiento, la valoración o intervención de un profesional médico o de salud mental, pudiendo suspender el servicio si la Paciente no sigue dicha recomendación y ello comprometiera su seguridad.

12. Duración y resolución del contrato

12.1. El presente contrato tendrá la duración correspondiente al programa de acompañamiento contratado por la Paciente.

12.2. Cualquiera de las partes podrá resolver el presente contrato de forma anticipada mediante comunicación por escrito, sin que ello genere derecho a la devolución de los importes correspondientes a las sesiones ya realizadas o a la parte proporcional del servicio ya prestado, salvo lo que resulte de aplicación conforme a la normativa de consumidores.

12.3. La Paciente, en su condición de consumidora, dispone de un derecho legal de desistimiento de 14 días naturales, cuyo alcance y consecuencias se detallan en el Anexo I del presente contrato, que la Paciente firma de forma independiente.

13. Declaración final y aceptación

La Paciente declara haber leído y comprendido íntegramente el presente contrato, incluida la información relativa al consentimiento informado y a la protección de datos personales, y presta su conformidad firmando el presente documento en prueba de aceptación.`;

const ANEXO_I = `INFORMACIÓN SOBRE EL DERECHO DE DESISTIMIENTO Y SOLICITUD EXPRESA DE INICIO INMEDIATO DEL SERVICIO

Este Anexo forma parte inseparable del Contrato de prestación de servicios de nutrición y consentimiento informado suscrito entre Laura Barbero Mora (Tunutrilaura) y la Paciente, y se firma de forma independiente al documento principal.

1. Derecho legal de desistimiento

De conformidad con los artículos 102 y siguientes del Real Decreto Legislativo 1/2007, por el que se aprueba el Texto Refundido de la Ley General para la Defensa de los Consumidores y Usuarios (TRLGDCU), la Paciente, en su condición de consumidora, dispone de un plazo de 14 días naturales desde la firma del presente contrato para desistir del mismo sin necesidad de justificar su decisión.

2. Solicitud expresa de inicio inmediato del servicio

La Paciente solicita expresamente que la prestación del servicio de acompañamiento nutricional comience de forma inmediata, antes de que finalice el citado plazo de 14 días naturales, siendo conocedora de que ello afecta a las consecuencias económicas de un eventual desistimiento, tal y como se describe en el apartado siguiente.

3. Consecuencias económicas del desistimiento

La Paciente conoce y acepta expresamente que, al haber solicitado que el servicio comience de forma inmediata, en caso de ejercer su derecho de desistimiento no procederá devolución alguna del importe abonado, con independencia del momento en que se ejerza dicho derecho dentro del plazo de 14 días naturales.

Ambas partes reconocen y aceptan que el acompañamiento incluye, desde el primer momento de su inicio, la valoración inicial de la Paciente, la elaboración de pautas personalizadas y la entrega de materiales y recursos adaptados a su caso, de manera que la Paciente recibe tratamiento y atención profesional desde la primera sesión, lo que justifica que no se devuelva ninguna cantidad satisfecha.

4. Declaración de la Paciente

La Paciente declara haber sido informada de forma clara, previa y expresa del contenido de este Anexo, comprende sus términos, y presta su consentimiento firmándolo de forma independiente al contrato principal.`;

const ANEXO_II = `DERIVACIÓN A NUTRICIONISTA COLABORADORA DE TUNUTRILAURA: AUTORIZACIÓN DE LA PACIENTE

Este Anexo forma parte inseparable del Contrato de prestación de servicios de nutrición y consentimiento informado suscrito entre Laura Barbero Mora (Tunutrilaura) y la Paciente, y se firma de forma independiente al documento principal.

1. Objeto de la derivación

La Paciente es informada de que el acompañamiento contratado puede ser prestado, en todo o en parte, por una nutricionista colaboradora de Tunutrilaura (en adelante, "la Colaboradora"), distinta de Laura Barbero Mora, que actúa bajo la supervisión de esta última y conforme a la misma metodología y enfoque de trabajo del presente contrato.

2. Autorización expresa de la Paciente

La Paciente autoriza expresamente que su caso sea derivado a la Colaboradora asignada por Tunutrilaura, así como que se le facilite a dicha Colaboradora la información necesaria (historia dietética, antecedentes relevantes, evolución, pautas y materiales) para la correcta prestación del acompañamiento.

3. Colaboradora asignada

Nombre y apellidos: Rocío Jiménez César
Nº de colegiada: AND01120

4. Confidencialidad y supervisión

La Colaboradora queda sujeta al mismo deber de confidencialidad y secreto profesional recogido en el presente contrato y a la normativa de protección de datos aplicable. Laura Barbero Mora supervisa el proceso y permanece como referencia última del acompañamiento, sin perjuicio de que el contacto habitual durante el programa se realice con la Colaboradora.

5. Revocación

La Paciente podrá solicitar en cualquier momento el cambio de Colaboradora asignada o retomar el contacto directo con Laura Barbero Mora, comunicándolo por los canales habituales, sin que ello afecte a la validez de las actuaciones ya realizadas.

6. Declaración de la Paciente

La Paciente declara haber sido informada de forma clara, previa y expresa del contenido de este Anexo, comprende sus términos, y presta su consentimiento firmándolo de forma independiente al contrato principal.`;

const ANEXO_III = `INFORMACIÓN SOBRE PROTECCIÓN DE DATOS PERSONALES

Este Anexo forma parte inseparable del Contrato de prestación de servicios de nutrición y consentimiento informado suscrito entre Laura Barbero Mora (Tunutrilaura) y la Paciente, y se firma de forma independiente al documento principal. Su contenido es conforme a la política de privacidad publicada en www.tunutrilaura.com/politica-de-privacidad, que se mantiene actualizada.

1. Responsable del tratamiento

Laura Barbero Mora, NIF 49586690R, correo de contacto info@tunutrilaura.com. No es obligatorio designar Delegado de Protección de Datos, al tratarse de una profesional sanitaria individual y no de un tratamiento a gran escala.

2. Finalidad y base jurídica del tratamiento

a) Prestación del servicio de nutrición: tratamiento de la historia dietética, antecedentes relevantes, evolución, pautas y planes nutricionales, con la finalidad de prestar asistencia nutricional y llevar el seguimiento de la Paciente. Base jurídica: ejecución del contrato de servicios (art. 6.1.b RGPD) y, para los datos de salud, la asistencia sanitaria prestada por profesional sujeta a secreto profesional (art. 9.2.h RGPD, en relación con la Ley 41/2002 de autonomía del paciente).

b) Facturación y obligaciones legales: emisión de facturas y cumplimiento de obligaciones fiscales y contables. Base jurídica: cumplimiento de una obligación legal (art. 6.1.c RGPD).

c) Comunicaciones: envío de información sobre citas y planes, y, si la Paciente lo autoriza expresamente, contenidos o formaciones. Base jurídica: ejecución del contrato para lo asistencial, y consentimiento para lo divulgativo, revocable en cualquier momento.

3. Plazo de conservación

La historia clínica se conservará, como mínimo, cinco años desde el alta del proceso asistencial (art. 17 de la Ley 41/2002) y, en Cataluña, conforme a los plazos de la Llei 21/2000, de 29 de desembre. Las facturas y la documentación contable se conservarán durante los plazos fiscales y mercantiles aplicables (con carácter general, entre 4 y 6 años).

4. Destinatarios y encargados del tratamiento

Los datos de la Paciente no se ceden ni venden a terceros para su uso propio. Se comparten únicamente con proveedores tecnológicos que actúan como encargados del tratamiento, conforme al artículo 28 RGPD: Hostinger International Ltd. (alojamiento del sitio web y del correo, con servidores en la Unión Europea) y Salamandra Solutions (sistema de gestión de la consulta/CRM, con servidores en la Unión Europea). Los datos podrán comunicarse también a la Administración tributaria y a otros organismos públicos cuando exista obligación legal de hacerlo.

5. Transferencias internacionales

Con carácter general, los datos de la Paciente no salen del Espacio Económico Europeo. Si en algún momento fuera necesario recurrir a un proveedor fuera de la UE, se haría con las garantías previstas en el capítulo V del RGPD.

6. Derechos de la Paciente

La Paciente puede ejercer en cualquier momento, y de forma gratuita, sus derechos de acceso, rectificación, supresión (con los límites que impone la normativa sanitaria sobre la historia clínica), oposición, limitación del tratamiento, portabilidad y retirada del consentimiento, escribiendo a info@tunutrilaura.com junto con una copia de su documento de identidad. La Profesional responderá en el plazo máximo de un mes. La Paciente puede además presentar una reclamación ante la Agencia Española de Protección de Datos (aepd.es).

7. Seguridad

La Profesional aplica medidas técnicas y organizativas razonables para proteger los datos de la Paciente: conexión cifrada (HTTPS), acceso al sistema de gestión mediante credenciales personales, y limitación del acceso a la información clínica a quien la necesita para prestar el servicio.

8. Declaración y consentimiento

La Paciente declara haber leído y comprendido la presente información, y presta su consentimiento expreso para el tratamiento de sus datos personales, incluidos los relativos a su salud, con las finalidades descritas en este Anexo, firmándolo de forma independiente al contrato principal.`;

// ── Consentimiento parental ──────────────────────────────────────────────────

const PARENTAL = `CONSENTIMIENTO PARENTAL Y AUTORIZACIÓN DEL TUTOR O TUTORA LEGAL

Para la incorporación de personas menores de edad al programa de acompañamiento individual — Tunutrilaura

Este documento se firma de forma independiente y adicional al Contrato de prestación de servicios de nutrición y consentimiento informado y a sus Anexos I, II y III, cuando la persona destinataria del acompañamiento sea menor de edad. Debe ser firmado por quien ostente la patria potestad o la guarda legal de la persona menor.

3. Objeto

El tutor o tutora legal declara conocer que la persona menor identificada en el apartado anterior va a recibir el servicio de acompañamiento nutricional individual prestado por Laura Barbero Mora, bajo la marca Tunutrilaura, especializado en la relación con la comida, el cuerpo y, en su caso, los Trastornos de la Conducta Alimentaria (TCA), conforme al Contrato de prestación de servicios de nutrición y consentimiento informado y a sus Anexos I, II y III, cuyo contenido declara haber leído y comprendido con carácter previo a la firma del presente documento.

4. Autorización y consentimiento

4.1. En su calidad de tutor o tutora legal, con patria potestad o guarda legal sobre la persona menor, el/la firmante autoriza expresamente su participación en el programa de acompañamiento descrito.

4.2. El tutor o tutora declara conocer que el servicio no sustituye la atención médica, psicológica o psiquiátrica que la persona menor pudiera requerir, y que, dada la naturaleza de la problemática abordada, puede resultar necesaria la coordinación con el pediatra o médico de referencia de la persona menor y, en su caso, con un profesional de la salud mental, pudiendo la Profesional condicionar la continuidad del acompañamiento a dicha coordinación cuando así lo exija la seguridad de la persona menor.

4.3. El tutor o tutora autoriza el canal de comunicación de seguimiento por WhatsApp incluido en el servicio, ya sea con el propio tutor o tutora, con la persona menor, o con ambos, según se acuerde conjuntamente con la Profesional.

4.4. El tutor o tutora autoriza que, cuando la Profesional lo considere oportuno, el caso sea derivado o compartido con la nutricionista colaboradora de Tunutrilaura, en los términos previstos en el Anexo II, así como con otros profesionales sanitarios cuando resulte necesario para la seguridad de la persona menor.

5. Protección de los datos de la persona menor

El tutor o tutora, en representación legal de la persona menor, presta su consentimiento para el tratamiento de los datos personales de esta, incluidos los relativos a su salud, en los términos informados en el Anexo III del Contrato, siendo consciente de que dicho tratamiento no puede sustentarse en el consentimiento de la propia persona menor mientras no alcance la mayoría de edad.

6. Confidencialidad y participación de la persona menor

La Profesional podrá, en función de la edad y madurez de la persona menor, mantener con ella un espacio de conversación con un grado razonable de confidencialidad propio de la relación terapéutica, sin perjuicio del deber de informar al tutor o tutora legal cuando exista un riesgo relevante para la salud o la seguridad de la persona menor.

7. Declaración

El tutor o tutora legal declara que la información facilitada en este documento es veraz, que ostenta la representación legal de la persona menor identificada, y que ha sido informado/a de forma clara y comprensible del contenido del presente consentimiento, prestando su conformidad mediante su firma.`;

// ── Las dos plantillas ───────────────────────────────────────────────────────

const PLANTILLAS = [
  {
    key: "paciente",
    title: "Contrato de prestación de servicios de nutrición y consentimiento informado",
    intro:
      "Puedes leer el contrato y cada anexo desplegándolos aquí mismo antes de aceptarlos. Al firmar te dejamos una copia en PDF en «Mis documentos».",
    version: 1,
    onlyMinors: false,
    secondSignatureLabel: null,
    footer: PIE,
    // `ficha` dice DÓNDE vive cada dato en el CRM. Los que la llevan se piden
    // ANTES de firmar («Completa tus datos») y se guardan en la ficha de la
    // paciente; al firmar ya no se preguntan, se enseñan. Sin `ficha` = son del
    // acto de firmar, no de la persona.
    fields: [
      { key: "nombre", label: "Nombre y apellidos", type: "text", required: true, ficha: "cliente.name" },
      { key: "dni", label: "DNI / NIE", type: "dni", required: true, ficha: "cliente.taxId" },
      {
        key: "domicilio",
        label: "Domicilio",
        type: "text",
        required: true,
        ficha: "cliente.customFields.domicilio",
      },
      { key: "email", label: "Correo electrónico", type: "email", required: true, ficha: "cliente.email" },
      { key: "telefono", label: "Teléfono", type: "tel", required: true, ficha: "cliente.phone" },
      {
        key: "fechaNacimiento",
        label: "Fecha de nacimiento",
        type: "date",
        required: true,
        // La que decide si además hace falta el consentimiento del tutor legal.
        ficha: "cliente.birthDate",
      },
      {
        key: "lugarFirma",
        label: "¿Desde qué localidad firmas?",
        type: "text",
        required: true,
        group: "Lugar y fecha de la firma",
        placeholder: "Ej. Barcelona",
      },
      {
        key: "fechaFirma",
        label: "Fecha de la firma",
        type: "date",
        required: true,
        group: "Lugar y fecha de la firma",
      },
    ],
    blocks: [
      {
        id: "contrato",
        title: "Contrato de prestación de servicios de nutrición y consentimiento informado",
        body: CONTRATO,
        acceptLabel: "He leído y acepto el Contrato de prestación de servicios de nutrición y consentimiento informado.",
        required: true,
      },
      {
        id: "anexo1",
        title: "Anexo I · Derecho de desistimiento",
        body: ANEXO_I,
        acceptLabel:
          "He leído y acepto el Anexo I (derecho de desistimiento de 14 días naturales, sin devolución del importe abonado por haber solicitado el inicio inmediato del servicio).",
        required: true,
      },
      {
        id: "anexo2",
        title: "Anexo II · Derivación a nutricionista colaboradora",
        body: ANEXO_II,
        acceptLabel:
          "He leído y acepto el Anexo II (autorizo la derivación de mi caso a la nutricionista colaboradora de Tunutrilaura que se me asigne).",
        required: true,
      },
      {
        id: "anexo3",
        title: "Anexo III · Protección de datos personales",
        body: ANEXO_III,
        acceptLabel: "He leído y acepto el Anexo III (información sobre protección de datos personales).",
        required: true,
      },
    ],
  },
  {
    key: "parental",
    title: "Consentimiento parental y autorización del tutor o tutora legal",
    intro:
      "La fecha de nacimiento que has indicado corresponde a una persona menor de edad, así que necesitamos también la autorización de quien tenga su patria potestad o guarda legal.",
    version: 1,
    onlyMinors: true,
    secondSignatureLabel: "Asentimiento de la persona menor (opcional, según edad y madurez)",
    footer: PIE,
    // Los datos del TUTOR no están en la ficha (es otra persona): se piden aquí
    // y al firmar entran como tutor de la ficha de la menor. Los de la MENOR sí
    // están —es la propia paciente—, así que se enseñan ya rellenos.
    fields: [
      {
        key: "nombre",
        label: "Nombre y apellidos",
        type: "text",
        required: true,
        group: "Identificación del tutor o tutora legal",
        ficha: "tutor.name",
      },
      {
        key: "dni",
        label: "DNI / NIE",
        type: "dni",
        required: true,
        group: "Identificación del tutor o tutora legal",
        ficha: "tutor.dni",
      },
      {
        key: "relacion",
        label: "Relación con la persona menor",
        type: "select",
        required: true,
        options: ["Padre", "Madre", "Tutor/a legal"],
        group: "Identificación del tutor o tutora legal",
        ficha: "tutor.relationship",
      },
      {
        key: "domicilio",
        label: "Domicilio",
        type: "text",
        required: true,
        group: "Identificación del tutor o tutora legal",
        ficha: "tutor.domicilio",
      },
      {
        key: "telefono",
        label: "Teléfono",
        type: "tel",
        required: true,
        group: "Identificación del tutor o tutora legal",
        ficha: "tutor.phone",
      },
      {
        key: "email",
        label: "Correo electrónico",
        type: "email",
        required: true,
        group: "Identificación del tutor o tutora legal",
        ficha: "tutor.email",
      },

      {
        key: "menorNombre",
        label: "Nombre y apellidos",
        type: "text",
        required: true,
        group: "Identificación de la persona menor de edad",
        ficha: "cliente.name",
      },
      {
        key: "menorFechaNacimiento",
        label: "Fecha de nacimiento",
        type: "date",
        required: true,
        group: "Identificación de la persona menor de edad",
        ficha: "cliente.birthDate",
      },
      {
        key: "menorDni",
        label: "DNI / NIE",
        type: "dni",
        required: false,
        help: "Solo si dispone de él.",
        group: "Identificación de la persona menor de edad",
        ficha: "cliente.taxId",
      },

      {
        key: "lugarFirma",
        label: "¿Desde qué localidad firmas?",
        type: "text",
        required: true,
        group: "Lugar y fecha de la firma",
        placeholder: "Ej. Barcelona",
      },
      { key: "fechaFirma", label: "Fecha de la firma", type: "date", required: true, group: "Lugar y fecha de la firma" },
    ],
    blocks: [
      {
        id: "parental",
        title: "Consentimiento parental y autorización del tutor o tutora legal",
        body: PARENTAL,
        acceptLabel:
          "He leído y acepto el consentimiento parental, y declaro que ostento la patria potestad o la guarda legal de la persona menor identificada.",
        required: true,
      },
    ],
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(` Clausulado de tunutrilaura → ${SCHEMA}\n`);
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  const [[existe]] = await s.query(
    `SELECT 1 AS ok FROM information_schema.tables
      WHERE table_schema = :schema AND table_name = 'contract_templates'`,
    { replacements: { schema: SCHEMA } }
  );
  if (!existe) {
    console.error(`  ✗ ${SCHEMA} no tiene 'contract_templates'.`);
    console.error("    Lanza antes: node scripts/migrate-contrato-estructurado.js\n");
    await s.close();
    process.exit(1);
  }

  for (const p of PLANTILLAS) {
    await s.query(
      `INSERT INTO "${SCHEMA}"."contract_templates"
         (id, key, title, intro, fields, blocks, footer, only_minors, second_signature_label, active, version, created_at, updated_at)
       VALUES
         (gen_random_uuid(), :key, :title, :intro, :fields::jsonb, :blocks::jsonb, :footer, :onlyMinors, :second, true, :version, now(), now())
       ON CONFLICT (key) DO UPDATE SET
         title                  = EXCLUDED.title,
         intro                  = EXCLUDED.intro,
         fields                 = EXCLUDED.fields,
         blocks                 = EXCLUDED.blocks,
         footer                 = EXCLUDED.footer,
         only_minors            = EXCLUDED.only_minors,
         second_signature_label = EXCLUDED.second_signature_label,
         active                 = true,
         version                = EXCLUDED.version,
         updated_at             = now()`,
      {
        replacements: {
          key: p.key,
          title: p.title,
          intro: p.intro,
          fields: JSON.stringify(p.fields),
          blocks: JSON.stringify(p.blocks),
          footer: p.footer,
          onlyMinors: p.onlyMinors,
          second: p.secondSignatureLabel,
          version: p.version,
        },
      }
    );
    process.stdout.write(
      `  ✓ ${p.key}: ${p.fields.length} campos, ${p.blocks.length} documento(s) a aceptar (v${p.version})\n`
    );
  }

  process.stdout.write("\n══════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Clausulado cargado\n");
  process.stdout.write("══════════════════════════════════════════════════\n\n");

  await s.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack || err.message}\n`);
  process.exit(1);
});
