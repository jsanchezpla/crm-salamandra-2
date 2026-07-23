<?php
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  tunutrilaura.com (TutorLMS)  →  CRM Salamandra · módulo Formación
 *  Snippet de SINCRONIZACIÓN de cursos y matrículas.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  QUÉ HACE (en cristiano)
 *  ───────────────────────
 *  El CRM no crea cursos: es un ESPEJO de lo que hay en la web. Este snippet es
 *  el "puente" que le cuenta al CRM lo que pasa en TutorLMS:
 *
 *    A) SYNC DE CURSOS (bajo demanda). Cuando visitas una URL secreta, le manda
 *       al CRM la lista de cursos publicados. El CRM crea/actualiza cada curso
 *       (por su ID de TutorLMS) y desactiva los que ya no estén. Lo lanzas la
 *       primera vez y cada vez que crees/cambies un curso.
 *
 *    B) MATRÍCULAS (automático). Cada vez que un alumno se matricula en un curso
 *       (gratis o tras pagar en WooCommerce), avisa al CRM, que da de alta al
 *       alumno y su matrícula. No hay que hacer nada manual.
 *
 *  Todo va FIRMADO (HMAC-SHA256) con un secreto compartido, así el CRM sabe que
 *  el aviso viene de verdad de esta web y no de un impostor.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  INSTALACIÓN (para Albert) — 5 pasos
 *  ─────────────────────────────────────────────────────────────────────────
 *
 *  PASO 1 · El secreto (una sola vez, en wp-config.php)
 *     Pide a Jorge el valor del secreto del CRM (es su variable
 *     RETORIKA_WEBHOOK_SECRET). En el servidor de tunutrilaura.com, edita el
 *     fichero  wp-config.php  y añade esta línea ANTES de la que pone
 *     "/* That's all, stop editing! * /":
 *
 *         define('CRM_WEBHOOK_SECRET', 'EL_VALOR_QUE_TE_DA_JORGE');
 *
 *     ⚠ Tiene que ser IDÉNTICO al del CRM, carácter a carácter. Nunca lo pongas
 *       dentro del snippet ni lo mandes por chat/WhatsApp: solo en wp-config.php.
 *
 *  PASO 2 · El snippet
 *     Instala el plugin "Code Snippets" (Plugins → Añadir nuevo → buscar
 *     "Code Snippets" → Instalar → Activar). Luego: Snippets → Añadir nuevo,
 *     ponle nombre "CRM Salamandra - Sync Formación", pega TODO el BLOQUE 1 de
 *     abajo (desde "// ===== BLOQUE 1" hasta el final del fichero), elige
 *     "Ejecutar el snippet en todas partes" y pulsa "Guardar cambios y activar".
 *
 *  PASO 3 · Primer sync de cursos
 *     Estando logueado como administrador de WordPress, abre en el navegador:
 *
 *         https://tunutrilaura.com/?nutrilaura_sync_courses=1
 *
 *     Debe salir un texto tipo:  "OK: enviados 1 curso(s) al CRM."
 *     (Si sale ERROR, mira el PASO "SI ALGO FALLA" de abajo.)
 *
 *  PASO 4 · Comprobar en el CRM
 *     Entra en el CRM → Formación → Cursos. Debe aparecer el curso
 *     "Reconciliándome con la comida...". Si aparece: ¡puente montado! ✅
 *
 *  PASO 5 · (Jorge, lado CRM — opcional) Para que salga el botón
 *     "Sincronizar" dentro del CRM, añadir en el .env.production del VPS:
 *         NUTRI_LAURA_TUTOR_SYNC_URL=https://tunutrilaura.com/?nutrilaura_sync_courses=1
 *     y reiniciar la app. Sin esto igualmente funciona: basta con abrir la URL
 *     del PASO 3 cuando haga falta re-sincronizar.
 *
 *  ─────────────────────────────────────────────────────────────────────────
 *  SI ALGO FALLA (diagnóstico)
 *  ─────────────────────────────────────────────────────────────────────────
 *   · El snippet "falla abierto": si el CRM no responde, NO rompe la web ni el
 *     acceso a los cursos. Como mucho, un aviso no llega.
 *   · Todo lo que pasa se escribe en el log de errores de PHP con la etiqueta
 *     "[nutrilaura-crm]". Pídele a Jorge que mire ese log si algo no cuadra.
 *   · Error más típico: "HTTP 401 Firma inválida" → el secreto del PASO 1 no
 *     coincide con el del CRM. Revisar que sean idénticos.
 *   · "HTTP 403 Módulo training no activo" → avisar a Jorge (se arregla en el CRM).
 *
 *  Cuando crees o edites un curso más adelante, vuelve a abrir la URL del PASO 3
 *  para re-sincronizar. Las matrículas (B) ya van solas, no hay que tocarlas.
 * ═══════════════════════════════════════════════════════════════════════════
 */


