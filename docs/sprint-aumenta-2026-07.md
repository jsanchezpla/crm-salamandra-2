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

## 1.b DESPLEGADO en producción el 31/07 (bloque 3 + bloque 4)

> Desplegado desde el commit `3333bec`. Copia de seguridad previa en el VPS:
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
- **1.4** agregado por terapeuta de los contadores trimestrales (para el
  programa de incentivos).

### 3.4 — Bloque 5: administración
- **8** cobros editables, con notas y **sin factura asociada**
  (`payments.invoice_id` ya es nullable, `client_id` y `period_month` añadidos).
- **8** sección **Morosidad** dentro de Cobros.
- **6.1** faltas justificadas/no justificadas: `Booking.noShowJustified` y
  `noShowReason` ya existen. Falta UI + notificación a administración.
- **9** lista de espera de **clientes**: modelo `WaitlistEntry` ya existe.
  ⚠️ **No confundir** con la «Lista de espera» que ya hay en Citas, que son
  solicitudes de reserva pendientes. Son cosas distintas con el mismo nombre:
  hay que decidir cómo se llaman para no liar al usuario.

### 3.5 — Bloque 6: Estadísticas (punto 10)
Sprint aparte, como marca el propio brief.

---

## 4. Trampas (esto es lo que ahorra tiempo)

1. **El servidor de desarrollo puede no ser tuyo.** Rodrigo trabaja en
   PARALELO en el mismo árbol (módulo de Analíticas Cloudflare para Spain
   Enzymes). Su `npm run dev` ocupa el 3000 y sirve TU código, porque es la
   misma carpeta. **Commitea con `git add <rutas>`, nunca `git add -A`**: en el
   commit `48804fa` se coló su módulo a medias y el mensaje no lo menciona.

2. **Compilar no es probar.** Los festivos compilaban y estaban rotos: faltaba
   un `import` y el endpoint reventaba con `cargarFestivos is not defined`.
   Solo salió al llamar al endpoint de verdad. Y peor: la comprobación con la
   que lo «verifiqué» estaba mal, porque buscaba la palabra en el fichero y
   aparecía por el USO, no por el import. **Comprueba `^import`, no la palabra.**

3. **Un modelo con columnas nuevas sin migración = 500 en producción.** Los
   endpoints de Desempeño devolvían `no existe la columna role_key`. La
   migración existía y nunca se había ejecutado. Antes de desplegar, arranca y
   **llama a los endpoints**, no te fíes del build.

4. **Migración nueva → registrarla en `scripts/_module-migrations.js`.**
   `node scripts/check-migration-order.js` la caza. Si no está, un cliente dado
   de alta desde el panel nace sin esas tablas y sus pantallas dan 503.

5. **JSONB no se compara con arrays de JS por Sequelize.** El filtro de tutores
   va en SQL crudo: `Client.sequelize.literal("jsonb_array_length(guardians) > 0")`.

6. **Un hash bcrypt no sobrevive a `ssh` + `psql`**: el shell se come los `$` y
   el login da 401 como si fuera un bug del código. Generar y guardar dentro
   del MISMO `node -e`.

7. **`docker exec` corre los scripts de la IMAGEN, no del checkout del host.**
   Si editas un script, hay que reconstruir el contenedor antes de ejecutarlo.

8. **La demo pública da sesión de ADMIN a visitantes anónimos.** Todo endpoint
   nuevo que mande correo, gaste IA o escriba en master necesita su guard de
   `lib/demo/isDemo.js`.

---

## 5. Pendientes manuales (no son código)

- **Migración de la retención de tarjeta** (`migrate-booking-authorization`,
  del sprint de pagos): el modelo `Booking` pide `authorization_expires_at` y en
  local no estaba, así que CUALQUIER consulta de citas —incluido el portal de la
  familia— devolvía 500. Se ejecutó en local el 31/07 (`npm run
  db:migrate:booking-auth`) y **hay que ejecutarla en producción antes o durante
  el próximo despliegue**. De paso se registró en `_module-migrations.js` (no
  estaba: un cliente nuevo con Citas nacía sin esas columnas) y se declaró su
  arista de orden.

- **Agenda compartida de Aumenta**: está APAGADA. Para que las terapeutas se
  vean las citas entre ellas hay que encenderla en Configuración. No se activó
  por decisión: expone nombre, email y teléfono del paciente a toda la
  plantilla, y eso lo decide el centro.
- **Resend**: sigue sin configurar. Sin él no sale ningún correo — el CRM lo
  dice en vez de mentir, pero los recordatorios de cita no sirven hasta
  entonces.
- **App OAuth de Google** (Calendar/Meet): pendiente, bloquea la integración
  real de videollamada.

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
