# «No vino» en vez de borrar, y las 127 facturas que lo impedían

**26/08/2026 · Jorge, a partir de una petición de Lau (Aumenta)** · Clientes,
`lib/clients/estados.js`, `clients.status`

---

## Lo que se pidió, y lo que resultó ser

Lau, el 14/08: quería sacar de en medio las fichas de «gente que llamó o dejó sus
datos pero nunca llegó a empezar». Entró al Registro como una tarea de **borrar**,
y con una nota: 21 de esas fichas tienen facturas.

Al medirlo, la tarea era otra. Jorge, el 26/08: «tampoco quiero borrar a la
persona, simplemente que tenga el status de que no ha venido». Lo que hacía falta
no era una papelera: era **poder decirlo**.

## Por qué borrar no era una opción, con números

Las fichas mudas y sin tutor son **118**, y de ellas **117 ya estaban
archivadas**. Cuelgan 117 pacientes, 136 sesiones clínicas y 304 citas. Y:

| | |
| --- | --- |
| Fichas con factura | **21** |
| Facturas | **127**, todas `paid` |
| Importe | **14.820 €** |
| Fechas | 03/10/2022 → **30/07/2026** |
| Series y ejercicios | 2 series, 5 años |

Tres cosas lo cerraban, y cada una sola habría bastado:

**1. `invoices.client_id` es ON DELETE CASCADE.** Borrar la ficha se lleva las
facturas y, por `payments.invoice_id`, también sus cobros. Hoy lo contiene un
`if` en `DELETE /api/clients/[id]` que devuelve 409 — pero es un guard de
aplicación en UN endpoint: cualquier otro camino que llegue a `clients` lo pisa.

**2. La factura no se sostiene sola.** No guarda ni un dato fiscal propio: el
nombre, el NIF, la dirección y la ciudad se leen **en vivo** de `clients`
(`lib/billing/nifCliente.js`, `lib/billing/invoicePdf.js`). Así que
«desenganchar la factura del cliente» tampoco valía: dejaría un documento
legalmente obligatorio que ya no se puede reimprimir — justo el que Lau dice que
le vienen a pedir años después.

**3. La numeración no admite huecos.** `lib/billing/generateInvoiceNumber.js` lo
dice en su cabecera: «correlativa por serie y año, sin huecos (obligación
fiscal)». 127 bajas serían 127 agujeros repartidos por cinco ejercicios, tres de
ellos ya declarados.

⚠️ Y la premisa tampoco aguantaba: **16 de esas 21 no tienen ni una cita en el
CRM** y aun así facturaron hasta hace un mes. No es que no vinieran — es que su
agenda no está en el CRM, el mismo agujero de la migración que dejó 1.827 citas
huérfanas. Borrar «a los que nunca vinieron» mirando las citas se habría llevado
clientes reales.

## Dónde vive el estado

`clients.status` ya era `ENUM('active','inactive','prospect')` y **`prospect`
estaba sin estrenar**: 0 fichas en Aumenta. O sea que esto **no añade ni una
columna ni una migración**.

| En pantalla | Columna |
| --- | --- |
| Activo | `active` |
| **No vino** | `prospect` |
| Baja | `inactive` |

## El campo que se veía hasta hoy decía otra cosa

El chip de la cabecera leía el **embudo comercial** (`customFields.seStatus`), no
la columna. Y el embudo **no lo ha usado nadie nunca**: medido el 26/08 en los
siete tenants con fichas, todo valor no vacío es el `new` que estampaba el alta o
una ficha suelta que alguien tocó una vez. En Aumenta las 1.083 lo tienen vacío,
y el respaldo a `"new"` hacía que una familia con cuatro años de historia y 127
facturas apareciera como **«Nuevo»**.

De paso salió un segundo caso de lo mismo: el PUT estampaba `seStatus: "new"` en
cualquier guardado que no lo trajera. Con el estado nuevo eso habrían sido 90
guardados seguidos escribiendo un embudo comercial en un cliente que no lo
enseña. Ahora no se inventa — el mismo arreglo, y por el mismo motivo, que se le
hizo a `origin` el 08/08/2026.

## Solo en perfil salud, a propósito

En un cliente comercial la columna **ya significa otra cosa**: la tienda marca
`prospect` a quien ha comprado una vez y todavía no es cartera
(`lib/tienda/pedidoDesdeTienda.js`), y laura_ubeda tiene sus **183 fichas** así.
Enseñarles «No vino» sería mentir sobre gente que sí compró.

Así que los comerciales se quedan con su embudo, intacto y sin tocar una línea.
El día que uno pida un estado, lo que se decide es su **rótulo** —peldaño 1 de la
escalera— y se enciende. El dato ya está.

## El archivo y el estado son el MISMO campo

Archivar (25/08) ya escribía `inactive` en esa columna. Con tres valores, un
interruptor de dos posiciones no llega: al desarchivar volvía siempre a `active`,
así que archivar y desarchivar a alguien marcado «No vino» lo habría ascendido a
Activo **en silencio**. Se eligió que el desplegable **sustituya** al botón donde
hay estado, y que el botón se quede donde no lo hay. Un campo, un sitio.

## Marcar 90 fichas sin abrir 90 fichas

La acción vive también en cada fila de «Fichas a completar», en las carpetas de
FAMILIA. Sin eso, marcar las 90 fichas mudas de Aumenta serían noventa fichas
abiertas de una en una, que es exactamente por lo que la petición llegó como
«bórralas». Al marcarla, la fila desaparece de la carpeta —«No vino» deja de
reclamar datos, igual que «Baja»— y vuelve con la casilla de arriba.

No lleva confirmación, igual que «Está bien así», que está justo al lado y
también hace desaparecer la fila: se deshace desde la ficha.

## Lo que se dejó sin hacer

- **La pasada en bloque.** Con criterio de «ninguna huella» (0 citas, 0 facturas,
  0 sesiones) serían **211 fichas** de las 1.083, y **90** de las 118 mudas. Es un
  cambio de datos en producción: se mide en seco y se enseña antes de tocar nada.
  Y nunca por «no tiene citas» a secas, por lo de los 16 de arriba.
- **Romper el CASCADE de `invoices.client_id`** y **congelar los datos fiscales
  en la factura**. No hacen falta para esto —aquí no se borra nada— pero siguen
  siendo verdad: el día que alguien escriba un borrado en lote, los dos tienen
  que estar hechos antes.
