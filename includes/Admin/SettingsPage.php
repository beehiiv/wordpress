<?php
/**
 * Beehiiv settings screen (Settings API + view).
 *
 * @package beehiiv
 */

namespace Beehiiv\Admin;

use Beehiiv\Config;

defined( 'ABSPATH' ) || exit;

/**
 * Registers settings for the admin page and renders the settings screen.
 */
final class SettingsPage {

	/**
	 * Register Settings API option and fields for this page.
	 */
	public static function init(): void {
		Registrar::register();
	}

	/**
	 * Render the settings screen (linked from the admin menu).
	 */
	public static function render(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		require Config::ADMIN_VIEWS_DIR . 'settings-page.php';
	}
}