// ═════════════════════════ BLOQUE 1 — PEGAR EN CODE SNIPPETS ═════════════════════════

if (!defined('NUTRILAURA_CRM_BASE'))   define('NUTRILAURA_CRM_BASE', 'https://crm.salamandrasolutions.com');
if (!defined('NUTRILAURA_CRM_TENANT')) define('NUTRILAURA_CRM_TENANT', 'nutri_laura');

/**
 * Firma el cuerpo JSON con HMAC-SHA256 y lo envía POST al CRM.
 * Devuelve true si el CRM respondió 2xx. Nunca lanza (fail-open).
 */
function nutrilaura_crm_post($path, $data) {
    $secret = defined('CRM_WEBHOOK_SECRET') ? CRM_WEBHOOK_SECRET : '';
    if (!$secret) {
        error_log('[nutrilaura-crm] Falta define(CRM_WEBHOOK_SECRET) en wp-config.php');
        return false;
    }
    $body = wp_json_encode($data);
    $sig  = hash_hmac('sha256', $body, $secret); // MISMO cálculo que el CRM

    $res = wp_remote_post(NUTRILAURA_CRM_BASE . $path, array(
        'timeout' => 8,
        'headers' => array(
            'Content-Type'         => 'application/json',
            'X-Retorika-Signature' => 'sha256=' . $sig,   // cabecera de firma que espera el CRM
            'x-tenant'             => NUTRILAURA_CRM_TENANT, // a qué cliente pertenece
        ),
        'body' => $body,
    ));

    if (is_wp_error($res)) {
        error_log('[nutrilaura-crm] ' . $path . ' error: ' . $res->get_error_message());
        return false;
    }
    $code = intval(wp_remote_retrieve_response_code($res));
    error_log('[nutrilaura-crm] ' . $path . ' => HTTP ' . $code . ' ' . wp_remote_retrieve_body($res));
    return $code >= 200 && $code < 300;
}

/**
 * A) SYNC de cursos bajo demanda.
 *    URL:  https://tunutrilaura.com/?nutrilaura_sync_courses=1  (solo admin)
 */
add_action('init', function () {
    if (empty($_GET['nutrilaura_sync_courses'])) return;

    if (!is_user_logged_in() || !current_user_can('manage_options')) {
        status_header(403);
        exit('No autorizado (hay que estar logueado como administrador).');
    }
    if (!function_exists('tutor_utils')) {
        exit('TutorLMS no está activo en esta web.');
    }

    $posts = get_posts(array(
        'post_type'   => 'courses',       // el tipo de contenido de TutorLMS
        'post_status' => 'publish',
        'numberposts' => -1,
    ));

    $courses = array();
    foreach ($posts as $p) {
        $product_id = intval(tutor_utils()->get_course_product_id($p->ID));
        $courses[] = array(
            'course_id'     => intval($p->ID),                 // = wpCourseId en el CRM
            'course_title'  => $p->post_title,
            'wc_product_id' => $product_id ?: null,            // producto WooCommerce (si el curso se vende)
        );
    }

    $ok = nutrilaura_crm_post('/api/webhooks/tutorlms/sync-courses', array('courses' => $courses));

    header('Content-Type: text/plain; charset=utf-8');
    echo $ok
        ? ('OK: enviados ' . count($courses) . ' curso(s) al CRM. Revisa Formación → Cursos.')
        : 'ERROR: no se pudo sincronizar. Que Jorge mire el log de PHP ([nutrilaura-crm]).';
    exit;
});

/**
 * B) MATRÍCULAS automáticas.
 *    TutorLMS dispara 'tutor_after_enrolled' cuando un alumno queda matriculado
 *    (curso gratis, o tras completarse el pago en WooCommerce).
 */
add_action('tutor_after_enrolled', function ($course_id, $user_id) {
    $user = get_userdata($user_id);
    if (!$user) return;

    nutrilaura_crm_post('/api/webhooks/tutorlms/enrollment', array(
        'user_email'   => strtolower($user->user_email),
        'display_name' => $user->display_name,
        'user_id'      => intval($user_id),
        'course_id'    => intval($course_id),       // = wpCourseId; si el curso no existía en el CRM, se crea
        'course_title' => get_the_title($course_id),
        'enrolled_at'  => current_time('c'),        // ISO 8601
    ));
}, 10, 2);
