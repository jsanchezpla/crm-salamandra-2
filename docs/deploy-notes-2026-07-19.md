# Deploy pendiente — notas para el despliegue (2026-07-19)

Master acumula **4 entregas sin desplegar**: Pacientes Fase 1a (PR #18),
Facturación de pacientes 2a+2b, sprint Nutrinotas y los catálogos de alimentos.
Este es el orden EXACTO en el VPS (importa: hay una migración que va ANTES del
deploy). Todo es idempotente: si algo se corta, se puede repetir sin romper nada.

```bash
ssh <vps>                       # acceso habitual al VPS
cd /opt/crm-salamandra

# 1) Bajar el código
git pull

# 2) MIGRAR ANTES DEL DEPLOY (imprescindible: la app nueva lee columnas nuevas
#    de clients/patients/bookings; si arranca sin ellas → errores 42703 en toda
#    lectura). El contenedor viejo no tiene el script, por eso se copia:
docker cp scripts/migrate-patients-clients-phase1.js crm-salamandra-app-1:/app/scripts/
docker exec crm-salamandra-app-1 node scripts/migrate-patients-clients-phase1.js

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
  y "Reparto".

## Notas

- La migración del paso 2 es **multi-tenant** (lee `master.tenants`) y tolera
  schemas parciales; re-ejecutarla es inofensivo.
- No hay que tocar la extensión `unaccent` (ya instalada en prod desde C3).
- Si algo va mal en un push a master: NUNCA `push --force`; se arregla con
  `git revert` y otro deploy (ver `CONTRIBUTING.md`).
