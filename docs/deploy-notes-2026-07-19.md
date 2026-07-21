# Deploy pendiente — notas para el despliegue (2026-07-19)

Master acumula las entregas sin desplegar: Pacientes Fase 1a (PR #18),
Facturación de pacientes 2a+2b, sprint Nutrinotas + catálogos de alimentos, y el
trabajo del 2026-07-21 (varios pacientes por cliente pagador, citas en la ficha
del paciente, y el sprint de Facturación: IRPF a 0 + régimen, exención de IVA,
numeración en orden de fecha, reparto en dos modos). Este es el orden EXACTO en el
VPS (importa: las migraciones van ANTES del deploy). Todo es idempotente: si algo
se corta, se puede repetir sin romper nada.

```bash
ssh <vps>                       # acceso habitual al VPS
cd /opt/crm-salamandra

# 1) Bajar el código
git pull

# 2) MIGRAR ANTES DEL DEPLOY (imprescindible: la app nueva lee columnas nuevas de
#    clients/patients/bookings/tenant_billing_settings; si arranca sin ellas →
#    errores 42703 en toda lectura). El contenedor viejo no tiene los scripts, por
#    eso se copia la carpeta entera. TODAS son aditivas e idempotentes; este ORDEN
#    importa (client-module-assignments crea el índice único que multi-per-client
#    luego quita).
#    ⚠️ OJO citas: `migrate-calendar-citas-fks` (bookings.team_member_id) es
#    IMPRESCINDIBLE — si falta, TODA reserva pública de cita revienta con 42703 y
#    no entra al CRM (fue el bug de tunutrilaura.com). Antes NO estaba en la lista.
docker cp scripts/. crm-salamandra-app-1:/app/scripts/
for m in \
  migrate-calendar-citas-fks \
  migrate-patients-clients-phase1 \
  migrate-client-module-assignments \
  migrate-patients-multi-per-client \
  migrate-team-modules-salary \
  migrate-billing-correction-reason \
  migrate-billing-tax-regime \
  migrate-billing-vat-exempt \
  migrate-nutricion-recipes \
; do echo "== $m ==" ; docker exec crm-salamandra-app-1 node scripts/$m.js ; done

# 3) Deploy normal (package.json cambió → deploy.sh hará npm ci + build completo)
./deploy.sh

# 4) DESPUÉS del deploy: sembrar los catálogos de alimentos (solo afecta a
#    tenants con el módulo nutricion, es decir nutri_laura; no toca al resto).
#    Idempotentes: no duplican ni pisan alimentos que Laura haya editado.
docker exec crm-salamandra-app-1 npm run db:seed-foods-base:prod
docker exec crm-salamandra-app-1 npm run db:seed-foods-branded:prod
```

## Verificación rápida (2 min)

- `https://tunutrilaura.com` → Nutrición → **Alimentos**: el catálogo debe rondar
  los **3.400** alimentos y NO debe aparecer ni la columna "Origen" ni el botón
  "Buscar online". Buscar "hacendado" debe dar resultados.
- Nutrición → **Menús** → "Nuevo menú": pide el nombre en un modal (no un
  prompt del navegador) y el menú nace con Desayuno/Almuerzo/Comida/Merienda/Cena.
- CRM de **aumenta** → ficha de un cliente: aparecen las secciones "Contactos" y
  "Pacientes". Ficha de un paciente → sección "Facturación" con "Nueva factura"
  y "Reparto", y la sección "Citas del paciente" con sus citas.
- **CITAS (crítico, era el bug):** en `https://tunutrilaura.com` pedir una cita de
  prueba desde la web pública → debe entrar y aparecer en la lista de espera de
  Laura. Si diera error, revisar que `migrate-calendar-citas-fks` corrió (columna
  `bookings.team_member_id`).

## Notas

- La migración del paso 2 es **multi-tenant** (lee `master.tenants`) y tolera
  schemas parciales; re-ejecutarla es inofensivo.
- No hay que tocar la extensión `unaccent` (ya instalada en prod desde C3).
- Si algo va mal en un push a master: NUNCA `push --force`; se arregla con
  `git revert` y otro deploy (ver `CONTRIBUTING.md`).
