// Extrae el array JSON de resultado del workflow desde el fichero de salida de la tarea.
import fs from "node:fs";
const src = process.argv[2];
const out = process.argv[3];
const obj = JSON.parse(fs.readFileSync(src, "utf8"));
let result = obj.result ?? obj.data ?? obj.output;
if (typeof result === "string") result = JSON.parse(result);
if (!Array.isArray(result)) {
  // buscar el primer valor array dentro del objeto
  const arr = Object.values(obj).find((v) => Array.isArray(v) && v[0]?.key);
  if (arr) result = arr;
}
if (!Array.isArray(result)) { console.error("No se encontró el array de resultado. Claves:", Object.keys(obj).join(", ")); process.exit(1); }
fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log("OK", result.length, "módulos:", result.map((m) => m.key).join(", "));
