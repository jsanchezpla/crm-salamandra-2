# Módulo Analíticas (`analytics`)

Visitas de la web del cliente, medidas con **Cloudflare Web Analytics**.
Estado: **implementado** (2026-07-31). Tenant de referencia: `spain_enzymes`.

---

## Qué es y qué NO es

Cloudflare Web Analytics mide **sin cookies y sin identificar a nadie**. Todo lo
que entrega este módulo es **agregado**:

- ✅ «esta semana han entrado 340 visitas: 120 de Alemania, 60 de Italia»
- ✅ «las visitas de Alemania caen sobre todo en /leather-line»
- ❌ «qué empresa alemana entró el martes» — **imposible por diseño**

Esa frontera es la razón de que no haga falta banner de consentimiento, y hay
que sostenerla también en la interfaz: la pantalla no habla de «visitantes» en
singular ni ofrece abrir el detalle de una visita. Si algún día se quiere
identificar empresas por IP, eso es otro producto (Leadfeeder, Albacross…), de
pago y con sus propias implicaciones de RGPD — **no** es una evolución de esto.

El único puente con el CRM es por **país y sobre totales**: el panel enseña, al
lado de las visitas, cuántos leads llegaron de cada país en el mismo periodo.
El país del lead es el que la persona **elige en el formulario** de la web
(`customFields.pais`), no uno deducido de su conexión. Son dos mediciones
distintas: sirven para comparar («entran muchas visitas de Italia pero no
escribe nadie»), no para cuadrar cifras.

---

## Piezas

| Fichero | Qué hace |
| --- | --- |
| `lib/analytics/cloudflareConfig.js` | Resuelve las credenciales del tenant (patrón BYOK, como `lib/ai/anthropicKey.js`) |
| `lib/analytics/cloudflareRum.js` | Cliente de la GraphQL Analytics API de Cloudflare (dataset RUM) |
| `app/api/analiticas/route.js` | `GET /api/analiticas?dias=1\|7\|30\|90\|180\|365`, gateado por `hasModule("analytics")` |
| `lib/analytics/historico.js` | Lee los rangos largos de nuestra propia copia (`web_visits_daily`) |
| `models/tenant/WebVisitDaily.model.js` | La foto diaria guardada por el CRM |
| `scripts/capturar-visitas-web.js` | Captura diaria (timer de systemd en el VPS) |
| `scripts/migrate-web-visits-daily.js` | Crea `web_visits_daily` en cada schema |
| `app/(dashboard)/analiticas/page.jsx` | Página; lee el rol y lo baja como booleano |
| `modules/analytics/AnaliticasModule.jsx` | Toda la interfaz (KPIs, mapa, serie, listas) |
| `modules/analytics/worldMap.js` | **Generado**: contornos de países en SVG |
| `scripts/check-cloudflare-analytics.js` | Diagnóstico de solo lectura desde consola |

Los rangos cortos (hoy, 7 días) se leen de Cloudflare en cada consulta, con 5
minutos de caché en memoria (`lib/tenant/tenantCache.js`). Los largos salen de
`web_visits_daily`, la copia diaria que guarda el propio CRM porque Cloudflare
solo conserva 7 días — ver «Histórico propio» al final de este documento.

---

## Credenciales (por tenant)

Se configuran en **Configuración → Integraciones → «Cloudflare (visitas de la
web)»**, con las instrucciones paso a paso dentro de la propia tarjeta.

| Campo en `settings.integrations` | Secreto | Para qué |
| --- | --- | --- |
| `cloudflareApiToken` | **sí** (cifrado con `secretBox`) | Token de API de solo lectura |
| `cloudflareAccountId` | no | Identificador de cuenta (sale en la URL del panel) |
| `cloudflareSiteTag` | no | Sitio concreto. Vacío = todos los de la cuenta |

El token necesita **un solo permiso**, tal y como lo llama Cloudflare en su
pantalla de tokens personalizados: `Cuenta` · `Account Analytics` · `Leer`
(comprobado en el panel el 2026-07-31 — el desplegable del medio solo ofrece
esa opción al escribir «Analytics»). No puede tocar DNS, dominios ni nada más.

