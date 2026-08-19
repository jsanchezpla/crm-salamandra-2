# El alta de clientes se adapta al cliente (por módulos, no por slug)

**Fecha:** 01/08/2026 · **Quién:** Jorge (sprint Aumenta) · **Módulos:**
clients, pacientes, clients_avanzado · **Lo que quedó en `CLAUDE.md`:** la
tabla de los dos perfiles y el aviso de `Client.address` (sección de módulos).

## Qué se decidió

`lib/clients/formularioAlta.js` decide QUÉ se pregunta en el alta, y lo
comparten la pantalla y el endpoint. Dos perfiles, **por MÓDULOS y no por
slug**, para que un centro nuevo salga bien de fábrica:

| Perfil | Cuándo | Campos | Tipo de cliente |
| --- | --- | --- | --- |
| `salud` | tiene `pacientes`, `clinica` o `nutricion` | sin Empresa/Tema/Producto | `individual` |
| `comercial` | el resto | como estaba | `company` |

**Código postal para todos**, en `customFields.postalCode` (no en `fiscalZip`:
recepción apunta dónde vive la familia, no dónde factura). **Tema y Producto de
interés se quitaron de todos los formularios, del Excel y del importador**: no
había un solo cliente con ellos rellenos en producción, y las notas internas
de la ficha cubren lo que hiciera falta.

## Lo que se aprendió por el camino

⚠️ **`Client.address` es JSONB, no texto.** Un campo «Dirección» de texto en la
ficha metió el `{}` por defecto como hijo de React y tumbó la pantalla entera —
compilaba y el servidor devolvía 200; solo se veía abriendo la ficha dos veces.
Si algún día se pide la dirección completa, hay que tratarla como el objeto que
es.

## Con `pacientes` activo

El alta crea también a los pacientes **en la misma transacción**
(`components/clients/PacientesDelAlta.jsx`): o entra la familia con sus
pacientes, o no entra nada. La casilla «el paciente es el propio cliente»
PRERRELLENA nombre y apellidos partiendo el nombre del cliente — a la vista y
editables, sin adivinar nada por detrás.

## Con `clients_avanzado` activo

Una casilla mete a la familia en la cola de admisión
(`lib/clients/listaEspera.js`). Esa entrada queda **`active` con `clientId`**,
que antes no pasaba: `converted` significa «ya tiene plaza» y la sacaría de la
cola el mismo día. Por eso la lista ofrece «Ya tiene plaza» en vez de
«Convertir en cliente» a quien ya tiene ficha. La ficha enseña «En lista de
espera desde el …» en su cabecera.

⚠️ La «lista de espera» de Citas y la de admisión son cosas distintas: la
primera son solicitudes de reserva concretas (`bookings` en `pending`); la
segunda, gente esperando plaza sin cita ni fecha. Por eso la segunda lleva
apellido en toda la UI.

## Cómo se aplica hoy

Es el **peldaño 2 de la regla #16**: un dato (qué campos) declarado en `lib/`
por módulos, que el base lee. Si otro oficio necesita otro perfil, se añade
ahí, no se copia el formulario.
