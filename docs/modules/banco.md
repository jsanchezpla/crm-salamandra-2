# Módulo Banco (`billing_banco`) — el extracto real y la conciliación

## Mapa

> Escrito al construir el módulo el 29/08/2026. Si algo no cuadra, manda el
> código: corrige esta tabla. **Quién tiene el módulo NO se lista aquí**:
> `/admin/modulos` o `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `billing_banco` · SUBMÓDULO de Facturación (29/08/2026, Rodrigo), con la clave prefijada por el padre como `clients_avanzado`/`team_avanzado`. Requiere `billing` (`lib/provisioning/dependencias.js`: la conciliación casa movimientos con `payments`/`costs` y la pantalla vive en la pestaña de Facturación). Nació un día como `banco` a secas; se renombró antes de que ningún tenant lo tuviera activo en producción. |
| **Reina** | — (nace sin cliente; el primero que lo encienda manda). |
| **Pantallas** | `/facturacion/banco` → `app/(dashboard)/facturacion/banco/page.jsx` (puerta con `notFound()`) + `BancoModule.jsx` (todo: conectar banco, sincronizar, extracto, casar/descasar). La pestaña «Banco» la pone `app/(dashboard)/facturacion/layout.jsx` (servidor) vía `lib/banco/moduloBanco.js`. El botón «Banco» de `/facturacion/cobros` salta aquí con `?mov=<id>`; «Stripe ↗» en esa misma pantalla abre el panel de Stripe (no es de este módulo, pero nació en el mismo sprint). |
| **Endpoints** | `app/api/banco/**` (9, todos `hasModule("billing_banco")`): `estado` (GET), `bancos` (GET, lista de entidades), `conectar` (POST, admin, crea acuerdo+requisición y devuelve el enlace AL banco), `confirmar` (POST, admin, la vuelta con `?ref=`; comprueba que la referencia empiece por `<slug>-`), `sincronizar` (POST, freno de 15 min por cuenta), `movimientos` (GET, con `?estado=`, `?q=`, `?id=`), `sugerencias` (GET), `casar`/`descasar` (POST), `cuentas/[id]` (DELETE, admin). `conectar`/`confirmar`/`cuentas` rechazan las demos (`isDemoTenant`): son públicas y esto toca un banco real. |
| **Lógica** | `lib/banco/` (4): `gocardlessConfig.js` (BYOK: `gocardlessSecretId` a la vista + `gocardlessSecretKey` cifrada, en `tenant.settings.integrations`; sin fallback al `.env`), `gocardless.js` (cliente REST de GoCardless Bank Account Data: token 24 h cacheado en memoria, bancos, requisiciones, cuentas, transacciones; scope de SOLO LECTURA; 401→«revisa credenciales», 429→«tope diario del banco»), `conciliacion.js` (PURO: `normalizarTransaccion`, `sugerenciasPara`, `ladoDe` — lo fija la prueba), `moduloBanco.js` (¿tiene el tenant el módulo?, para layout y página). El cruce Stripe→Cobros es de billing: `lib/billing/cobroDesdeStripe.js`. |
| **Modelos** | `models/tenant/`: `BankAccount` (`bank_accounts`, una por cuenta concedida; `accountUid` UNIQUE hace idempotente reconectar), `BankTransaction` (`bank_transactions`, solo movimientos CONTABILIZADOS; UNIQUE cuenta+uid hace idempotente sincronizar). El enlace de conciliación vive en `payments.bank_transaction_id` y `costs.bank_transaction_id` (SIN FK a propósito, con índice). Registrados para TODOS los tenants en `lib/db/tenantDb.js` → sus tablas se crean en todos los schemas (CORE). |
| **Interruptores y parámetros** | ninguno. Lo que enciende la función es tener las credenciales de GoCardless (`tenantTieneBanco`) y el módulo activo. |
| **Pantallas propias** | ninguna. |
| **Scripts** | `migrate-banco-conciliacion.js` (CORE en `_module-migrations.js`: columnas de `payments`/`costs` + tablas del banco en todos los schemas; **VA ANTES del despliegue**, los modelos piden las columnas por nombre). Activación: `node scripts/enable-module.js <slug> billing_banco`. |
| **Pruebas** | `scripts/_smoke-banco-conciliacion.mjs` (`node:test`, ligera, en `npm test`): fija `lib/banco/conciliacion.js` — el uid estable y que sin él NO hay fila (idempotencia del extracto), la contraparte según el signo, el concepto sin repetirse, y las sugerencias: importe clavado al céntimo o nada, valor absoluto, tope de días, fecha más cercana primero y desempate por nombre sin tildes. |
| **Decisiones** | La de fondo va abajo (§1): un «botón al banco» no puede ser un enlace porque la banca española no da URL por movimiento — es traerse el extracto y casarlo. |
| **En este doc** | 1. Por qué es un módulo y no un campo · 2. El flujo entero · 3. Límites conocidos |

---

## 1. Por qué es un módulo y no un campo

Se pidió «un botón que lleve del cobro del CRM al movimiento del banco». Al
medirlo en producción (24/08/2026) salieron dos cosas:

- **No había de dónde tirar**: la fila de un cobro no guardaba ni un
  identificador externo. Y en Aumenta, con 14.243 facturas, había CERO cobros —
  el dinero online moría en `payment_sessions` sin cruzar a Facturación.
- **El banco no da enlaces**: la banca online española no tiene una URL estable
  por movimiento. Lo que dan las APIs PSD2 son los DATOS del movimiento.

Así que son dos productos, y se construyeron los dos:

1. **Stripe** (parte de `billing`): el webhook registra el cobro solo
   (`lib/billing/cobroDesdeStripe.js`) y la pantalla de Cobros enseña
   «Stripe ↗» con `payments.stripe_payment_intent_id`.
2. **El banco de verdad** (este módulo): agregador PSD2 (GoCardless Bank
   Account Data, capa gratuita, banca española cubierta), extracto dentro del
   CRM, conciliación con cobros y gastos, y el botón «Banco» de Cobros que
   salta al movimiento casado.

## 2. El flujo entero

1. **Credenciales** (una vez): Configuración → Conexiones → «Banco
   (GoCardless)». Secret ID + Secret Key del portal
   bankaccountdata.gocardless.com. BYOK, cifradas como el resto.
2. **Conectar** (admin): Facturación → Banco → «Conectar tu banco» → se elige
   la entidad → GoCardless lleva a la web DEL banco → el titular consiente
   (solo lectura, 90 días) → vuelve a `/facturacion/banco?ref=…` y `confirmar`
   guarda las cuentas.
3. **Sincronizar** (botón): trae los movimientos contabilizados (90 días la
   primera vez; luego desde el último menos una semana). Idempotente.
4. **Casar**: cada movimiento sin casar ofrece sugerencias (importe exacto,
   ±10 días, nombre parecido sube). Casar escribe
   `payments/costs.bank_transaction_id` y se audita
   (`banco.movimiento.casado`, con el descuadre anotado si lo hay).
5. **El botón**: en Cobros, «Banco» → `/facturacion/banco?mov=<id>`.

## 3. Límites conocidos

- **Cuotas de fraccionados**: la 2ª cuota en adelante NO crea cobro en
  Facturación (rastro en `ps.metadata.cuotasPagadas`). Si un día hace falta, es
  un sprint con su propia idempotencia.
- **Ritmo**: los bancos limitan las consultas por cuenta y día (el 429). La
  sincronización es manual con freno de 15 min; nada de bucles ni cron.
- **Consentimiento**: caduca a los 90 días (PSD2). La cuenta pasa a
  «Consentimiento caducado» y se reconecta desde la pantalla; los movimientos
  ya traídos se quedan.
- **Pendientes**: los movimientos no contabilizados no se guardan (sin id
  estable, duplicarían al consolidarse).
