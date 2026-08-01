# Sprint Aumenta (formación 28/07/2026) — traspaso a sesión nueva

Estado a **31/07/2026**. Este documento existe para que una sesión limpia pueda
continuar sin releer el historial. Lo importante está en «Trampas»: son cosas
que ya han mordido una vez.

---

## 1. Qué está HECHO y DESPLEGADO en producción

| Punto | Qué | Verificado |
| --- | --- | --- |
| 3.1 | «Admisión» → **Entrevista inicial**; tipo **Derivación** nuevo. Endpoints y las dos pantallas leen el catálogo compartido (`lib/clinica/serialize.js`), antes duplicado en 5 sitios | sí |
| 8 (parcial) | Cobros: columna **Cliente** + enlace a la factura; los cobros sin factura salen marcados | sí, en demo |
| 6.2 | **Multi-responsable** en incidencias (tabla pivote, patrón `task_assignees`). `assignedToId` queda como espejo del principal | sí |
| 5 | **Festivos y cierres** del centro: el widget deja de dar hueco, la reserva pública lo rechaza aunque manden el POST a mano, y el alta manual avisa pero deja forzar | sí |
| 5 | **Agenda compartida** por tenant (`settings.citas.agendaCompartida`), **apagada por defecto** | sí |
| 11 | Apellido de Silvia corregido en producción (Fernández → **Hernández**) y en el seed | sí |
| 1.3 | **Plan de intervención**: endpoint + pestaña «Plan» en la ficha del paciente, con cumplimiento por trimestre escolar | sí |
| 1.2 | **Familias con dos tutores**, cada uno con su acceso al portal | sí |

Commits: `0d474c7` (bloque 1), `48804fa` (plan de intervención), `29cc4ef` (tutores).

Migraciones **ya ejecutadas en producción**:
```
node scripts/migrate-clinica-performance-roles.js
node scripts/migrate-sprint-aumenta-2026-07.js
```

---

## 1.a DESPLEGADO en producción el 01/08 (Leads en dos orígenes, paquetes)

> Desde `f259c45`. Copia previa en `/opt/backups-pre-leads-20260801.dump`.
>
> - **Leads pasa a ser un grupo con dos orígenes**, nombrados por su origen:
>   **Profesionales** (el embudo de siempre, `/leads`) y **Comerciales** (lo que
>   entra por la web, el antiguo Formularios). En el menú van sin la palabra
>   «Leads» delante; dentro de cada pantalla, completa. Cambiado en el módulo por
>   defecto y en los siete overrides por tenant. Aumenta y sandbox conservan
>   «Interesados» para el grupo.
> - **Pantalla nueva: `/leads/estadisticas`**, que es el PADRE del grupo en el
>   menú. Entrada por mes con los dos orígenes, embudo por etapa, orígenes y
>   estado de la bandeja. Quien no tiene Comerciales no ve ese bloque.
> - **`formularios` ahora requiere `leads`** y se ACTIVÓ en `aumenta` (con sus
>   migraciones). Su bandeja empieza vacía: el despliegue web de Aumenta —dos
>   tipos de formulario, portal— es una iteración futura.
> - **La lista de espera de admisión sale de `clients` a `clients_avanzado`**
>   (`migrate-clients-avanzado.js`, dada a `aumenta` y `demo`). Cerrada por menú,
>   pantalla (`notFound()`) y API. El paquete Nutrición lleva Clientes SIN ella.
> - **El alta de clientes estrena PAQUETES** (`lib/provisioning/catalogo.js`):
>   «Paquete Nutrición» = `citas, clients, leads, formularios, team, documents,
>   nutricion`. Formación queda fuera, es un extra de Laura. De paso entran al
>   catálogo `documents_avanzado` y `clients_avanzado`.
>
> Verificado en producción con sesión de la demo: `/leads/estadisticas`,
> `/leads`, `/formularios` y `/clientes/lista-espera` a 200, el endpoint
> devolviendo cifras reales, cero errores en el log.

## 1.b DESPLEGADO en producción el 31/07 (bloques 3, 4, 5 y 6)

