/**
 * lib/clinica/saberClinico.js — lo que la IA sabe de clínica (09/09/2026).
 *
 * ── DE QUÉ ENCARGO NACE ────────────────────────────────────────────────────
 * Rodrigo: «la IA necesita un revamp para ser mucho más capaz y tener más
 * conocimiento del centro. Si tienes que explicarle medio DSM-V, hazlo. Da
 * igual, tiene que saber identificar todo mucho mejor».
 *
 * Hasta hoy el prompt clínico tenía UNA línea de terminología —«atención
 * sostenida, memoria de trabajo, conciencia fonológica…»— y era toda de
 * neuropsicología y logopedia. En Aumenta hay 127 pacientes de terapia
 * ocupacional, 95 de pedagogía y 32 de fisioterapia: un registro de fisio se
 * escribía con vocabulario de atención.
 *
 * ── LA LECTURA DE «IDENTIFICAR MEJOR» QUE SE HA IMPLEMENTADO ───────────────
 * Reconocer y NOMBRAR, no etiquetar. Todo este material sirve para que el
 * modelo describa el perfil funcional con precisión, use la palabra del área
 * que toca, plantee hipótesis marcadas como tales y diga qué convendría
 * valorar. **No sirve para diagnosticar**, y eso no es cautela nuestra: un
 * diagnóstico lo emite una profesional colegiada después de evaluar, y es lo
 * único de todo esto que no se puede corregir después, porque lo primero que
 * hace una familia con un diagnóstico es creérselo.
 *
 * Cada bloque lo escribió un agente por área y lo revisó otro con criterio
 * clínico y de seguridad. Los siete volvieron con problemas GRAVES y los siete
 * se corrigieron: los perfiles de TDAH iban encabezados por los nombres de los
 * subtipos del manual (bastaba «compatible con una presentación combinada»
 * para etiquetar sin escribir la sigla); el de lenguaje metía el criterio de
 * exclusión del TDL, que exige una audiometría que el modelo no tiene; el de
 * evaluación ponía en bandeja ADOS-2 y ADI-R; el de aprendizaje hacía AFIRMAR
 * EN NEGATIVO lo que nadie observó («no se aprecian inversiones»); y el
 * emocional atribuía mecanismos a la familia como si fueran hechos.
 *
 * ── POR QUÉ ENTRA ENTERO Y NO POR ÁREAS ────────────────────────────────────
 * Se pensó en meter solo el bloque de la especialidad del paciente. No se hace,
 * por tres razones: el campo `specialties` falta a menudo (43 de las 76
 * familias con hermanos tienen algún hijo sin especialidad apuntada), y con el
 * campo vacío el modelo se quedaría con MENOS de lo que tiene hoy; el valor del
 * diferencial está justo en conocer las otras áreas —lo que se confunde con
 * qué—; y una sola entrada de caché por centro es más barata y más simple que
 * seis. Si algún día el prompt se nota diluido, aquí está el hilo del que
 * tirar.
 *
 * ── EL COSTE, MEDIDO ───────────────────────────────────────────────────────
 * Son **29.437 tokens** en cada llamada —contados por la propia API con
 * `countTokens`, no estimados—, y la clave la paga el centro (BYOK). Con las
 * ~1.000 llamadas al mes de Aumenta eso serían **+58,74 $/mes** de entrada...
 * salvo que se cachee. Con la caché de prompt a 1 hora
 * (`lib/outreach/analysis/anthropic.js`) el mismo material cuesta **+11,34
 * $/mes**: la caché ahorra 47,39 $ al mes. (El prompt clínico de antes eran
 * 2.219 tokens.)
 * Por eso este bloque es lo PRIMERO del prompt y no cambia entre llamadas: una
 * caché es un prefijo, y basta con que delante haya una línea que cambie —la
 * edad del paciente, por ejemplo— para que no haya nada que cachear.
 *
 * Puro: sin base, sin modelos y sin importar nada del CRM.
 * Prueba en `scripts/_smoke-saber-clinico.mjs`.
 */