> **El token no se pide ni se pega nunca por chat ni por correo** (regla 14 de
> CLAUDE.md). Lo crea el cliente o el administrador en Cloudflare y lo pega
> directamente en la pantalla de Configuración, que lo cifra en reposo.
> Si un token se ha visto en un canal no seguro, se revoca en Cloudflare y se
> crea otro.

---

## Alta en un tenant

```bash
docker exec crm-salamandra-app-1 node scripts/enable-module.js <slug> analytics --force
```

`--force` es necesario **la primera vez**: `analytics` no está en `MODULE_KEYS`,
así que `enable-module.js` lo trata como clave desconocida (protección contra
typos). A partir de que un tenant lo tenga, ya aparece como conocido y el
`--force` sobra.

Desde que existe el histórico, el módulo **sí tiene migración**
(`migrate-web-visits-daily`, registrada en `scripts/_module-migrations.js`), así
que el alta crea también la tabla `web_visits_daily`.

Después, comprobar la conexión:

```bash
docker exec crm-salamandra-app-1 node scripts/check-cloudflare-analytics.js <slug> 30
```

---

## El mapa

`modules/analytics/worldMap.js` está **generado**, no se edita a mano. Son 174
países proyectados en equirectangular sobre un viewBox de 1000×386, recortado a
latitudes −56…83 para quitar la Antártida y el Ártico vacío. La clave es el
código ISO alpha-2, que es lo que devuelve Cloudflare en la dimensión de país.

Origen: **Natural Earth 1:110m** vía `world-atlas` (dominio público) + tabla
ISO-3166. Se convirtió una sola vez con un script de un solo uso que decodifica
el TopoJSON y proyecta los contornos; el resultado se commiteó. **El CRM no
descarga nada en tiempo de ejecución y no se añadió ninguna dependencia** — que
es justo el motivo de hacerlo así: meter una librería de gráficos o de mapas
obliga a un deploy completo con reinstalación de dependencias (ver `deploy.sh`).

Por el mismo motivo, los gráficos (serie temporal y barras) son SVG escrito a
mano dentro del módulo.

Para regenerarlo, el script vive en el historial de la conversación del
2026-07-31; lo esencial es: descargar `world-atlas@2/countries-110m.json`,
acumular los arcos delta del TopoJSON, proyectar con
`x = (lon+180)/360·W`, `y = (83−lat)/139·H`, redondear a un decimal y descartar
anillos de menos de 0,7 px.

---

## Detalles que conviene saber

- **Escala de color por raíz cuadrada.** Con un país dominante —lo normal en una
  web con mercado local— una escala lineal deja el resto del mapa
  indistinguible del fondo, y esos países pequeños son justo la información
  interesante.
- **Sin guard de demo.** El endpoint es de solo lectura, no escribe en `master`,
  no gasta IA y no manda correos. El tenant `demo` no tiene credenciales de
  Cloudflare, así que ve el estado «sin configurar», que es exactamente lo que
  debe ver un visitante anónimo.
- **Los errores de Cloudflare se enseñan tal cual.** `CloudflareAnalyticsError`
  extiende `AppError` a propósito, porque `handleRouteError` solo conserva el
  mensaje de los `AppError`. «Cloudflare rechazó el token» es accionable;
  «Error interno del servidor» no.
- **Los filtros van interpolados en la consulta GraphQL**, no como variables:
  los nombres de los tipos de entrada de Cloudflare varían según el ámbito y
  declararlos mal rompe la consulta entera. Es seguro porque los tres valores
  que entran (id de cuenta, id de sitio, fechas) se validan con expresión
  regular antes — hex de 32 y `YYYY-MM-DD`.
- **Caché de 5 minutos** por tenant y rango. Cloudflare limita la frecuencia de
  llamadas y estos datos se agregan por día: no tiene sentido consultarlos en
  cada repintado.
- **Los desgloses no cuadran exactamente con el total, y no es un fallo
  nuestro.** El dataset es *Adaptive*: Cloudflare muestrea, y agrupaciones
  distintas de los mismos eventos no reconcilian al dedillo. Observado en
  producción el 2026-07-31 con la respuesta **de Cloudflare**: total 5 visitas,
  mientras el desglose por país sumaba 7 (GB 3, US 2, ES 1, AT 1). Con
  volúmenes pequeños la diferencia relativa canta mucho; con tráfico real se
  diluye. El CRM guarda y enseña lo que Cloudflare da, sin cuadrarlo a la
  fuerza: inventar un ajuste sería peor que la descuadre. Si alguien pregunta
  «¿por qué el mapa suma más que el total?», la respuesta es esta.