> **Segundo despliegue del día, desde `34a5cfb`**: resto del bloque 4, bloque 5
> entero y las estadísticas. Copia previa en `/opt/backups-pre-b456.dump`. Sin
> migraciones (todo usa tablas y columnas que ya existían). Verificado:
> estadísticas, planes por terapeuta, coordinaciones, derivaciones, morosidad y
> lista de espera a 200; Excel y PDF descargando; las tres páginas nuevas a 200;
> cero errores en el log.
>
> Primer despliegue, desde el commit `3333bec`. Copia de seguridad previa en el VPS:
> `/opt/backups-pre-sprint3.dump`. Migraciones ejecutadas:
> `migrate-booking-authorization` (la del sprint de pagos, que faltaba) y
> `migrate-contract-patient-to-client`, que en producción **no tenía nada que
> mover**: ningún paciente tenía contrato subido (el reset del 24/07 dejó el
> módulo clínico vacío). Verificado tras el despliegue: `/login` 200, endpoints
> de contrato, meses del portal, coordinaciones y derivaciones a 200, páginas
> nuevas a 200 y cero errores en el log del contenedor.

**Punto 1.1 — el contrato pasa del paciente al cliente.** El contrato es de la
FAMILIA: quien firma y quien paga son los padres, y con dos hermanos en el
centro había dos contratos para una misma familia.

- El PDF ya no tiene almacén propio: es una fila de `documents`
  (`source='contrato'`, `client_visible=true`) y `clients.contract_document_id`
  apunta a ella. Lógica compartida en `lib/clients/clientContract.js`.
- Endpoints nuevos: `GET/POST/DELETE /api/clients/[id]/contract` y
  `GET /api/clients/[id]/contract/download`. Solo PDF, validado por **magic
  bytes**; auditado (`client.contract.uploaded` / `.deleted`).
- UI: sección «Contrato» en la ficha del cliente
  (`components/clients/ClientContractSection.jsx`). La ficha del paciente ya
  solo lo MUESTRA y enlaza a la del cliente; el alta de paciente perdió el
  check «Contrato firmado» y la subida de PDF.
- `POST` y `DELETE` de `/api/pacientes/[id]/contract` **retirados**; el `GET`
  sobrevive solo para descargar lo que la migración no pueda mover.

**Al desplegar hay que ejecutar la migración de datos** (dry-run por defecto):

```
docker exec crm-salamandra-app-1 node scripts/migrate-contract-patient-to-client.js
docker exec crm-salamandra-app-1 node scripts/migrate-contract-patient-to-client.js --confirm
```

Mueve el contrato solo si el paciente tiene cliente pagador; con dos hermanos
con contrato mueve el más reciente y lista el otro. **Copia** el PDF (el
original sigue en `{uploads}/{slug}/patients/{id}/`) y deja un `.rollback.sql`.

Probado en local de punta a punta: subida, rechazo de un no-PDF, descarga,
borrado idempotente, y la migración con su rollback aplicado de verdad.

**Puntos 2.1 y 2.2 — firma web del contrato y doble firma.** Al entrar al
portal, el contrato tapa la pantalla hasta que se firma (con «Lo firmo más
tarde», que deja ver las citas pero no los documentos).

- `GET/POST /api/public/c/[slug]/citas-portal/contract{,/sign,/documento}`;
  lógica común en `lib/citas/portalContract.js`. Firma dibujada en canvas →
  PNG + fecha + IP + navegador en `ContractSignature`
  (`lib/clients/signatureStorage.js`, fuera del archivo de documentos).
- **Quién firma**: los tutores marcados; si la ficha no tiene tutores, el
  titular (`effectiveSigners`). Sin ese respaldo la familia se quedaba
  encerrada en una puerta sin llave, porque `contractFullySigned` devuelve
  false cuando no hay firmantes.
- **Padres separados**: hacen falta las dos firmas; el que ya firmó ve el aviso
  de que falta el otro y la documentación sigue cerrada para ambos.
- **Mis documentos** queda cerrado del todo mientras falte una firma (ni ver ni
  subir), también en la descarga directa de un documento por su enlace.
- El contrato **en papel** subido a la ficha cuenta como firmado y desactiva la
  firma web.
- Pantalla nueva en el CRM: «Padres y tutores»
  (`components/clients/ClientGuardiansSection.jsx`). El endpoint de tutores
  existía desde el 29/07 pero NO había pantalla: sin ella ninguna familia podía
  tener dos firmantes.

Probado en local contra el servidor: bloqueo → firma → desbloqueo, PNG
inválido rechazado, doble firma (madre firma → sigue cerrado → firma el padre →
se abre), contrato en papel saltándose la firma, y la pantalla del portal con
el «lo firmo más tarde».

