/**
 * camposFiscales — los campos de «Datos de facturación» de una ficha, declarados
 * UNA vez y compartidos por la tarjeta de la ficha (ClientFiscalSection) y el
 * panel «Editar ficha» del listado (ClientesClient).
 *
 * Nació el 31/08/2026: el panel de edición usaba la misma lista de campos que
 * el alta, que no lleva los fiscales, así que la razón social y el NIF de
 * facturación solo se podían corregir buscando una tarjeta al final de la
 * pestaña Datos de la ficha — y con ~100 familias sin NIF que rellenar, ese
 * camino no lo encontraba nadie.
 *
 * ⚠️ Cada clave de esta lista tiene que estar en la lista blanca fiscal del
 * PUT de `app/api/clients/[id]/route.js` — lo vigila `_smoke-campos-fiscales.mjs`.
 */
export const CAMPOS_FISCALES = [
  { key: "fiscalName", label: "Nombre o razón social", placeholder: "Javier Pérez Ruiz · o Empresa S.L." },
  { key: "fiscalTaxId", label: "NIF / CIF", placeholder: "12345678Z · o B12345678" },
  { key: "fiscalAddress", label: "Dirección fiscal", placeholder: "C/ Mallorca 210, 3º 2ª" },
  { key: "fiscalZip", label: "Código postal", placeholder: "28013" },
  { key: "fiscalCity", label: "Ciudad", placeholder: "Madrid" },
];
