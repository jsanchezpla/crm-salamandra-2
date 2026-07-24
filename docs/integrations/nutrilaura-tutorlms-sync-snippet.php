<?php
/**
 * Sincronización TutorLMS → CRM Salamandra (módulo Formación).
 *
 * El CRM es un ESPEJO de la web: no crea cursos, los recibe. Este fichero es el
 * "puente" y hace tres cosas, todo firmado con HMAC-SHA256:
 *
 *   A)  Curso al PUBLICAR/EDITAR/DESPUBLICAR → se sincroniza solo (automático).
 *   A-bis) Sync masivo bajo demanda (para los cursos que YA existían), abriendo
 *         https://tunutrilaura.com/?nutrilaura_sync_courses=1  (solo administrador).
 *   A-ter) Re-envío masivo de MATRÍCULAS ya existentes (recupera las que se
 *         perdieron mientras el puente estuvo roto), abriendo
 *         https://tunutrilaura.com/?nutrilaura_sync_enrollments=1  (solo admin).
 *         Es seguro repetirlo: el CRM no duplica nada.
 *   B)  Matrícula de un alumno → se avisa al CRM (automático).
 *
 * SECRETO: se lee de wp-config.php →  define('CRM_WEBHOOK_SECRET', '...');  con el
 * MISMO valor que la variable RETORIKA_WEBHOOK_SECRET del CRM (lo da Jorge).
 * Nunca se pone el secreto en el theme.
 *
 * Fail-open: si el CRM no responde, NO rompe la web; como mucho un aviso no llega.
 * Todo queda en el log de PHP con la etiqueta [nutrilaura-crm].
 *
 * @package NutriLaura
 */

if ( ! defined( 'ABSPATH' ) ) { exit; }

if ( ! defined( 'NUTRILAURA_CRM_BASE' ) )   { define( 'NUTRILAURA_CRM_BASE', 'https://crm.salamandrasolutions.com' ); }
if ( ! defined( 'NUTRILAURA_CRM_TENANT' ) ) { define( 'NUTRILAURA_CRM_TENANT', 'nutri_laura' ); }

/** Secreto compartido para firmar los webhooks (definido en wp-config.php). */
function nutrilaura_tutorlms_secret() {
	if ( defined( 'CRM_WEBHOOK_SECRET' ) && CRM_WEBHOOK_SECRET ) {
		return CRM_WEBHOOK_SECRET;
	}
	return '';
}

/**
 * Firma el cuerpo JSON (HMAC-SHA256), lo envía POST al CRM y devuelve el
 * DETALLE de qué pasó (para poder diagnosticar sin buscar el log de PHP).
 * Nunca lanza (fail-open).
 *
 * @return array { ok: bool, why: 'sin_secreto'|'wp_error'|'http'|'', code: int, body: string }
 */
function nutrilaura_tutorlms_post_full( $path, $data ) {
	$secret = nutrilaura_tutorlms_secret();
	if ( ! $secret ) {
		error_log( '[nutrilaura-crm] Falta define(CRM_WEBHOOK_SECRET) en wp-config.php' );
		return array( 'ok' => false, 'why' => 'sin_secreto', 'code' => 0, 'body' => '' );
	}
	$body = wp_json_encode( $data );
	$sig  = hash_hmac( 'sha256', $body, $secret ); // mismo cálculo que el CRM

	$res = wp_remote_post( NUTRILAURA_CRM_BASE . $path, array(
		'timeout' => 8,
		'headers' => array(
			'Content-Type'         => 'application/json',
			'X-Retorika-Signature' => 'sha256=' . $sig,      // cabecera de firma que espera el CRM
			'x-tenant'             => NUTRILAURA_CRM_TENANT,  // a qué cliente pertenece
		),
		'body' => $body,
	) );

	if ( is_wp_error( $res ) ) {
		error_log( '[nutrilaura-crm] ' . $path . ' error: ' . $res->get_error_message() );
		return array( 'ok' => false, 'why' => 'wp_error', 'code' => 0, 'body' => $res->get_error_message() );
	}
	$code = (int) wp_remote_retrieve_response_code( $res );
	$resp = (string) wp_remote_retrieve_body( $res );
	if ( $code < 200 || $code >= 300 ) {
		error_log( '[nutrilaura-crm] ' . $path . ' => HTTP ' . $code . ' ' . $resp );
		return array( 'ok' => false, 'why' => 'http', 'code' => $code, 'body' => $resp );
	}
	return array( 'ok' => true, 'why' => '', 'code' => $code, 'body' => $resp );
}

/** Variante simple (hooks automáticos): true si el CRM respondió 2xx. */
function nutrilaura_tutorlms_post( $path, $data ) {
	$r = nutrilaura_tutorlms_post_full( $path, $data );
	return $r['ok'];
}