**Punto 2.3 — bloqueo mensual por impago.** `settings.citas.portalBloqueoImpago`
(interruptor en Configuración), **apagado por defecto**. Con él encendido, la
familia ve los documentos de un mes solo si consta el cobro de ese mes
(`Payment.periodMonth` completado) o si administración lo abre a mano
(`Client.portalUnlockedMonths`). Regla única en `lib/citas/portalMeses.js`,
aplicada también en la descarga individual.

- Lo que sube la familia NO se bloquea nunca: es suyo.
- El portal dice qué meses tiene retenidos y cuántos documentos hay; esconder
  un informe sin explicación es peor que nombrar el mes pendiente.
- Ficha del cliente → «Acceso al portal por meses»
  (`GET/PUT /api/clients/[id]/portal-months`, auditado).
- ⚠️ Encenderlo en un centro que no registra los cobros con su mes esconde de
  golpe la documentación de TODAS las familias. Por eso nace apagado.

**Punto 3.2 — «Enviar al paciente».** `POST /api/clinica/reports/[id]/enviar`
exporta el informe a PDF (`lib/clinica/reportPdf.js`), lo publica como documento
visible para la familia (`source='informe'`) y lo enlaza en
`deliveredDocumentId`. Antes, «Marcar como entregado» solo cambiaba el estado:
no entregaba nada. Reenviar sustituye el PDF anterior. Detalle en
`docs/modules/clinica.md`.

Probado en local: informe enviado → PDF de 13 KB descargado DESDE el portal;
bloqueo por impago escondiendo los dos documentos de julio (y devolviendo 403 en
la descarga directa), apertura a mano desde la ficha y apertura automática al
registrar el cobro del mes.

---

## 2. Decisiones cerradas con Rodrigo (29/07) — NO reabrir

1. **1.2 familias**: UN cliente con VARIOS tutores (`Client.guardians` JSONB), no
   dos fichas. Con separados hay dos personas pero una familia y un paciente;
   partirlo obligaría a decidir de quién es cada factura y bifurcaría el
   desbloqueo mensual del portal.
2. **5 videollamada**: campo de **enlace externo** por cita (pegar el link de
   Zoom). NO integración con la API de Zoom.
3. **7 coordinaciones**: **módulo propio** en el menú con listado general, y
   además botón «Nueva coordinación» desde la ficha del paciente.
4. **2.2 doble firma**: el que ya firmó ve **su contrato firmado y un aviso de
   que falta el otro**. La documentación del paciente sigue bloqueada para
   ambos.
5. **1.4 secuenciación**: va **por paciente** (`InterventionPlan.reportSchedule`),
   no un estándar único del centro. Ya implementado.
6. **6.1 destinatario de faltas**: lista configurable de usuarios por tenant,
   nunca Olga a fuego. Helper listo en `lib/notifications/notifyUsers.js`.

---

## 3. Lo que QUEDA, en orden

### 3.1 — Punto 1.1: el contrato, del paciente al cliente
**HECHO en local el 31/07** (ver sección 1.b). Falta desplegar y correr la
migración. `patients.contractSigned` queda como columna legada, sin uso en la UI.

### 3.2 — Bloque 3: área privada del cliente
- **2.1** firma web del Contrato del Centro — **HECHO en local** (sección 1.b).
- **2.2** doble firma — **HECHO en local** (sección 1.b).
- **2.3** bloqueo mensual por impago — **HECHO en local** (sección 1.b).
- **3.2** «Enviar al paciente» — **HECHO en local** (sección 1.b).

### 3.3 — Bloque 4: clínico
- **4** registro de sesión en 3 partes — **HECHO en local** (31/07):
  preparación (texto + adjuntos), informe y devolución de la familia. Las
  partes 1 y 3 se pueden rellenar después, desde el cajón de la sesión.
  Adjuntos en `/api/clinica/sessions/[id]/prep-files` (fotos/audio/PDF, 10 por
  sesión); NO son documentos del archivo a propósito — detalle en
  `docs/modules/clinica.md`.
- **3.1** informe de evolución con selección libre de registros de sesión —
  **HECHO en local** (31/07): al crear un informe evolutivo se marcan las
  sesiones que lo alimentan (`contentSections.sourceSessionIds`).