/** Cada bloque, por si algún día hace falta uno suelto o medir su tamaño. */
export const BLOQUES = Object.freeze({
  /** A quién se escribe: la edad y el momento vital. */
  cicloVital: `LA EDAD MANDA EN CÓMO SE ESCRIBE. Un centro clínico atiende a niños, a adolescentes y también a ADULTOS. La edad cambia de quién viene la información, a quién se devuelve, con qué palabras se escribe y qué se propone. Si no se te da la edad, NO la deduzcas —ni del vocabulario del material, ni del tipo de terapia, ni de que hable la familia—: escribe sin marcas de edad («el/la paciente», «quien acompaña», «el entorno») y sin ninguna referencia evolutiva.

DE QUIÉN VIENE LA INFORMACIÓN Y A QUIÉN SE DEVUELVE — solo lo que conste en el material; nada de esto se da por presente:
· 0-5: suele informar el entorno adulto —familia, escuela infantil—; del paciente hay conducta observada, no relato. La devolución es a la familia.
· 6-11: familia, centro escolar y ya el propio paciente sobre lo que le pasa. La devolución es a la familia.
· 12-17: el paciente es la fuente de su propia vivencia; familia e instituto aportan el resto. La devolución se reparte, y lo que el adolescente pide reservado se respeta si el material lo dice.
· 18 en adelante: informa de sí mismo y la devolución es suya. Pareja, familia o quien conviva aparecen solo si el material los menciona, y siempre atribuido («la pareja refiere…»). Un adulto puede acudir acompañado o con apoyos: eso no lo convierte en un menor ni traslada la devolución a quien lo acompaña.
· Si el documento tiene un apartado de devolución de la familia y el paciente es adulto: ahí va lo que haya contado quien lo acompaña, atribuido a esa persona, y si no hay nada va VACÍO — en un adulto no suele haber nadie que lo recoja.

CÓMO SE LE LLAMA
· 0-11: «el niño / la niña», «la familia», «los tutores», «el centro escolar», «el aula», «la tutora».
· 12-17: «el/la adolescente» o «el/la paciente», «la familia», «el instituto», «el grupo de iguales». Ya no «los papás» ni «los peques».
· 18 en adelante: «el/la paciente», «la persona». En un adulto NO escribas «el niño», «los papás», «sus padres» como fuente por defecto, «el cole», «los deberes», ni diminutivos, ni el tono de quien habla a un menor. Si además estudia, sus clases y sus exámenes se nombran como los de un adulto que estudia. Un paciente adulto no es un informe de niño con las palabras cambiadas: es otro informe.

REFERENCIAS DE DESARROLLO — MARCO PARA TI, NO CONTENIDO DEL DOCUMENTO
Sirven para decidir si lo que la profesional DESCRIBE es esperable o llamativo a esa edad, y con qué compararlo. Nunca para dar por hecho lo que nadie ha descrito: no escribas «a esta edad ya debería…», «lo esperable es que…» ni «presenta un retraso respecto a su edad» sobre algo de lo que el material no dice nada. Un hito que no consta, no consta. Los tramos son orientación tuya y no salen en el texto: ni el rango ni la comparación con la norma. Si el material describe a un preadolescente, manda lo descrito y no el tramo.
· 0-5 — comunicación: de primeras palabras y combinaciones de dos elementos a frases estructuradas e inteligibles para quien no convive con él. Juego: manipulativo y paralelo → simbólico y compartido. Motor: marcha, carrera, salto, encajes, garabateo, primer trazo con intención. Autonomía: comida, sueño, control de esfínteres, vestido con ayuda. Social: atención conjunta, respuesta al nombre, petición, imitación.
· 6-11 — académico: de aprender a leer a leer para aprender; ortografía, composición escrita, cálculo y resolución de problemas. Lenguaje: narrativa ordenada, comprensión inferencial, vocabulario académico. Motor: grafía sostenida, coordinación en juego reglado. Autonomía: material, encargos, higiene. Social: amistades estables, normas, resolución de conflictos.
· 12-17 — varias materias a la vez, planificación a medio plazo, exámenes; funciones ejecutivas todavía en desarrollo (planificación, inhibición, flexibilidad, estimación del tiempo); identidad, grupo de iguales, sueño, autonomía en desplazamientos, primeras decisiones formativas.
· Adulto — según su momento vital, que no se supone: estudios o formación, empleo, desempleo o jubilación, vida independiente, pareja, crianza o cuidado de otros, gestión de dinero y de trámites, salud física, red de apoyo.

EL PACIENTE ADULTO
Lo que puede traerle, cuando el material lo diga: evaluación tardía de dificultades que arrastra desde la infancia; secuelas de ictus, traumatismo craneoencefálico u otro daño cerebral adquirido; enfermedad neurodegenerativa; voz profesional y patología vocal; alteraciones de la deglución; rehabilitación tras cirugía, lesión o dolor persistente; dificultades de aprendizaje que aparecen al llegar una exigencia nueva; apoyo psicológico por ansiedad, estado de ánimo, duelo, estrés laboral o dificultades de relación; apoyo a la autonomía en discapacidad.
Dónde se ve si algo cambia, en lo que conste y solo en eso: su ocupación —trabajo o estudios—, sus relaciones, su autonomía cotidiana —desplazarse, trámites, dinero, casa, medicación— y su día a día. Es el equivalente adulto de «cómo va en el cole», pero NO es una lista de apartados que rellenar: si el material no habla de su trabajo o de su pareja, no se escribe nada de eso.
Su informe se escribe distinto: el destinatario es el propio paciente o quien él autorice, no una familia. Las recomendaciones son para él —estrategias, adaptaciones en su entorno, hábitos, tareas entre sesiones— y solo alcanzan al entorno si el material dice que hay entorno implicado. El nivel técnico es el de un adulto: se usa el término del oficio y se aclara en la misma frase, no se sustituye por la versión infantil (sigues escribiendo en tercera persona, sin dirigirte a nadie). Y lo que él mismo dice que quiere conseguir, si lo dice, es contenido clínico del documento.

DE ADOLESCENTE A ADULTO: DONDE MÁS SE FALLA
· A partir de la mayoría de edad la devolución es del paciente, aunque lleve diez años viniendo y aunque la familia siga acompañando o pagando.
· No arrastres la voz de los registros anteriores. Quien empezó de niño tiene apartados antiguos escritos como niño; lo de HOY se escribe a la edad de hoy, y al citar lo anterior no se heredan sus palabras.
· El foco se desplaza: del rendimiento escolar y las rutinas de casa a los estudios o el empleo, la organización propia, la vida independiente y las relaciones.
· Un adolescente puede acudir y marcharse solo: no des por hecho que alguien lo acompaña ni atribuyas a la familia lo que ha contado el propio paciente.
· La edad tampoco es una explicación: llegar de mayor no explica por sí solo lo que se observa, y no se escribe «detectado tardíamente» si nadie lo ha dicho.`,

  /** Neurodesarrollo y perfil cognitivo. */
  neurodesarrollo: `SABER CLÍNICO — NEURODESARROLLO Y PERFIL COGNITIVO. Vocabulario y criterio para NOMBRAR con precisión lo que la profesional ha descrito y para decir qué convendría valorar. No es una lista de criterios que se cumplen: nada de aquí autoriza a escribir del paciente algo que el material no diga, ni a poner una etiqueta.

CADA PROCESO, CON EL MARCADOR QUE PERMITE NOMBRARLO. Usa el término solo si hay una conducta DESCRITA que lo sostenga. Una palabra del material («se distrae», «le cuesta») no autoriza tres marcadores: escribe lo observado, no lo que suele acompañarlo.
- Atención sostenida: arranca bien y se cae con los minutos; los fallos se acumulan hacia el final de la tarea.
- Atención selectiva: se va con el ruido de fuera, con lo que hay sobre la mesa, con una lámina cargada; rinde mejor con el espacio despejado.
- Atención dividida: no puede escuchar y escribir a la vez; pierde la consigna mientras copia.
- Atención alternante: le cuesta retomar tras una interrupción, o cambiar de tarea sin perder el punto.
- Inhibición: responde antes de que termine la consigna, empieza sin escuchar, toca el material antes de tiempo, interrumpe, no espera turno.
- Memoria de trabajo: pierde el hilo en el segundo paso de una instrucción de tres; retiene el enunciado pero no mientras calcula; pregunta qué había que hacer con la hoja delante.
- Flexibilidad: se atasca en la primera estrategia aunque no funcione, protesta al cambiar de regla, repite la respuesta anterior (perseveración).
- Planificación: empieza por el final, no reparte el espacio de la hoja, no anticipa el material que va a necesitar.
- Automonitorización: no revisa lo hecho; no ve el error hasta que se le señala, o lo ve y no lo corrige.
- Velocidad de procesamiento: resuelve bien pero tarde, termina la mitad en el tiempo, se agota con la copia. Sepárala de la lentitud por duda, de la de comprobarlo todo y de la torpeza motriz.
- Memoria: distingue registro (no llegó a entrar), retención (entró y se pierde) y recuperación (sale con pista o eligiendo, no de forma espontánea); si mejora con la repetición; si copia bien y no recuerda; y si es igual con material verbal que con material visual, cuando de los dos se hable.
- Razonamiento fluido: resuelve algo nuevo, deduce la regla sin habérsela aprendido. Cristalizado: lo que sabe y explica, vocabulario, conocimientos. Un desnivel entre los dos se cuenta con lo observado, nunca como índice ni puntuación.
- Cognición social y teoría de la mente: no anticipa lo que el otro sabe, entiende literal la ironía, no ajusta lo que cuenta a quien escucha, lee mal la intención ajena.
- Perfil intelectual: homogéneo o disarmónico, qué va por delante y qué se queda. Hablar de perfil exige puntuaciones que consten en el material; sin ellas se habla del RENDIMIENTO OBSERVADO en esa tarea y ese día.

AGRUPAMIENTOS QUE AYUDAN A DESCRIBIR. Sirven para ordenar y afinar lo que ya está dicho. El nombre del grupo NO se escribe en el documento, ni siquiera como «compatible con»: lo que se escribe es la conducta. «Compatible con» vale para un proceso —«compatible con una demanda alta sobre la memoria de trabajo»—, nunca para un cuadro.
- Cuando lo descrito es DESATENCIÓN: pierde y olvida material, se despista en lo largo y poco motivante, empieza y no termina, parece que no escucha, falla por descuido más que por no saber; suele no molestar, y por eso se ve tarde.
- Cuando lo descrito es INQUIETUD E IMPULSIVIDAD: se levanta, se mueve en la silla, habla encima, no aguanta la espera, contesta a medias; en adolescentes y adultos, inquietud interna más que motora.
- Las dos cosas pueden ir juntas. En cualquiera de los casos, una hipótesis se sostiene en que aparezca en MÁS DE UN CONTEXTO (casa y aula, o casa y trabajo), en que lleve tiempo y en que interfiera de verdad; no en la conducta de una sesión. Una hora con novedad, uno a uno y con un adulto delante es el peor sitio para verlo, y eso se puede escribir.
- Cuando lo descrito es COMUNICACIÓN SOCIAL, INTERESES, RIGIDEZ Y RESPUESTA SENSORIAL: poca iniciativa para compartir lo que le gusta (frente a pedir), mirada que no acompaña a lo que dice, prosodia plana o cantarina, poco gesto, conversación que vuelve a su tema, juego simbólico escaso o siempre con el mismo guion; interés profundo y poco compartido; rutinas propias, se altera si cambia el orden o el material; se tapa los oídos, evita texturas, busca presión y movimiento. Se escribe por ejemplos, uno a uno, nunca como categoría.
- Cuando lo descrito es un RITMO GLOBAL MÁS LENTO: el desfase aparece en varias áreas a la vez y no en una sola —y solo se puede decir de las áreas de las que el material hable—. Lo que más informa, además del rendimiento, es la autonomía cotidiana (vestido, comida, dinero, desplazamientos, trámites): es lo que define el apoyo que hace falta. Hay grados: se puede desenvolver bien en lo de cada día y quedarse solo cuando sube la exigencia.
- Cuando lo descrito es un RITMO MUY POR DELANTE DE LA DEMANDA: aprende a la primera y se aburre con la repetición, pregunta a otro nivel, vocabulario adelantado, intereses de más edad, autoexigencia y frustración cuando algo le cuesta, distancia entre lo que piensa y lo que su mano escribe.

CÓMO SE ORDENA LA DESCRIPCIÓN. Los ejes de los manuales sirven para estructurar un informe, no para dictaminar. De cada eje, solo lo que conste:
- POR DOMINIOS: cognitivo (atención, ejecutivas, memoria, velocidad, razonamiento), lenguaje y comunicación, aprendizajes instrumentales, motor y sensorial, socioemocional y conducta, autonomía.
- POR APOYO NECESARIO, en lugar de por gravedad abstracta: qué hace solo, qué con ayuda verbal, qué con modelo o ayuda física, qué con supervisión continua, y dónde.
- POR CURSO: desde cuándo, si es estable, si aparece en todos los contextos o en uno solo, si algo lo empeora.
- POR IMPACTO FUNCIONAL: en el aula o el trabajo, en casa y con iguales. Lo que solo se ve en un contexto pide explicar ese contexto antes que atribuirlo a la persona.

LO QUE SE CONFUNDE CON QUÉ. Siempre en forma de «convendría valorar», nunca de conclusión, y solo si el material da pie:
- Desatención y ansiedad: preocupación anticipatoria, bloqueo ante la demanda, quejas somáticas, alivio al retirar la tarea. Convendría valorar el estado emocional junto con la atención.
- Desatención y sueño insuficiente: cuesta arrancar por la mañana, somnolencia durante el día, se acuesta tarde. Convendría recoger horario y calidad del sueño.
- Desatención y comprensión: se descuelga solo cuando el texto es largo o el enunciado complejo; lee bien y no entiende. Convendría valorar comprensión y vocabulario antes de atribuirlo a la atención.
- Desatención y dificultad de la tarea: se descuelga justo cuando sube el nivel. Convendría comparar tareas de distinta exigencia.
- Audición y lenguaje debajo de un «no atiende» o un «no hace caso»: convendría descartar audición y comprensión oral antes que nada.
- No habla o no participa: convendría precisar dónde SÍ habla, con quién y desde cuándo. No es lo mismo soltarse en confianza, hablar en casa con normalidad y no emitir palabra fuera, o que la dificultad sea del ida y vuelta y aparezca también con los suyos.
- Ritmo por delante y notas bajas: las notas no dicen nada por sí solas, en ningún sentido. Convendría mirar desmotivación, desajuste con lo que se le pide, escritura lenta o un perfil atencional que conviva con ello; y aburrirse en clase, por sí solo, tampoco dice nada.
- Factores que cambian lo observado (medicación, cambio de colegio, duelo, separación, enfermedad): si constan, se nombran como posible factor; si no constan, no se suponen.

CÓMO SE ESCRIBE TODO ESTO
- Una hipótesis lleva delante lo que la sostiene: «pierde el hilo en el segundo paso y pregunta la consigna con la hoja delante, lo que sugiere una demanda alta sobre la memoria de trabajo; convendría valorarla».
- «Convendría valorar» dice QUÉ mirar (atención sostenida, control de impulsos, memoria de trabajo verbal, comprensión lectora, conducta adaptativa, procesamiento sensorial, audición) y, si procede, a qué ESPECIALIDAD derivar (otorrinolaringología, neuropediatría, equipo de orientación), nunca a una persona ni a un centro con nombre. NUNCA nombres una prueba, escala ni cuestionario concretos: eso solo se escribe cuando consta como administrado. Una o dos por documento, las que de verdad cambien algo: seis derivaciones que nadie pidió se leen como una lista de sospechas.
- Si el documento trae un apartado de diagnóstico, de conclusión o de impresión diagnóstica, ahí tampoco se pone la etiqueta: el diagnóstico es un DATO y solo se escribe si la profesional lo ha dictado, con sus palabras. Si no lo ha dictado, ese apartado se devuelve VACÍO. Lo que sí va: el perfil funcional, la hipótesis marcada como tal y qué falta por valorar.
- Los ejemplos de arriba están dichos en tarea de mesa y aula porque es donde más se describe; los mismos procesos, en un adulto, se ven en el trabajo, la conducción, los trámites y la organización de la casa. Traduce el ejemplo, no lo copies.
- Nada de normas de edad sobre alguien de quien no se sabe: no escribas «a esta edad ya debería…» si el material no dice qué hace.`,

  /** Lenguaje, habla y comunicación. */
  lenguaje: `LENGUAJE, HABLA Y COMUNICACIÓN. Vale cuando el material habla de cómo el paciente habla, entiende o se comunica —también voz, deglución y lectoescritura—; si el material no va de eso, no lo uses. Es vocabulario para DESCRIBIR lo que la profesional cuenta, nunca para deducir lo que no ha contado: del nivel del que no se dice nada, no se escribe nada, y de la condición en la que no consta que se observara algo, tampoco.

FONÉTICA Y FONOLOGÍA. Distingue el error articulatorio (no consigue producir el sonido, tampoco aislado, y falla siempre igual) del proceso fonológico (sabe producirlo y lo simplifica de forma sistemática, y suele salir mejor en repetición o en sílaba aislada). Si el material no dice en qué condición se observa el error, NO decidas cuál de los dos es: descríbelo como está y di qué convendría contrastar. Procesos: sustitución, omisión, asimilación, reducción de grupo consonántico, simplificación de la estructura silábica (omisión de sílabas átonas o de coda), frontalización, posteriorización, metátesis, distorsión. Nombres del oficio: rotacismo, sigmatismo. Ceceo y seseo son rasgos dialectales normales en amplias zonas de España: no se describen como error salvo que la profesional lo plantee así. Deja escrito en qué condición se observa —habla espontánea, repetición, denominación, lectura, sílaba aislada—: el contraste entre ellas es lo que orienta. La inteligibilidad se dice por interlocutor (familia, adultos conocidos, desconocidos) y por contexto (palabra suelta, frase, conversación larga); en porcentaje solo si el material lo da.

LÉXICO Y SEMÁNTICA. Vocabulario receptivo frente a expresivo, que pueden ir muy desigualados. Acceso léxico y evocación: latencia larga, circunloquios, palabras comodín («esto», «la cosa», «el de…»), sustituciones por término de la misma categoría, ayuda eficaz de la clave semántica o de la primera sílaba. Denominación por confrontación visual, fluidez verbal semántica (por categorías) y fonológica (por letra), campos semánticos, relaciones de categoría, función y parte-todo, definición por uso frente a por atributos.

MORFOSINTAXIS. Longitud media de enunciado (LME), habla telegráfica, omisión de artículos, preposiciones y nexos, concordancia de género y número, concordancia sujeto-verbo, morfología verbal (tiempos, irregulares, subjuntivo), pronombres átonos, orden de palabras, subordinación (relativas, causales, temporales, condicionales), comprensión de estructuras reversibles y de la pasiva. Si producción y comprensión no van a la par, dilo: cambia el trabajo.

PRAGMÁTICA Y DISCURSO. Intención comunicativa y funciones que usa (pedir, rechazar, comentar, preguntar, narrar), iniciación frente a respuesta, toma de turnos, solapamientos, latencia de respuesta, mantenimiento y cambio de tema, reparación cuando el interlocutor no le entiende, ajuste al interlocutor y a la situación, uso del gesto, mirada y prosodia. Narrativa: estructura (escenario, problema, resolución), cohesión (conectores, referencia pronominal ambigua), coherencia y cuánta información da por supuesta. Comprensión no literal: inferencias, lenguaje figurado, doble sentido, ironía.

COMPRENSIÓN. Órdenes de uno, dos o tres pasos, con y sin apoyo gestual o contextual; órdenes secuenciadas; comprensión literal frente a inferencial; seguimiento de un texto oral; necesidad de repetición, reformulación o ritmo más lento. Cuando responde bien en rutina y falla al retirar la clave contextual, es un dato y se escribe. Que lo que falla sea la comprensión y no la atención, la memoria de trabajo o la audición es una hipótesis, y se escribe como tal.

HABLA. Praxias orofaciales (movilidad, tono y fuerza de labios, lengua y velo; diadococinesias tipo pa-ta-ka), respiración y soplo, coordinación fonorrespiratoria, babeo. Dispraxia verbal: errores INCONSISTENTES entre intentos de la misma palabra, tanteo articulatorio, más error cuanto más larga la palabra, prosodia alterada, mejor rendimiento en habla automática que a demanda. Disartria: debilidad o descoordinación constante, habla lenta o arrastrada, imprecisión consonántica, hipernasalidad, voz soplada, ininteligibilidad que aumenta con la fatiga. Lo que las separa en lo que se ve es la consistencia del error; con un solo intento descrito no se pueden separar, y entonces no se separan.

FLUIDEZ. Disfemia: repeticiones (de sonido, de sílaba, de palabra, de frase), prolongaciones, bloqueos con o sin sonido, tensión visible, movimientos asociados, latencia antes de empezar. Y lo que más pesa y menos se escribe: conductas de evitación (cambiar la palabra, callarse, no coger el teléfono, no salir a la pizarra), en qué situaciones aumenta y en cuáles casi desaparece (canto, lectura al unísono, hablar solo), qué hace el entorno y cómo lo vive el paciente. Las disfluencias típicas del desarrollo —repetición de palabra entera, sin tensión ni conciencia de ella— no se describen igual que las tensas.

VOZ. Disfonía; timbre soplado, áspero o ronco, tono inadecuado, intensidad excesiva o insuficiente, quiebros, fatiga vocal al final del día, carraspeo, tensión cervical y laríngea, ataque vocal duro, respiración clavicular, abuso y mal uso vocal (gritar, uso profesional de la voz, hablar sobre ruido), afonías repetidas, higiene vocal. La causa de una disfonía no se afirma sin exploración otorrinolaringológica.

DEGLUCIÓN Y ALIMENTACIÓN. Deglución atípica: interposición lingual, contracción perioral al tragar, empuje lingual contra incisivos, respiración oral, relación con maloclusión y ortodoncia. Selectividad alimentaria: por textura, color, temperatura o presentación, arcadas, rechazo anticipatorio, duración de la comida, autonomía. Disfagia: tos o carraspeo durante o después de la ingesta, voz húmeda, residuo en boca, deglución fraccionada, escape anterior, atragantamientos, cambios de peso. Ante signos de riesgo lo único que se escribe es que conviene valorarlo: ni pautas de alimentación, ni cambios de textura, ni maniobras.

LECTOESCRITURA DESDE EL LADO DEL LENGUAJE. Conciencia fonológica por niveles (rima, sílaba, fonema: aislar, segmentar, omitir, sustituir) y correspondencia grafema-fonema. Ruta fonológica: lectura de pseudopalabras, silabeo, lentitud, esfuerzo. Ruta léxica: palabras frecuentes reconocidas de golpe frente a palabras largas o poco frecuentes, y lectura adivinada desde las primeras letras; en castellano, que es transparente, la ruta léxica se ve sobre todo en la VELOCIDAD, no en la exactitud. Distingue exactitud de velocidad y di si autocorrige. En escritura: uniones y fragmentaciones indebidas, omisiones, sustituciones entre grafemas de sonido próximo y ortografía arbitraria (b/v, g/j, h, ll/y), y qué cambia entre copia, dictado y redacción. Cuando la decodificación consume todos los recursos, la comprensión lectora cae sin que el problema sea de comprensión.

PERFILES, PARA LEER EL CUADRO Y NO PARA ESCRIBIR EL NOMBRE. Estos cuatro nombres NO aparecen en el documento: ni solos, ni como «compatible con», ni como «perfil sugerente de». Sirven para que describas con más precisión lo que se ve y para orientar qué convendría contrastar.
- Perfil de retraso: lo que hay es propio de una etapa anterior —no errores atípicos— y aparece en el orden esperable; la comprensión suele aguantar mejor que la expresión.
- Perfil de trastorno del desarrollo del lenguaje: el desajuste es persistente y desproporcionado respecto al resto del funcionamiento; suelen ser la morfosintaxis y la evocación léxica lo más afectado, y la comprensión puede resentirse o no. Descartar audición, nivel cognitivo o falta de exposición es parte de la valoración, no algo que puedas dar por hecho: si no consta, no escribas que está descartado.
- Perfil de dificultad en los sonidos del habla: la dificultad está en producir u organizar los sonidos, con léxico, morfosintaxis y pragmática relativamente conservados; dentro, separa lo articulatorio, lo fonológico y lo dispráxico por lo dicho arriba.
- Perfil de dificultad pragmática: la forma puede estar bien y el uso no; fallan el ajuste al interlocutor, el turno, la inferencia y la narrativa.
Si en el material consta que el paciente está expuesto a más de una lengua, tenlo en cuenta antes de describir sus errores como una dificultad del lenguaje; si no consta, no lo supongas.

HITOS, SOLO PARA NO EQUIVOCARTE AL NOMBRAR LO QUE TE CUENTAN. No los uses para suponer qué hace un paciente del que no se dice nada, ni para escribir «a esta edad ya debería» o «no esperable para su edad». Una comparación con la edad solo se escribe sobre algo que la profesional haya descrito, y va marcada como interpretación. Hacia los 12 meses, primeras palabras; entre los 18 y los 24, combinación de dos palabras y crecimiento rápido del vocabulario; a los 3 años, enunciados de tres o más elementos e inteligibilidad para la familia; a los 4, relato de un suceso con apoyo, inteligibilidad para desconocidos y procesos de simplificación en retirada; entre los 5 y los 6, narración con estructura, vibrante múltiple y grupos consonánticos resueltos, conciencia fonémica; entre los 6 y los 7, decodificación lectora establecida. Son referencias aproximadas y con variación amplia entre niños.

QUÉ CONVIENE VALORAR, POR DOMINIO Y NO POR PRUEBA. No nombres instrumentos: di qué hay que mirar. Como mucho una o dos propuestas en todo el documento, y solo las que salgan de una duda concreta de ESTE material; si no queda ninguna duda abierta, ninguna. Dominios: audición, lo primero, cuando la dificultad lo pida y del estado auditivo no conste nada; fonología en habla espontánea y en repetición; vocabulario receptivo y expresivo por separado; morfosintaxis en producción y en comprensión; narrativa e inferencias; conciencia fonológica y decodificación; exploración orofacial y praxias; exploración otorrinolaringológica en voz; valoración específica de deglución si hay signos de riesgo.`,

  /** Terapia ocupacional, sensorial y motor. */
  ocupacional: `TERAPIA OCUPACIONAL, SENSORIAL Y MOTOR — CÓMO SE NOMBRA LO QUE SE VE EN LA SALA. Vocabulario para DESCRIBIR lo que la profesional cuenta, no una lista que rellenar: un sistema, un rango, un gesto o una actividad de los que no se habla NO se nombran, ni para decir que están conservados o dentro de lo esperable. Y con adolescentes y adultos los mismos procesos se describen en SUS contextos —estudios, trabajo, casa, conducción, ocio—: los ejemplos escolares de abajo no se trasplantan.

PROCESAMIENTO SENSORIAL. Se nombra el sistema, el tipo de respuesta y en qué se ve. Sistemas: táctil, vestibular, propioceptivo, visual, auditivo, gustativo y olfativo, e interocepción. Tipos de respuesta: hiperrespuesta (reacciona a muy poco), hiporrespuesta (necesita mucho para responder, o no se entera), búsqueda (se lo busca él), evitación (lo esquiva). Y dos cosas distintas: modulación (ajustar la respuesta a la demanda) y discriminación (distinguir qué le llega). El tipo de respuesta es una LECTURA de lo observado, no un hecho: va con la conducta delante y marcada —«se cuelga y empuja sin que se le pida, lo que sugiere búsqueda propioceptiva»—, nunca sola.
- Táctil: rechaza etiquetas, costuras, calcetines, el corte de pelo y de uñas; se limpia en cuanto se mancha, o al revés busca pintura, arena y espuma; no tolera el contacto por la espalda; no localiza dónde se le ha tocado sin mirar.
- Vestibular: se agarra en el columpio, evita los pies fuera del suelo, se resiste a inclinar la cabeza o a tumbarse boca arriba; o gira sin marearse, se balancea, salta y se cuelga sin parar.
- Propioceptivo: aprieta el lápiz hasta romper la mina, choca con muebles y con quien tiene al lado, se apoya en la pared, muerde la ropa, empuja y abraza fuerte, calcula mal la fuerza al coger un vaso.
- Auditivo: se tapa los oídos con el secamanos, el timbre o el comedor; pide repetir en ambiente ruidoso; no responde al nombre aunque oiga bien.
- Visual: le molesta la luz del techo, se pierde en una hoja con muchos estímulos, busca luces y objetos que giran.
- Gustativo y olfativo: repertorio de comidas muy corto, rechazo por texturas (grumo, mezcla), arcadas al oler, se lleva objetos a la boca.
- Interocepción: no avisa de que tiene que ir al baño, no reconoce hambre, sed ni cansancio hasta el extremo.
Y, cuando conste, el umbral y la recuperación: cuánto tarda en reaccionar, cuánto le dura y qué le devuelve a la calma (presión profunda, movimiento lineal, retirar el estímulo).

PRAXIS. Son pasos distintos y hay que decir en cuál se atasca. Ideación: no se le ocurre qué hacer con material nuevo, repite siempre el mismo juego. Planificación motora: sabe qué quiere pero no encuentra por dónde empezar, va por ensayo y error, se organiza si se le dan los pasos. Secuenciación: pierde el orden en una consigna de varios pasos, se salta partes del circuito. Ajuste: no corrige cuando algo no sale, repite el mismo error. Imitación: posturas en espejo, gestos sin objeto, secuencias, y con qué apoyo. Un contraste que conviene describir tal cual cuando aparece: torpe con lo nuevo y hábil con lo conocido, o aprende una secuencia y no la generaliza a otra tarea.

MOTRICIDAD GRUESA Y CONTROL POSTURAL.
- Tono: se describe lo que se ve —se derrumba en la silla, apoya la cabeza en la mesa, bloquea codos y rodillas, se sienta en W, o al revés ofrece resistencia al movimiento—. «Hipotonía», «hipertonía» y «tono fluctuante» son conclusiones de una exploración: solo se escriben si constan dichas por quien exploró.
- Control postural: cambia de postura sin parar, se sienta sobre los pies, se recuesta; sostiene el tronco solo mientras atiende. Resistencia: cuánto aguanta antes de buscar apoyo.
- Equilibrio estático (apoyo monopodal, con y sin ojos cerrados) y dinámico (caminar en línea, esquivar, frenar, escaleras alternando pies, pata coja), y qué hace al perderlo.
- Coordinación óculo-manual y óculo-pédica: lanzar, recibir, botar, golpear. Coordinación bilateral (las dos manos con el mismo gesto y con gestos distintos), cruce de línea media (gira el cuerpo o cambia de mano en el centro), disociación de cinturas escapular y pélvica.

MOTRICIDAD FINA Y GRAFOMOTRICIDAD.
- Estabilidad de mano y muñeca (escribe con la muñeca flexionada o apoyada), arcos de la mano, separación de los lados radial y cubital.
- Disociación de dedos: mueve los dedos por separado o la mano en bloque; oposición del pulgar; manipulación dentro de la mano (girar una moneda, recolocar una pieza sin ayuda de la otra mano).
- Prensión: palmar, digital pronada, cuadrípode, trípode (estática o dinámica); si la sostiene o cambia al cansarse. Presión: marca o rompe el papel, o el trazo apenas se ve.
- Trazo: control del recorrido, tamaño irregular, se sale de la pauta, no respeta renglón ni margen, direccionalidad de letras y números, inversiones.
- Fluidez y fatiga: cuánto escribe antes de quejarse, sacudir la mano o parar; cómo está la legibilidad al final de la hoja frente al principio.
- Herramientas: tijeras (recto y curva, y si sujeta el papel con la otra mano), regla, cordones, cremallera, cubiertos. Se dice la mano que usa, si es estable, y si la otra hace de apoyo.

ESQUEMA CORPORAL, LATERALIDAD Y ESPACIO. Localiza partes del cuerpo en él y en el otro; figura humana; se golpea con lo que tiene alrededor. Lateralidad de mano, ojo y pie, si coinciden y si alterna la mano dentro de la misma tarea. Derecha e izquierda en él, en el otro y en el papel. Nociones espaciales (delante, detrás, encima, entre) y su traslado al papel: organización de la hoja, copia de un modelo, orientación en el cuaderno.

AVD Y AUTONOMÍA. Se describe SIEMPRE con qué apoyo —independiente, con supervisión, con ayuda verbal, con ayuda gestual, con guía física parcial o total— y en qué contexto: lo que hace solo en la sala no es lo que hace en el aula ni en casa. Vestido: botones, cremallera, cordones, del derecho y del revés, abrigo al salir. Alimentación: cubiertos, cortar, beber en vaso, repertorio y texturas, comer con ruido alrededor. Higiene: manos, dientes, ducha, esfínteres. Instrumentales según la edad que conste: material y mochila, apuntar las tareas, moverse por el centro o por la calle, dinero, transporte, y cocina, compra y gestiones en adultos. No se da por supuesto lo que le tocaría por edad: se describe lo que consta y, si falta, se propone observarlo.

FISIOTERAPIA, lo que se mira en una sesión pediátrica.
- Marcha: patrón, por dónde apoya el pie, base de sustentación, braceo, simetría, tropiezos y caídas, resistencia; carrera y giro.
- Alineación: cabeza y hombros, escápulas, columna (curvas y asimetría al flexionar), pelvis, rodillas, pies. Aquí pasa lo mismo que con el tono: «valgo», «varo», «pie plano», «escoliosis», «acortamiento» y «retracción» son conclusiones de exploración y solo se escriben si constan dichas; si no, se describe lo que se vio —por dónde apoya, qué asimetría, qué gesto queda limitado y hasta dónde llega—.
- Rangos articulares y grupos que quedan cortos (isquiotibiales, tríceps sural, flexores de cadera), fuerza por grupos musculares y control selectivo del movimiento.
- Control cefálico y de tronco por posiciones: prono, supino, sedestación, cuadrupedia, rodillas, bipedestación; volteos y transiciones. Patrón respiratorio y cómo lo coordina con el esfuerzo.
- Dolor, si lo hay: dónde, cuándo aparece y qué lo alivia. Órtesis y ayudas (plantillas, férulas, andador, silla): si las lleva y cómo las tolera.

PARTICIPACIÓN, JUEGO Y ENTORNO. Juego por tipo: exploratorio, funcional, constructivo, simbólico, reglado; si lo inicia, lo sostiene, lo varía, lo comparte; en paralelo o cooperativo. Rutinas de casa, de aula o de trabajo: transiciones, anticipación, qué las rompe. Colegio o puesto: postura en la silla, copia de la pizarra o de la pantalla, ritmo respecto al grupo, recreo, educación física. Adaptaciones y productos de apoyo, dichos por lo que resuelven: adaptador de lápiz, plano inclinado, cojín dinámico, reposapiés, tijeras adaptadas (de doble anilla o de autoapertura), pauta ancha, apoyo visual de la secuencia, auriculares, rincón de calma, pausas de movimiento; y cuál se ha probado y cómo ha respondido.

CÓMO ENTRA ESTO EN EL TEXTO. El proceso va pegado al hecho: «no cruza la línea media, cambia de mano en el centro de la hoja» dice algo; «presenta dificultades de coordinación», no. Ni el nombre de un proceso ni el de un patrón se escriben sin el hecho que los sostiene y, si son una lectura, sin la marca de interpretación. Y no se ponen etiquetas: «dispraxia», «trastorno del desarrollo de la coordinación», «trastorno del procesamiento sensorial», «disfunción de integración sensorial» y «retraso psicomotor» son diagnósticos; se describe la respuesta observada y, si procede, qué convendría valorar, sin nombrar pruebas que no consten.`,

  /** Aprendizaje y pedagogía. */
  aprendizaje: `APRENDIZAJE Y PEDAGOGÍA — CÓMO SE NOMBRA LO QUE SE VE

Aplica cuando el material habla de lectura, escritura, cálculo, deberes, estudio o rendimiento escolar, se llame el área pedagogía, refuerzo o apoyo. Es vocabulario para DESCRIBIR mejor lo que la profesional cuenta, nunca para suponer lo que no consta. Tres cautelas, que mandan sobre todo lo que sigue:
· Lo de aquí abajo son formas de NOMBRAR lo que ya se ha observado, no una lista de comprobación. Un marcador del que el material no dice nada no se menciona, tampoco para negarlo: nada de «no se aprecian inversiones», «mantiene el renglón» o «no muestra rechazo a la tarea» si eso no se ha dicho.
· No escribas lo que sería esperable a una edad o en un curso: lo que no se probó no se afirma, se propone comprobarlo.
· Un término técnico solo entra si describe algo que consta. Si el material dice únicamente que le costó leer, se escribe eso y qué convendría registrar; no se rellena con «conciencia fonológica» y «ruta léxica».

LECTURA. Distingue las dos mitades y dilas por separado: la MECÁNICA (descodificación) y la COMPRENSIÓN. De la mecánica: conciencia fonológica (rima, sílaba, fonema; segmentar, aislar, omitir, sustituir), correspondencia grafema-fonema, ruta fonológica y ruta léxica, exactitud, velocidad lectora, prosodia y respeto de la puntuación. Marcadores, cuando consten: silabeo o lectura vacilante, sustituciones, omisiones, adiciones e inversiones —sobre todo en grupos consonánticos o sinfones (pla, tra) y en sílabas inversas y trabadas (pal, tar)—, confusión entre letras de forma o sonido parecidos, sustitución de una palabra por otra de forma parecida, lexicalización de pseudopalabras (las convierte en una palabra real), rectificaciones, repeticiones, pérdida del renglón, seguimiento con el dedo, y lectura mejor en palabras familiares que en pseudopalabras o en palabras largas y poco frecuentes. De la comprensión: literal, inferencial (inferencias puente y elaborativas), idea principal, secuencia, vocabulario (amplitud y profundidad), y si controla su propia comprensión (detecta que no ha entendido y relee). Si solo se leyó en voz alta, la comprensión no se ha explorado: dilo así.

ESCRITURA. Tres tareas que no informan de lo mismo, y conviene distinguirlas cuando el material lo hace: copia, dictado y composición libre. Grafía y grafomotricidad: trazo, presión, tamaño, ligado, respeto del renglón y de los márgenes, velocidad, fatiga, prensión. Ortografía NATURAL (la que se resuelve oyendo y segmentando bien: omisiones y sustituciones de letras, sílabas trabadas y sinfones, uniones y fragmentaciones de palabras, inversiones), ARBITRARIA o visual (b/v, h, g/j, ll/y) y REGLADA (tildes, mayúsculas, signos de puntuación): la primera apunta a la representación del sonido; la segunda, a la memoria ortográfica y a la exposición al texto; la tercera, al dominio y la aplicación de la regla. Composición: planificación previa, generación de ideas, estructura textual según el tipo (narración con marco, nudo y desenlace; descripción; texto expositivo; argumentación), cohesión (conectores, referentes, tiempos verbales), coherencia, extensión y densidad de ideas, revisión y autocorrección. Marcadores: escribe mucho menos de lo que cuenta oralmente, abandona una palabra por no saber escribirla, empieza sin plan y se le acaba la idea, entrega sin releer, dictado con muchas más faltas que la copia.

MATEMÁTICAS. Sentido numérico: conteo, cardinalidad, comparación de magnitudes, recta numérica, valor posicional, descomposición, estimación. Hechos numéricos: si los recupera de memoria o los calcula contando (con los dedos, de uno en uno, sobreconteo), dominio de las tablas. Algoritmos: colocación en columnas, llevadas en suma y en resta, ceros intermedios, división, decimales y fracciones; di si el error es de procedimiento o de hecho numérico dentro de un procedimiento correcto. Resolución de problemas: comprensión del enunciado, representación, elección de la operación, uso de palabras clave sin entender el problema, problemas de varios pasos, estimación previa y comprobación del resultado. Razonamiento: patrones, proporcionalidad, álgebra elemental, orientación espacial y geometría. Y cómo se pone ante la tarea, dicho por lo que se ve: evitación o bloqueo ante la hoja, prisa por borrar, verbalizaciones de incapacidad, peor rendimiento con límite de tiempo o en la pizarra que a solas, mejor rendimiento oral que escrito. Llamar a eso ansiedad ante las matemáticas es ya una hipótesis y va marcada como tal.

TRABAJO ACADÉMICO. Organización del material y de la agenda, anotación y entrega de tareas, inicio de la tarea y demora, mantenimiento del esfuerzo, fragmentación de tareas largas, planificación contando desde la fecha del examen, priorización y gestión del tiempo. Técnicas de estudio: lectura previa, subrayado (subraya todo o no subraya nada), esquema, resumen, palabras clave, autoexplicación, autoevaluación, repaso espaciado frente a relectura la víspera, memorización sin comprensión. Autonomía y apoyo: qué tipo de ayuda necesita (consigna verbal, modelo, apoyo visual, presencia del adulto), cuánta, y si el rendimiento se mantiene al retirarla. Motivación y atribuciones: a qué atribuye el resultado (a la capacidad, al esfuerzo o a la estrategia), expectativa de éxito, autoconcepto académico, evitación de lo difícil.

QUÉ CONTRASTAR ANTES DE CONCLUIR. Esto NO es un árbol de decisión ni sirve para elegir un perfil con dos datos sueltos: son contrastes que se PROPONEN, y su resultado casi nunca está en el material. Si lo que hay no permite separar dos de ellos, no separes: escribe qué convendría contrastar y con qué tipo de tarea. Lo que se mira, cuando consta:
· Instrucción u oportunidad: escolarización irregular, absentismo, cambio de sistema educativo, método de lectura reciente. Suele verse desfase parejo en todo y errores de quien aún no ha aprendido, más que atípicos.
· Lengua familiar distinta o exposición reciente al castellano: errores de transferencia, vocabulario limitado, y una comprensión lectora limitada por la misma vía que la oral.
· Techo de comprensión oral: descodifica correctamente y comprende poco, y comprende igual de poco lo que se le lee en voz alta o se le explica. Es el reverso de quien descodifica con esfuerzo y entiende bien lo escuchado.
· Componente atencional: rendimiento variable dentro de una misma tarea y de un día a otro, errores por omisión o precipitación en lo que domina, mejora al reducir la cantidad por hoja o al supervisar, no lee el enunciado entero.
· Componente de velocidad: lo resuelve bien pero no termina; con tiempo adicional el resultado cambia.
· Vacío curricular acumulado: falla lo de cursos anteriores (valor posicional, tablas, sinfones) más que lo del curso actual.
· Cambio emocional o vital: la caída tiene un momento identificable y no se limita a un área.
Tipos de tarea que se pueden proponer para separarlos: lectura de palabras y de pseudopalabras, con y sin tiempo; dictado frente a copia; comprensión oral frente a comprensión lectora de un texto equivalente; cálculo con y sin límite de tiempo; información del tutor o tutora; y revisión de audición y de visión, que se descartan antes que nada. Nombra el TIPO de tarea o de valoración, nunca una prueba con su nombre. Y ninguno de estos contrastes autoriza una etiqueta: describen y orientan qué valorar.

MARCO ESCOLAR ESPAÑOL. Solo si el material habla del colegio, del instituto o de la escolarización; en un paciente adulto sin estudios en curso, o cuando del centro escolar no consta nada, este apartado no se usa. Etapas y cursos, tal como consten y sin deducir el curso de la edad ni la edad del curso: Infantil, Primaria (1º a 6º), ESO (1º a 4º), Bachillerato, FP básica, de grado medio y de grado superior. Figuras: tutor o tutora, orientación del centro o equipo externo, PT (Pedagogía Terapéutica), AL (Audición y Lenguaje), departamento de orientación en secundaria. Medidas, de menor a mayor: diseño universal para el aprendizaje y medidas ordinarias de aula; adaptaciones metodológicas NO significativas (tiempo adicional, lugar preferente, menos ítems por hoja, enunciados leídos o simplificados, tipo y tamaño de letra, permitir la tabla de multiplicar o la calculadora, valorar contenido y no ortografía, examen oral o fraccionado, guion de estudio); refuerzo y apoyo de PT o AL; y adaptación curricular SIGNIFICATIVA, que modifica objetivos y criterios de evaluación del curso. Un centro clínico aporta y propone; quien determina si hay NEAE y quien autoriza una adaptación significativa es la orientación del centro y la administración educativa: se escribe como propuesta, nunca como prescripción ni como algo ya concedido. Y las medidas concretas solo se proponen cuando el documento las pide —orientaciones para el aula, informe para el centro escolar— o cuando la profesional ya las ha planteado: no se cuelan en un registro de sesión que no habla de ellas. En el informe para la beca NEAE del Ministerio se usan las denominaciones de la convocatoria y solo caben motivo de consulta, objetivos y metodología: ahí no se añaden apartados. Para que un informe le sirva al colegio, di en qué se nota dentro del aula y en qué materias o momentos, y propón medidas aplicables con lo que el profesorado tiene, diciendo qué se busca con cada una y en qué se vería que funciona.`,

  /** Emocional, conducta y familia. */
  emocional: `SABER CLÍNICO — EMOCIONAL, CONDUCTA Y FAMILIA. Vocabulario para describir con más precisión lo que la profesional ha contado. Nada de aquí abajo autoriza suponer, completar por edad, dar por ausente lo que no se ha mencionado ni ENUMERAR lo que no consta: estas listas sirven para nombrar lo que hay, nunca para repasar en el documento lo que nadie preguntó.

ETIQUETAS QUE AQUÍ TAMPOCO SE PONEN, además de las ya prohibidas: depresión, trastorno de ansiedad, fobia, mutismo selectivo, trastorno negativista desafiante, trastorno de conducta, anorexia, bulimia, trastorno de la conducta alimentaria, apego (en cualquiera de sus tipos), acoso escolar, maltrato, negligencia. Se describe el perfil funcional y se marca la hipótesis; la etiqueta la pone quien evalúa y firma.

ANSIEDAD. Se describe por lo que se evita, por el cuerpo y por el contexto en que aparece, no por la palabra «nervioso». Anticipación: pregunta una y otra vez por lo que va a pasar, busca reaseguro, aplaza lo nuevo. Cara somática, que es como llega la mayoría de las consultas: cefalea, dolor abdominal recurrente, náuseas o vómitos matutinos, ganas de orinar, nudo en la garganta, dificultad para conciliar el sueño. Formas y sus marcadores: de separación (llanto en la despedida, no duerme solo, teme que le pase algo al adulto); social (habla poco o no habla en el aula y sí en casa, no pide ayuda, evita el comedor o el recreo, rubor, voz temblorosa); generalizada (preocupación por varios frentes a la vez, perfeccionismo, borra y repite la tarea); fobia (evitación circunscrita a un estímulo); ante los exámenes o el rendimiento (se queda en blanco sabiendo el contenido, abandona a la primera dificultad). Escribe QUÉ evita, EN QUÉ contextos y QUÉ ocurre después, si consta. El patrón es lo que separa una queja somática ansiosa de otra cosa —si aparece los días lectivos y cede el fin de semana y en vacaciones—: cuando eso no consta no se supone, se propone precisarlo.

ESTADO DE ÁNIMO. El ánimo bajo en la infancia no siempre se presenta como tristeza: puede presentarse como IRRITABILIDAD —estallidos, contestar mal, aburrimiento persistente, «me da igual»—, y esa presentación se pasa por alto con facilidad. Marcadores: anhedonia descrita por lo concreto que ha dejado de hacer (deja el deporte, ya no queda con nadie), llanto fácil o expresividad reducida, enlentecimiento o inquietud, cambios en el sueño (conciliación, despertares, dormir mucho más) y en el apetito, cansancio, retirada social, caída del rendimiento, autodescalificaciones espontáneas. Di desde cuándo y respecto a qué ha cambiado, si consta.

IDEACIÓN AUTOLÍTICA Y AUTOLESIÓN — REGLA DURA. Si aparece cualquier mención a hacerse daño, a no querer vivir o a desaparecer, o una autolesión: se recoge TAL COMO SE DIJO, con quién lo dice y cuándo si consta, y ahí se para. No se interpreta, no se minimiza, no se convierte en hipótesis, no se lleva a logros, a objetivos ni a recomendaciones, y del método o la frecuencia no se escribe detalle. Se añade una línea: requiere valoración del riesgo por la profesional. DÓNDE VA: únicamente en el apartado de observación clínica o en las notas internas del equipo. Si el documento que estás escribiendo no tiene ninguno de los dos —un informe de seguimiento, unos objetivos de intervención—, NO lo escribas en ningún otro apartado: no es material para un texto que va a leer la familia. Y nunca escribas que no hay ideación: la ausencia no se afirma desde un registro.

REGULACIÓN Y CONDUCTA. Un estallido se describe por su secuencia, no por su adjetivo: qué lo desencadena (una demanda, una transición, un error, una negativa, un cambio de plan), cuánto dura, qué lo corta y qué pasa después (si vuelve a la tarea, si repara, si queda desactivado). Lo que ocurre después se describe tal como conste, sin atribuir intención ni culpa a nadie; que una conducta se mantenga por lo que la sigue es una hipótesis funcional y se escribe marcada como tal, nunca como un hecho. Las rabietas son frecuentes en los primeros años y lo que informa no es que las haya, sino su intensidad, cuánto duran, cómo se recupera y cuánto interfieren en la vida diaria; no escribas que algo «no es propio de su edad». Oposicionismo: discute con el adulto, desafía normas, culpa a otros; lo que cambia la propuesta es EN QUÉ CONTEXTOS ocurre —solo en casa, solo en el aula, en los dos—. Agresividad: verbal o física, hacia objetos o hacia personas, reactiva a una frustración o planificada. Impulsividad: responde antes de que termine la pregunta, interrumpe, no espera turno, actúa sin medir la consecuencia. Tolerancia a la frustración: abandona a la primera, rompe la ficha, dice «no sé» antes de intentarlo, no acepta ayuda ni el error. Estrategias de regulación: cuáles usa ya solo (pedir ayuda, retirarse, respirar, poner palabras), cuáles necesita del adulto —corregulación— y si aparecen fuera de la sesión.

HABILIDADES SOCIALES. Por partes: iniciación (se acerca, cómo y a quién), mantenimiento (sostiene el juego, propone, cede, repara), asertividad (pide, dice que no, reclama sin agredir ni callarse), resolución de conflictos, lectura de claves (tono, cara, ironía) y pragmática (turnos, tema, ajuste al interlocutor). Victimización: lo que cuentan el paciente o la familia va COMO REFERIDO y con quién lo refiere; hay señales que se describen sin concluir —se queda solo en el recreo, pierde o rompe material, no quiere ir, cambia de ruta—. Calificar los hechos corresponde al centro escolar por su protocolo: describe lo referido y propón coordinación.

AUTOESTIMA Y AUTOCONCEPTO. No es global: separa dominios (académico, físico, social, familiar). Marcadores: autodescalificaciones espontáneas, atribuir el acierto a la suerte y el fallo a uno mismo, rechazar el elogio, compararse, no exponerse, pedir permiso para todo, o la fanfarronería que lo tapa. Una frase textual del paciente informa más que cualquier adjetivo.

CONDUCTA ALIMENTARIA. Dos cuadros distintos que no se mezclan. Restrictiva o evitativa SIN preocupación por el peso ni la figura: selectividad por textura, olor, color o temperatura, repertorio muy corto, arcadas, comidas muy largas, dependencia del triturado, rechazo tras un atragantamiento; convendría valorar el perfil sensorial (terapia ocupacional) y la deglución (logopedia). CON preocupación por el peso o la figura: saltarse comidas, contar, ir al baño después de comer, ejercicio compensatorio, ropa ancha, dejar de comer con la familia. Pérdida de peso, mareos, desmayos, amenorrea o vómitos no se tratan como una conducta a trabajar: se hacen constar como lo que se ha referido y requieren valoración médica. No escribas peso, talla ni IMC que no consten.

ADOLESCENCIA. Autolesión: la regla dura de arriba. Consumo y pantallas: se recoge lo que refieren el paciente o la familia, con la marca de quién lo refiere y sin cuantificar lo que no consta; de las pantallas se describe el efecto —desplaza sueño, tarea o trato cara a cara— antes que las horas.

LO QUE RODEA AL PACIENTE. Se describe, no se juzga ni se clasifica. Vocabulario para lo que la profesional cuente: consistencia entre las figuras adultas, claridad y seguimiento de los límites, exigencia y afecto, corregulación, expectativas puestas. NO etiquetes el estilo educativo (autoritario, permisivo, sobreprotector, negligente) ni describas a la familia por lo que no hace. Acontecimientos vitales estresantes: duelo, enfermedad de un familiar, nacimiento de un hermano, mudanza, cambio de colegio, migración. Hermanos: comparación, celos, papel de cuidador. Si algo de esto coincide en el tiempo con lo consultado, dilo así y UNA SOLA VEZ en el documento: la coincidencia no es la causa, y no se repite como fórmula.

SEPARACIÓN DE LOS PROGENITORES — REGLA DURA. Es el material que más veces acaba en un procedimiento judicial. Se escribe SOLO lo que consta y atribuido a quien lo dijo: el régimen de convivencia si se ha dicho, y lo que el paciente o la familia refieren. No valores a ningún progenitor, no los compares, no atribuyas el estado del paciente al régimen de convivencia ni al conflicto entre ellos, y no recomiendes nada sobre la custodia ni sobre los tiempos de estancia. Un conflicto entre los adultos se recoge como referido y sin adjetivos.

SOSPECHA DE DESPROTECCIÓN O MALTRATO — REGLA DURA. Aquí no concluyes nada y no usas las palabras maltrato, abuso ni negligencia. Recoges literalmente lo que se dijo o se observó, con la fuente y la fecha si constan, sin adjetivos y sin atribuir causa, y añades una sola línea: corresponde a la profesional valorar la activación del protocolo. DÓNDE VA: el mismo destino que la regla de ideación —observación clínica o notas internas—, y si el documento no los tiene, no se escribe.

QUÉ CONVENDRÍA VALORAR. Por TIPO de instrumento y sin nombrar ninguna prueba concreta, aunque te la sepas: cuestionario de banda ancha de conducta y emoción respondido por la familia y por el centro escolar, autoinforme de ansiedad o de sintomatología depresiva según la edad, registro conductual de antecedente-conducta-consecuencia en casa y en el aula, escala de habilidades sociales, entrevista con el centro escolar, valoración pediátrica de la queja somática. Siempre como propuesta, nunca como algo hecho.

DOS AVISOS. Cuando compiten dos lecturas del mismo comportamiento —ansiedad ante la tarea o una dificultad de aprendizaje detrás; ánimo bajo o desregulación—, nómbralas las dos y di qué las distinguiría. Y el término técnico no sustituye a la descripción, la acompaña: «anhedonia» sin decir qué ha dejado de hacer no informa de nada, y lo mismo con «desregulación» y «corregulación». Una conducta desregulada no es un trastorno de conducta, y la impulsividad no es un déficit de atención.`,

  /** Qué convendría valorar, y a quién derivar. */
  evaluacion: `QUÉ CONVENDRÍA VALORAR, CON QUÉ Y A QUIÉN SE DERIVA

REGLA DURA, POR DELANTE DE TODO LO DEMÁS: no escribas NUNCA una puntuación —directa, escalar, típica, percentil, CI o índice— ni una clasificación («dentro de la media», «por debajo de lo esperado para su edad») que no conste en el material, ni des por administrada una prueba que no conste como administrada. Si el material trae puntuaciones, se copian tal cual y con el nombre exacto de la escala, sin redondear y sin convertirlas en una clasificación que nadie ha escrito: «percentil 12» no se reescribe como «por debajo de la media». Lo ÚNICO que puedes hacer tú con una prueba es PROPONERLA, y siempre en condicional y hacia delante («convendría completar…», «se propone valorar…»); en pasado suena a que se pasó. Proponer no es nombrar una prueba administrada: es la única excepción a la prohibición de nombrar pruebas.

DÓNDE VA UNA PROPUESTA: en recomendaciones, propuesta de actuación, orientaciones o propuesta de continuidad. Nunca dentro de un objetivo de intervención ni en lo que se hizo en la sesión.

CÓMO SE PROPONE. Sale de lo observado, no de un catálogo, y tiene tres partes: qué se ha visto (conducta o rendimiento concreto) · qué proceso hay que acotar · con qué instrumento o qué tipo de prueba, y quién la pasaría si no es el centro. Una propuesta por duda abierta, y no más de tres en un mismo documento: nada de enumerar baterías «para completar el perfil». Si lo observado no lo justifica, no propongas nada; también es un resultado correcto.
· Ajusta a la edad que conste. Con adultos, instrumento de adultos —WAIS-IV, STAI, TMT, escalas de autonomía y de actividades de la vida diaria— y nunca material infantil. Si la edad no consta, propón el tipo de prueba y no una concreta.
· Cuando lo observado sea habla, lectura, atención o aprendizaje, la audición y la visión se miran antes que nada. Escríbelo SIEMPRE en condicional y sin convertirlo en un hecho ni en un reproche a la familia: «si no se ha hecho ya, convendría descartar…». Que algo no aparezca en el material no significa que no se haya hecho, y no se escribe como si lo significara.
· Si el material dice qué pruebas se han pasado ya, o con cuáles trabaja el centro, muévete dentro de eso.
· Hay instrumentos que llevan la etiqueta diagnóstica en el nombre o en su propósito (ADOS-2, ADI-R, SCQ, SRS-2, EDAH, escalas de Conners, PROLEXIA, las pruebas de cribado de discalculia). Nombrarlos ES decir la sospecha sin ponerla, y el documento lo lee la familia: propón el ÁREA y quién la valora —«valoración específica de comunicación social, por profesional con formación acreditada»—, no el instrumento. Si el material ya los nombra, se citan tal cual.
· El número de versión de una prueba cuenta como cifra: en el informe de seguimiento escribe el nombre sin versión (BRIEF, Perfil Sensorial, PROLEC) o di el tipo de prueba.

PRUEBAS QUE SE USAN EN ESPAÑA, POR ÁREA (nombre y qué mide; las edades son orientativas)
· Capacidad cognitiva: WPPSI-IV (infantil, de dos años y medio a siete) · WISC-V (niños y adolescentes) · WAIS-IV (desde los dieciséis) · RIAS-2 (índices de inteligencia y de memoria) · K-BIT (cribado breve: vocabulario y matrices) · Leiter (escala manipulativa, sin demanda de lenguaje: útil con lenguaje muy limitado, sordera o bilingüismo reciente) · NEPSY-II y CUMANIN/CUMANES (perfil neuropsicológico infantil por dominios).
· Desarrollo y atención temprana: Bayley (desarrollo infantil temprano, primeros tres años) · Brunet-Lézine-R (desarrollo psicomotor, primeros treinta meses) · Battelle (desarrollo global).
· Atención y funciones ejecutivas: CARAS-R (atención selectiva y control de la impulsividad, desde los seis) · d2-R (atención selectiva y concentración) · AULA Nesplora (atención, impulsividad y actividad motora en entorno virtual) · CPT, prueba de ejecución continua por ordenador (atención sostenida y respuesta impulsiva) · ENFEN (funciones ejecutivas en Primaria) · BRIEF y BRIEF-P (funcionamiento ejecutivo cotidiano según familia y profesorado; es cuestionario, no prueba de rendimiento) · Stroop (inhibición y control de la interferencia) · Trail Making Test A y B (rastreo visomotor y alternancia) · Torre de Londres y Figura Compleja de Rey (planificación y organización; la Figura, además, memoria visual).
· Lenguaje: PLON-R (cribado del lenguaje oral en Infantil: forma, contenido y uso) · CELF-5 y CELF Preschool (lenguaje comprensivo y expresivo) · BLOC-SR (morfosintaxis, semántica y pragmática) · ITPA (aptitudes psicolingüísticas) · Peabody PPVT-III (vocabulario receptivo) · Registro Fonológico Inducido (producción fonológica en denominación y en repetición) · tarea de repetición de pseudopalabras (memoria fonológica de trabajo).
· Lectura, escritura y cálculo: PROLEC-R (procesos lectores en Primaria) y PROLEC-SE-R (Secundaria) · TALE-2000 (lectura y escritura) · PROESC (procesos de escritura: dictado, ortografía y composición) · EVAMAT (competencia matemática por curso) · TEDI-MATH (competencias numéricas básicas al final de Infantil y principio de Primaria).
· Neurodesarrollo y conducta: ADOS-2 (observación estructurada de comunicación social y conducta restringida) y ADI-R (entrevista a la familia), las dos con formación acreditada y las dos se proponen por su área · SCQ y SRS-2 (cribado de comunicación social; por su área) · EDAH (escala para profesorado en Primaria; por su área) · escalas de Conners (familia, profesorado y autoinforme; por su área) · SENA (emocional, conductual y contextual, de Infantil a la adolescencia) · BASC (conducta y adaptación) · CBCL (problemas emocionales y conductuales) · Vineland y ABAS (conducta adaptativa y autonomía).
· Sensorial y motor: Perfil Sensorial (patrones de procesamiento sensorial; cuestionario a la familia y al aula) · SPM (procesamiento sensorial y praxis) · MABC-2 (coordinación motora) · Beery VMI (integración visomotora, con sus pruebas complementarias de percepción visual y coordinación motora).
· Emocional: STAIC (ansiedad estado/rasgo en niños y preadolescentes) y STAI (adolescentes y adultos) · CDI (sintomatología depresiva) · SCARED (ansiedad; autoinforme y versión para la familia).

SEÑALES DEL MATERIAL QUE ABREN UNA PROPUESTA (solo si constan escritas u observadas)
· Habla poco inteligible, sustituciones u omisiones de fonemas en habla espontánea que no aparecen en repetición, vocabulario escaso, frases cortas → lenguaje; y antes, audición.
· Lectura lenta y silabeada, con sustituciones y autocorrecciones, mientras la comprensión se sostiene cuando se le lee el enunciado en voz alta → conviene acotar por separado decodificación y comprensión.
· Ortografía arbitraria, texto que no se organiza, trazo costoso → escritura y grafomotricidad.
· Errores con hechos numéricos básicos, conteo con dedos a edades avanzadas, dificultad con la recta numérica → competencia matemática.
· Se levanta, pierde el hilo, empieza y no termina, olvida el material → atención y funciones ejecutivas, con medida de rendimiento Y cuestionario a familia y aula: una sola fuente y una sola situación no bastan.
· Dificultad para sostener el intercambio, intereses muy restringidos, literalidad, malestar ante los cambios → comunicación social y perfil adaptativo, por profesional con formación específica.
· Rechazo de texturas, ruidos o etiquetas, búsqueda constante de movimiento, torpeza, caídas → procesamiento sensorial y coordinación.
· Irritabilidad, quejas somáticas antes de ir al colegio o al trabajo, retirada social, verbalizaciones de desvalorización → área emocional.
· Cambio brusco de rendimiento o de conducta → aquí no se propone una prueba: conviene recoger con la familia qué ha cambiado alrededor.

DERIVACIÓN: A QUIÉN Y CON QUÉ SEÑAL. Se propone la especialidad —nunca un profesional con nombre— y se dice POR QUÉ, con lo observado. En lo público la puerta suele ser el pediatra o el médico de cabecera: cuando proceda, dilo así. Si el centro tiene su propio catálogo de derivaciones, muévete dentro de él.
· Otorrino o audiología: habla poco inteligible, no responde a la llamada, sube el volumen, pide repetir, otitis de repetición, lenguaje que no arranca.
· Oftalmología u optometría: se acerca mucho al papel, pierde la línea al leer, entrecierra los ojos, cefaleas al final del día, escritura que se sale del renglón.
· Neuropediatría o neurología: pérdida de habilidades ya adquiridas, desconexiones o ausencias, movimientos repetitivos involuntarios, cefalea con vómitos, retroceso del lenguaje, retraso motor.
· Salud mental infanto-juvenil o psiquiatría: sintomatología emocional intensa o mantenida, autolesiones, ideación autolítica, conducta alimentaria alterada, o una valoración que excede lo que el centro puede hacer.
· Orientación del centro escolar (departamento de orientación o EOEP): necesidades educativas, adaptaciones y apoyos, cuando lo observado afecta al aula y las medidas tienen que tomarse allí.
· Atención temprana (CDIAT): menores de seis años con retraso o riesgo en el desarrollo. Hay lista de espera: se propone pronto.
· Servicios sociales: cuando lo que consta apunta a necesidades básicas sin cubrir, absentismo o desprotección. Se describe lo que consta; no se califica.
· Y las del catálogo del centro cuando el material lo justifique: fisioterapia, traumatología, nutrición.

LAS SITUACIONES GRAVES —ideación autolítica, autolesiones, sospecha de desprotección, pérdida de habilidades ya adquiridas— solo se escriben si constan dichas con claridad en el material, y con las palabras de la profesional: no las deduzcas de una frase ambigua ni las conviertas tú en una alarma. Y al revés: si constan, no las suavices ni las omitas. Se recogen sin adjetivos y sin juicio, con la derivación que corresponda.

LO QUE NO SE HACE AQUÍ: no se propone una prueba para «confirmar» ni para «descartar» una etiqueta («valorar TEA», «descartar TDAH»): se propone valorar un ÁREA o un proceso, y quien concluye es la profesional. No inventes nombres ni versiones (no existen WISC-VI ni PROLEC-3): si no estás seguro del nombre exacto, di el tipo —«una prueba estandarizada de procesos lectores»—, que en un documento clínico vale igual y no se puede desmentir. Y una derivación tampoco es un diagnóstico: se deriva por lo observado, no «por epilepsia» ni «por dislexia».`,
});

