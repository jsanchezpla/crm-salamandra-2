/**
 * Padres/tutores estructurados del cliente (sprint Aumenta 2026-07-28).
 *
 * Viven en `Client.guardians` (JSONB): ambos progenitores SIEMPRE dentro del
 * mismo cliente (misma familia con un paciente común), también con padres
 * separados — decisión de la reunión del 28/07. Cada entrada lleva un `id`
 * estable que usan las firmas del contrato (ContractSignature.guardianId).
 *
 * Forma: { id, name, relationship, dni, phone, email, signer }
 *   - relationship ∈ madre | padre | tutor | otro
 *   - signer: debe firmar el Contrato del Centro en el portal.
 */

import { randomUUID } from "crypto";

export const GUARDIAN_RELATIONSHIPS = ["madre", "padre", "tutor", "otro"];
export const GUARDIAN_RELATIONSHIP_LABEL = {
  madre: "Madre",
  padre: "Padre",
  tutor: "Tutor/a legal",
  otro: "Otro",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanStr(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

// Normaliza el array que llega del formulario. Conserva los `id` existentes
// (las firmas apuntan a ellos) y genera uno para las entradas nuevas.
export function normalizeGuardians(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((g) => g && typeof g === "object")
    .map((g) => ({
      id: UUID_RE.test(String(g.id ?? "")) ? String(g.id).toLowerCase() : randomUUID(),
      name: cleanStr(g.name) ?? "",
      relationship: GUARDIAN_RELATIONSHIPS.includes(g.relationship) ? g.relationship : "tutor",
      dni: cleanStr(g.dni, 20),
      phone: cleanStr(g.phone, 50),
      email: cleanStr(g.email, 255),
      signer: g.signer !== false, // por defecto todo tutor firma
    }))
    .filter((g) => g.name);
}

/**
 * Los tutores como los ve la FICHA DEL PACIENTE (02/09/2026, AV-0023 y AV-0024
 * de Aumenta): nombre, parentesco, teléfono y correo, y nada más.
 *
 * Nace de una queja real: en Organízate cada paciente tenía su apartado de
 * tutores y en el CRM «solo aparece un cliente por paciente y desaparecen el
 * resto de datos». Los datos estaban (1.846 tutores en 813 familias con dos o
 * más), pero solo se enseñaban en la ficha de la familia, a la que las
 * terapeutas no entran. Esta función es lo que viaja a quien mira un paciente:
 *
 *   · sin `dni`: quien llama a una familia necesita el teléfono, no el DNI, y
 *     el listado de pacientes ya se molestaba en no mandarlo al navegador;
 *   · sin `signer`: quién firma el contrato es cosa de la ficha de la familia;
 *   · con `relationshipLabel` resuelto aquí, para que la pantalla no tenga su
 *     propia tabla de parentescos que se separe de esta.
 *
 * Una entrada sin nombre no es nadie: se descarta, igual que al normalizar.
 */
export function tutoresParaFicha(guardians) {
  if (!Array.isArray(guardians)) return [];
  return guardians
    .filter((g) => g && typeof g === "object" && cleanStr(g.name))
    .map((g) => {
      const relationship = GUARDIAN_RELATIONSHIPS.includes(g.relationship) ? g.relationship : "tutor";
      return {
        id: g.id ?? null,
        name: cleanStr(g.name),
        relationship,
        relationshipLabel: GUARDIAN_RELATIONSHIP_LABEL[relationship],
        phone: cleanStr(g.phone, 50),
        email: cleanStr(g.email, 255),
      };
    });
}

// Tutores que deben firmar el contrato. Si no hay ninguno marcado, no se
// puede exigir firma (el gate del portal lo trata como "sin firmantes").
export function signersOf(guardians) {
  return (Array.isArray(guardians) ? guardians : []).filter((g) => g && g.signer && g.id);
}

// ¿Está el contrato completamente firmado? `signatures` = filas de
// ContractSignature del cliente. Exige la firma de TODOS los firmantes
// (con padres separados serán dos).
export function contractFullySigned(guardians, signatures) {
  const signers = signersOf(guardians);
  if (signers.length === 0) return false;
  const signed = new Set((signatures ?? []).map((s) => String(s.guardianId ?? s.guardian_id).toLowerCase()));
  return signers.every((g) => signed.has(String(g.id).toLowerCase()));
}
