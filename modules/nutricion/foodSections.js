"use client";

/**
 * foodSections — secciones del catálogo de alimentos para los desplegables
 * (tabla de alimentos y buscador del editor de recetas).
 *
 * Los tags del catálogo base son slugs ("verduras-hortalizas"); aquí viven sus
 * nombres bonitos con acentos. Un tag que no esté en el mapa (creado a mano por
 * la nutricionista) se muestra con un prettify genérico, así sus secciones
 * propias aparecen igual que las del catálogo.
 */

import { useEffect, useState } from "react";

export const SECTION_LABELS = Object.freeze({
  "aceites-grasas": "Aceites y grasas",
  bebidas: "Bebidas",
  carnes: "Carnes",
  "cereales-derivados": "Cereales y derivados",
  "condimentos-salsas": "Condimentos y salsas",
  "dulces-reposteria": "Dulces y repostería",
  frutas: "Frutas",
  "frutos-secos-semillas": "Frutos secos y semillas",
  huevos: "Huevos",
  lacteos: "Lácteos",
  legumbres: "Legumbres",
  marca: "Productos de marca",
  pescados: "Pescados y mariscos",
  "pescados-mariscos": "Pescados y mariscos",
  procesados: "Procesados",
  setas: "Setas",
  tuberculos: "Tubérculos",
  "verduras-hortalizas": "Verduras y hortalizas",
});

export function sectionLabel(tag) {
  if (SECTION_LABELS[tag]) return SECTION_LABELS[tag];
  const plain = String(tag).replace(/-/g, " ").trim();
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

/**
 * Hook: carga las secciones existentes (tags con recuento) una vez.
 * Devuelve [{ value: tag, label: "Nombre bonito (n)" }] listo para un Select,
 * con la opción "Todas las secciones" delante.
 */
export function useFoodSections() {
  const [sections, setSections] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/nutricion/foods/tags");
        const j = await r.json();
        if (cancelled || !j.ok) return;
        const items = (j.data?.items ?? j.items ?? [])
          .map(({ tag, count }) => ({ value: tag, label: `${sectionLabel(tag)} (${count})` }))
          .sort((a, b) => a.label.localeCompare(b.label, "es"));
        setSections(items);
      } catch {
        /* sin secciones: el desplegable simplemente no filtra */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return [{ value: "", label: "Todas las secciones" }, ...sections];
}