- **3.1** catálogo de derivación — **HECHO en local** (31/07): vive en
  `settings.clinica.referralSpecialties`, se edita en Configuración y se elige
  al crear un informe de derivación. Renombrar una etiqueta NO rompe los
  informes ya escritos (apuntan a la clave, que se conserva).
- **7** coordinaciones — **HECHO en local** (31/07): módulo propio en el menú
  (`/clinica/coordinaciones`) con listado general y filtros, más el botón
  «Nueva coordinación» en la pestaña de la ficha del paciente. El POST ya
  guarda `scope` y `externalEntity`, y resuelve solo quién la registra.
- **1.4** agregado por terapeuta de los contadores trimestrales — **HECHO en
  local** (31/07): `GET /api/clinica/performance/planes` y su tabla en Equipo →
  Dirección, con selector de trimestre. Cuenta sobre los informes y las
  sesiones REALES, igual que la pestaña «Plan» del paciente, así que los dos
  números no pueden contradecirse. Cada parte se topa a lo previsto: hacer 20
  registros de más no compensa un informe sin entregar, que es justo lo que
  mide el incentivo.

### 3.4 — Bloque 5: administración — **HECHO en local el 31/07**

- **8 cobros**: se puede registrar un cobro SIN factura, con su cliente y su
  **mes** (`periodMonth`), que es el flujo real del centro —se cobra la cuota y
  se factura después— y además es lo que abre los documentos de ese mes en el
  área privada. Los cobros ya registrados se editan desde la pantalla (importe,
  método, fecha, estado y notas), auditado; antes había que tocar la base de
  datos a mano.
- **8 morosidad**: `GET /api/billing/morosidad?mes=AAAA-MM` y su panel dentro de
  Cobros. Debe quien tiene un paciente ACTIVO y no tiene cobro de ese mes —el
  MISMO criterio que abre el portal, para que Cobros y el área privada no se
  contradigan— con los meses seguidos que acumula.
- **6.1 faltas**: al marcar «No asistió» se pregunta si la falta estaba
  justificada y por qué. Las NO justificadas avisan a administración
  (`settings.citas.avisoFaltas`; sin lista configurada, a los usuarios con rol
  admin — por rol y no por persona, que quien se va de vacaciones no se lleve
  los avisos).
- **9 lista de espera**: `/clientes/lista-espera`, con alta, reordenar y
  «Convertir en cliente» (crea la ficha y deja la entrada enlazada, para poder
  responder cuánto esperó cada familia). **Se llama «Lista de espera de
  admisión»** para no confundirla con la de Citas, que son solicitudes de
  reserva: era la decisión pendiente del brief.

Probado contra el servidor: cobro sin factura creado y desapareciendo de
morosidad, falta sin justificar generando el aviso a administración, y el alta
y listado de la lista de espera.

### 3.4.bis — lo que era el bloque 5 (referencia)
- **8** cobros editables, con notas y **sin factura asociada**
  (`payments.invoice_id` ya es nullable, `client_id` y `period_month` añadidos).
- **8** sección **Morosidad** dentro de Cobros.
- **6.1** faltas justificadas/no justificadas: `Booking.noShowJustified` y
  `noShowReason` ya existen. Falta UI + notificación a administración.
- **9** lista de espera de **clientes**: modelo `WaitlistEntry` ya existe.
  ⚠️ **No confundir** con la «Lista de espera» que ya hay en Citas, que son
  solicitudes de reserva pendientes. Son cosas distintas con el mismo nombre:
  hay que decidir cómo se llaman para no liar al usuario.

### 3.5 — Bloque 6: Estadísticas (punto 10) — **HECHO en local el 31/07**

Módulo propio: `/clinica/estadisticas` (solo dirección), con selector de
periodo (mes, trimestre, curso o fechas libres) y descarga en **Excel y PDF**.
Tres bloques, los que pidió Rodrigo:

- **Actividad clínica**: pacientes activos y en pausa, altas y bajas del
  periodo, sesiones e informes por terapeuta, % de informes entregados en
  plazo y pacientes activos por especialidad.
- **Agenda y ausencias**: citas por estado, faltas justificadas vs sin
  justificar y tasa de ausencias por profesional. La tasa se calcula sobre las
  citas que LLEGARON A SU HORA (atendidas + no presentadas), igual que el
  informe de ocupación: cancelar avisando no penaliza.
