<?php
/**
 * PHPUnit bootstrap for the beehiiv plugin.
 *
 * @package beehiiv
 */

$_tests_dir = getenv( 'WP_TESTS_DIR' );
if ( ! $_tests_dir ) {
	$_tests_dir = '/tmp/wordpress-tests-lib';
}

define( 'WP_TESTS_PHPUNIT_POLYFILLS_PATH', dirname( __DIR__, 2 ) . '/vendor/yoast/phpunit-polyfills' );

require_once $_tests_dir . '/includes/functions.php';

/**
 * Manually load the plugin under test.
 */
function _beehiiv_manually_load_plugin() {
	require dirname( __DIR__, 2 ) . '/beehiiv.php';
}
tests_add_filter( 'muplugins_loaded', '_beehiiv_manually_load_plugin' );

require $_tests_dir . '/includes/bootstrap.php';