---

## Histórico propio: por qué el CRM copia las visitas

**Cloudflare Web Analytics solo conserva 7 días.** Medido contra producción el
2026-07-31, no sacado de la documentación: si el inicio del rango está a 8 días
o más del día de hoy, la consulta devuelve cero filas. Y no da error — responde
HTTP 200 con la lista vacía, indistinguible de «esta web no ha tenido visitas».
Se comprobó además que **no** es un límite de anchura del rango: 31 días de
ancho funcionan mientras el rango empiece dentro de la ventana retenida. Lo que
caduca es el dato viejo, no la consulta larga. La constante está en
`MAX_DIAS_RUM` (`lib/analytics/cloudflareRum.js`) por si el plan de la cuenta
cambia.

Pasada esa ventana el dato **no se puede recuperar de ninguna manera**. Así que
para enseñar meses, trimestres o años el CRM va copiando cada día lo que
Cloudflare da mientras lo da.

### Las dos fuentes

| Rango en pantalla | De dónde sale |
| --- | --- |
| Hoy, 7 días | Cloudflare **en vivo** (el día en curso sale al minuto) |
| Mes, trimestre, semestre, año | La copia propia, tabla `web_visits_daily` |

La respuesta del endpoint trae `fuente` (`cloudflare` \| `historico`) y, en el
segundo caso, `historicoDesde`: el primer día del que hay copia. La pantalla lo
enseña porque antes de esa fecha **no es que no hubiera visitas, es que nadie
las estaba guardando** — y un cero sin explicación se lee como una avería.

### La tabla

`web_visits_daily`, una por tenant. Una fila por `(fecha, dimension, valor)`,
desnormalizada por dimensión para que los rangos largos salgan con un `GROUP BY`
normal. `valor` es cadena vacía —no NULL— en la dimensión `total`: en PostgreSQL
dos NULL no chocan en un índice único, y con NULL el mismo día podría entrar dos
veces. Migración: `scripts/migrate-web-visits-daily.js`.

### La captura

`scripts/capturar-visitas-web.js`. Recorre los tenants con `analytics` activo
leyendo `master.tenants` en tiempo de ejecución (regla 12), pide los últimos 7
días y hace upsert. Es **idempotente**: repetir la pasada corrige huecos y no
duplica. Un tenant que falle (token caducado, Cloudflare caído) no corta a los
demás; el código de salida es 1 si falló alguno.

Al pedir 7 días cada día, la captura aguanta que el disparador falle varios días
seguidos: mientras no se pierdan **7 pasadas consecutivas**, el hueco se rellena
solo en la siguiente. Esa holgura es a propósito.

> **Lo que Cloudflare NO da por día**: los desgloses (países, páginas,
> referrers, dispositivos, navegadores) vienen agregados de TODO el rango
> consultado; solo la serie temporal viene partida por días. Por eso los
> desgloses se guardan atribuidos al último día del rango y **la captura tiene
> que ser diaria**. Si se lanzara semanalmente, los desgloses de esos 7 días
> quedarían apilados en uno solo. Los totales diarios sí son correctos siempre,
> porque salen de la serie — y por eso `consultarHistorico` suma los totales de
> la serie y nunca de los desgloses.

### El disparador

**Timer de systemd**, que es como están las otras tareas del VPS
(`crm-backup`, `crm-recordatorios`). El servidor **no tiene cron instalado**:
un `/etc/cron.d/…` allí no se ejecuta nunca.

```
/etc/systemd/system/crm-capturar-visitas.service
/etc/systemd/system/crm-capturar-visitas.timer     → 03:40 UTC, Persistent=true
/var/log/crm-capturar-visitas.log
```

Comprobar que sigue vivo:

```
systemctl list-timers crm-capturar-visitas.timer
tail /var/log/crm-capturar-visitas.log
```

**Si el timer se para, el histórico deja de crecer en silencio** y lo no
capturado se pierde para siempre. No hay forma de recuperarlo después.