/**
 * A) Curso al PUBLICAR / EDITAR / DESPUBLICAR (automático).
 *    publish → crea/actualiza en el CRM; papelera/borrador → lo desactiva.
 */
add_action( 'transition_post_status', function ( $new_status, $old_status, $post ) {
	if ( ! $post || 'courses' !== $post->post_type ) { return; }
	if ( wp_is_post_revision( $post->ID ) || wp_is_post_autosave( $post->ID ) ) { return; }

	if ( 'publish' === $new_status ) {
		$product_id = function_exists( 'tutor_utils' ) ? (int) tutor_utils()->get_course_product_id( $post->ID ) : 0;
		nutrilaura_tutorlms_post( '/api/webhooks/tutorlms/course', array(
			'action'        => ( 'publish' === $old_status ? 'update' : 'publish' ),
			'course_id'     => (int) $post->ID,
			'course_title'  => $post->post_title,
			'wc_product_id' => $product_id ? $product_id : null,
		) );
	} elseif ( 'publish' === $old_status && in_array( $new_status, array( 'trash', 'draft', 'private', 'pending' ), true ) ) {
		nutrilaura_tutorlms_post( '/api/webhooks/tutorlms/course', array(
			'action'    => 'delete',
			'course_id' => (int) $post->ID,
		) );
	}
}, 10, 3 );

/**
 * A-bis) Sync masivo bajo demanda — para traer los cursos que YA existían.
 *    URL:  https://tunutrilaura.com/?nutrilaura_sync_courses=1   (solo admin)
 */
add_action( 'init', function () {
	if ( empty( $_GET['nutrilaura_sync_courses'] ) ) { return; }

	if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
		status_header( 403 );
		exit( 'No autorizado (hay que estar logueado como administrador).' );
	}
	if ( ! function_exists( 'tutor_utils' ) ) { exit( 'TutorLMS no esta activo en esta web.' ); }

	$posts   = get_posts( array( 'post_type' => 'courses', 'post_status' => 'publish', 'numberposts' => -1 ) );
	$courses = array();
	foreach ( $posts as $p ) {
		$product_id  = (int) tutor_utils()->get_course_product_id( $p->ID );
		$courses[]   = array(
			'course_id'     => (int) $p->ID,           // = wpCourseId en el CRM
			'course_title'  => $p->post_title,
			'wc_product_id' => $product_id ? $product_id : null,
		);
	}

	// ── Autodiagnóstico en pantalla (solo lo ve el admin) ──
	header( 'Content-Type: text/plain; charset=utf-8' );
	echo "Sincronizacion NutriLaura -> CRM\n";
	echo "================================\n\n";
	echo '1) Secreto CRM_WEBHOOK_SECRET en wp-config.php: ' . ( nutrilaura_tutorlms_secret() ? "OK (definido)\n" : "FALTA\n" );
	echo "2) TutorLMS activo: OK\n";
	echo '3) Cursos publicados encontrados: ' . count( $courses ) . "\n";
	foreach ( $courses as $c ) { echo '   - [' . $c['course_id'] . '] ' . $c['course_title'] . "\n"; }
	echo '4) Enviando a ' . NUTRILAURA_CRM_BASE . "/api/webhooks/tutorlms/sync-courses ...\n\n";

	$r = nutrilaura_tutorlms_post_full( '/api/webhooks/tutorlms/sync-courses', array( 'courses' => $courses ) );

	if ( $r['ok'] ) {
		echo 'RESULTADO: OK — enviados ' . count( $courses ) . " curso(s) al CRM. Revisa Formacion > Cursos.\n";
		echo 'Respuesta del CRM: ' . $r['body'] . "\n";
	} elseif ( 'sin_secreto' === $r['why'] ) {
		echo "RESULTADO: ERROR — falta el secreto.\n\n";
		echo "QUE HACER (Albert): edita wp-config.php (raiz de WordPress) y, ENCIMA de la linea\n";
		echo "/* That's all, stop editing! */, anade:\n\n";
		echo "    define( 'CRM_WEBHOOK_SECRET', 'PEGA_AQUI_EL_VALOR' );\n\n";
		echo "El VALOR te lo pasa Jorge/Rodrigo por canal seguro (es el mismo que usa el CRM).\n";
		echo "Guarda el fichero y vuelve a abrir esta URL.\n";
	} elseif ( 'wp_error' === $r['why'] ) {
		echo "RESULTADO: ERROR — este WordPress no consigue conectar con el CRM.\n\n";
		echo 'Detalle tecnico: ' . $r['body'] . "\n\n";
		echo "Suele ser el HOSTING bloqueando conexiones salientes (cURL). Que Albert pida al\n";
		echo "hosting permitir conexiones HTTPS salientes a crm.salamandrasolutions.com (puerto 443).\n";
	} elseif ( 401 === $r['code'] ) {
		echo "RESULTADO: ERROR — el CRM rechaza la firma (HTTP 401).\n\n";
		echo "El valor de CRM_WEBHOOK_SECRET en wp-config.php NO coincide con el del CRM.\n";
		echo "Que Albert lo compare (sin espacios ni comillas de mas) con el valor que le paso Jorge.\n";
	} elseif ( 403 === $r['code'] ) {
		echo "RESULTADO: ERROR — el CRM responde 403.\n\nDetalle: " . $r['body'] . "\nQue Jorge revise el modulo de formacion del tenant.\n";
	} else {
		echo 'RESULTADO: ERROR — el CRM respondio HTTP ' . $r['code'] . ".\n\nDetalle: " . $r['body'] . "\nQue Jorge mire los logs del CRM.\n";
	}
	exit;
} );