- **Captación**: leads por origen, cómo entran los clientes nuevos (lead,
  lista de espera o alta directa) y cuánto se espera de media.

El **dinero se queda fuera a propósito** (decisión de Rodrigo): vive en
Facturación —cobros y morosidad— y duplicarlo aquí sería duplicar la verdad.

El cálculo vive UNA sola vez en `lib/clinica/estadisticas.js` y lo comparten la
pantalla, el Excel y el PDF: si contase cada salida por su cuenta, el papel que
se lleva a la reunión de dirección y el CRM acabarían diciendo cosas distintas.

---

## 4. Trampas (esto es lo que ahorra tiempo)

1. **El servidor de desarrollo puede no ser tuyo.** Rodrigo trabaja en
   PARALELO en el mismo árbol (módulo de Analíticas Cloudflare para Spain
   Enzymes). Su `npm run dev` ocupa el 3000 y sirve TU código, porque es la
   misma carpeta. **Commitea con `git add <rutas>`, nunca `git add -A`**: en el
   commit `48804fa` se coló su módulo a medias y el mensaje no lo menciona.

2. **El contenedor NO compila: se lleva el `.next` del host.** El Dockerfile
   hace `COPY .next ./.next`. Si se lanza `docker compose up -d --build` sin
   `npm run build` antes, ese COPY sale **CACHED**, el contenedor arranca sin
   una sola queja y sirve el código VIEJO. Las rutas nuevas ni siquiera dan
   404: las come la ruta dinámica hermana (`/api/leads/estadisticas` cayó en
   `/api/leads/[id]` y dio 500 «invalid input syntax for type uuid»). Pasó el
   01/08. Comprobación: `docker exec crm-salamandra-app-1 grep -o
   "api/ruta/nueva" /app/.next/routes-manifest.json`.
   Y no esperar el build con `until ! pgrep -f 'next build'`: el propio `bash
   -c` contiene esa cadena, se encuentra a sí mismo y el bucle no acaba nunca.

3. **Compilar no es probar.** Los festivos compilaban y estaban rotos: faltaba
   un `import` y el endpoint reventaba con `cargarFestivos is not defined`.
   Solo salió al llamar al endpoint de verdad. Y peor: la comprobación con la
   que lo «verifiqué» estaba mal, porque buscaba la palabra en el fichero y
   aparecía por el USO, no por el import. **Comprueba `^import`, no la palabra.**

4. **Un modelo con columnas nuevas sin migración = 500 en producción.** Los
   endpoints de Desempeño devolvían `no existe la columna role_key`. La
   migración existía y nunca se había ejecutado. Antes de desplegar, arranca y
   **llama a los endpoints**, no te fíes del build.

5. **Migración nueva → registrarla en `scripts/_module-migrations.js`.**
   `node scripts/check-migration-order.js` la caza. Si no está, un cliente dado
   de alta desde el panel nace sin esas tablas y sus pantallas dan 503.

6. **JSONB no se compara con arrays de JS por Sequelize.** El filtro de tutores
   va en SQL crudo: `Client.sequelize.literal("jsonb_array_length(guardians) > 0")`.

7. **Un hash bcrypt no sobrevive a `ssh` + `psql`**: el shell se come los `$` y
   el login da 401 como si fuera un bug del código. Generar y guardar dentro
   del MISMO `node -e`.

8. **`docker exec` corre los scripts de la IMAGEN, no del checkout del host.**
   Si editas un script, hay que reconstruir el contenedor antes de ejecutarlo.

9. **Una feature del PORTAL cae sobre el único tenant que tiene portal, y no
   es Aumenta: es `nutri_laura`, que es un CRM en uso REAL.** El cerrojo del
   contrato se escribió para Aumenta y se activaba con solo tener el portal
   encendido; al desplegarlo (31/07), a las pacientes de Laura les apareció una
   pantalla completa pidiéndoles firmar un contrato inexistente. Arreglado
   condicionándolo a que el centro haya subido su Contrato del Centro. Antes de
   desplegar algo del portal: `SELECT slug, settings->'widget'->'sso'->>'enabled'
   FROM master.tenants` y piensa en ESOS tenants, no en el que te lo pidió.

10. **La demo pública da sesión de ADMIN a visitantes anónimos.** Todo endpoint
   nuevo que mande correo, gaste IA o escriba en master necesita su guard de
   `lib/demo/isDemo.js`.

