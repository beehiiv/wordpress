<?php
/**
 * beehiiv top-level admin menu.
 *
 * @package beehiiv
 */

namespace Beehiiv\Admin;

use Beehiiv\Config;

defined( 'ABSPATH' ) || exit;

/**
 * Adds the beehiiv item to the wp-admin sidebar.
 *
 * @since 1.0.0
 */
final class Menu {

	/**
	 * Register the top-level menu page (hooked from `Plugin::init()` on `admin_menu`).
	 *
	 * Icon is drawn in global admin CSS (`src/js/admin/admin.scss`) via mask so it
	 * follows the same currentColor / hover / active states as Dashicons.
	 *
	 * @since 1.0.0
	 */
	public static function register(): void {
		add_menu_page(
			__( 'beehiiv Settings', 'beehiiv' ),
			__( 'beehiiv', 'beehiiv' ),
			'manage_options',
			Config::PLUGIN_SLUG,
			[ SettingsPage::class, 'render' ],
			'none',
			99
		);
	}
}