/**
 * A-ter) Re-envío masivo de MATRÍCULAS ya existentes — para recuperar las que
 *    se perdieron mientras el puente estuvo roto (el aviso automático solo
 *    salta EN EL MOMENTO de matricularse). TutorLMS guarda cada matrícula como
 *    un post 'tutor_enrolled' (post_parent = curso, post_author = alumno).
 *    Es seguro repetirlo: el CRM usa findOrCreate y no duplica nada.
 *    URL:  https://tunutrilaura.com/?nutrilaura_sync_enrollments=1   (solo admin)
 */
add_action( 'init', function () {
	if ( empty( $_GET['nutrilaura_sync_enrollments'] ) ) { return; }

	if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
		status_header( 403 );
		exit( 'No autorizado (hay que estar logueado como administrador).' );
	}
	if ( ! function_exists( 'tutor_utils' ) ) { exit( 'TutorLMS no esta activo en esta web.' ); }

	$enrollments = get_posts( array(
		'post_type'   => 'tutor_enrolled',
		'post_status' => 'completed',
		'numberposts' => -1,
	) );

	header( 'Content-Type: text/plain; charset=utf-8' );
	echo "Re-envio de matriculas NutriLaura -> CRM\n";
	echo "========================================\n\n";
	echo 'Matriculas encontradas en TutorLMS: ' . count( $enrollments ) . "\n\n";

	$ok = 0;
	$ko = 0;
	foreach ( $enrollments as $e ) {
		$user = get_userdata( (int) $e->post_author );
		if ( ! $user ) { $ko++; echo "  ERR matricula #{$e->ID}: el alumno ya no existe en WordPress\n"; continue; }
		$course_id = (int) $e->post_parent;

		$r = nutrilaura_tutorlms_post_full( '/api/webhooks/tutorlms/enrollment', array(
			'user_email'   => strtolower( $user->user_email ),
			'display_name' => $user->display_name,
			'user_id'      => (int) $e->post_author,
			'course_id'    => $course_id,
			'course_title' => get_the_title( $course_id ),
			'enrolled_at'  => mysql2date( 'c', $e->post_date_gmt, false ),
		) );

		if ( $r['ok'] ) {
			$ok++;
			echo '  OK  ' . $user->user_email . ' -> [' . $course_id . '] ' . get_the_title( $course_id ) . "\n";
		} else {
			$ko++;
			echo '  ERR ' . $user->user_email . ' -> ' . ( 'http' === $r['why'] ? 'HTTP ' . $r['code'] . ' ' . $r['body'] : $r['body'] ) . "\n";
			if ( 'sin_secreto' === $r['why'] ) {
				echo "\n  Falta CRM_WEBHOOK_SECRET en wp-config.php — arregla eso primero\n";
				echo "  (abre ?nutrilaura_sync_courses=1 para ver las instrucciones) y vuelve.\n";
				break;
			}
		}
	}
	echo "\nRESULTADO: {$ok} enviadas, {$ko} con error. Revisa Formacion > Alumnos en el CRM.\n";
	exit;
} );

/**
 * B) Matrículas automáticas. TutorLMS dispara 'tutor_after_enrolled' cuando un
 *    alumno queda matriculado (curso gratis o tras completarse el pago Woo).
 */
add_action( 'tutor_after_enrolled', function ( $course_id, $user_id ) {
	$user = get_userdata( $user_id );
	if ( ! $user ) { return; }

	nutrilaura_tutorlms_post( '/api/webhooks/tutorlms/enrollment', array(
		'user_email'   => strtolower( $user->user_email ),
		'display_name' => $user->display_name,
		'user_id'      => (int) $user_id,
		'course_id'    => (int) $course_id,  // = wpCourseId; si el curso no existia en el CRM, se crea
		'course_title' => get_the_title( $course_id ),
		'enrolled_at'  => current_time( 'c' ),
	) );
}, 10, 2 );