---

## 5. Pendientes manuales (no son código)

- **Migración de la retención de tarjeta** (`migrate-booking-authorization`,
  del sprint de pagos): el modelo `Booking` pide `authorization_expires_at` y en
  local no estaba, así que CUALQUIER consulta de citas —incluido el portal de la
  familia— devolvía 500. Se ejecutó en local el 31/07 (`npm run
  db:migrate:booking-auth`) y **ya se ejecutó en producción el 31/07**, durante
  el despliegue del bloque 3. De paso se registró en `_module-migrations.js` (no
  estaba: un cliente nuevo con Citas nacía sin esas columnas) y se declaró su
  arista de orden.

- ~~**Agenda compartida de Aumenta**~~: **ENCENDIDA el 31/07** a petición de
  Rodrigo. Todo el equipo ve ahora la agenda completa; el listado enseña
  nombre, email y teléfono del paciente, así que el centro debería saberlo.
- **Resend**: sigue sin configurar. Sin él no sale ningún correo — el CRM lo
  dice en vez de mentir, pero los recordatorios de cita no sirven hasta
  entonces.
- **App OAuth de Google** (Calendar/Meet): pendiente, bloquea la integración
  real de videollamada.
- **Consentimiento de comunicaciones (01/08, ya en producción)**: al entrar al
  área privada, la familia marca por dónde quiere que se le escriba (correo,
  WhatsApp, novedades). Como el portal solo lo tiene encendido `nutri_laura`,
  **hoy la pantalla la verán sus pacientes REALES** la próxima vez que entren;
  Aumenta la verá el día que encienda el portal. Nadie pierde avisos por esto:
  mientras no contesten valen los valores por defecto (correo sí, WhatsApp no).
- **Documentos básico para nutri_laura (01/08, ya en producción)**: se le activó
  el módulo `documents` (solo el Contrato de Prestación de Servicios). Ya puede
  subir el suyo desde Documentos; en cuanto lo suba, sus pacientes tendrán que
  firmarlo al entrar al portal. `demo` y `aumenta` recibieron
  `documents_avanzado` para no perder el archivo completo.
- **Claves de nutri_laura**: pendiente dárselas la semana del 04/08 para que
  pueda configurar ella misma Resend, WhatsApp y lo que necesite.
- **Para que Aumenta use la firma del portal**: hay que subir su **Contrato del
  Centro** (ficha de un paciente → contrato estándar) y **encenderles el
  portal**, que hoy tienen apagado. Sin contrato estándar subido no se le pide
  la firma a nadie, por diseño (ver trampa 8).
- **Destinatarios del aviso de faltas**: sin configurar,
  `settings.citas.avisoFaltas` está vacío y el aviso va a todos los usuarios
  con rol admin. Si el centro quiere que vaya solo a administración, hay que
  poner ahí sus ids.

---

## 6. Entorno

- Repo: `C:\Claude Code\crm-salamandra-2` (el brief decía `C:\Dev\...`, no existe).
- Producción: `root@187.124.51.178`, repo en `/opt/crm-salamandra`.
- Ritual: copia de seguridad → `git pull` → `npm run build` en el host →
  `docker compose up -d --build --no-deps app` → **migraciones** → verificar
  endpoints y log.
- Contenedores: `crm-salamandra-app-1`, `crm-salamandra-db-1` (BD `salamandra`,
  usuario `crm_user`).
- El clasificador veta comandos `ssh` largos de forma aleatoria: comandos
  cortos.

---

## 7. Cómo arrancar la sesión nueva

> Continúa el sprint Aumenta. Lee `docs/sprint-aumenta-2026-07.md` antes de
> tocar nada. El **bloque 3 está entero en local, sin desplegar** (1.1, 2.1,
> 2.2, 2.3 y 3.2 — ver sección 1.b), y del bloque 4 está hecho el **registro de
> sesión en 3 partes**. Lo siguiente del bloque 4: informe de evolución con
> selección libre de sesiones, catálogo de derivación editable por tenant,
> coordinaciones (botón + módulo del menú) y el agregado trimestral por
> terapeuta. Después, el bloque 5 (cobros, morosidad, faltas, lista de espera). Rodrigo puede estar trabajando en paralelo en el
> mismo árbol: commitea solo tus ficheros.
