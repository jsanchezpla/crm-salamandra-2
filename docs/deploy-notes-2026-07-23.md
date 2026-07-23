# Deploy pendiente — sprint conexión cliente/equipo + arreglos de bugs (2026-07-23)

Master acumula desde el deploy del 19-jul: **Formularios** (bandeja pública →
ficha), **unificación de Citas** (override nutri_laura como default, doble
clic/arrastre en calendario, globito de pendientes, enlace `bookings.client_id`),
**conexión cliente/equipo** (enlaces reales en documentos, clínica, planes,
interacciones, notas y formularios), **Documentos transversal** (una tabla para
todos, acepta cualquier fichero, buscador con filtro por cliente/origen) y el
**sprint de arreglos** de la revisión de bugs (commit `80a1996`: RGPD en el
audit_log, los dos 42703 que quedaban, IP real en el rate-limit, antispam en la
reserva pública, etc.).

Orden EXACTO en el VPS. **Las migraciones van ANTES del deploy** (la app nueva
lee columnas nuevas — `bookings.client_id`, `documents.client_id`/`source`,
`clinic_sessions/clinical_reports/coordinations.client_id`, `plans.team_member_id`,
`interactions.team_member_id`, `client_notes.team_member_id`,
`form_submissions.handled_by_team_id`; si arranca sin ellas → 42703 en toda
lectura). **Todo es aditivo e idempotente**: se corre la lista COMPLETA en orden
canónico; las que ya estén aplicadas son un no-op (`ADD COLUMN IF NOT EXISTS`,
`CREATE TABLE IF NOT EXISTS`). Multi-tenant: leen `master.tenants`, toleran
schemas parciales, re-ejecutar es inofensivo.

```bash
ssh <vps>                       # acceso habitual al VPS
cd /opt/crm-salamandra

# ── 0) SALVAGUARDA: copia de la BD y de uploads ANTES de tocar nada ──────────
#     (hay pacientes reales de Laura; esta copia es el botón de deshacer)
docker exec crm-salamandra-db-1 pg_dump -U postgres salamandra \
  | gzip > ~/backup-salamandra-$(date +%Y%m%d-%H%M).sql.gz
tar czf ~/backup-uploads-$(date +%Y%m%d-%H%M).tar.gz -C /opt/crm-salamandra uploads

# ── 1) Bajar el código ───────────────────────────────────────────────────────
git pull                        # debe traer hasta 80a1996

# ── 2) MIGRAR ANTES DEL DEPLOY — lista completa en orden canónico ────────────
#     El contenedor viejo no tiene los scripts nuevos, por eso se copia la
#     carpeta entera. El ORDEN importa (p. ej. documents-sprint-1 crea la tabla
#     que documents-transversal luego altera; client-module-assignments crea el
#     índice único que patients-multi-per-client quita).
docker cp scripts/. crm-salamandra-app-1:/app/scripts/
for m in \
  migrate-billing-correction-reason \
  migrate-billing-quotes \
  migrate-billing-rework \
  migrate-billing-fix-kind-enum \
  migrate-billing-irpf-partners \
  migrate-billing-tax-regime \
  migrate-billing-vat-exempt \
  migrate-citas-sprint-1 \
  migrate-booking-client-link \
  migrate-booking-pending \
  migrate-calendar-citas-fks \
  migrate-client-attachments-and-notes \
  migrate-clinica-module \
  migrate-clinica-client-link \
  migrate-course-registrations \
  migrate-documents-sprint-1 \
  migrate-documents-transversal \
  migrate-documents-client-link \
  migrate-formularios-module \
  migrate-formsubmission-team \
  migrate-interactions-notes-team \
  migrate-inventory-rework \
  migrate-nutricion-day-comments \
  migrate-nutricion-recipes \
  migrate-nutricion-show-macros \
  migrate-nutricion-week-recipe-media \
  migrate-client-module-assignments \
  migrate-patients-clients-phase1 \
  migrate-patients-multi-per-client \
  migrate-plan-team \
  migrate-projects-sprint-1 \
  migrate-projects-sprint-2 \
  migrate-projects-task-priority \
  migrate-stage-to-string \
  migrate-team-fields \
  migrate-rename-therapist-to-employee \
  migrate-team-members-avatar-color \
  migrate-team-modules-salary \
  migrate-training-archive \
  migrate-training-fields \
; do echo "== $m ==" ; docker exec crm-salamandra-app-1 node scripts/$m.js || { echo "✗ FALLÓ $m — PARAR"; break; } ; done

# ── 3) Deploy (package.json NO cambió en este sprint → build rápido) ─────────
./deploy.sh

# ── 4) DESPUÉS del deploy: migración de DATOS (mueve los adjuntos viejos de
#      client_attachments al archivo central `documents`, source='ficha', y
#      mueve los ficheros físicos). Es de UN SOLO USO e idempotente por borrado
#      de la fila vieja: re-ejecutar solo ve las pendientes. Va DESPUÉS del build
#      porque la app nueva ya sabe leer el archivo central. ──────────────────
docker exec crm-salamandra-app-1 node scripts/migrate-attachments-to-documents.js

# ── 5) Chequeo de salud de conexiones (solo lectura): cuenta registros sueltos
#      por tabla. No arregla nada; es la foto de qué quedó sin enlazar. ───────
docker exec crm-salamandra-app-1 node scripts/check-links.js
```

## Verificación rápida (3 min)

- **Salud HTTP:** `https://tunutrilaura.com` y el CRM de aumenta cargan (200), y
  el login entra.
- **CITAS (crítico):** en `https://tunutrilaura.com` pedir una cita de prueba
  desde la web → debe entrar y aparecer en la lista de espera de Laura. En el CRM,
  **doble clic** en el calendario debe abrir un evento listo para editar, y el
  globito rojo de pendientes debe contar bien (cancelar una cita lo baja).
- **Cita manual:** al crear una cita a mano, el cliente es un **desplegable
  buscable** de pacientes (no un texto libre) y al elegirlo se rellenan email y
  teléfono solos.
- **Documentos:** subir un fichero desde las **notas de un cliente** → debe
  aparecer en el módulo **Documentos** (archivo central), filtrable por ese
  cliente. El buscador por cliente/origen funciona.
- **Formularios:** enviar el formulario público de nutri_laura → cae en la
  bandeja; aceptarlo crea la ficha de cliente/paciente (y, cuando estén las
  claves, el usuario de WordPress).
- **check-links (paso 5):** anota los conteos de "sueltos". No tienen por qué ser
  cero (hay registros viejos sin enlazar a propósito), pero **no deben subir**
  respecto a la vez anterior por culpa del deploy.

## Notas

- **No hace falta re-sembrar alimentos** (a diferencia del 19-jul): el catálogo ya
  está en prod y este sprint no lo toca.
- Las claves que faltan para cerrar flujos (no bloquean el deploy):
  `RESEND_API_KEY` (correo de alta de paciente) y `CRM_WIDGET_SSO_SECRET`
  (creación del usuario de WordPress). Van en `.env.production`, por SSH, nunca por
  chat (regla 14).
- Si algo va mal: NUNCA `push --force`. Se restaura la BD del backup del paso 0
  (`gunzip < backup-....sql.gz | docker exec -i crm-salamandra-db-1 psql -U postgres salamandra`)
  y se arregla con un commit nuevo + otro deploy.
