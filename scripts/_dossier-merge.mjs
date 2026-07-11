// Añade leads y pacientes (generados por agentes directos) a content.json.
import fs from "node:fs";
const path = process.argv[2];
const arr = JSON.parse(fs.readFileSync(path, "utf8"));

const leads = {
  key: "leads", name: "Leads",
  claim: "El módulo de Leads reúne en un solo sitio todas las oportunidades comerciales de tu empresa, desde el primer contacto hasta el cierre. Recoge los contactos que llegan por tu web, los que das de alta a mano y los que subes desde una hoja de cálculo, y te deja seguir en qué punto está cada uno. Está pensado para equipos comerciales que hoy pierden el hilo entre correos, notas sueltas y hojas de Excel.",
  headline: "Cada oportunidad comercial, seguida hasta el cierre",
  bullets: [
    { bold: "Varios orígenes", rest: "Junta en una misma lista los leads que entran por los formularios de tu web, los que das de alta manualmente y los que importas desde un Excel o CSV." },
    { bold: "Embudo por etapas", rest: "Cada lead avanza por fases claras —nuevo, contactado, en seguimiento, propuesta y negociación— hasta que se marca como convertido o descartado." },
    { bold: "Ficha completa", rest: "Guarda teléfono, email, valor estimado de la operación, probabilidad de cierre, fecha prevista y notas internas de cada oportunidad." },
    { bold: "Campos a medida", rest: "Cada empresa ve las columnas que le importan (empresa, zona, cargo, motivo de la consulta) según su sector, sin cargar con campos que no usa." },
    { bold: "Importar y exportar", rest: "Sube leads en bloque desde una plantilla de Excel y descarga el listado completo cuando lo necesites para trabajarlo fuera del CRM." },
    { bold: "Filtros y búsqueda", rest: "Localiza cualquier lead por nombre, email o teléfono y filtra la lista por etapa o por empresa para centrarte en lo que toca ahora." },
  ],
  card: [
    { type: "flow", label: "El embudo, de principio a fin", pills: ["Nuevo", "Contactado", "En seguimiento", "Propuesta", "Negociación", "Convertido"] },
    { type: "text", label: "Adaptado a tu sector", text: "El mismo módulo dibuja un **embudo distinto para cada negocio**: una consulta de nutrición trabaja etapas como consulta agendada o paciente activo; un equipo de energía sigue demos y cierres." },
    { type: "text", label: "Permisos claros", text: "Cualquiera puede **consultar y exportar** los leads, pero solo un **administrador** puede crearlos, editarlos, importarlos o borrarlos." },
  ],
  ai: [
    { title: "Aviso de leads parados", desc: "Revisa qué leads llevan más tiempo sin movimiento según las fechas ya registradas y propone una lista corta para retomar. El comercial decide a quién llama; la IA no inventa previsiones ni cierra nada por su cuenta." },
    { title: "Posibles duplicados", desc: "Compara nombre, email y teléfono entre los leads existentes y señala los que parecen la misma persona repetida. Una persona confirma si conviene unificarlos; la IA solo avisa." },
  ],
};

const pacientes = {
  key: "pacientes", name: "Pacientes",
  claim: "El submódulo Pacientes reúne en una sola ficha toda la información clínica de cada caso: centro escolar, motivo de derivación, terapeuta principal, frecuencia de asistencia y estado del tratamiento. Esa ficha es la base sobre la que se apoyan las sesiones, los informes y las coordinaciones de la clínica.",
  headline: "La ficha clínica que ordena cada caso",
  bullets: [
    { bold: "Ficha clínica", rest: "Recoge centro escolar, curso académico, motivo de derivación y quién derivó al paciente en un formulario único." },
    { bold: "Terapeuta principal", rest: "Cada paciente queda vinculado a su terapeuta del equipo y a su frecuencia de asistencia, semanal o quincenal." },
    { bold: "Estado del tratamiento", rest: "Marca a cada paciente como activo, en pausa o dado de alta, con la fecha y el motivo del alta cuando corresponde." },
    { bold: "Timeline por paciente", rest: "Reúne sus sesiones, informes y coordinaciones en pestañas dentro de la misma ficha." },
    { bold: "Sesiones desde audio", rest: "Subes el audio grabado con el móvil y se transcribe y estructura en apartados que revisas antes de guardar." },
    { bold: "Coordinaciones", rest: "Deja constancia de las actas con la familia, el colegio y profesionales externos asociadas a cada paciente." },
  ],
  card: [
    { type: "flow", label: "De la grabación a la sesión", pills: ["Grabas", "Subes audio", "Transcripción", "Apartados", "Revisas y guardas"] },
    { type: "text", label: "El estado a la vista", text: "Cada caso está **activo**, en pausa o dado de alta, con su fecha y motivo, para saber a quién se está atendiendo." },
  ],
  ai: [
    { title: "Estructurar la sesión grabada", desc: "Sobre el audio subido de una sesión, transcribe y ordena el contenido en apartados —objetivos, actividades y observaciones— que el terapeuta revisa y confirma antes de guardar en la ficha." },
    { title: "Avisar de seguimientos pendientes", desc: "Cruza el estado 'activo' y la frecuencia de asistencia con la fecha de la última sesión para proponer pacientes que llevan tiempo sin cita; el equipo decide a quién retomar." },
  ],
};

const byKey = Object.fromEntries(arr.map((m) => [m.key, m]));
byKey.leads = leads;
byKey.pacientes = pacientes;

// reordenar a orden lógico
const order = ["clientes", "leads", "calendario", "citas", "proyectos", "pedidos", "inventario", "equipo", "formacion", "nutricion", "clinica", "pacientes"];
const merged = order.filter((k) => byKey[k]).map((k) => byKey[k]);
fs.writeFileSync(path, JSON.stringify(merged, null, 2));
console.log("OK", merged.length, "módulos:", merged.map((m) => m.key).join(", "));