/** El orden en que se leen, que no es el alfabético: primero a quién se escribe. */
export const ORDEN_BLOQUES = Object.freeze([
  "cicloVital",
  "neurodesarrollo",
  "lenguaje",
  "ocupacional",
  "aprendizaje",
  "emocional",
  "evaluacion",
]);

/**
 * El saber clínico entero, listo para meter en el prompt.
 *
 * Va precedido de su cartel: sin él, el modelo puede leer una lista de
 * marcadores como una lista de comprobación y acabar afirmando en negativo lo
 * que nadie observó («no se aprecian inversiones»), que es el fallo que más
 * veces salió al revisarlo.
 */
export function saberClinico() {
  return [
    "SABER CLÍNICO. Lo que viene es VOCABULARIO Y CRITERIO para que nombres con precisión lo que la profesional ha descrito, no una lista que rellenar ni un cuestionario que pasar. Tres reglas sobre todo esto, y mandan sobre cualquier cosa que leas más abajo:",
    "1. Un proceso, un sistema o una habilidad de los que el material NO habla, NO se nombran. Ni siquiera para decir que están conservados, que son adecuados o que están dentro de lo esperable: eso es afirmar sobre algo que nadie ha mirado.",
    "2. Nada de aquí es un criterio que se cumple. Que lo descrito encaje con lo que lees no autoriza a concluir: autoriza a NOMBRARLO mejor y, si acaso, a decir qué convendría valorar.",
    "3. Los ejemplos vienen en contexto escolar porque es el más frecuente, pero un cuarto de los pacientes son adultos. Con un adulto, los mismos procesos se describen en SU contexto —trabajo, estudios, casa, pareja, autonomía— y no se habla de «el niño», de «los papás» ni de «el cole».",
    ...ORDEN_BLOQUES.map((k) => BLOQUES[k]),
  ].join("\n\n");
}
