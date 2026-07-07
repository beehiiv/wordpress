<?php
/**
 * Plugin Name: beehiiv
 * Description: Official beehiiv WordPress plugin. Publish WordPress posts as newsletters and grow your audience with beehiiv.
 * Version: 1.0.0
 * Author: beehiiv
 * Text Domain: beehiiv
 * Domain Path: /languages
 * Requires at least: 6.5
 * Requires PHP: 7.4
 *
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 *
 * @package beehiiv
 */

defined( 'ABSPATH' ) || exit;

if ( ! defined( 'BEEHIIV_VERSION' ) ) {
	define( 'BEEHIIV_VERSION', '1.0.0' );
}

if ( ! defined( 'BEEHIIV_PLUGIN_FILE' ) ) {
	define( 'BEEHIIV_PLUGIN_FILE', __FILE__ );
}

if ( ! defined( 'BEEHIIV_PLUGIN_DIR' ) ) {
	define( 'BEEHIIV_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );
}

if ( ! defined( 'BEEHIIV_PLUGIN_URL' ) ) {
	define( 'BEEHIIV_PLUGIN_URL', plugin_dir_url( __FILE__ ) );
}

if ( ! defined( 'BEEHIIV_BUILD_DIR' ) ) {
	define( 'BEEHIIV_BUILD_DIR', BEEHIIV_PLUGIN_DIR . 'build/' );
}

if ( ! defined( 'BEEHIIV_BUILD_URL' ) ) {
	define( 'BEEHIIV_BUILD_URL', BEEHIIV_PLUGIN_URL . 'build/' );
}

require_once BEEHIIV_PLUGIN_DIR . 'vendor/autoload.php';

/**
 * Initialize the plugin.
 */
add_action(
	'plugins_loaded',
	static function () {
		if ( ! class_exists( \Beehiiv\Plugin::class ) ) {
			return;
		}
		\Beehiiv\Plugin::init();
	}
);
