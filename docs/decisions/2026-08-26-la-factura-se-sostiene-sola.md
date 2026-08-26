# La factura se sostiene sola, y borrar una ficha ya no se la lleva

**26/08/2026 · Jorge** · Facturación, `lib/billing/datosFiscales.js`,
`invoices.fiscal_snapshot`, la FK `invoices_client_id_fkey`

---

## De dónde sale

De medir la tarea de borrar fichas
(`2026-08-26-no-vino-en-vez-de-borrar.md`). Aquella se resolvió sin borrar nada,
pero dejó dos cosas escritas como «el día que alguien escriba un borrado en
lote, antes hay que…». Esto es ese «antes».

Son dos problemas distintos que se cuentan juntos porque el segundo es lo que
hace seguro al primero.

## 1 · Borrar una ficha borraba sus facturas

`invoices.client_id → clients` estaba declarada **ON DELETE CASCADE**. Y
`payments.invoice_id → invoices` también, así que la cascada llegaba hasta los
cobros. Lo único que lo contenía era un `if` en `DELETE /api/clients/[id]`: un
freno de aplicación, en UNA puerta.

En Aumenta son **14.243 facturas, todas numeradas y ninguna en borrador**. Y la
numeración de una serie es correlativa **sin huecos por obligación fiscal**
(`lib/billing/generateInvoiceNumber.js`), así que esto no era «perder unos
documentos»: era agujerear ejercicios ya declarados.

Ahora es **ON DELETE RESTRICT**: el «no» lo dice la base de datos, y el `if` del
endpoint pasa a ser lo que debe ser — un mensaje bonito por delante de una
garantía real.

**No se eligió SET NULL**, que es lo que haría falta para poder borrar la ficha
y conservar la factura. Eso pide el punto 2 hecho *y además* una decisión de
producto que nadie ha tomado. Hoy el CRM no borra fichas con facturas, y con
RESTRICT eso pasa a ser verdad de verdad.

**De paso, las duplicadas.** La misma columna tenía la restricción declarada
varias veces —2 en `crm_aumenta`, 2 en `crm_spain_enzymes`, **4** en `crm_demo`
de producción y **15** en el `crm_demo` local—, restos de sincronizaciones
automáticas de esquema de otras épocas. Se dejan en una, con el nombre que
generaría Sequelize.

⚠️ **Reponer una demo sigue funcionando.** `lib/demo/resetDemo.js` usa
`TRUNCATE … CASCADE`, que no mira las reglas de borrado; comprobado en local
antes de tocar producción, dentro de una transacción deshecha.

## 2 · Corregir el NIF de una ficha reescribía sus facturas viejas

Una factura no guardaba **ni un dato fiscal propio**. El nombre, el NIF, la
dirección y la ciudad impresos se leían de la ficha del cliente cada vez que se
generaba el PDF o el libro de IVA. O sea que corregir hoy el NIF de una familia
cambiaba, hacia atrás y en silencio, **todas sus facturas ya emitidas**: el PDF
que se reimprimiera diría algo distinto del que se entregó, y el libro de IVA de
un ejercicio cerrado cambiaría al mirarlo.

No daba ningún error. Los dos documentos seguían saliendo; solo que ya no eran
los que se emitieron. Y el módulo empuja justamente a corregir esos datos: al
emitir, si falta la razón social o el NIF, la pantalla manda a editar la ficha.

Desde hoy, **al emitir** se guarda una foto en `invoices.fiscal_snapshot`
(JSONB): `{ nombre, nif, direccion, cp, ciudad, pais }`.

### Las cinco decisiones que lleva dentro

**Se congela en la emisión y en ningún otro sitio.** Es el único momento en que
se sabe a quién se le está emitiendo: cuatro líneas antes se acaba de exigir que
la ficha tenga razón social y NIF, y a partir de ese `update` la factura deja de
ser un borrador que se pueda rehacer. Congelar antes sería congelar algo que
todavía podía cambiar.

**El correo NO se congela**, aunque el PDF lo imprima. No es un elemento fiscal
de la factura: es por dónde se le escribe a esa persona hoy. Duplicar un dato
personal más de lo necesario no sale gratis.

**Columna propia, no `customFields`.** La rectificativa reinicia `customFields` a
`{}` y se llevaría la foto por delante.

**La rectificativa hereda la del original.** Corrige un documento concreto, así
que tiene que identificar al MISMO destinatario que aquel, aunque la ficha haya
cambiado. Si el original no tiene foto, la rectificativa tampoco: las dos leen
del cliente vivo y al menos dicen lo mismo entre ellas.

**Las 14.243 que ya existen NO se rellenan.** Se quedan sin foto y siguen
leyendo del cliente, exactamente como hasta hoy. Rellenarlas con los datos de
HOY sería peor que no tener foto: estamparía como «lo que decía la factura de
2022» algo que quizá se corrigió en 2025, y con toda la apariencia de un dato
bueno. La foto solo la pone quien la puede saber: la emisión.

### Y por qué la lee un solo sitio

`lib/billing/datosFiscales.js` responde «¿qué pone en esta factura?» para los
**dos documentos oficiales** que salen del CRM: el PDF y el libro de IVA. Si cada
uno decidiera por su cuenta cuándo mira la foto y cuándo el cliente vivo, el
papel que recibe la familia y el que se le manda a la gestoría acabarían
diciendo cosas distintas de la MISMA factura — y a partir de ahí no se discute
de la factura, se discute de cuál de los dos miente. Es el mismo motivo por el
que existe `nifCliente.js` un peldaño más abajo.

Lo que **no** cambia son los agregados por cliente (analítica, Excel por cliente,
KPIs): ahí se agrupa por quién es el cliente HOY, y eso es lo correcto. Un
informe de dirección no es un documento fiscal.

⚠️ Y una foto rota o vacía **no tapa el respaldo**: si `fiscal_snapshot` llegara
sin nombre ni NIF, se lee del cliente. El fallo caro aquí sería un documento sin
destinatario, no uno con el destinatario de hoy.

## Cómo se comprobó

- `_smoke-billing-datos-fiscales.mjs` (15 casos): qué se congela, qué no, y que
  una foto rota cae al respaldo.
- `_smoke-pdf-factura-informe.mjs`, cuatro casos nuevos que **leen el texto de
  dentro del PDF** —descomprimiendo los flujos y traduciendo los glifos con el
  `/ToUnicode`— y exigen que con foto salga el NIF congelado y **no** el de hoy.
- En local, el ciclo entero por la aplicación: emitir, corregir el NIF y la
  dirección de la ficha, y comprobar que la factura sigue diciendo lo suyo. El
  libro de IVA devolvió el NIF congelado.
- El RESTRICT, con un `DELETE` real dentro de una transacción deshecha: la base
  se niega y la ficha y sus cuatro facturas siguen ahí.

## El orden del despliegue

Las dos migraciones **van antes**. La columna porque el modelo pasa a declarar
`fiscalSnapshot` y Sequelize pide las columnas por nombre: el código nuevo por
delante de la columna da 42703 en cada lectura de factura. La FK porque no
depende del código y es mejor que la red esté puesta antes que después.

Ninguna de las dos toca una fila. La de la FK **puede fallar** —si hubiera
facturas apuntando a una ficha que ya no existe, el `ADD CONSTRAINT` no pasaría—,
y por eso lo comprueba antes y se para en ese schema en vez de dejar la tabla sin
ninguna restricción.
