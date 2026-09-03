# Módulo de Facturación (`billing`)

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es este
> mismo commit). Si algo no cuadra, manda el código: corrige esta tabla. **Quién
> tiene el módulo NO se lista aquí** (una lista a mano se queda vieja):
> `/admin/modulos` en el back-office o `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `billing` · requiere `clients` (`lib/provisioning/catalogo.js`: `invoices.client_id` es NOT NULL y las fichas solo se crean desde Clientes). A su vez lo exige `orders` (dar un pedido por servido crea la factura borrador). |
| **Reina** | — (el doc no nombra ninguna). |
| **Pantallas** | `app/(dashboard)/facturacion/**` — 19 `page.jsx` bajo `/facturacion` (contando `/facturacion/banco`, que es de `billing_banco`), con la barra de pestañas de `app/(dashboard)/facturacion/layout.jsx`. Desde el 01/09/2026 también **cuelgan del menú**: `billing` tiene `children` en `components/layout/Sidebar.jsx` (Presupuestos, Facturas, Cobros, Cuotas, Gastos, Arqueo, Banco y Resumen) — era el único módulo grande sin desplegable, y sus pantallas solo se veían entrando primero. En el submenú va la OPERATIVA; el resto (Recurrentes, Proveedores, analíticas, Cumplimiento y Configuración) sigue solo en la barra. El único hijo con `moduleKey` es Banco (`billing_banco`). Operativa: `/facturacion` (Panel), `/facturacion/acciones` (TODAS las acciones requeridas, filtrables por tipo — 31/08/2026; el Panel enlaza con «Ver todas»), `/facturacion/presupuestos` (+ `/[id]`), `/facturacion/facturas`, `/facturacion/cobros` (incluye Morosidad; su cajón «Editar» corrige importe, método, fecha, estado, factura y notas —existe desde el 31/07/2026— y desde el 01/09/2026 tiene **«Revertir cobro»**: BORRA el cobro y devuelve la factura a pendiente, con confirmación y auditado por el DELETE. Revertir no es «Devuelto»: devuelto es dinero que entró y se devolvió y se queda en el histórico; revertir es un cobro que nunca debió existir —apuntado dos veces o en la familia equivocada—, y dejarlo como devuelto ensuciaría el arqueo y la morosidad de un mes que estaba bien. La columna de acciones llevaba la cabecera vacía y el «Editar» se perdía al final de una tabla ancha: ahora dice «Acciones»), `/facturacion/cuotas` (las cuotas asignadas, el alta de la cuota del CATÁLOGO sin salir de ahí y la generación mensual — 01/09/2026), `/facturacion/recurrentes`, `/facturacion/costes` (Gastos), `/facturacion/proveedores`, `/facturacion/arqueo`. Finanzas: `/facturacion/resumen` (KPIs), `/facturacion/analitica` (índice), `/facturacion/analitica/socios`, `/facturacion/analitica/clientes`, `/facturacion/analitica/empleados`, `/facturacion/analitica/iva`, `/facturacion/cumplimiento` (Verifactu/Factura-e, solo informativo). Config: `/facturacion/configuracion`. Piezas comunes en `app/(dashboard)/facturacion/_components/` (`PeriodPicker`, `Kpi`, `StatusBadge`, `tableSort`). Sin páginas públicas ni portal. |
| **Endpoints** | `app/api/billing/**` — 39 `route.js`, todos con `hasModule("billing")`: `invoices` (9: lista, `[id]`, `issue`, `send`, `cancel`, `rectify`, `pdf`, `bulk-pdf`, `bulk-issue` —la Facturación del mes—), `quotes` (6: lista, `[id]`, `accept`, `convert`, y desde el 31/08/2026 `pdf` y `send` — el PDF existe también en borrador, que un presupuesto no es documento fiscal, y el envío adjunta el PDF con las reglas del send de facturas: best-effort, candado de demo, `quote.sent` auditado), `costs` (2), `payments` (2), `recurring` (2), `series` (2), `rates` (2, legacy), `settings` (1), `analytics` (6: raíz, `iva`, `iva/export`, `clients`, `employees`, `partners`), `exports` (7 Excel: `by-client`, `by-employee`, `by-partner`, `expenses`, `payments`, `quotes`, `recurring`), `morosidad` (1), `operations` (1, el Panel), `acciones` (1, las filas de la pantalla de acciones requeridas — 31/08/2026), `conceptos` (2: lista/alta y `[id]` editar/borrar — el catálogo de conceptos y cuotas, 31/08/2026, alta y borrado auditados) — y desde el 01/09/2026 la EDICIÓN tiene puerta en Configuración (el PATCH existía, pero la pantalla solo dejaba apagar y borrar: corregir un precio obligaba a dar de alta otro concepto; importa porque las cuotas con importe a NULL toman su precio de ahí), `cuotas` (3: lista/alta —el alta acepta una LISTA de destinatarios y crea una cuota por cada uno—, `[id]` modificar/baja/borrar —el DELETE con cobros detrás YA NO se niega: devuelve 409 con el desglose (cuántos cobros y cuántos siguen pendientes) y borra con `?confirmar=1`, para que la pantalla pregunte con los números delante; los cobros NO se borran nunca ahí, se quedan sin la cuota que los explica y eso queda en la auditoría—, y `generar` GET vista previa + POST crear los cobros del mes; todo auditado — 01/09/2026). Fuera de esa raíz pero con la misma puerta: `app/api/arqueo/{cajas,cierres,movimientos,movimientos/[id],resumen}` (5; los tres últimos del 01/09/2026: entradas y salidas de caja y el resumen por día), `app/api/proveedores/**` (2), `app/api/clients/[id]/billing-summary`, `app/api/team/[id]/billing-summary`, `app/api/orders/[id]/complete`. Sin endpoints públicos ni webhooks (Verifactu/Facturantia NO está integrado). |
| **Lógica** | `lib/billing/` (22 ficheros): `calculateInvoice.js` (líneas e IVA por línea), `ivaPorDefecto.js` (el IVA con el que nace una línea sin tipo elegido: emisor exento → 0, si no su `defaultVatRate`; la regla la comparten facturas y presupuestos, servidor y formularios — 31/08/2026), `generateInvoiceNumber.js` (número correlativo con `FOR UPDATE`), `generateQuoteNumber.js` (serie P, no fiscal), `updateInvoiceStatus.js` (paidAmount → estado), `invoiceStatus.js` (`overdue` en lectura), `invoiceScope.js` (qué facturas cuentan en todo agregado), `billingSummary.js` (KPIs en base imponible), `accionesRequeridas.js` (las filas de `/facturacion/acciones`, mismos criterios que los contadores del Panel — 31/08/2026), `buildIvaReport.js` (Libro IVA, 303 e IRPF), `irpf.js`, `nifCliente.js` (NIF de facturación vs el de la ficha), `lotesCuotas.js` (la Facturación del mes: agrupar los cobros de cuota por pagador — o POR TERAPIA desde el 31/08/2026: grupo por pagador+concepto (`payments.concept_id`, que el cobro de cuota guarda cuando la cuota es de UN concepto; y `patient_id`, que desde el 01/09/2026 SÍ tiene formulario: el drawer de cobro pregunta de qué paciente es la cuota), los cobros sin concepto van juntos en un grupo «resto» del pagador y excluir a mano va por `grupoId` —, apartar a quien no tiene NIF y construir líneas cuyo total cuadra al céntimo con lo cobrado), `datosFiscales.js` (a quién se le emitió: la foto congelada al emitir o el cliente vivo; la leen el PDF y el libro de IVA, y nadie más), `membrete.js` (qué logo y pie viste cada documento: el presupuesto tiene los suyos y cae a los de la factura — 31/08/2026) y `logoMembrete.js` (los bytes del logo desde su URL, con vallas: https, 3 s, 2 MB, PNG/JPEG; cualquier fallo → sin logo, nunca sin PDF), `patientLink.js` (factura↔paciente), `empleadosSugeridos.js` (los terapeutas del paciente arriba en el desplegable de Empleado de la factura, con la referencia preseleccionada — 31/08/2026), `invoicePdf.js` (pdfkit; desde el 31/08/2026 el render acepta un `spec` con los valores de FACTURA por defecto y exporta también `buildQuotePdfBuffer`/`quotePdfFilename` — el presupuesto es el mismo lienzo con otro rótulo; y acepta `patientName` —línea «Paciente: X» bajo el destinatario— y `stamp` —el sello junto a los totales—, los dos opcionales: en la descarga se quitan con `?paciente=0` / `?sello=0`, el correo y el ZIP llevan los valores por defecto), `exportXlsx.js` (Excel), `parseSort.js` (orden whitelisted), `conceptosCatalogo.js` (qué acepta el catálogo de conceptos y qué línea sale de elegir uno; lo comparten la API y el formulario — 31/08/2026), `mesesSinPagar.js` (los «meses seguidos» de la morosidad, sin acusar de meses anteriores al primer cobro del centro; con cero cobros la ruta devuelve `sinCobros: true` y la pantalla avisa del estreno en vez de listar a todo el centro — 31/08/2026), `prorrateo.js` (`prorrateoDeCuota`: la parte proporcional de una cuota cuando la familia empieza a mitad de mes — días restantes sobre los del mes; `rotuloDeProrrateo` la frase que queda escrita —«desde el 13/09/2026 (18/30 días)»— y `partesConProrrateo` varios servicios cada uno con SU fecha de inicio, que es lo que pidió el centro: empezó el 13 con logopedia y el 17 con psicología y cada servicio paga lo suyo. En el drawer «Nuevo cobro» modo cuota cada concepto elegido lleva su «Empezó el», el importe se suma y prorratea solo y la composición con sus prorrateos queda en la nota del cobro; en la factura cada línea tiene un «Empezó a mitad de mes» opcional que prorratea el precio desde el de mes entero y hornea el desglose en el texto de la línea (lo imprime el PDF; ni el POST de payments ni calculateInvoice cambiaron) — 31/08/2026), `repartoPorEmpleado.js` (`basePorEmpleado`: a quién se atribuye la base cuando las líneas llevan terapeutas distintos — cada línea al suyo, sin él al de la factura, títulos fuera; una línea puede llevar `employeeId` desde el formulario, `calculateInvoice` lo conserva y la analítica «Por empleado» aparta esas facturas del agregado SQL y las reparte línea a línea en JS — 31/08/2026), `socios.js` (`haySocios`: la vara única que decide si se enseña lo de socios — pestaña «Por socio», campo Socio en factura y gasto y «Cliente (opcional)» del gasto, que comparten interruptor; sin socios en `tenant_billing_settings.partners` nada de eso sale; la mitad de servidor para el layout, `sociosServidor.js` `centroConSocios`, mismo patrón que Banco — 31/08/2026), `camposGasto.js` (qué campos del cuerpo acepta un gasto, compartido por el POST y el PATCH de `/costs`; desde el 31/08/2026 acepta `irpfRate` — los euros nunca), `totalesGasto.js` (`computeCostTotals`: base + IVA + total del gasto, compartido por esos mismos dos endpoints; desde el 31/08/2026 también la retención de IRPF, que RESTA del total a pagar y se guarda en `costs.irpf_rate/irpf_amount`; la factura externa se adjunta subiéndola a `POST /api/billing/costs/adjunto` y se abre por `GET /api/billing/costs/adjunto/[docId]` — archivo central con source='gasto' pero servido por la puerta de billing, no por Documentos avanzado), `filtrosGasto.js` (con qué filtros se pide la lista de gastos, compartido por la tabla de `/facturacion/costes` y el enlace de su Excel), `busquedaCobros.js` (la búsqueda de Cobros en el SERVIDOR — 31/08/2026: el filtro del navegador solo veía los 100 cargados; todas las palabras en cualquiera de los campos —nota, cliente directo o el de la factura, nº de factura, método en cristiano— por regex insensible a tildes, con `subQuery: false` en el GET), `bajaProveedor.js` (`decidirBajaProveedor`: si un proveedor se borra de verdad o solo se desactiva, contando gastos Y entradas de almacén, cada uno gateado por su módulo), `audit.js` (auditoría del dinero), `getApplicableRate.js` (tarifas legacy), `cuotas.js` (la cuota mensual asignada — 01/09/2026: `tramoDelMes` qué parte del mes se cobra —generaliza `prorrateo.js` para cubrir también la baja a mitad de mes—, `importeDeCuota` el pactado o la suma de sus conceptos, `planDeCuotasDelMes` qué cobro sale de cada cuota vigente y cuál ya está generado, y `limpiarCuota` lo que acepta el alta), `cuotaPacientes.js` (**01/09/2026: DE QUIÉN es una cuota cuando la cuota no lo dice** — una cuota sin `patient_id` cubre a los pacientes de SU familia. Nace de un número: de las 274 cuotas activas de Aumenta solo **15** tienen paciente (las otras 259 son del volcado del Organízate, donde la cuota es de la familia), así que buscar por el nombre del niño no encontraba nada en el 95% de las filas y la columna «Paciente» era una raya. `rotuloPacienteDeCuota` lo dice sin inventarse el reparto —«Hugo, Marta (toda la familia)»— y `cuotaCasaCon` es el filtro de la pantalla) y `caja.js` (el dinero del cajón — 01/09/2026: `CESTAS`/`cestaDe` el reparto efectivo/tarjeta/banco —la domiciliación cuenta como banco—, `METODOS_COBRO`/`metodosValidos` la ÚNICA lista de métodos de cobro del CRM —la comparten las cuotas, «Facturar el mes» y el resumen—, `limpiarMovimiento` qué acepta un apunte (el importe se guarda siempre positivo, el signo lo pone `direction`), `saldoDeMovimientos` y `resumenDelDia`). El buscador de fichas de las pantallas de dinero es `GET /api/billing/fichas` (31/08/2026): abre con `billing` —Rosa y Olga cobran sin `clients` en su module_access y contra `/api/clients` el selector volvía VACÍO—, devuelve solo lo fiscal + `cuotaConceptIds`, y busca también por el NOMBRE DEL NIÑO (`lib/clients/buscarPorPaciente.js`, compartido con `/api/clients`; la etiqueta «— paciente: X» en `lib/clients/buscarFichas.js`); las cinco pantallas de facturación pasan `fuente="billing"` a `SelectorCliente`. Y la ficha APRENDE su cuota (`clients.cuota_concept_ids`, `migrate-clients-cuota.js`): el drawer de cobro modo cuota rellena los conceptos al elegir a la familia —desde el 01/09/2026 desde sus cuotas ASIGNADAS, sumando TODAS las vigentes y respetando el importe PACTADO por encima de la tarifa, con la aprendida solo de respaldo; y la composición se BORRA SIEMPRE al cambiar de familia, que antes se quedaba pegada la del paciente anterior con su importe—, y cada cobro de cuota re-aprende la composición desde `conceptIds` del POST de payments — lo último cobrado ES la cuota, así que el primer cobro del mes enseña y del segundo en adelante sale sola. Correo: `lib/email/templates/billing/invoiceSent.js` y `quoteSent.js` (31/08/2026). Aviso de almacén al emitir: `lib/inventory/applyStockMovementsForInvoice.js`. |
| **UI** | Sin `modules/billing/`: las pantallas viven en las páginas. `components/billing/`: `ClientBillingSection.jsx` (ficha de cliente), `PatientBillingSection.jsx` (ficha de paciente), `EmployeeBillingSection.jsx` (drawer de Equipo), `PatientReparto.jsx` (reparto de cuota entre pagadores; desde el 31/08/2026 con modo por porcentajes, botón 50/50 —cierre al céntimo en `lib/billing/repartoImportes.js`—, alta rápida de empresa pagadora, y puerta desde el formulario de nueva factura al elegir paciente), `ExportButtons.jsx` (Excel + ZIP de PDF). |
| **Modelos** | `models/tenant/`: `Invoice` (`invoices`), `Quote` (`quotes`), `Payment` (`payments`), `Cost` (`costs`), `Supplier` (`suppliers`), `RecurringInvoice` (`recurring_invoices`), `InvoiceSeries` (`invoice_series`), `TenantBillingSettings` (`tenant_billing_settings`, una fila), `Rate` (`rates`, legacy), `BillingConcept` (`billing_concepts`, el catálogo de conceptos y cuotas — 31/08/2026), `CashPoint` (`cash_points`), `CashClose` (`cash_closes`), `CashMovement` (`cash_movements`, entradas y salidas del cajón — 01/09/2026), `Cuota` (`billing_cuotas`, la cuota asignada a una familia — 01/09/2026; el cobro que sale de ella lo apunta `payments.cuota_id`). |
| **Interruptores y parámetros** | ninguno que lea el código (los `featureFlags`/`logicOverrides` de `billing` en `master.tenant_modules` no los mira nadie). |
| **Pantallas propias** | ninguna (`app/(dashboard)/facturacion/**` no tiene mapa `UI_OVERRIDES`; en producción ningún `billing` lleva `ui_override`). |
| **Scripts** | Activación: `node scripts/enable-module.js <slug> billing` — corre las 11 migraciones de `MODULES.billing` en `scripts/_module-migrations.js` (`migrate-suppliers`, `migrate-arqueo`, `migrate-impuestos-y-arqueo`, `migrate-billing-rework`, `migrate-billing-fix-kind-enum`, `migrate-billing-quotes`, `migrate-billing-correction-reason`, `migrate-billing-tax-regime`, `migrate-billing-vat-exempt`, `migrate-billing-irpf-partners`, `migrate-billing-membretes` —logo y pie propios del presupuesto, 31/08/2026, **va ANTES del despliegue**: el modelo pide las columnas por nombre—, `migrate-billing-sello` —el sello del centro (`stamp_url`), 31/08/2026, mismas reglas—, `migrate-billing-conceptos` —la tabla `billing_concepts`, 31/08/2026, ANTES del despliegue—, `migrate-billing-cuotas` —la tabla `billing_cuotas` y la columna `payments.cuota_id`, 01/09/2026, **ANTES del despliegue**—, `migrate-arqueo-movimientos` —la tabla `cash_movements`, 01/09/2026, ANTES del despliegue; la FK a `cash_points` se añade aparte y tolerando el fallo, porque las fotos doradas se copian sin claves primarias—, `migrate-rename-therapist-to-employee`, `migrate-invoice-fiscal-snapshot` —la foto fiscal, **va ANTES del despliegue**: el modelo la pide por nombre—, `migrate-invoices-client-restrict` —borrar una ficha ya no borra sus facturas—); el NIF de facturación va en CORE (`migrate-client-fiscal-taxid`). Datos, con dry-run: `backfill-cobro-paciente-desde-cuota.js` (01/09/2026: el cobro hereda el paciente de SU cuota — `--slug`, `--mes`, en seco por defecto. Hace falta cuando el enlace cuota↔paciente llega DESPUÉS que sus cobros, que es lo que pasó en septiembre; **corrido en aumenta el 01/09/2026: 224 cobros**. Escribe una sola columna y **no cambia ninguna factura**: «Facturar el mes» agrupa por pagador y terapia, nunca por paciente). Datos, con dry-run: `backfill-cuota-paciente-unico.js` (01/09/2026: la cuota de una familia con UN solo paciente pasa a ser de ese paciente — `--slug`, en seco por defecto, `--confirm` para escribir; **corrido en aumenta el 01/09/2026: 225 de 275 cuotas enlazadas**, y las 35 de familias con varios hijos se quedan sin paciente a propósito, que repartirlas sería inventárselo. Solo escribe `patient_id`: ni un importe cambia, y los cobros YA generados siguen con su `patient_id` a NULL). Seeds: `seed-billing-demo.js` (`npm run db:seed:billing-demo`, solo demo) y `_hechos/seed-billing-spain-enzymes.js`. ONE_OFF ya ejecutado: `_hechos/import-aumenta-contabilidad.js` (proveedores, gastos, facturas y cierres de Aumenta). · `volcar-cobros-organizate.js` (02/09/2026: los cobros y pendientes de la Caja de Organízate al CRM, casados POR FAMILIA con los cobros de cuota del mes; en seco por defecto, idempotente por la marca «Organízate #id» en la nota; corrido en `aumenta` para septiembre de 2026) |
| **Pruebas** | `scripts/_smoke-campos-gasto.mjs` (`node:test`, 20/08/2026, en `npm test`) fija `lib/billing/camposGasto.js`: `supplierId` entra, el desplegable vacío lo borra en vez de guardar `""`, una clave que no viene no se inventa, y `taxAmount`/`total` no se aceptan nunca del cuerpo; y `lib/billing/totalesGasto.js`: los cuatro importes que devuelve `computeCostTotals`, el redondeo a céntimos de la base y del IVA, el gasto de 0 €, el IVA nulo (0 %, no el 21 % de fábrica) y que una base ilegible sale como `NaN` en vez de colarse valiendo cero. `scripts/_smoke-filtros-gasto.mjs` (`node:test`, 21/08/2026, en `npm test`) fija `lib/billing/filtrosGasto.js`: qué filtros viajan a `GET /costs` y al Excel de gastos, que un desplegable sin elegir no se manda, que no se inventa un filtro que la pantalla no ofrece, y que para los mismos filtros la tabla y el Excel piden exactamente lo mismo (la tabla solo añade `sortBy`/`sortDir`). `scripts/_smoke-fechas-trimestres-madrid-parseDate.mjs` (`node:test`, 19/08/2026, en `npm test`) en su parte de `lib/billing/invoiceStatus.js`: `effectiveStatus` pasa `issued`/`sent`/`partially_paid` a `overdue` el día DESPUÉS del vencimiento y no el mismo, cobrada entera no vence (con 0,0049 € de margen por redondeo), los importes DECIMAL en texto se comparan como números, 0 € o sin vencimiento no vence, los estados terminales se devuelven tal cual y el `overdue` persistido a mano prevalece, «hoy» puede ser `YYYY-MM-DD`, ISO con hora o Date; `withEffectiveStatus(List)` devuelve copias sin tocar el original; **desde el 21/08/2026 fija que el «hoy» en Date es el día de MADRID y no el de UTC** —a las 00:30 de Madrid la factura de ayer ya vence, a las 23:59 todavía no, y el corte se mueve con el horario de verano—, y siguen marcados SOSPECHOSO un `dueDate` que llegue como Date (nunca vence) y un «hoy» vacío (tampoco). `scripts/_smoke-pdf-factura-informe.mjs` (`node:test`, 21/08/2026, ligera, en `npm test`, 76 comprobaciones) abre el buffer de `buildInvoicePdfBuffer` y lee el TEXTO de dentro —descomprime los flujos y traduce los glifos con el `/ToUnicode` que pdfkit ya mete—: emisor y cliente, el NIF con la regla de `nifCliente.js` (manda `fiscalTaxId`, respaldo en `taxId`), los totales (base, desglose de IVA por tipo de mayor a menor, IRPF solo si se retuvo, TOTAL y «Cobrado/Pendiente» solo en cobro parcial), las ocho etiquetas de estado —contrastadas contra el enum del modelo—, el salto de página con 60 líneas y el nombre de fichero. Ahí vive el arreglo del 21/08/2026: **una razón social de dos líneas ya no pisa el NIF**. Deja escritos cinco `it` marcados `// SOSPECHOSO`, entre ellos que un TOTAL de seis cifras se parte en dos líneas (la casilla solo admite hasta 99.999,99 €). El correo de envío de factura (`invoiceSent`) se prueba en `scripts/_smoke-plantillas-resto-layout.mjs`. `scripts/_smoke-facturacion-del-mes.mjs` (`node:test`, 31/08/2026, ligera, en `npm test`) fija `lib/billing/lotesCuotas.js`: una factura POR PAGADOR (los cobros del grupo en orden de fecha), quien no tiene NIF se aparta con su motivo en vez de tumbar el lote, la factura previa del mes solo AVISA (no excluye), un cobro sin cliente no entra, y el invariante del lote —el total de la factura es EXACTAMENTE la suma de sus cobros— barrido céntimo a céntimo a 21/10/4 % (la base se busca hacia atrás desde el total y, cuando el redondeo no deja base exacta, la diferencia va en una línea «Ajuste de redondeo» a IVA 0, siempre positiva), con el IRPF del lote fijado a 0. `scripts/_smoke-pdf-presupuesto.mjs` (`node:test`, 31/08/2026, ligera, en `npm test`) lee el TEXTO del PDF de presupuesto: rótulos de presupuesto presentes («PRESUPUESTO», «Válido hasta», «PRESUPUESTO PARA»), rótulos de factura ausentes, el borrador con su número, el pie PROPIO del presupuesto sin colarse el de la factura, y el nombre del fichero. `scripts/_smoke-meses-sin-pagar.mjs` (`node:test`, 31/08/2026, ligera, en `npm test`) fija `lib/billing/mesesSinPagar.js`: un mes pagado corta la cuenta, el arranque de la caja también (nadie debe meses de antes del primer cobro del centro), y sin tope cuenta la ventana entera. `scripts/_smoke-conceptos-catalogo.mjs` (`node:test`, 31/08/2026, ligera, en `npm test`) fija `lib/billing/conceptosCatalogo.js`: el alta se sanea con frases claras, la edición parcial solo toca lo que viaja, y elegir un concepto rellena la línea (texto, cantidad 1, precio, IVA). Su seed: `scripts/seed-conceptos-aumenta.js` (en seco por defecto, `--confirm` para escribir, nunca duplica por nombre). `scripts/_smoke-empleados-sugeridos.mjs` (`node:test`, 31/08/2026, ligera, en `npm test`) fija `lib/billing/empleadosSugeridos.js`: los sugeridos suben en su orden y marcados, sin sugeridos nada cambia, un id fuera de plantilla ni revienta ni se inventa. `scripts/_smoke-reparto-importes.mjs` (`node:test`, 31/08/2026, ligera, en `npm test`) fija `lib/billing/repartoImportes.js`: 50/50 exacto y con céntimo impar, porcentajes con la última parte cerrando la diferencia, barrido de mil totales cuadrando al céntimo, y entradas raras a cero sin reventar. `scripts/_smoke-pdf-paciente-sello.mjs` (`node:test`, 31/08/2026, ligera, en `npm test`) fija el nombre del paciente y el sello en el PDF de factura: salen cuando se piden, no salen cuando no, y un sello corrupto no tumba el documento. `scripts/_smoke-membrete.mjs` (`node:test`, 31/08/2026, ligera, en `npm test`) fija `lib/billing/membrete.js`: factura con su membrete, presupuesto con el suyo, caída al de la factura cuando el propio está vacío, y nulos (no cadenas vacías) sin configuración. `scripts/_smoke-acciones-requeridas.mjs` (`node:test`, 31/08/2026, ligera, en `npm test`) fija `lib/billing/accionesRequeridas.js`: la vencida sale con su PENDIENTE (total − cobrado), caducan y aceptados en listas separadas, quotes sin migrar (42P01) degrada a vacío, otro error no se esconde, y los topes se declaran. `scripts/_smoke-buscador-paciente-facturacion.mjs` (`node:test`, 31/08/2026, ligera, en `npm test`) fija `lib/clients/familiasPorPaciente.js` y que los GET de facturas y presupuestos lo usan: buscar por el nombre del paciente devuelve sus familias sin duplicados, sin texto/modelo/módulo asistencial no se consulta nada, la tabla sin migrar (42P01) devuelve vacío en vez de tumbar el buscador, otro error de base NO se esconde, y ningún endpoint copia el bloque en local. `scripts/_smoke-iva-por-defecto.mjs` (`node:test`, 31/08/2026, ligera, en `npm test`) fija `lib/billing/ivaPorDefecto.js`: exento manda (0 aunque haya otro tipo), sin exención el tipo del emisor (los DECIMAL llegan como texto; el 0 explícito es válido), y un tipo ausente o ilegible cae al 21 en vez de colarse valiendo cero. `scripts/_smoke-cuotas.mjs` (`node:test`, 01/09/2026, ligera, en `npm test`, 39 comprobaciones) fija `lib/billing/cuotas.js`: EL TRAMO (el mes del alta y el de la baja no se cobran enteros, y el prorrateo del alta da lo MISMO que `prorrateo.js` —si divergieran, el mismo alta daría dos importes—), LA REPETICIÓN (una cuota ya generada sale en «repetidas» y nunca en el lote: relanzar el mes no puede duplicar), una cuota EN PAUSA (apagada y sin fecha de baja) que no genera nada frente a una DADA DE BAJA que sí genera su último mes prorrateado, el importe pactado mandando sobre los conceptos, un cobro de 0 € apartado con su motivo, el día 31 recortado en febrero, el filtro por método sin cambiar el importe, y lo que acepta el alta. `scripts/_smoke-caja.mjs` (`node:test`, 01/09/2026, ligera, en `npm test`, 18 comprobaciones) fija `lib/billing/caja.js`: EL SIGNO (un −20 tecleado en una salida se guarda como 20; el signo lo pone `direction`, y un importe negativo no resta dos veces), las tres cestas cubriendo los cuatro métodos del enum de `Payment`, EL PENDIENTE FUERA (un cobro que aún no ha entrado no cuadra una caja — desde que las cuotas se generan solas son cientos de filas al mes), y lo que debe quedar en el cajón (fondo + efectivo + entradas − salidas). `scripts/_smoke-cuota-pacientes.mjs` (`node:test`, 01/09/2026, ligera, en `npm test`) fija `lib/billing/cuotaPacientes.js`: buscar por el nombre del niño encuentra la cuota de SU FAMILIA aunque la cuota no lleve paciente (259 de 274 en Aumenta), el rótulo dice «toda la familia» en vez de afirmar un reparto que nadie ha hecho, con muchos hermanos se corta la etiqueta pero NO la búsqueda, y una cuota sin nada no revienta. `scripts/_smoke-cuota-para-rellenar.mjs` (`node:test`, 01/09/2026, ligera, en `npm test`, 20 comprobaciones) fija `lib/billing/cuotaParaRellenar.js`, que es lo que Cobros y Facturas usan al elegir a la familia: entran TODAS sus cuotas (una por hijo) y no solo la primera, con paciente elegido solo las suyas, y si ninguna cuota lleva paciente entran las de la familia entera (las 260 de Aumenta vienen sin paciente); el mismo concepto en dos cuotas sale DOS veces (son dos hermanos); el importe PACTADO manda sobre la tarifa pero solo si TODAS lo tienen escrito; y lo que puso la cuota anterior SE REEMPLAZA al cambiar de familia mientras que lo escrito a mano NO se pisa —el fallo que se cobraba: al cambiar de paciente se quedaba fija la cuota (y el importe) del anterior—. Lo rozan `scripts/_smoke-alta-progenitores.mjs` (fija `lib/billing/nifCliente.js`) y `scripts/_smoke-paquetes.mjs` (que `billing` exige `clients`); todas entran en `npm test` y ninguna necesita base de datos. |
| **Decisiones** | `../decisions/2026-07-28-repaso-de-seguridad.md` (el envío de facturas por correo desde la demo; auditar lo que mueve dinero) · `../decisions/2026-08-13-ciclo-de-vida-de-un-cliente.md` (la baja aparta y no destruye: las facturas se conservan por ley). |
| **En este doc** | Visión general · Modelos · La factura guarda a quién se le emitió (26/08/2026) · La factura sabe qué tipo de cita cobró (29/08/2026) · Facturación del mes (31/08/2026) · «Cobrar mes» desde la cita (03/09/2026) · Cuotas mensuales asignadas (01/09/2026) · Entradas y salidas de caja (01/09/2026) · La lista de facturas: fecha, paciente y descarga de una (01/09/2026) · Los conceptos de la cuota rellenan la factura (01/09/2026) · Estados de factura y transiciones · Lógica de cálculos KPI · Numeración correlativa · Libro IVA y Modelo 303 · Endpoints · Páginas frontend |

> Documentación de detalle del módulo. Referencia rápida en
> `CLAUDE.md` (sección "Módulos del CRM"). Si encuentras una discrepancia entre
> este documento y el código, **prevalece el código**: actualiza este fichero.


## Envío de facturas por email (2026-07-27)

`POST /api/billing/invoices/[id]/send` ya NO se limita a marcar la factura:
**envía el PDF adjunto al email del cliente** con la plantilla
`lib/email/templates/billing/invoiceSent.js` y las credenciales Resend del
tenant. Antes solo anotaba el canal ("Sin integraciones reales todavía") y
había que descargar el PDF y mandarlo a mano.

- `?via=whatsapp|other` → solo anota el canal, no manda nada (para quien la
  entrega por su cuenta). Sin `via`, o `?via=email`, envía.
- Cliente sin email → se marca como enviada igualmente y la respuesta trae
  `emailError`; la UI avisa antes de pulsar y después del resultado.
- Best-effort: si Resend falla, la factura QUEDA en estado `sent` (el estado
  contable no puede depender de que conteste un proveedor de correo) y la
  respuesta lo dice en `emailEnviado`/`emailError`.

## Visión general

El módulo cubre el ciclo financiero del tenant:

- Presupuestos (serie `P`, no fiscal) convertibles en factura borrador.
- Emisión de facturas (borrador → emitida → enviada → cobrada / parcial / vencida),
  con PDF y envío por correo.
- Cobros parciales asociados a una factura, o sin factura todavía (por mes).
- Costes con IVA (deducible o no), por categoría (fijo / variable / OPEX / CAPEX),
  con proveedor compartido con Inventario; arqueo de caja.
- Facturación recurrente (plantillas, **emisión manual hoy**).
- Libro de IVA + estimación del Modelo 303 con exportación a Excel.
- Analítica por cliente, por empleado y por socio (sobre base imponible),
  morosidad mensual y panel operativo.
- Configuración fiscal del emisor y series de facturación correlativas.

Es un módulo opcional por tenant. Todos los endpoints validan
`hasModule("billing")` antes de operar.

## Lo que NO hace (por ahora)

- **Catálogo de servicios** reutilizable. Las líneas de factura se escriben a
  mano, **salvo** que el tenant tenga Inventario: el editor de `/facturacion/facturas`
  carga `/api/inventory/products` y deja elegir un producto del almacén por
  línea (`line.productId`), con la casilla «transporte» (`line.kind =
  "shipping"`) para la línea que no toca stock. `calculateInvoice` conserva los
  dos campos. Sin Inventario el endpoint responde 403 y el desplegable no sale.
- **Verifactu / Facturantia**: los campos `facturantiaId`, `qrUrl`,
  `verifactuStatus`, `verifactuSentAt` existen en `Invoice` pero **no se rellenan
  ni hay integración** (ni QR, ni hash, ni envío a la AEAT). El PDF NO es un
  documento conforme al sistema antifraude. Pendiente (masterclass Quique, ago-2026).
- **Motor de ejecución automática de RecurringInvoice**: hoy son plantillas
  con `nextRunAt` orientativa. La emisión real es manual (vía POST al
  endpoint, restringido a admin, o creando una factura nueva). Pendiente
  integrar con n8n.
- **Integración Inventario ↔ Costes por producto**: `Cost.inventoryProductId`
  sigue en BD y en el modelo, pero **sin asociación Sequelize** (el modelo
  `InventoryProduct` al que apuntaba se retiró) y sin UI. FK durmiente. El
  enlace que sí existe entre los dos módulos va por el otro lado:
  `StockEntry.costId` → `Cost` (la entrada de mercancía apunta al gasto que la
  pagó) y `Supplier`, compartido (ver `docs/modules/inventory.md`).

## Ya implementado (correcciones de doc previa)

Cosas que versiones antiguas de este doc daban por NO hechas y **sí existen**:

- **PDF de la factura** (`lib/billing/invoicePdf.js`): individual y en ZIP por
  rango; muestra desglose de IVA, IRPF, notas y pie. No lleva QR/Verifactu.
- **Presupuestos** convertibles a factura (`/api/billing/quotes/[id]/convert`).
- **IRPF** por factura y **rectificativas** con edición de importe (parcial por
  diferencias / anulación total).
- **Proveedor en el gasto** (20/08/2026): `POST` y `PATCH /costs` aceptan
  `supplierId` (opcional; se comprueba que el proveedor sea de este tenant
  antes de guardarlo), el `GET` lo devuelve con `supplier` y la pantalla de
  Gastos lo pide en un desplegable, lo enseña en una columna y deja ordenar por
  él. El Excel de gastos que se le pasa a la gestoría trae la columna
  «Proveedor» (detrás de «Empleado», como en pantalla) y acepta el filtro
  `supplierId`. La lista de campos que aceptan los dos endpoints está en
  `lib/billing/camposGasto.js` (una sola, antes estaba escrita dos veces y en
  ninguna aparecía `supplierId`) y la fórmula de los importes en
  `lib/billing/totalesGasto.js` (otra que estaba copiada dos veces), con prueba
  en `scripts/_smoke-campos-gasto.mjs`.
- **Filtrar los gastos por proveedor** (21/08/2026): la lista de Gastos tiene
  su desplegable de proveedor, junto a los de tipo y categoría, llenado con la
  MISMA carga de `/api/proveedores` que usa el formulario (solo activos; se
  esconde si el tenant no tiene ninguno dado de alta). Al filtro no se le
  añaden los proveedores de baja como sí hace el desplegable del formulario:
  ese los necesita porque el gasto que se edita puede apuntar a uno y el
  desplegable se quedaría sin opción que enseñar, mientras que el filtro nace
  vacío y solo llega a valer lo que alguien elija de la lista; a los gastos de
  un proveedor de baja se llega por el buscador libre, que mira su nombre.
  Los filtros que viajan a la tabla y los que viajan al Excel salen ahora de un
  solo sitio, `lib/billing/filtrosGasto.js` (`paramsFiltrosGasto` +
  `urlConFiltros`, prueba en `scripts/_smoke-filtros-gasto.mjs`): estaban
  escritos a mano dos veces y el Excel se bajaba ignorando en silencio lo que
  la pantalla tenía filtrado. `employeeId`, `partnerId` y `clientId` los siguen
  aceptando los dos endpoints y **siguen sin tener pantalla**: solo se alcanzan
  montando la URL a mano. Al revés pasa con el **buscador libre** de la barra:
  es el único filtro de la pantalla que NO viaja —se aplica en cliente sobre lo
  ya cargado y ningún endpoint de gastos lo acepta—, así que con una búsqueda
  escrita el Excel sigue trayendo más filas que la tabla, y los totales de la
  cabecera (que sí cuentan la búsqueda) no cuadran con la hoja.

## Configuración fiscal (sprint 2026-07-21)

`TenantBillingSettings` guarda la config fiscal del emisor. Novedades:

- **Régimen fiscal (`taxRegime`: `company` | `autonomo` | `freelance`)** e **IRPF por defecto 0**.
  `autonomo` (añadido 2026-07-27) = autónomo con actividad empresarial: factura SIN
  retención, igual que `company`; solo `freelance` (autónomo PROFESIONAL) aplica el −15%.
  Antes `defaultIrpfRate` era 15 y restaba IRPF a TODA factura (mal en SL y B2C).
  Ahora por defecto 0; solo se aplica si el emisor se marca **Autónomo profesional**
  (interruptor en Configuración → Facturación). Migración
  `migrate-billing-tax-regime.js` (resetea el 15 heredado). El cálculo
  (`invoices/route.js`) defaultea a 0.
- **Exención general de IVA (`vatExempt` + `vatExemptNote`)**. Con el interruptor
  activo, las nuevas facturas nacen a **IVA 0** y **congelan la nota legal** (art.20
  LIVA, editable) en `invoice.customFields.vatExemptNote`, que el PDF muestra.
  Migración `migrate-billing-vat-exempt.js`. Para exención por-servicio puntual se
  pone la línea a 0% en el editor.
- **Numeración en orden de fecha**: `assignInvoiceNumber` bloquea emitir una factura
  con fecha anterior a la última ya emitida de esa serie+año (error 422). Garantiza
  correlatividad cronológica además de numérica.
- **Reparto de cuota del paciente en 2 modos** (`components/billing/PatientReparto.jsx`):
  A) una factura por el total a un pagador (IVA una vez + cobros parciales), y
  B) varias facturas (una por pagador, IVA proporcional) con **validación de que la
  suma cuadre** con el total y limpieza de borradores si algo falla a medias.

## Modelos

Las definiciones viven en `models/tenant/`. Aquí solo se documenta lo no obvio.

### Invoice

Fichero: `models/tenant/Invoice.model.js`. Tabla: `invoices`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `clientId` | UUID NOT NULL | Cliente facturado (FK a `Client`). Es el **pagador**. |
| `patientId` | UUID nullable | De qué paciente es la factura (FK a `Patient`, `as: "patient"`). Solo trazabilidad: el pagador sigue siendo `clientId`. Lo valida e incluye `lib/billing/patientLink.js`, y se ignora si el tenant no tiene `clinica` ni `pacientes`. Va en columna y no en `customFields` porque la rectificativa reinicia `customFields`. **No es legacy** (reutilizada en la Fase 2a). |
| `employeeId` | UUID nullable | Empleado responsable (FK a `TeamMember`). |
| `partnerId` | STRING nullable | Socio que «gana» la factura; id de `TenantBillingSettings.partners`. Alimenta `/facturacion/analitica/socios`. |
| `projectId` | UUID nullable | FK durmiente a `Project` (asociada, sin uso en UI). |
| `series` | VARCHAR(8) | Código de serie (`F` ordinaria, `R` rectificativa). |
| `number` | STRING UNIQUE | `DRAFT-…` mientras es borrador; `F-YYYY-NNNN` al emitir. |
| `status` | ENUM | `draft`, `issued`, `sent`, `paid`, `partially_paid`, `overdue`, `cancelled`, `rectified`. |
| `issueDate` | DATEONLY NOT NULL | Fecha de emisión (define el periodo fiscal). |
| `dueDate` | DATEONLY nullable | Se prerellena con `issueDate + TenantBillingSettings.defaultPaymentTermsDays` al crear el borrador y al emitir, si no llega explícito. |
| `lines` | JSONB | Estructura nueva con IVA por línea. Ver sección dedicada. |
| `taxBase` | DECIMAL(12,2) | Suma de `lineBase`. **Es la magnitud financiera real**. |
| `vatAmount` | DECIMAL(12,2) | Suma de `lineVat`. |
| `irpfRate`, `irpfAmount` | DECIMAL(5,2), DECIMAL(12,2) | Retención IRPF **sobre la base imponible** (`irpfAmount = taxBase × irpfRate/100`). Por defecto `TenantBillingSettings.defaultIrpfRate` (0 salvo `taxRegime = freelance`). |
| `total` | DECIMAL(12,2) | `taxBase + vatAmount − irpfAmount`. |
| `paidAmount` | DECIMAL(12,2) | Cache: SUM de `Payment.amount` con `status='completed'`. Lo recalcula `updateInvoiceStatus`. |
| `rectifiesInvoiceId` | UUID nullable | Si esta factura es rectificativa, apunta a la original. |
| `rectifiedByInvoiceId` | UUID nullable | En la original, apunta a su rectificativa cuando ya fue rectificada. |
| `correctionReason` | STRING nullable | Motivo de la rectificación (desplegable de la UI: error de importe, de IVA, de datos, otros). Solo lo llevan las de serie `R`. |
| `recurringConfig` | JSONB | Si nació de una RecurringInvoice, guarda `{ recurringInvoiceId }`. |
| `customFields` | JSONB | Extensión libre. Ahí van `sentVia`/`sentAt`/`sentTo` (envío), `vatExemptNote` (exención congelada), `sourceQuoteId`/`sourceQuoteNumber` (viene de un presupuesto) y `sourceOrderId` (viene de un pedido). |

Campos legacy (no tocar, pendiente de limpieza en sprint posterior):
`familyId`, `serviceType`, `invoiceType`, `subtotal`, `vatRate`,
`discountType`, `discountValue`. Vienen del modelo terapéutico anterior. El
código nuevo los rellena con valores neutros (`subtotal = taxBase`,
`vatRate = 0`) para mantener compatibilidad de datos antiguos.

Asociaciones (definidas en `lib/db/tenantDb.js`):

- `Invoice.belongsTo(Client, as: "client")`.
- `Invoice.hasMany(Payment, as: "payments")`.
- `Invoice.belongsTo(TeamMember, as: "employee")`.
- `Invoice.belongsTo(Patient, as: "patient")` y `Invoice.belongsTo(Project, as: "project")`.
- `Invoice.hasOne(Order, as: "order")` (la factura borrador que nace al completar un pedido).
- Self-relations: `belongsTo(Invoice, as: "rectifies")` y
  `belongsTo(Invoice, as: "rectifiedBy")`.

### Cost

Fichero: `models/tenant/Cost.model.js`. Tabla: `costs`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `type` | ENUM | `salary`, `rent`, `software`, `material`, `commission`, `tax`, `other`. `tax` (IRPF, IVA, IBI, tasas) se añadió el 02/08/2026 (`migrate-impuestos-y-arqueo`): antes los impuestos caían en `other`, mezclados con los folios. |
| `category` | ENUM | `fixed`, `variable`, `capex`, `opex`. |
| `description` | STRING NOT NULL | Texto libre. |
| `taxBase` | DECIMAL(12,2) | Magnitud usada en márgenes y EBITDA. |
| `vatRate` | DECIMAL(5,2) | Default `21`. |
| `taxAmount` | DECIMAL(12,2) | `taxBase × vatRate / 100` recalculado en POST/PATCH con `computeCostTotals` (`lib/billing/totalesGasto.js`), nunca aceptado del cuerpo. |
| `total` | DECIMAL(12,2) | `taxBase + taxAmount`. |
| `vatDeductible` | BOOLEAN | Si `true`, contribuye a IVA soportado del Modelo 303. |
| `incurredAt` | DATEONLY NOT NULL | Fecha real del gasto. Filtra por periodo. |
| `employeeId` | UUID nullable | FK a `TeamMember` (quien lo registró o a quien se imputa). |
| `partnerId` | STRING nullable | Socio que se desgrava el gasto; id de `TenantBillingSettings.partners`. Filtro `partnerId` en `GET /costs` y en el Excel de gastos. |
| `clientId` | UUID nullable | FK a `Client` para imputar costes a un cliente concreto. |
| `supplierId` | UUID nullable | FK a `Supplier` (`as: "supplier"`, `ON DELETE SET NULL`). A quién se le pagó. Opcional a propósito (una tasa o un recibo suelto no tienen ficha). Lo escriben el import de Aumenta y, desde el 20/08/2026, `POST`/`PATCH /costs` y la pantalla de Gastos. Filtro `supplierId` y orden `supplier.name` en `GET /costs` y en el Excel de gastos. |
| `projectId` | UUID nullable | FK durmiente a `Project` (asociada, sin uso en UI). |
| `inventoryProductId` | UUID nullable | **Durmiente**: sin asociación, endpoints ni UI. |
| `attachmentUrl` | STRING nullable | URL del justificante. |

Campos durmientes en BD pero no expuestos en el modelo Sequelize (legacy del
seed antiguo, pendientes de borrado físico):

- `month` (VARCHAR YYYY-MM): la migración la pasó a `NULL` permitido.
- `amount` (DECIMAL): la migración hizo backfill `taxBase = amount` y la pasó
  a `NULL` permitido.

Asociaciones:

- `Cost.belongsTo(TeamMember, as: "employee")`.
- `Cost.belongsTo(Client, as: "client")`.
- `Cost.belongsTo(Supplier, as: "supplier")` y `Cost.belongsTo(Project, as: "project")`.
- `Cost.hasMany(StockEntry, as: "stockEntries")`: la entrada de mercancía que
  pagó este gasto (Inventario).
- Columna `Cost.inventoryProductId` sigue en BD pero **sin asociación
  Sequelize**: el modelo `InventoryProduct` se retiró con el rework de
  Inventario, y `OutboundProduct` —al que se pensó re-apuntarla— tampoco
  existe desde el 02/08/2026. Pendiente decidir si se elimina.

### Payment

Fichero: `models/tenant/Payment.model.js`. Tabla: `payments`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `invoiceId` | UUID **nullable** | FK a `Invoice`. Nullable desde el sprint Aumenta (28/07/2026): el flujo real es cobrar ANTES de facturar y asociar la factura después. Un cobro sin factura exige `clientId`. |
| `clientId` | UUID nullable | Quién paga (`as: "client"`). Con factura se rellena desde `invoice.clientId`. |
| `periodMonth` | DATEONLY nullable | Mes al que corresponde el cobro (`YYYY-MM-01`). Es lo que mira `GET /morosidad` y el bloqueo por impago del portal (`lib/citas/portalMeses.js`): un mes está pagado si hay un cobro `completed` con ese `periodMonth`. |
| `amount` | DECIMAL(12,2) | Importe del cobro. Se valida que no exceda `total - paidAmount`. |
| `paidAt` | DATE NOT NULL | Fecha del cobro (no del periodo de la factura). |
| `method` | ENUM | `card`, `transfer`, `cash`, `direct_debit`. |
| `status` | ENUM | `pending`, `completed`, `failed`, `refunded`. Default `completed`. |
| `notes` | TEXT nullable | |
| `patientId` / `conceptId` | UUID nullable | De quién y de qué terapia es la cuota (31/08/2026). `conceptId` apunta al catálogo y solo se rellena cuando la cuota es de UN concepto: una cuota compuesta no se puede partir por terapia. |
| `cuotaId` | UUID nullable | De qué cuota asignada nació el cobro (01/09/2026, `billing_cuotas`). Lo rellena SOLO la generación mensual; el cobro apuntado a mano sigue naciendo a NULL. Es lo que evita generar dos veces el mismo mes: sin él, «ya generado» habría que adivinarlo por importe y fecha. |

Solo los pagos con `status = "completed"` cuentan en `paidAmount` y disparan
transición de la factura. Los cobros en efectivo (`method = "cash"`) del día
son además lo que el arqueo espera encontrar en caja (ver `CashClose`). **Los
que genera la cuota del mes nacen `pending`** (01/09/2026): generar no es
cobrar, así que hasta que alguien los pase a cobrado no cuentan ni para
morosidad, ni para el portal, ni para «Facturar el mes».

Asociaciones: `Payment.belongsTo(Invoice, as: "invoice")` y
`Payment.belongsTo(Client, as: "client")`.

### Quote (presupuesto)

Fichero: `models/tenant/Quote.model.js`. Tabla: `quotes`. Documento
**pre-venta, no fiscal**: sin Verifactu ni numeración correlativa obligatoria.
Se numera al **crear** (serie `P`, `P-YYYY-NNNN`, `lib/billing/generateQuoteNumber.js`),
no al emitir, porque al no ser fiscal se permiten huecos.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `clientId` | UUID NOT NULL | FK a `Client`. |
| `projectId`, `employeeId` | UUID nullable | FK a `Project` / `TeamMember`. |
| `series`, `number` | VARCHAR(8), STRING UNIQUE | `P` por defecto. |
| `status` | ENUM | `draft`, `sent`, `viewed`, `accepted`, `rejected`, `expired`, `converted`. |
| `issueDate`, `validUntil` | DATEONLY | Fecha y caducidad de la oferta. |
| `lines`, `taxBase`, `vatAmount`, `total` | — | Misma forma que `Invoice` (las calcula `calculateInvoice`, sin IRPF). |
| `sentAt`, `viewedAt`, `acceptedAt`, `rejectedAt` | DATE nullable | Línea de tiempo. |
| `convertedInvoiceId`, `convertedAt` | UUID / DATE nullable | La factura en que se convirtió (`as: "convertedInvoice"`). En la factura, el origen va en `customFields.sourceQuoteId/Number`. |

`PATCH /quotes/[id]` acepta a mano `draft`/`sent`/`viewed`/`rejected`/`expired`
(y sella la fecha correspondiente); `accepted` y `converted` tienen endpoint
propio. Un presupuesto `converted` no se edita ni se borra (409).

### Supplier (proveedor)

Fichero: `models/tenant/Supplier.model.js`. Tabla: `suppliers`. A quién SE LE
COMPRA. Entidad **compartida** con Inventario (`Cost.supplierId` = lo que le
pagas; `StockEntry.supplierId` = lo que te entrega), creada el 02/08/2026
porque en Gastos no existía y en Inventario era texto libre. Campos: `name`
(lo único obligatorio), `taxId`, `email`, `phone`, `contactName`, `address`,
`notes`, `active`. Se **desactiva** en vez de borrarse si tiene gastos o
entradas colgando; se borra de verdad solo si no tiene nada. Sus endpoints
viven fuera de `/api/billing` (ver «Proveedores y arqueo»).

### CashPoint y CashClose (arqueo)

Ficheros: `models/tenant/CashPoint.model.js` (`cash_points`) y
`CashClose.model.js` (`cash_closes`). Lo único de la Contabilidad de Organízate
que Facturación no cubría (02/08/2026).

- `CashPoint`: el punto donde se cobra en efectivo (`name`, `active`, `notes`).
  Casi todos los clientes tendrán uno; existe como lista porque el arqueo se
  cuadra POR caja.
- `CashClose`: un cierre. `cashPointId`, `closeDate`, `openingAmount` (fondo),
  `expectedAmount` (fondo + cobros `cash` `completed` del día — **lo calcula el
  servidor**, nunca el navegador), `countedAmount` (lo contado a mano),
  `difference` (**guardada calculada**, contado − esperado: un cierre es la
  FOTO de ese día y no se recalcula al leer), `notes`, `closedById` (FK a
  `TeamMember`, `as: "closedBy"`), `closedAt`. NO hay único por (caja, día):
  Aumenta cierra varias veces al día, una por turno.

⚠️ Limitación conocida: `Payment` no guarda en QUÉ caja se cobró, así que con
dos cajas la parte de COBROS del esperado saldría igual para las dos (los
apuntes de `CashMovement` sí van por caja). El día que un cliente abra la
segunda hay que añadir `payments.cash_point_id` ANTES.

### CashMovement (entradas y salidas de caja)

Fichero: `models/tenant/CashMovement.model.js`. Tabla: `cash_movements`
(01/09/2026). Lo que entra y sale del cajón y **no es un cobro**.

`cashPointId` (NOT NULL, de qué cajón), `date` (DATEONLY: un movimiento de caja
es del día, no de una hora), `direction` (`in`/`out`), `amount` (DECIMAL(10,2),
**siempre positivo**: el signo lo pone `direction`), `concept` (obligatorio),
`notes` y `createdById` (FK a `TeamMember`, `as: "createdBy"`).

Entra en el arqueo: lo esperado pasa a ser fondo + cobros en efectivo del día +
entradas − salidas. Ver la sección «Entradas y salidas de caja (01/09/2026)».

### Cuota (la cuota mensual asignada)

Fichero: `models/tenant/Cuota.model.js`. Tabla: `billing_cuotas` (01/09/2026).
Qué paga cada familia todos los meses. No confundir con `BillingConcept` (el
catálogo: el precio de la casa) ni con `clients.cuota_concept_ids` (la cuota
APRENDIDA del último cobro, que rellena el drawer).

`clientId` (NOT NULL, el pagador), `patientId` (opcional), `conceptIds` (JSONB),
`amount` (**nullable, y el NULL significa «lo que digan sus conceptos»**),
`method`, `dayOfMonth`, `startDate` (NOT NULL), `endDate` (la baja), `active`,
`notes`. Ver la sección «Cuotas mensuales asignadas (01/09/2026)».

### RecurringInvoice

Fichero: `models/tenant/RecurringInvoice.model.js`. Tabla: `recurring_invoices`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `clientId` | UUID NOT NULL | |
| `familyId` | UUID nullable | Legacy del dominio terapéutico. |
| `frequency` | ENUM | `weekly`, `biweekly`, `monthly`. |
| `nextRunAt` | DATE NOT NULL | Próxima fecha sugerida. **Hoy solo orientativa**. |
| `templateConfig` | JSONB | Plantilla de la factura: `{ description, taxBase, vatRate, lines?, notes? }`. |
| `active` | BOOLEAN | Pausa/activa la recurrencia. |

POST a `/api/billing/recurring/[id]` genera un **borrador** a partir de la
plantilla y avanza `nextRunAt` según la frecuencia. No emite ni asigna
número correlativo. El usuario tiene que ir a Facturas y pulsar "Emitir".

Asociación: `RecurringInvoice.belongsTo(Client, as: "client")`.

### InvoiceSeries

Fichero: `models/tenant/InvoiceSeries.model.js`. Tabla: `invoice_series`.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `code` | VARCHAR(8) UNIQUE | Identificador corto (`F`, `R`). |
| `name` | STRING | Nombre legible. |
| `prefix` | VARCHAR(16) | Prefijo del número final. Por defecto coincide con `code`. |
| `year` | INTEGER | Año de la numeración. Si cambia, se reinicia. |
| `nextNumber` | INTEGER | Próximo número correlativo. Lock pesimista al asignar. |
| `isDefault` | BOOLEAN | Solo informativo en la UI. |
| `kind` | ENUM | `normal` o `rectificative`. |

La migración crea siempre dos series por tenant: `F` (default, `normal`) y
`R` (`rectificative`). El endpoint `PATCH /series/[id]` **no permite editar
`nextNumber`** para no romper la correlatividad fiscal. `DELETE` rechaza
si hay facturas con esa serie.

### TenantBillingSettings

Fichero: `models/tenant/TenantBillingSettings.model.js`. Tabla:
`tenant_billing_settings`. Una sola fila por tenant.

| Campo | Tipo | Notas |
| --- | --- | --- |
| `fiscalName`, `taxId`, `fiscalAddress`, `fiscalCity`, `fiscalZip` | STRING nullable | Datos fiscales del **emisor**. |
| `fiscalCountry` | VARCHAR(2) | Default `ES`. |
| `defaultVatRate` | DECIMAL(5,2) | Default `21`. Aplicado a las nuevas líneas que no traigan `vatRate`. |
| `availableVatRates` | JSONB | Array de números 0-100. Default `[21, 10, 4, 0]`. La UI usa esta lista en los desplegables. |
| `defaultPaymentTermsDays` | INTEGER | Default `30`. Se aplica automáticamente como `dueDate = issueDate + N días` cuando POST `/invoices` no incluye `dueDate`, y al emitir un borrador que aún no lo tenga. La UI también lo prerellena. |
| `taxRegime` | VARCHAR(20) | `company` (default) · `autonomo` · `freelance`. Solo `freelance` aplica IRPF por defecto. Ver «Configuración fiscal». |
| `defaultIrpfRate` | DECIMAL(5,2) | Default `0`. IRPF de las facturas nuevas que no traigan `irpfRate`. |
| `vatExempt`, `vatExemptNote` | BOOLEAN, TEXT | Exención general de IVA y su nota legal (se congela en cada factura). |
| `partners` | JSONB | Socios `[{ id, name }]` (default Jorge/Rodrigo). Es lo que eligen `Invoice.partnerId` y `Cost.partnerId`, y lo que pinta «Por socio». |
| `invoiceFooterText`, `logoUrl` | nullable | Branding del documento. |

### Modelos relacionados

- `TeamMember.monthlySalary` (DECIMAL(10,2) nullable): salario mensual.
  **Solo informativo**. NO se cuenta como coste real (eso lo hace la tabla
  `Cost` con `type='salary'`). Filtrado en backend: solo admin/superadmin
  lo ve. Se usa para el KPI `projectedSalaryCost` (proyección estimativa).
- `TeamMember.hourlyCost` y `hourlyRate`: legacy de tarificación por hora,
  no se usan en los KPIs actuales.
- `Client.fiscalName`, `fiscalAddress`, `fiscalCity`, `fiscalZip`,
  `fiscalCountry`: campos fiscales del **destinatario**, opcionales en el
  modelo. Bloqueantes para emitir factura: ver "Validaciones críticas".

## Estructura de líneas de factura

`Invoice.lines` es un array JSONB. Cada línea tiene este esquema (lo computa
`lib/billing/calculateInvoice.js`):

```json
{
  "description": "Consultoría estratégica",
  "quantity": 1,
  "unitPrice": 1800,
  "discountPct": 0,
  "vatRate": 21,
  "lineBase": 1800.00,
  "lineVat": 378.00,
  "lineTotal": 2178.00
}
```

Reglas:

- Cantidades negativas son válidas (se usan en rectificativas).
- `lineBase = round2(quantity × unitPrice × (1 - discountPct/100))`.
- `lineVat = round2(lineBase × vatRate/100)`.
- `lineTotal = round2(lineBase + lineVat)`.
- Cada línea se redondea a 2 decimales **antes de sumar**: evita drift de
  céntimos entre la suma de líneas y los totales de la factura.
- Dos campos opcionales que `calculateInvoice` conserva tal cual si llegan:
  `productId` (producto del almacén, si el tenant tiene Inventario) y `kind`
  (`"shipping"` = línea de transporte, que no toca stock). Los lee
  `lib/inventory/applyStockMovementsForInvoice.js` al emitir.

`calculateInvoice` también devuelve un agregado `vatBreakdown` por tipo de
IVA (`{ "21": { base, vat }, "10": { base, vat } }`) que se usa para pintar
el desglose en el drawer de la factura, y aplica el IRPF sobre la base
(`total = taxBase + vatAmount − irpfAmount`).

## Estados de factura y transiciones

```
              POST /invoices                  POST /invoices/:id/issue
   (nada) ──────────────────► draft ──────────────────────────► issued
                              │  │                                │
                              │  │ DELETE /invoices/:id           │ POST /invoices/:id/send
                              │  └──► (borrada)                   ▼
                              │                                  sent
                              │                                   │
              POST /invoices/:id/cancel                           │
              (solo si paidAmount = 0)                            ▼
   draft / issued / sent ─────────────────────► cancelled    paid / partially_paid / overdue
                                                                  │
                                                                  │ POST /invoices/:id/rectify
                                                                  ▼
                                                              rectified  + (nueva R-…)
```

Quién dispara cada transición:

- **`draft` → `issued`**: `POST /api/billing/invoices/[id]/issue`. Asigna
  número correlativo en transacción con `FOR UPDATE`. Rechaza con `422` si
  el cliente no tiene `fiscalName`/`name` o `taxId`. Rechaza con `400` si
  no hay líneas o `total <= 0`. Solo admin/superadmin.
- **`issued` → `sent`**: `POST /api/billing/invoices/[id]/send`. Solo
  permitido si el estado actual es `issued`; rechaza con `422` en cualquier
  otro caso. Solo admin/superadmin. Sin `?via` o con `?via=email` **envía el
  PDF por correo** al email del cliente (Resend del tenant; ver «Envío de
  facturas por email» arriba); `?via=whatsapp|other` solo anota el canal.
  Se persiste en `customFields.sentVia`/`sentAt`/`sentTo`. La distinción
  `issued` vs `sent` **no afecta a ningún cálculo de KPI**. También se usa
  como destino de revertido desde `paid`/`partially_paid` cuando desaparecen
  los cobros (ver `updateInvoiceStatus.js`).
- **`issued`/`sent` → `paid` / `partially_paid`**: indirecto. Al crear o
  actualizar `Payment`, `updateInvoiceStatus` recalcula `paidAmount` y
  ajusta el estado.
- **`overdue`**: se calcula **dinámicamente en lectura** (no se persiste).
  El helper `lib/billing/invoiceStatus.js` (`effectiveStatus`) reescribe
  el `status` que se serializa hacia el cliente: si la factura está en
  `issued`/`sent`/`partially_paid` y `dueDate < hoy` y `paidAmount < total`,
  el campo `status` devuelto es `overdue`. La fila en BD no se modifica.
  Si un admin setea `overdue` manualmente vía PATCH (caso típico:
  reclamación abierta), prevalece sobre el cálculo. Esto evita la
  necesidad de un cron y elimina riesgos de desincronización.

  ⚠️ **El «hoy» contra el que se compara `dueDate` es el día de Europe/Madrid,
  no el de UTC** (`lib/utils/madridDate.js`). Se arregló el 21/08/2026: antes se
  calculaba con `toISOString()`, así que entre las 00:00 y las 02:00 de Madrid
  (01:00 en invierno) una factura que había vencido el día anterior seguía
  apareciendo como no vencida —en el listado, en la ficha y en el resumen de
  facturación—. Que el contenedor corra en `TZ=Europe/Madrid` desde el
  19/08/2026 no lo tapaba: `toISOString()` es UTC corra el proceso donde corra.
  Ningún endpoint le pasa la fecha: los tres usan el reloj. Si se le pasa un
  **texto** («2026-08-20») se toma tal cual, porque un texto no es un instante y
  no tiene zona que convertir: es un día que ya decidió quien llama.
- **`draft`/`issued`/`sent` → `cancelled`**: `POST /invoices/[id]/cancel`.
  `409` si `paidAmount > 0` (refunde primero o emite rectificativa). Solo
  admin/superadmin.
- **`issued`/`sent`/`paid`/`partially_paid`/`overdue` → `rectified`**:
  `POST /invoices/[id]/rectify`. Crea una factura nueva en serie `R` con
  cantidades invertidas (negativas), la marca `issued`, enlaza ambas
  (`rectifiesInvoiceId` ↔ `rectifiedByInvoiceId`) y deja la original como
  `rectified`. Rechaza si ya hay `rectifiedByInvoiceId`. Solo admin/superadmin.
- **`draft` → eliminable**: `DELETE /api/billing/invoices/[id]` (`409` si
  no es draft). Solo admin/superadmin.

`PATCH /invoices/[id]` solo acepta cambios cuando el estado es `draft`.
Para cualquier modificación posterior se usa rectificativa.

## Lógica de cálculos KPI

Toda la lógica vive en `lib/billing/billingSummary.js`. Principio rector:

> **Todos los KPIs financieros del Resumen están en BASE IMPONIBLE (sin IVA).**
> El IVA es dinero que pasa por la empresa pero no es suyo. Los reportes que
> sí lo cuentan son el Libro IVA y el Modelo 303 (otra función,
> `buildIvaReport.js`).

Filtros base de "facturas activas del periodo":

- `issueDate BETWEEN from AND to`
- `status NOT IN ('draft', 'cancelled', 'rectified')`

### Facturado

```
billedBase = SUM(invoices.tax_base)   (sobre facturas activas)
```

### Cobrado

Cobrado proporcional en base imponible. Cada factura aporta su parte cobrada
**proporcional al peso de la base sobre el total con IVA**:

```
collectedBase = SUM( paid_amount × tax_base / NULLIF(total, 0) )
```

`NULLIF` evita división por cero en facturas con `total = 0`. Esto reparte
correctamente el IVA pagado fuera del importe operativo y elimina el bug
histórico que producía `Cobrado / Facturado > 100 %`.

### Pendiente

```
pendingCollection = max(0, billedBase - collectedBase)
```

Siempre `≥ 0` por construcción.

### Conteos

- `invoiceCount`: nº de facturas activas del periodo (todas).
- `clientCount`: clientes únicos de las facturas activas del periodo.
- `pendingInvoiceCount`: nº de facturas activas del periodo con
  `paid_amount < total`.
- `pendingClientCount`: clientes únicos de las pendientes (no de todas).

### Ticket medio

```
averageTicket = invoiceCount > 0 ? billedBase / invoiceCount : 0
```

Sobre base imponible.

### Costes

Sobre `Cost.taxBase` filtrado por `incurredAt BETWEEN from AND to`. Se agrupa
por `category` y por `type`.

```
totalCosts     = sum(costs.tax_base)
operatingCosts = costs.byCategory.variable
               + costs.byCategory.fixed
               + costs.byCategory.opex
```

CAPEX está fuera de operativos por definición (es inversión, no gasto del
periodo).

### Márgenes

```
grossMargin = billedBase - costs.byCategory.variable
netMargin   = billedBase - operatingCosts
ebitda      = netMargin + costs.byCategory.capex
```

EBITDA suma el CAPEX al Margen Neto porque el CAPEX no es coste operativo.
Los porcentajes correspondientes se calculan sobre `billedBase`.

### `monthsBetween`

Para `projectedSalaryCost` (analítica de empleados):

```
days = (to - from) / (1000*60*60*24)
months = max(0, round2(days / 30.4375))
```

Sin `+1` inclusivo. Un periodo de 1 año natural devuelve ≈ 12.0 meses, no 13.

### Bugs históricos que NO se deben reintroducir

Antes del rework, los siguientes bugs estaban en producción y han sido
corregidos. Si vuelves a tocar `billingSummary.js`, no rompas estos invariantes:

1. **Cobrado superior a 100 % del Facturado** — venía de sumar `paid_amount`
   con IVA contra `tax_base` sin IVA. Solución: distribución proporcional con
   `paid_amount × tax_base / total`.
2. **EBITDA igual al Margen Neto** — antes no se sumaba el CAPEX. Solución:
   `ebitda = netMargin + capex`.
3. **Pendiente contado sobre todas las facturas** — antes el conteo de
   "facturas pendientes" era el total de facturas del periodo. Solución:
   filtro adicional `paidAmount < total`.
4. **Mezcla de unidades** — algunos KPIs venían con IVA y otros sin él.
   Solución: TODO el Resumen va sobre `taxBase`. Solo `billedTotal` se
   mantiene como dato informativo.
5. **`projectedSalaryCost` inflado ~8 %** — la fórmula inclusiva
   `(y2-y1)*12 + (m2-m1) + 1` daba 13 meses para un año. Solución: días/30.4375.
6. **Cobrado/Facturado > 100 % al rectificar facturas cobradas** — el filtro
   `status NOT IN (..., 'rectified')` excluía la original (perdiendo su
   `paid_amount` del `collectedBase`) mientras la R con base negativa restaba
   del `billedBase` sin compensar el cobrado (R recién creada con
   `paid_amount=0`). Resultado: ratio > 100 %. **Solución** (2026-05): en
   `POST /api/billing/invoices/[id]/rectify` la R hereda
   `paidAmount = -original.paidAmount` al crearse. Así el cobrado virtual de
   la R compensa exactamente el cobrado perdido al excluir la original. Para
   tenants con R existentes anteriores al fix, ejecutar el backfill SQL:
   `UPDATE crm_${slug}.invoices r SET paid_amount = -f.paid_amount FROM
   crm_${slug}.invoices f WHERE r.rectifies_invoice_id = f.id AND
   r.paid_amount = 0`.

## La factura guarda a quién se le emitió (26/08/2026)

Hasta ese día una factura **no guardaba ni un dato fiscal propio**: el nombre, el
NIF, la dirección y la ciudad impresos se leían de la ficha del cliente CADA VEZ
que se generaba el PDF o el libro de IVA. Corregir hoy el NIF de una familia
cambiaba, hacia atrás y en silencio, todas sus facturas ya emitidas — en Aumenta,
14.243.

Desde el 26/08/2026, **al emitir** se congela en `invoices.fiscal_snapshot`
(JSONB) `{ nombre, nif, direccion, cp, ciudad, pais }`. Lo pone
`app/api/billing/invoices/[id]/issue/route.js`, justo después del bloqueo fiscal
que exige razón social y NIF; la rectificativa **hereda** la del original.

Quién la lee: **solo el PDF y el libro de IVA**, y los dos por
`lib/billing/datosFiscales.js`, para que los dos documentos oficiales de una
misma factura no puedan decir cosas distintas. Los agregados por cliente
(analítica, Excel por cliente, KPIs) siguen leyendo la ficha viva: ahí se agrupa
por quién es el cliente HOY, que es lo correcto en un informe de dirección.

⚠️ **Las anteriores no se rellenan.** Sin foto se lee del cliente, como siempre.
Rellenarlas con los datos de hoy estamparía como «lo que decía la factura de
2022» algo que quizá se corrigió después. Y una foto vacía o rota tampoco tapa
el respaldo: si no trae ni nombre ni NIF, se lee del cliente.

El **correo** no se congela aunque el PDF lo imprima: no es un elemento fiscal,
es por dónde se le escribe a esa persona hoy.

**Borrar una ficha ya no borra sus facturas** (mismo día):
`invoices.client_id` pasa de `ON DELETE CASCADE` a `ON DELETE RESTRICT`, y de
paso las restricciones duplicadas de esa columna se dejan en una. El `if` de
`DELETE /api/clients/[id]` sigue estando, ahora como mensaje por delante de una
garantía real. Motivo y cifras en
`docs/decisions/2026-08-26-la-factura-se-sostiene-sola.md`.

## La factura sabe qué tipo de cita cobró (29/08/2026)

`invoices.event_type_id` (UUID, nullable, FK a `event_types` con `ON DELETE SET
NULL` donde esa tabla existe; migración `migrate-invoice-tipo-cita.js`). Es el
enlace del que la portada saca **«Ingresos por servicio»**: la decisión de
Rodrigo fue que el dinero por servicio no se sabe por el precio del tipo de
cita (valor de agenda) sino por lo FACTURADO, y para eso la factura tiene que
llevar aparejado el tipo que cobró — «aunque sea internamente».

- **Opcional e interno**: sin pantalla por ahora. Lo aceptan `POST
  /api/billing/invoices` y `PATCH /api/billing/invoices/[id]` (`eventTypeId`,
  validado contra los tipos del tenant; `null` desenlaza). Hoy lo ponen los
  seeds de las demos.
- La **rectificativa lo hereda** del original (`[id]/rectify`): nace con base
  negativa y estado activo, así que arrastrar el tipo es lo que hace que la
  gráfica RESTE lo anulado.
- Una factura sin tipo simplemente **no cuenta** en esa gráfica: enseña lo
  atribuible por servicio, el total ya lo dice la cifra de Facturado.
- Las facturas anteriores quedan a NULL a propósito (nadie sabe hoy qué cita
  cobró una factura vieja).

Motivo y contexto: `docs/decisions/2026-08-29-el-dinero-se-sabe-por-facturas.md`.

## Facturación del mes (31/08/2026)

La «Facturación múltiple» de Organízate, que era lo único de su facturación que
el CRM no cubría (petición de Aumenta, ~175 cuotas al mes; propuesta aprobada
por Jorge el 31/08/2026): **elegir un mes y emitir de una pasada las facturas
de cuota a partir de los cobros ya registrados**. Botón «Facturar el mes» en
`/facturacion/cobros` (asistente en `_components/FacturarMesDrawer.jsx`),
endpoint `GET`/`POST /api/billing/invoices/bulk-issue`, lógica pura en
`lib/billing/lotesCuotas.js` (prueba: `_smoke-facturacion-del-mes.mjs`).

- **Qué entra en el lote**: cobros `completed` con `period_month` del mes y
  `invoice_id IS NULL`. Enganchar el cobro NO toca ni `period_month` ni su
  estado: la morosidad y el bloqueo del portal siguen leyendo exactamente lo
  mismo. Relanzar el mes no duplica (los enganchados desaparecen del lote).
- **Una factura por pagador** (`payments.client_id`): el reparto de cuota entre
  dos pagadores ya viene resuelto, cada uno factura lo que pagó. Una **línea
  por cobro** («Cuota septiembre 2026», con la nota del cobro detrás).
- **Nace cobrada**: en una transacción por familia se asigna el número
  (`assignInvoiceNumber`, serie F), se congela la foto fiscal (`fotoFiscalDe`),
  se enganchan los cobros y la factura se crea `paid` con
  `paidAmount = total`. Si los cobros cambiaron entre la vista previa y la
  emisión, ESA factura se deshace y las demás siguen. El lote va EN SERIE (el
  FOR UPDATE de la serie lo obliga); todas con la MISMA fecha de emisión (hoy
  por defecto), validada contra la serie ANTES de empezar.
- **El total cuadra con lo cobrado al céntimo**: con exención/IVA 0 (Aumenta,
  sanitaria) es directo; con IVA por defecto del tenant la base se busca hacia
  atrás desde el total y el céntimo que el redondeo no deja cuadrar va en una
  línea «Ajuste de redondeo» a IVA 0. **IRPF del lote a 0** a propósito: una
  cuota de familia no retiene, y con retención el total ya no sería lo cobrado.
- **Sin NIF se salta y se lista** (en Aumenta ~100 familias): la vista previa
  los aparta con enlace a la ficha, no revientan el lote. Quien ya tiene una
  factura activa ese mes entra **DESMARCADO** («ya facturado este mes ·
  desmarcado», 01/09/2026, petición de Aumenta: «si se ha hecho alguna factura
  manual, que cuente como emitida y no te dé la opción de hacerla múltiple, para
  no duplicar»). Desmarcado y no escondido a propósito: la factura manual de ese
  mes puede ser de otra cosa (un taller, un informe) y entonces su cuota SÍ hay
  que emitirla; esconderlo dejaría a esa familia sin factura y sin que nadie se
  entere. Así el duplicado exige un clic deliberado.
- **Elegir qué facturar por forma de pago** (01/09/2026): chips
  Banco / Domiciliación / Tarjeta / Efectivo que filtran los cobros del lote
  (`metodo=` repetible en el GET, `metodos: []` en el POST). Sin elegir ninguna
  entran todas, que es lo de siempre. Y «Marcar todas / Desmarcar todas» encima
  de la lista, para no ir una a una en un lote de 175.
- **Preflight del emisor**: sin `fiscalName`/`taxId` en
  `TenantBillingSettings` el POST rechaza con 422 accionable (en Aumenta
  estaban vacíos el 31/08/2026 — rellenarlos antes del primer lote, y cerrar
  con su gestoría la exención de IVA de las cuotas).
- `customFields.loteCuotas = mes` marca las facturas del lote;
  `patientId`/`eventTypeId` van a NULL (la cuota puede cubrir varios hijos y no
  hay tipo de cita «cuota»). Auditoría: `invoice.issued` por factura con
  `lote` en el resumen.
- **El caso inverso también quedó cubierto**: un cobro suelto se asocia a una
  factura ya emitida desde el drawer de edición de Cobros
  (`PATCH /payments/[id]` con `invoiceId`; mismas garantías que el POST, y
  `resumenImporte` ahora incluye `facturaId` para que el rastro no salga con
  before y after idénticos).

## «Cobrar mes» desde la cita (03/09/2026)

Petición de Aumenta por Rodrigo: «un botón en el modal de las citas, solo
visible para quien tenga el módulo de Facturación, que sea COBRAR MES, y en
cuanto se cobre a esa persona no vuelva a salir hasta la primera cita del
siguiente mes; ya sea porque se ha cobrado desde la cita —que llevará a Cobros
y autorrellenará el Registrar cobro— o a mano desde Cobros». Y el matiz: «lo
cobrado no depende de lo facturado, y que salga por defecto el mes».

- **Dónde**: la ficha de la cita (`CitaDetalleModal`), junto a «Ver ficha», y
  el «Cobrar» del menú contextual de la agenda. Regla pura en
  `lib/citas/cobrarMes.js` (prueba: `_smoke-cobrar-mes.mjs`).
- **Quién lo ve**: quien tenga `billing` en `enabledModules` de `/api/auth/me`
  (módulo del centro cruzado con el acceso de la persona; en Aumenta, Olga y
  Rosa además de dirección). Sin módulo, ni botón ni entrada activa en el menú.
- **A dónde lleva**: `/facturacion/cobros?abrir=cuota&cliente=<id>&paciente=<id>&mes=AAAA-MM`.
  Cobros abre el drawer «Registrar cobro» en modo cuota con familia, paciente y
  **el mes de la cita** puestos; la cuota de la familia se rellena sola como
  siempre (`cuotaParaRellenar.js`). Sin `mes` en la URL se queda el vigente.
- **Cuándo se apaga**: `GET /api/billing/payments/mes?clientId&mes` devuelve
  los cobros **completados** de la familia con `periodMonth` de ese mes. Con
  alguno, el botón no sale; da igual si nació de la cita o se apuntó a mano.
  Un cobro de UN hijo no lo apaga en las citas del hermano; uno de toda la
  familia (`patientId` NULL), sí. **Nunca mira facturas**: Aumenta cobra
  primero y factura al cierre («Facturar el mes»), la factura llega semanas
  después del dinero.
- **Cuándo vuelve**: con la primera cita del mes siguiente, porque pregunta
  por OTRO mes. No hay estado guardado ni tarea nocturna.

## Cuotas mensuales asignadas (01/09/2026)

Petición de Aumenta: «cómo crear cuotas para grupos de pacientes y programarlas
mensualmente» y «poder dar de baja, modificar, eliminar una cuota».

**Qué había antes.** `BillingConcept` (31/08/2026) es el CATÁLOGO: el precio de
la casa («Logopedia 60x2 · 190 €»). Y `clients.cuota_concept_ids` es la cuota
APRENDIDA: los conceptos del último cobro, que rellenan el drawer. Ninguna de
las dos sabe decir *quién debe pagar este mes*: no tienen fecha de alta, ni
baja, ni paciente, ni método. Con ~175 cuotas al mes, eso es teclear 175 cobros
cada 30 días.

**Qué es una `Cuota`** (`billing_cuotas`): la ASIGNACIÓN. Pagador (`client_id`,
NOT NULL: sin pagador no se cobra ni se factura), paciente opcional, los
conceptos que la componen, importe, método, día de cobro, alta y baja.

- **El importe puede ser NULL, y eso SIGNIFICA algo**: «lo que digan sus
  conceptos». Así una subida de precio se aplica cambiando UN concepto y no 300
  filas. Con un número escrito manda ese número: es el precio pactado con esa
  familia y no se mueve aunque suba la tarifa.
- **Alta EN GRUPO**: el POST acepta `destinatarios: [{clientId, patientId}]` y
  crea una cuota por cada uno con los mismos datos. Quien ya tiene cuota activa
  para ese mismo paciente se salta con su motivo (`permitirDuplicadas: true` lo
  fuerza): un lote de 40 familias no puede convertirse en 40 cuotas repetidas
  por un doble clic.
- **Baja ≠ borrado.** `PATCH { endDate, active:false }` apaga la cuota desde una
  fecha y CONSERVA la fila (los cobros que salieron de ella siguen explicando
  por qué se cobró lo que se cobró). `DELETE` es para el alta equivocada de hace
  cinco minutos: con cobros detrás se niega con 409 y manda dar de baja. La
  ruta cierra el círculo de los dos campos: poner fecha de baja apaga la cuota,
  y reactivarla sin quitar la fecha la borra —una fila que dice dos cosas a la
  vez no la lee nadie—.
- **Apagada SIN fecha de baja = en pausa** (no genera ningún mes). Apagada CON
  fecha de baja SÍ genera hasta esa fecha, prorrateado. Es la distinción que
  fija el smoke.

**La generación mensual** (`GET/POST /api/billing/cuotas/generar`): un cobro por
cuota vigente, con el mes de alta y el de baja PRORRATEADOS por días y la cuenta
escrita en la nota («Cuota septiembre 2026 — Logopedia 60x2 — desde el
16/09/2026 (15/30 días)»), que es lo que evita la llamada de la familia
preguntando por el importe raro.

- **EL COBRO NACE PENDIENTE.** Generar no es cobrar: el dinero todavía no ha
  entrado. Morosidad, el bloqueo del portal y «Facturar el mes» miran
  `status = 'completed'`, así que un mes generado y sin cobrar sigue contando
  como impagado — que es la verdad. Se pasa a cobrado desde Cobros.
- **Relanzar el mes NO duplica**: cada cobro guarda su `cuota_id` y la cuota que
  ya tiene cobro de ese mes sale en «repetidas». El candado real está DENTRO de
  la transacción (`findOne` con `LOCK.UPDATE` antes del `create`), porque entre
  la vista previa y el bucle cabe otra pestaña haciendo lo mismo.
- **Filtro por método** (`metodo=` repetible): «solo las de banco». Se aplica
  después de la vigencia, así que el tramo y el importe son los mismos que en el
  lote entero.
- Una cuota que falla NO tumba el lote: se salta y se cuenta, como en
  «Facturar el mes». Fuera de producción el motivo lleva el mensaje real.
- El catálogo puede no existir (`billing_concepts` es del 31/08/2026): un 42P01
  degrada a catálogo vacío en vez de tumbar la pantalla.

**La cuota del CATÁLOGO se crea desde la propia pantalla de Cuotas**
(01/09/2026, Rodrigo: «crear nueva cuota no crea realmente una nueva cuota,
porque no hay una opción de añadir cuota en la lista de cuotas»). Aquí conviven
DOS cosas que el centro llama igual: el catálogo (`BillingConcept`, la tarifa) y
la asignación (`billing_cuotas`, quién la paga). «+ Nueva cuota» siempre creó la
segunda; la primera solo se daba de alta en Configuración y desde aquí había un
enlace de texto, así que la pantalla parecía no crear nada. Ahora se crea en el
sitio —«+ Crear cuota nueva» junto al filtro y «+ Crear una nueva» dentro del
drawer— por la MISMA puerta `POST /api/billing/conceptos`: no es una copia del
catálogo, es el catálogo, y lo creado sale también en Configuración, en las
facturas y en los talleres. Nace con el IVA del emisor (`ivaPorDefecto`) y
`periodicity: "mensual"`, y queda marcada en el alta. **Cuando un cliente dice
«cuota» a secas, preguntar cuál de las dos**: el parte de fallo nació de ahí.

**«Durante N meses»** (01/09/2026): botones 3/6/9/12 que escriben `endDate`.
`bajaTrasMeses(startDate, meses)` y su inverso `mesesDeTramo` viven en
`lib/billing/cuotas.js` con su smoke. **El mes del alta cuenta como el
primero**: tres meses desde el 15/09 es baja el 30/11, no el 15/12 — así lo dice
el centro («de septiembre a noviembre») y así encaja con el tramo: el mes del
alta prorrateado, los de en medio enteros y el de la baja entero por caer en su
último día. Meter a un paciente unos meses y darlo de baja YA funcionaba
(`endDate` + `tramoDelMes` + el cuadro de Bajas con «Reintegrar»); lo que
faltaba era no contar los meses a mano. La columna «Vigencia» dice cuántos son.

**Los nombres largos ya no se cortan en los desplegables** (01/09/2026): el
panel de `components/ui/Select.jsx` medía exactamente lo que el botón (`left-0
right-0`) y encima truncaba cada opción, así que el filtro de 288 px de esta
pantalla dejaba «Logopedia 60 min x2 se…». Ahora crece con el contenido hasta
30rem, se ancla al lado que cabe midiendo el hueco al abrir —si no, uno pegado
al borde derecho se saldría— y el texto baja de línea en vez de cortarse. **Lo
usa medio CRM**: cualquier desplegable del sistema cambia con esto. En
Configuración → Conceptos y cuotas, además, la fila de alta pasa a dos filas de
cuatro columnas: con siete campos en un renglón los rótulos se quedaban en «Im»
y «me».

## Entradas y salidas de caja (01/09/2026)

Petición de Aumenta: «se necesita poder hacer entradas y salidas de caja (donde
figure fecha, importe, concepto, observaciones)» y «poder ver un resumen por día
de los cobros efectuados en efectivo, tarjeta y banco».

**El arqueo estaba incompleto.** Lo esperado en el cajón era «fondo inicial +
cobros en efectivo del día». Por el cajón pasa mucho más: se paga la mensajería,
se compra material, se saca el sobre para el banco, se mete cambio. Nada de eso
es un cobro, así que el arqueo descuadraba y el descuadre acababa explicado en
la casilla de «motivo» — texto libre que dentro de seis meses no dice nada.

- `CashMovement` (`cash_movements`): caja, fecha, dirección, importe, concepto,
  observaciones y quién lo apuntó. **`amount` siempre positivo**: el signo lo
  pone `direction`, y un −20 tecleado en una salida se guarda como 20 (guardar
  −20 lo restaría dos veces).
- **Lo esperado pasa a ser fondo + cobros en efectivo + entradas − salidas**, y
  el «Comprobar» del cierre enseña la línea de movimientos: un esperado que sale
  de una cuenta que la persona no puede seguir no sirve para cuadrar nada.
- **Un apunte de un día YA CERRADO no se toca** (409): el cierre guardó la foto
  de lo que se contó y de lo que se esperaba. Se corrige con un apunte nuevo,
  como la contabilidad de toda la vida.
- **El día es el de MADRID**, no el del servidor (que en producción va en UTC).
  `calcularEsperado` usaba `new Date(fecha+'T00:00:00')`, hora local del
  contenedor: un cobro de las 00:30 caía en el día anterior y el arqueo no
  cuadraba con lo que la persona acababa de contar. Ahora usa `madridDayRange`,
  que además acierta en los cambios de hora.
- **Resumen por día** (`GET /api/arqueo/resumen`): una fila por día con
  efectivo / tarjeta / banco, las entradas y salidas y lo que debería quedar en
  el cajón, con TODOS los días del rango presentes (un día sin caja es un dato,
  no una fila que falta). La domiciliación cuenta como banco: para quien mira el
  día, un recibo domiciliado y una transferencia son «lo que entró por banco».
  Un cobro PENDIENTE no suma —se enseña aparte—, y un método que no cae en
  ninguna cesta se declara en `metodosSinCesta` en vez de perderse.

Las tres cosas viven en la misma pantalla (`/facturacion/arqueo`) con pestañas
—Cierres · Entradas y salidas · Resumen por día—: se miran seguidas, cuadrando
el día.

## La lista de facturas: fecha, paciente y descarga de una (01/09/2026)

Petición de Aumenta: «una vez hechas las facturas se deben poder descargar una a
una, de un paciente concreto y de una fecha concreta; en el listado tiene que
aparecer la fecha individual de cada una».

- La **fecha de cada factura** ya salía en su columna (y en la tarjeta del
  móvil); lo que faltaba era **acotar el periodo**: filtros Desde/Hasta que
  viajan como `from`/`to` al GET, que ya los aceptaba.
- **Descargar UNA** sin abrir la factura: icono de descarga por fila
  (`/api/billing/invoices/[id]/pdf`), con `stopPropagation` para que el clic no
  abra el cajón. El ZIP de todas (`bulk-pdf`) sigue donde estaba.
- **Agrupar por paciente**: cabecera de grupo en la tabla. Agrupar es ORDENAR
  por paciente (`sortBy=patient.lastName`, clave nueva en el whitelist del GET y
  **condicionada al módulo**, que sin tabla de pacientes Sequelize pediría un
  alias que no existe). Agrupar solo lo que cabe en la página sería mentira: con
  el orden puesto, los grupos siguen enteros aunque la lista pase de página.
- La casilla se le pregunta al MÓDULO (`/api/pacientes?limit=1`), no a las 20
  filas cargadas: mirando la página, en Aumenta aparecía y desaparecía según
  dónde estuvieras (sus primeras facturas son de antes del enlace con el
  paciente).

## Los conceptos de la cuota rellenan la factura (01/09/2026)

Petición de Aumenta: «en las facturas tienen que salir los conceptos
predeterminados que tiene cada paciente y que van asociados a su cuota».

Al elegir el cliente en una factura NUEVA, las líneas se rellenan solas: manda
la cuota ASIGNADA (`billing_cuotas`) y, si esa familia no tiene, la APRENDIDA de
la ficha (`clients.cuota_concept_ids`).

**Cuántas cuotas entran** (corregido el 01/09/2026): con paciente elegido, las
DE ESE paciente —dos hermanos pagan cosas distintas y la factura es de uno—; sin
paciente, **TODAS las de la familia**, porque la factura es de la familia y la
familia paga las dos. Esto era `cuotas[0]`: una familia con dos hijos facturaba
solo al primero, en silencio. Y no basta con mirar el paciente, porque una cuota
puede no tener paciente asignado (las 260 de Aumenta vienen así del volcado de
Organízate): si ninguna casa con el elegido, entran todas las de la familia, que
es lo único que de verdad se sabe.

**Cuándo se pisan las líneas** (corregido el 01/09/2026): cuando están EN BLANCO
(una sola, sin texto y a cero) **o cuando son exactamente las que puso esta misma
cuota y nadie las ha tocado**. Lo escrito a mano no se pisa nunca; para eso está
el botón «Poner su cuota (n)». La segunda mitad es la que arregla cambiar de
familia: antes, las líneas puestas para la familia anterior ya no estaban «en
blanco», así que se quedaban tal cual y la nueva factura salía con los conceptos
de otra. La comparación es una HUELLA de lo que el usuario edita (texto, precio,
cantidad, descuento e IVA) y no el objeto entero, que cambia por dentro sin que
nadie escriba nada.

El párrafo bajo las líneas dice de dónde han salido —«de las 2 cuotas de esta
familia: están todas», «de la cuota del paciente elegido», «del último cobro»—,
porque callarlo es lo que hacía dudar de si salían todas.

La decisión entera vive en `lib/billing/cuotaParaRellenar.js` (`cuotasQueEntran`,
`conceptosDeCuotas`, `importePactado`, `huellaLineas`, `sePuedeRellenar`), la
comparten Facturas y Cobros, y la fija `scripts/_smoke-cuota-para-rellenar.mjs`
(20 comprobaciones, en `npm test`).

**Y Cobros pregunta por el paciente** (01/09/2026, Rodrigo: «cuando un tutor
tiene dos pacientes y cada uno está en una cuota distinta, al poner a uno me
salen las dos»). El drawer «Nuevo cobro» en modo cuota tenía selector de FAMILIA
y nada más, así que sumaba las dos cuotas y cobraba el doble. Ahora, con la
familia elegida, baja sus pacientes (`GET /api/pacientes?clientId=…`) y enseña
un desplegable «¿De qué paciente?» con «Toda la familia» de primera opción: el
mismo `cuotasQueEntran` decide, el cobro guarda `payments.patient_id` —que
existía desde el 31/08 y solo lo rellenaba la generación mensual— y el párrafo
de debajo avisa de que las cuotas de sus hermanos han quedado fuera. Sin módulo
asistencial la lista vuelve vacía y el cobro es de la familia, como siempre.

## Numeración correlativa

Implementado en `lib/billing/generateInvoiceNumber.js`
(`assignInvoiceNumber`).

- El número solo se asigna al **emitir** (draft → issued). El borrador no
  consume número.
- Se ejecuta dentro de una transacción explícita con `SELECT ... FOR UPDATE`
  sobre la fila de `InvoiceSeries`. La fila queda bloqueada hasta el commit,
  garantizando unicidad.
- Si la fecha de emisión cae en un año distinto al de la serie, se calcula
  el siguiente `nextNumber` consultando el `MAX` real para ese prefijo+año en
  `invoices`. Evita colisiones con datos históricos importados.
- Formato: `${prefix}-${year}-${NNNN}` (4 dígitos con padding). Ejemplo:
  `F-2026-0042`.
- Hay dos series por tenant garantizadas por la migración: `F` (`normal`) y
  `R` (`rectificative`). El endpoint de `POST /series` permite crear más
  desde admin, pero la UI de configuración solo lista las existentes.

La correlatividad sin huecos es **obligación fiscal**. Por eso:

- No se permite borrar facturas emitidas (solo borradores).
- `PATCH /series/[id]` no acepta cambios en `nextNumber`.
- Para anular una factura emitida con cobros se rectifica, no se cancela.

## IVA por línea

`calculateInvoice` procesa cada línea con su propio `vatRate`. Los tipos
disponibles para los desplegables vienen de `TenantBillingSettings.availableVatRates`
(default `[21, 10, 4, 0]`, editable en `/facturacion/configuracion`).

El breakdown agregado por tipo (`vatBreakdown` en la respuesta de
`calculateInvoice`) se usa para pintar "IVA 21%: 378,00 €" / "IVA 4%: 18,00 €"
en el drawer de la factura y en el formulario de creación.

Redondeo: cada línea se redondea a 2 decimales **antes de sumar**, evitando
drift entre la suma de líneas y los totales agregados.

## Libro IVA y Modelo 303

`lib/billing/buildIvaReport.js` agrega los datos. El endpoint
`/api/billing/analytics/iva` devuelve la estructura JSON; el endpoint
`/api/billing/analytics/iva/export` devuelve un Excel con tres hojas (IVA
Repercutido, IVA Soportado, Modelo 303) generado con `exceljs`.

Composición:

- **IVA repercutido** (ventas): se calcula desde `Invoice.lines` (no desde
  `vatAmount`) agrupando por `vatRate`. Solo facturas con
  `status NOT IN (draft, cancelled, rectified)` y `issueDate` en el periodo.
- **IVA soportado deducible** (compras): `Cost.taxAmount` solo cuando
  `vatDeductible = true` y `taxAmount > 0`. Filtrado por `incurredAt`.
- **Modelo 303** (estimativo):
  ```
  outputVat              = SUM(IVA repercutido)
  deductibleInputVat     = SUM(IVA soportado deducible)
  difference             = outputVat - deductibleInputVat
  ```
  - `difference > 0` → "A pagar a Hacienda".
  - `difference < 0` → "A devolver / compensar".

> **Aviso obligatorio**: el Modelo 303 que devuelve este módulo es
> **estimativo / orientativo**. No es la declaración real ante la AEAT. La
> UI de `/facturacion/analitica/iva` muestra el aviso en una banda ámbar.

**Backfill conservador**: la migración `migrate-billing-rework.js` rellenó
los costes históricos previos al rework con `vat_rate = 0`,
`vat_deductible = false` y `tax_base = amount`. Esto significa que el
Libro IVA es fiable solo para los costes posteriores a la migración, o para
los que se hayan editado a mano. Para los más antiguos no se infiere IVA que
no estaba registrado.

## Filtrado de campos sensibles

El filtrado se hace **siempre en backend antes de serializar** la respuesta,
nunca confiando en que el frontend respete el rol.

- `TeamMember.monthlySalary` y `TeamMember.hourlyCost`: solo
  admin/superadmin (controlado en los endpoints de `/api/team`, fuera de
  este módulo, pero mencionado aquí porque alimenta los KPIs).
- `/api/team/[id]/billing-summary`: si el viewer no es admin, se borran
  `data.employee.monthlySalary` y `data.projectedSalaryCost` antes de
  devolver.
- `/api/billing/analytics/employees`: `monthlySalary` y `projectedSalaryCost`
  solo se incluyen en el JSON cuando el rol es admin/superadmin. La whitelist
  de `sortBy` también excluye estos campos para no-admins.

## Validaciones críticas

- **Emisión bloqueada (HTTP 422)** si el cliente carece de
  `fiscalName`/`name` o `taxId`. Mensaje explícito indicando qué falta y
  enlace a la ficha del cliente desde la UI.
- **Borrado de cliente bloqueado (HTTP 409)** si tiene al menos una
  factura. Implementado en `app/api/clients/[id]/route.js` (DELETE). El
  mensaje sugiere marcar el cliente como inactivo.
- **PATCH de factura solo en `draft`** (HTTP 409 en otros estados). Permitido
  cambiar: `clientId`, `employeeId`, `issueDate`, `dueDate`, `lines`,
  `notes`, `customFields`, `series`. Si llegan `lines`, se recalculan
  `taxBase`, `vatAmount`, `total`.
- **POST de cobro** rechaza facturas en `draft`/`cancelled`/`rectified`
  (HTTP 409) y rechaza importes que excedan el pendiente (HTTP 400, con
  margen de redondeo de 0.0049).
- **Cancelación con cobros** prohibida (HTTP 409). Hay que reembolsar
  primero o rectificar.
- **Rectificativa**: líneas con `quantity` invertida (negativa). La suma neta
  de la factura R cancela aritméticamente la original. La original queda
  `rectified` y la R en `issued`.

## Integraciones con otros módulos

### Clientes (#1)

- Nuevos campos fiscales en `Client`: `fiscalName`, `fiscalAddress`,
  `fiscalCity`, `fiscalZip`, `fiscalCountry` (default `ES`).
- Endpoint cross-module: `GET /api/clients/[id]/billing-summary?from=&to=`
  (sin `from`/`to` → histórico completo).
- Sección embebida `components/billing/ClientBillingSection.jsx` en la ficha
  de cliente: stats (Facturado, Cobrado, Pendiente, Margen) + listado de las
  10 últimas facturas del cliente. Si el módulo billing no está activo, el
  endpoint devuelve `403` y la sección no se renderiza (silenciosa).
- En el alta/edición de factura, si el cliente seleccionado no tiene
  `fiscalName` o `taxId`, aparece una banda ámbar con enlace a la ficha del
  cliente. Permite guardar como borrador, pero no emitir.

### Equipo (#6)

- `Invoice.employeeId` y `Cost.employeeId` (FK a `TeamMember`).
- `TeamMember.monthlySalary` (informativo, solo admin).
- Endpoint cross-module:
  `GET /api/team/[id]/billing-summary?from=&to=`. Devuelve facturado,
  ticket medio, coste salarial registrado, y `projectedSalaryCost` (solo
  admin).
- Sección embebida `components/billing/EmployeeBillingSection.jsx` en el
  drawer de la página de Equipo. Selector trimestre/año.

### Inventario (#10)

- **Pedidos descuenta; Facturación NO.** Al emitir una factura,
  `POST /invoices/[id]/issue` llama a
  `lib/inventory/applyStockMovementsForInvoice.js`, que desde el 02/08/2026
  **solo avisa**: si la factura lleva líneas con `productId` (y no son
  `kind = "shipping"`) y NO viene de un pedido (`customFields.sourceOrderId`
  vacío), devuelve un aviso de que el stock no se ha descontado. No bloquea la
  emisión; la respuesta del `issue` lo trae en `inventoryWarnings`. El
  descuento real lo hace `POST /api/orders/[id]/complete`, que además crea
  esta factura en borrador — descontar otra vez al emitirla restaría el doble.
  Detalle en `docs/modules/inventory.md`.
  **Histórico (hasta 02/08/2026):** las líneas llevaban `outboundProductId` y
  emitir disparaba un descuento FIFO sobre `InboundBatch` resolviendo la
  `Formula` del producto; esos tres modelos ya no existen.
- El editor de facturas carga el catálogo de `/api/inventory/products` para
  rellenar `line.productId` (si el tenant no tiene `inventory`, 403 y sin
  desplegable).
- `Supplier` es compartido (gasto ↔ entrada de mercancía) y
  `StockEntry.costId` apunta al gasto que pagó la entrada.
- `Cost.inventoryProductId` queda como columna histórica sin asociación
  Sequelize. Pendiente decidir si se elimina.

## Endpoints

Todos bajo `/api/billing/` salvo los marcados como cross-module. Todos
pasan por `withTenant` y validan `hasModule("billing")`.

### Invoices

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /invoices` | Listado paginado con filtros (`status`, `clientId`, `employeeId`, `series`, `from`, `to`, `q`) y orden whitelisted. | — |
| `POST /invoices` | Crea borrador (sin número, sin emitir). Aplica `defaultVatRate` a líneas sin `vatRate`. | — |
| `GET /invoices/[id]` | Detalle con `payments`, `client`, `employee`, `rectifies`, `rectifiedBy`. | — |
| `PATCH /invoices/[id]` | Edita un borrador. Recalcula totales si cambian las líneas. | Solo admin/superadmin. |
| `DELETE /invoices/[id]` | Borra borrador (`409` si no es draft). | Solo admin/superadmin. |
| `POST /invoices/[id]/issue` | draft → issued con número correlativo en transacción. Aplica `dueDate` por defecto si el borrador no lo tenía. | Solo admin/superadmin. |
| `POST /invoices/[id]/send` | issued → sent **y envía el PDF por correo** (Resend del tenant; best-effort: la factura queda `sent` aunque el correo falle, y la respuesta trae `emailEnviado`/`emailError`). `?via=whatsapp\|other` solo anota el canal. `422` si el estado no es `issued`. No envía desde la demo (`isDemoTenant`). | Solo admin/superadmin. |
| `POST /invoices/[id]/cancel` | issued/sent → cancelled (`409` si tiene cobros). | Solo admin/superadmin. |
| `POST /invoices/[id]/rectify` | Crea factura R- (anulación total o por diferencias con `correctBase`), marca la original como `rectified` solo en la anulación total. | Solo admin/superadmin. |
| `GET /invoices/[id]/pdf` | Descarga el PDF (`lib/billing/invoicePdf.js`, pdfkit) de una factura emitida. `409` si es borrador. | — |
| `POST /invoices/bulk-pdf?from=&to=` | ZIP en streaming con los PDF de todas las emitidas del rango. `404` si no hay ninguna. Lo usa el botón «Descargar facturas» de `components/billing/ExportButtons.jsx`. | — |
| `GET /invoices/bulk-issue?mes=AAAA-MM` | Vista previa de la Facturación del mes: el lote agrupado por pagador, los sin NIF apartados, el estado del emisor y la fecha mínima de la serie. | `422` si el mes no es `AAAA-MM`. |
| `POST /invoices/bulk-issue` | Emite el lote (`{ mes, issueDate?, exclude? }`): una factura por pagador, cobros enganchados en la misma transacción, nace `paid`. Ver «Facturación del mes». | `422` sin emisor fiscal o con fecha fuera de orden. |

Las acciones `issue`, `send`, `cancel`, `rectify` registran en
`master.AuditLog` con la acción correspondiente.

### Quotes (presupuestos)

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /quotes` | Listado paginado con filtros (`status`, `clientId`, `projectId`, `q`) y orden whitelisted. | — |
| `POST /quotes` | Crea presupuesto y le asigna número `P-YYYY-NNNN` al crear. | — |
| `GET /quotes/[id]` · `PATCH` · `DELETE` | Detalle · edición (líneas, fechas, estado manual `draft/sent/viewed/rejected/expired`) · borrado. `409` si ya está `converted`. | — |
| `POST /quotes/[id]/accept` | Marca `accepted` y sella `acceptedAt`. `409` si ya está convertido. | — |
| `POST /quotes/[id]/convert` | Crea una **factura borrador** con cliente, proyecto, empleado y líneas del presupuesto; deja `convertedInvoiceId` y `customFields.sourceQuote*` en la factura. `409` si ya se convirtió. | — |

### Morosidad, Panel y socios

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /morosidad?mes=AAAA-MM` | Quién no ha pagado el mes: familias con al menos un paciente activo SIN cobro `completed` con ese `periodMonth`, y cuántos meses seguidos llevan. Mismo criterio que el bloqueo del portal. Lo pinta `/facturacion/cobros`. | `422` si el mes no es `AAAA-MM`. |
| `GET /operations?from=&to=` | Datos del Panel operativo: embudo presupuestos → aceptados → facturado → cobrado y lista de «acción requerida» (vencidas, presupuestos que caducan, aceptados sin facturar). Facturado/Cobrado se acotan al periodo; el pipeline es foto de hoy. **Desde el 03/09/2026 Cobrado son los COBROS completados por `paidAt` en el periodo, con o sin factura** (`cobrado.amount`, `cobrado.count`); antes era el `paid_amount` de las facturas emitidas en el periodo y en Aumenta daba 0 € en el mes vivo con ~10.000 € cobrados (cobran primero, facturan al cierre). | — |
| `GET /analytics/partners?from=&to=` | Reparto por socio (`TenantBillingSettings.partners`): facturado, IVA repercutido, IRPF retenido, gastos deducibles y neto, más el conjunto. | — |

### Exports (Excel)

Siete `GET` que devuelven un `.xlsx` (`lib/billing/exportXlsx.js`, exceljs)
con los mismos filtros que su pantalla; los pinta `ExportButtons.jsx`:

| Ruta | Qué exporta |
| --- | --- |
| `/exports/by-client?from=&to=` | La tabla de «Por cliente». |
| `/exports/by-employee?from=&to=` | La de «Por empleado» (`projectedSalaryCost` solo admin). |
| `/exports/by-partner?from=&to=` | La de «Por socio». |
| `/exports/expenses` | Gastos con los filtros de la pantalla (`type`, `category`, `employeeId`, `partnerId`, `clientId`, `supplierId`, `from`, `to`). Columnas: fecha, tipo, categoría, descripción, empleado, proveedor, base, IVA y total. |
| `/exports/payments` | Cobros (`from`, `to`, `status`, `method`, `invoiceId`). |
| `/exports/quotes` | Presupuestos (`status`, `clientId`, `q`). |
| `/exports/recurring` | Recurrentes (`active`, `clientId`). |

Las respuestas de estos endpoints (incluido el GET) reescriben el `status`
con `effectiveStatus` (ver "Estados y transiciones": cálculo dinámico de
`overdue`). El campo persistido en BD no cambia salvo en transiciones
explícitas.

### Costs

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /costs` | Listado con filtros (`type`, `category`, `employeeId`, `partnerId`, `clientId`, `supplierId`, `from`, `to`) y orden whitelisted (incluye `supplier.name`). Devuelve `employee`, `client` y `supplier`. | — |
| `POST /costs` | Crea coste; recalcula `taxAmount`/`total` desde `taxBase × vatRate` (`lib/billing/totalesGasto.js`, la misma función que el PATCH). Si no se indica `employeeId`, usa el `TeamMember` cuyo `userId` coincide con el del solicitante. Campos aceptados en `lib/billing/camposGasto.js`; `supplierId` opcional y comprobado contra `Supplier` del tenant (404 si no existe). | — |
| `GET /costs/[id]` | Detalle con `employee`, `client` y `supplier`. | — |
| `PATCH /costs/[id]` | Edita (mismos campos aceptados que el POST, con la misma comprobación del proveedor) y recalcula totales si cambian `taxBase`/`vatRate`. | Solo admin/superadmin. |
| `DELETE /costs/[id]` | Borra. | Solo admin/superadmin. |

### Payments

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /payments` | Listado paginado con filtros (`invoiceId`, `status`, `method`, `from`, `to`) y orden whitelisted. | — |
| `POST /payments` | Registra cobro y dispara `updateInvoiceStatus`. Rechaza si excede el pendiente. | Solo admin/superadmin. |
| `GET /payments/[id]` | Detalle con `invoice`. | — |
| `PATCH /payments/[id]` | Cambia `status`/`amount`/`method`/`paidAt`/`notes` y, desde el 31/08/2026, `invoiceId`: asocia un cobro suelto a una factura (viva, del mismo cliente, sin exceder el pendiente) o lo desasocia (`null`; rechaza si el cobro quedaría sin cliente). Recalcula las DOS facturas tocadas. `periodMonth` no se toca. | Solo admin/superadmin. |
| `DELETE /payments/[id]` | Borra y recalcula la factura. | Solo admin/superadmin. |

### Series

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /series` | Lista todas, ordenadas por `isDefault`/`code`. | — |
| `POST /series` | Crea serie nueva. Valida `code` (`^[A-Z0-9]{1,8}$`) y `year`. | Solo admin/superadmin. |
| `PATCH /series/[id]` | Cambia `name`, `prefix`, `isDefault`. **No permite editar `nextNumber`**. | Solo admin/superadmin. |
| `DELETE /series/[id]` | Borra serie. `409` si hay facturas usándola. | Solo admin/superadmin. |

### Settings

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /settings` | Devuelve la fila única (la crea vacía si no existe). | — |
| `PUT /settings` | Actualiza datos fiscales, IVA, términos de pago, branding. Valida `availableVatRates` como array de números 0-100. | Solo admin/superadmin. |

### Recurring

Todos los endpoints validan `hasModule("billing")`. Las mutaciones requieren
admin/superadmin.

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /recurring` | Lista con filtros `active`, `clientId` y orden whitelisted. | — |
| `POST /recurring` | Crea recurrencia. | Solo admin/superadmin. |
| `GET /recurring/[id]` | Detalle. | — |
| `PATCH /recurring/[id]` | Activa/desactiva, cambia frecuencia/`nextRunAt`/template. | Solo admin/superadmin. |
| `POST /recurring/[id]` | Genera **un borrador** desde el template y avanza `nextRunAt`. | Solo admin/superadmin. |
| `DELETE /recurring/[id]` | Borra recurrencia. | Solo admin/superadmin. |

### Analytics

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /analytics?from=&to=` | KPIs del Resumen (ingresos, costes, márgenes, evolución mensual). | `from` y `to` obligatorios. |
| `GET /analytics/iva?from=&to=` | Libro IVA + estimación Modelo 303. | `from` y `to` obligatorios. |
| `GET /analytics/iva/export?from=&to=` | Excel con 3 hojas (xlsx). | — |
| `GET /analytics/clients?from=&to=&sortBy=&sortDir=` | Por cliente: facturado/cobrado/pendiente/margen sobre base imponible. | — |
| `GET /analytics/employees?from=&to=&sortBy=&sortDir=` | Por empleado: facturado, coste salarial, margen, cancelaciones. `monthlySalary` y `projectedSalaryCost` solo admin. | — |

### Cross-module summaries

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /api/clients/[id]/billing-summary?from=&to=` | Resumen del cliente (sin periodo → histórico). Usa `getClientBillingSummary`. | Requiere `hasModule("billing")`. |
| `GET /api/team/[id]/billing-summary?from=&to=` | Resumen del empleado. Filtrado por rol. Usa `getEmployeeBillingSummary`. | Requiere `hasModule("billing")`: el bloque es de Facturación, así que a quien solo tiene Equipo se le responde 403 y la ficha no lo pinta. |

### Proveedores y arqueo (fuera de `/api/billing`)

Viven en su propia raíz porque no son solo de Facturación (el proveedor se
comparte con Inventario) o porque llegaron después (arqueo, 02/08/2026), pero
la puerta es la misma.

| Método y ruta | Propósito | Restricciones |
| --- | --- | --- |
| `GET /api/proveedores` · `POST` | Lista (`search`; solo activos salvo `incluirInactivos=1`) · alta. `422` sin nombre, `409` si ya existe uno con ese nombre. | `billing` **o** `inventory`. |
| `GET /api/proveedores/[id]` · `PUT` · `DELETE` | Ficha con `totalGastado`/`numGastos` (solo si hay `billing`) · edición · baja: **desactiva** si tiene gastos o entradas, borra de verdad si no tiene nada. | `billing` **o** `inventory`. |
| `GET /api/arqueo/cajas` · `POST` | Puntos de cobro en efectivo (`CashPoint`). | `billing`. |
| `GET /api/arqueo/cierres` · `PATCH` · `POST` | Cierres (`CashClose`): lista (`desde`, `hasta`, `cajaId`, `soloDescuadres=1`) · **vista previa** del esperado (`PATCH`, antes de contar) · cierre: el servidor recalcula el esperado (fondo + cobros `cash` `completed` del día) y guarda la diferencia. | `billing`. |

### Rates (legacy)

`GET /POST /PATCH /DELETE /api/billing/rates[/...]` y `lib/billing/getApplicableRate.js`
quedan como sub-módulo legacy de tarifas por empleado del flujo terapéutico
antiguo. El rework billing usa precio explícito en cada línea de factura.
**No es un punto de extensión recomendado**. Aún así, todos los endpoints
validan `hasModule("billing")` y las mutaciones requieren admin/superadmin
(igualados con el resto del módulo).

## Páginas frontend

Todas bajo `app/(dashboard)/facturacion/` — **17 `page.jsx`**, con la barra de
pestañas de `layout.jsx` en tres bloques: **Operativa** (Panel, Presupuestos,
Facturas, Cobros, Recurrentes, Gastos, Proveedores, Arqueo), **Finanzas &
Rentabilidad** (Resumen, Por socio, Por cliente, Por empleado, Impuestos,
Cumplimiento) y **Config**. Componentes compartidos en `_components/`:
`PeriodPicker`, `StatusBadge`, `Kpi`, `tableSort`; y en `components/billing/`
el `ExportButtons.jsx` (Excel + ZIP de PDF) que llevan varias de ellas.

| Ruta | Qué muestra / permite |
| --- | --- |
| `/facturacion` | **Panel operativo** (`GET /operations`): embudo presupuestos → aceptados → facturado → cobrado, y la lista de «acción requerida» (vencidas, presupuestos que caducan, aceptados sin facturar). Las fechas solo mueven Facturado y Cobrado. **Abre en el MES** (03/09/2026, Rodrigo; `PeriodPicker periodoPorDefecto="month"`, el resto de pantallas de Facturación siguen en el año) y Cobrado es lo que ha entrado por Cobros, no lo cobrado de las facturas. |
| `/facturacion/presupuestos` (+ `/[id]`) | Listado de presupuestos con filtros y Excel; ficha con líneas, línea de tiempo (enviado / visto / aceptado / rechazado), «Aceptar» y «Convertir en factura». |
| `/facturacion/facturas` | Listado paginado, filtro por estado y búsqueda libre. Drawer con detalle, edición de borrador (con desplegable de producto del almacén si hay Inventario), acciones (Emitir, **Enviar** por email con el PDF, Cancelar, Eliminar, Rectificar) y descarga del PDF. |
| `/facturacion/cobros` | Listado de cobros con filtros (método, estado) y Excel. Drawer para registrar cobro nuevo (selector de facturas pendientes, calcula automáticamente el importe restante; también cobro sin factura con `periodMonth`). Incluye el bloque de **Morosidad** del mes (`GET /morosidad`). |
| `/facturacion/costes` | «Gastos»: listado con filtros (tipo, categoría, socio, fechas) y Excel; columna de proveedor, ordenable. Drawer de alta/edición con preview de IVA, socio y proveedor (desplegable de `/api/proveedores`, opcional; los proveedores se dan de alta en su pantalla, no aquí). Borrado inline. |
| `/facturacion/proveedores` | Alta, edición y baja de proveedores (`/api/proveedores`). Está aquí y no en Inventario porque es donde se usa: al registrar un gasto. |
| `/facturacion/arqueo` | Cajas y cierres de caja: vista previa del esperado, conteo, diferencia y notas; filtro «solo descuadres». |
| `/facturacion/recurrentes` | Listado con activar/pausar y Excel. **Banda ámbar prominente** avisando de que las facturas NO se emiten automáticamente. |
| `/facturacion/resumen` | **Resumen ejecutivo** (`GET /analytics`): KPIs (Facturado, Cobrado, Pendiente, Ticket medio), gráfico de barras mensual, desglose de costes y márgenes. Es la pantalla que antes estaba en `/facturacion`. |
| `/facturacion/analitica` | Índice con enlaces a Libro IVA, Por cliente y Por empleado (no está en la barra de pestañas; se llega por URL). |
| `/facturacion/analitica/socios` | «Por socio» (`GET /analytics/partners`): facturado, IVA, IRPF, gastos deducibles y neto por socio y en conjunto; Excel. |
| `/facturacion/analitica/iva` | «Impuestos»: Libro IVA + Modelo 303 con KPIs (A pagar / A devolver), tablas por tipo, listado de facturas, botón "Exportar Excel" y aviso de que el resultado es orientativo. |
| `/facturacion/analitica/clientes` | Tabla por cliente: facturado, cobrado, pendiente, costes imputados, margen; Excel. |
| `/facturacion/analitica/empleados` | Tabla por empleado: facturado, coste salarial, salario proyectado (solo admin), margen, cancelaciones; Excel. |
| `/facturacion/cumplimiento` | «Verifactu & Factura-e»: solo informativa. Serie a serie dice si está lista y para qué fecha obliga la ley (RD-ley 15/2025 · RD 238/2026). No emite nada; la serie `P` queda fuera por no ser fiscal. |
| `/facturacion/configuracion` | Datos fiscales del emisor, lista editable de tipos de IVA, IVA por defecto, términos de pago, branding, listado de series (solo lectura: el contador no se puede editar). El **régimen fiscal** (IRPF) y la **exención de IVA** se tocan en la Configuración general (engranaje del pie, `modules/config/ConfigModule.jsx`), que llama al mismo `PUT /api/billing/settings`. `partners` no tiene pantalla: se edita por API. |

Mobile: los drawers usan `top-14 lg:top-0 ... bottom-0` (CLAUDE.md regla 13)
para respetar la barra del menú móvil.

## Factura a nombre de un tutor de la familia (02/09/2026)

Decisión de Rodrigo: dentro de una misma ficha conviven los tutores, y al
facturar se puede pedir una factura para cada uno —o para una empresa o
fundación—, por importe o por porcentaje (una sola forma por reparto), tantas
como haga falta por el mismo paciente.

- **Dónde vive**: `invoices.guardian_id` (migración
  `migrate-invoices-a-nombre-de-tutor`, columna opcional). El pagador sigue
  siendo `client_id` (la familia): la factura cuelga de su ficha, sus cobros y
  su morosidad. `guardian_id` dice a QUIÉN se le emite: la entrada de
  `clients.guardians`.
- **A quién se le emite**: `lib/billing/datosFiscales.js` — `tutorDe`,
  `fotoFiscalDeTutor` (nombre y DNI del tutor con la dirección fiscal de la
  familia), `aNombreDe` (para las pantallas) y `faltaParaEmitirATutor` (sin
  DNI no se emite; el candado está en `/issue`; la pantalla lo enseña con el `faltaTutor` que le llega del servidor). Al emitir se
  congela la foto del tutor en `fiscal_snapshot`; un borrador imprime al tutor
  vivo; la rectificativa conserva `guardian_id`.
- **Cómo se pide**: en el reparto de una factura (`PatientReparto`), cada fila
  elige «La familia», uno de sus tutores o «Otra ficha»; `POST /api/billing/invoices`
  acepta `guardianId` y comprueba que sea un tutor de ESA ficha. Los tutores NO viajan a los listados: el listado y la ficha de la factura resuelven `aNombreDe` y `faltaTutor` en el servidor y quitan `client.guardians` de la respuesta (`ATRIBUTOS_CLIENTE_FACTURA` no los lleva; `ATRIBUTOS_PARA_CONGELAR` sí, para emitir). Prueba: `scripts/_smoke-factura-a-nombre-de-tutor.mjs`.

## Migración y backfill

Fichero: `scripts/migrate-billing-rework.js`. Estructura en dos fases:

- **Fase A — `ALTER TYPE` en autocommit**, fuera de transacción global:
  - `enum_invoices_status`: rename `partial` → `partially_paid`, ADD VALUE
    `issued`, `rectified`.
  - `enum_costs_category`: ADD VALUE `opex`.
  - `enum_payments_status`: ADD VALUE `refunded`.
  - Razón: en PostgreSQL anterior a 12, `ADD VALUE` no es transaccional.
- **Fase B — todo en una transacción global**:
  - `ADD COLUMN` para los nuevos campos en `invoices`, `costs`, `clients`,
    `team_members`.
  - `CREATE TABLE` `invoice_series` y `tenant_billing_settings`.
  - Backfills:
    - `costs.incurred_at = (month || '-15')::date` cuando `month` cumple
      `YYYY-MM`. Para filas sin month válido, usa `created_at::date`.
    - `costs`: `tax_base = amount`, `total = amount`, `vat_rate = 0`,
      `tax_amount = 0`, `vat_deductible = false` (conservador, no inventa
      IVA donde no estaba).
    - `costs.amount` y `costs.month`: `DROP NOT NULL` (deprecadas, no
      eliminadas físicamente).
    - `costs.incurred_at`: `SET NOT NULL` después del backfill.
    - `invoices.tax_base = subtotal` cuando `subtotal > 0` y `tax_base = 0`.
    - `invoices.paid_amount = SUM(payments.amount WHERE status='completed')`.
    - `invoices.lines`: enriquece cada línea con `lineBase`/`lineVat`/
      `lineTotal` y `vatRate` por línea (usa `vatRate` global de la factura
      si la línea no lo trae). Solo si la línea aún no tiene esos campos.
  - Asegura serie `F` (default, `nextNumber` calculado desde el `MAX` real
    de facturas existentes) y serie `R`.
  - Asegura una fila en `tenant_billing_settings` con valores por defecto.

La lista de schemas la da `byTable(sequelize, "invoices")` de
`scripts/_schema-targets.js`: todos los schemas de `master.tenants` que tengan
tabla `invoices`, **sin filtrar por `status`** (regla 12 de CLAUDE.md desde el
12/08/2026: el estado decide quién puede entrar, no qué forma tiene su schema;
antes recorría «todos los activos» y en un tenant sin Facturación moría a
medias). Es **idempotente**: cada paso comprueba existencia antes de actuar.

Comandos:

```
npm run db:migrate:billing-rework                                   # local
docker exec crm-salamandra-app-1 node scripts/migrate-billing-rework.js   # producción (VPS)
```

En producción los scripts **viajan dentro de la imagen** (el Dockerfile copia
`scripts/`), así que se ejecutan con `docker exec` sin copiar nada; la
`DATABASE_URL` del contenedor ya apunta al hostname interno de Docker. El
atajo `npm run …:prod` de `package.json` (`--env-file=.env.production`) no
vale en el host del VPS. Y en el día a día ni siquiera hace falta llamarla a
mano: está en `MODULES.billing` de `scripts/_module-migrations.js`, así que la
corren `enable-module.js` y `ensure-tenant-schema`.

### Sub-migración correctiva: `invoice_series.kind` ENUM (2026-05)

**Bug histórico**: la primera versión de `migrate-billing-rework.js` creaba
la columna `invoice_series.kind` como `VARCHAR(20) NOT NULL DEFAULT 'normal'`,
pero el modelo Sequelize la define como `ENUM('normal', 'rectificative')`.
Cualquier `sync({ alter: true })` posterior falla al intentar convertir el
default `'normal'` (varchar) al ENUM:

> el valor por omisión para la columna «kind» no puede ser convertido
> automáticamente al tipo `enum_invoice_series_kind`

Detectado durante el sprint de QA inicial al ejecutar
`scripts/reset-demo-tenant.js`. La cadena de seeds incluye un
`sync({ alter: true })` indirecto y reventaba.

**Fix permanente** (en `migrate-billing-rework.js`):

- En la fase A (autocommit) se crea el TYPE `enum_invoice_series_kind` si
  no existe, usando el helper `enumTypeExists`.
- En la fase B el `CREATE TABLE invoice_series` declara
  `kind "${schema}"."enum_invoice_series_kind" NOT NULL DEFAULT 'normal'`
  en lugar de `VARCHAR(20)`. Tenants creados a partir de ahora salen ya
  con el tipo correcto.

**Sub-migración correctiva** (`scripts/migrate-billing-fix-kind-enum.js`):

Para tenants donde la migración antigua ya dejó la columna como VARCHAR.
Idempotente, lee slugs desde `master.tenants` (todos, sin filtrar por
`status`). Para cada schema:

1. Salta si la tabla `invoice_series` no existe (módulo billing inactivo).
2. Si el ENUM `enum_invoice_series_kind` no existe, lo crea.
3. Si la columna `kind` ya es `USER-DEFINED` con
   `udt_name=enum_invoice_series_kind`, reporta "already-migrated".
4. Si es `character varying`, ejecuta:
   - `ALTER TABLE … ALTER COLUMN kind DROP DEFAULT`
   - `ALTER TABLE … ALTER COLUMN kind TYPE enum_invoice_series_kind USING kind::enum_invoice_series_kind`
   - `ALTER TABLE … ALTER COLUMN kind SET DEFAULT 'normal'`

Antes de la conversión hace un sanity check (`SELECT DISTINCT kind ...`) y
aborta si encuentra valores no convertibles.

Comandos:

```
npm run db:migrate:billing-fix-kind-enum                                   # local
docker exec crm-salamandra-app-1 node scripts/migrate-billing-fix-kind-enum.js   # producción (VPS)
```

**Estado en local (2026-05)**: ejecutada con éxito. 3 tenants migrados
(`crm_aumenta`, `crm_quality_energy`, `crm_spain_enzymes`), 1 ya migrado
(`crm_demo`, alineado previamente por el reset). Re-ejecución idempotente:
4/4 "already-migrated". (`quality_energy` se purgó el 12/08/2026.)

**Pendiente en producción**: ejecutar
`docker exec crm-salamandra-app-1 node scripts/migrate-billing-fix-kind-enum.js`
la próxima vez que se haga deploy del módulo billing en el VPS (sin verificar
el 19/08/2026; está en `MODULES.billing`, así que `enable-module` /
`ensure-tenant-schema` la corren al activar o poner al día un tenant).
Mientras tanto el sistema funciona porque ningún flujo de runtime escribe en
`kind` (solo el seed/migración), pero un `sync({ alter: true })` accidental
rompería los tenants no migrados.

`scripts/reset-demo-tenant.js` mantiene su `alignSchemaQuirks()` como
defensa en profundidad. Tras la migración correctiva debería ser un no-op
en cualquier tenant local.

## Seed

Fichero: `scripts/seed-billing-demo.js`. Comando:
`npm run db:seed:billing-demo`. Solo opera sobre el tenant `demo`.

Idempotente: usa el marcador `[seed-billing-demo]` en `notes`/`description`
para detectar y limpiar la pasada anterior antes de regenerar.

Lo que crea (en este orden):

1. Asegura `TenantBillingSettings` con datos fiscales del emisor demo.
2. Verifica que las series `F` y `R` existen (creadas por la migración).
3. Rellena campos fiscales de hasta 6 clientes existentes (`fiscalName`,
   `taxId`, `fiscalAddress`, `fiscalCity`, `fiscalZip`).
4. Asigna `monthlySalary` a los empleados activos cuyo `displayName` esté
   en la tabla `SALARIES` (Ana García 2400, Carlos López 2700, Laura
   Martínez 2900, Miguel Sánchez 1900).
5. Genera **costes** distribuidos en los 12 meses anteriores: salarios
   mensuales por empleado (vat 0, no deducibles), alquiler, suscripciones
   SaaS, suministros (cada 2 meses), comisiones, material consumible,
   subcontratas eventuales (cada 2 meses), más 2 entradas CAPEX puntuales.
   En total ~110 costes según la cardinalidad real del seed.
6. Genera **11 facturas** (`SCENARIOS`) distribuidas a 0..5 meses atrás, con
   IVA mixto (21 / 10 / 4), una multi-línea, una marcada como `overdue`,
   una pendiente de rectificar.
7. Genera **8 cobros** (`payRatio > 0` en los escenarios sin `rectifyAfter`).
   Una factura queda `overdue` (sin cobros, `dueDate` pasado).
8. Genera **1 factura rectificativa** (serie R) que anula la factura
   marcada como `rectifyAfter`.

Resultado tipo: 11 facturas + 1 rectificativa, 8 cobros, ~110 costes,
salarios proyectados realistas. Distribución diseñada para producir Margen
Bruto 50–70 %, Margen Neto 15–35 % y EBITDA ligeramente superior al Neto
(según los comentarios del propio seed).

## Backlog

Pendiente de sprints futuros, en orden vagamente sugerido:

- **Limpieza de campos legacy en Invoice**: borrado físico de `familyId`,
  `patientId`, `serviceType`, `invoiceType`, `subtotal`, `vatRate` global,
  `discountType`, `discountValue` (todos terapéuticos).
- **Eliminación de `costs.month` y `costs.amount`**: tras confirmar que el
  Libro IVA y los KPIs son correctos durante un ciclo fiscal completo.
- **Limpieza de costes legacy del db-seed antiguo**: hay costes (~38.845 €
  según la nota del prompt original) sin marcador `[seed-billing-demo]` que
  inflan los fijos del demo. Borrarlos al regenerar el seed o filtrarlos.
- **Proveedor en el Excel de gastos**: la pantalla y los endpoints ya lo llevan
  (20/08/2026), el export `expenses` no. Y decidir qué hacer con
  `Cost.inventoryProductId` (borrarla: ya no apunta a nada).
- **Motor n8n de RecurringInvoice**: cron + webhook + emisión automática
  cuando llegue `nextRunAt`. Hoy todo es manual.
- **Integración Verifactu / Facturantia**: rellenar `facturantiaId`,
  `qrUrl`, `verifactuStatus`, `verifactuSentAt` al emitir, y QR en el PDF
  (`/facturacion/cumplimiento` hoy solo informa).
- **Catálogo de servicios** reutilizable (los productos del almacén ya se
  eligen por línea si hay Inventario).
- **Página detalle de empleado** como ruta propia (`/equipo/[id]`) en lugar
  de drawer.
- **Filtro por estado efectivo** en `GET /api/billing/invoices?status=overdue`
  (hoy filtra por status persistido — ver "Limitaciones conocidas").

## Incoherencias resueltas

Todas las incoherencias identificadas en la documentación inicial se
arreglaron en el sprint inmediatamente posterior. Quedan aquí registradas
solo como historial de decisiones:

1. **`monthsBetween` unificado**. Hoy hay una única implementación, exportada
   desde `lib/billing/billingSummary.js`. El endpoint
   `/api/billing/analytics/employees` la importa, no la duplica.
2. **`/api/billing/recurring*` con guard de admin** y validación de
   `hasModule("billing")` en todos los métodos. GET sigue accesible para
   cualquier autenticado del tenant. La auditoría aplicó el mismo arreglo
   a `/api/billing/rates*`, que también estaba sin guard.
3. **`PeriodPicker` deriva el preset activo del rango actual** (no del query
   param). Cambiar manualmente `from` o `to` resalta automáticamente
   "Personalizado". Llegar por URL compartida con un rango exacto a un
   preset lo resalta automáticamente.
4. **`dueDate` por defecto desde `TenantBillingSettings.defaultPaymentTermsDays`**.
   `POST /invoices` lo aplica si no llega; `POST /invoices/[id]/issue` lo
   completa al emitir si el borrador aún no lo tenía. La UI lo prerellena
   en el formulario de alta.
5. **`overdue` dinámico en lectura**. Helper `lib/billing/invoiceStatus.js`.
   No requiere cron ni migración. El admin sigue pudiendo setearlo
   manualmente vía PATCH (prevalece sobre el cálculo).
6. **Endpoint `POST /invoices/[id]/send`** y botón "Enviar" en el drawer de
   detalle cuando `status === "issued"`. Nació como «Marcar como enviada»
   (solo anotaba el canal); desde el 27/07/2026 envía el PDF por correo y
   `?via=whatsapp|other` queda para quien la entrega por su cuenta.

### Limitaciones conocidas (no resueltas en este sprint)

- `GET /api/billing/invoices?status=overdue` filtra por **status persistido**,
  no por `effectiveStatus`. Una factura `issued` con `dueDate` ya pasado
  no aparece en el filtro `?status=overdue`, aunque el GET devuelva
  `status: "overdue"`. Mismo razonamiento para `sortBy=status`. Si en el
  futuro hace falta filtrar por estado efectivo, hay que pasar la lógica
  a SQL (CASE expression sobre `due_date`/`paid_amount`/`total`) o
  post-procesar tras la query.
- El include de `Invoice` en `GET /api/billing/payments` solo trae
  `id`, `number`, `total`, `status`, `clientId`, `issueDate`. No se aplica
  `effectiveStatus` allí porque la página de Cobros no muestra el estado
  de la factura (solo el del cobro). Si más adelante se muestra,
  ampliar el include con `dueDate`, `paidAmount` y mapear con
  `withEffectiveStatus`.
