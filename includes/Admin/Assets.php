<?php
/**
 * WordPress admin asset registration.
 *
 * @package beehiiv
 */

namespace Beehiiv\Admin;

use Beehiiv\Config;

defined( 'ABSPATH' ) || exit;

/**
 * Enqueues compiled scripts and styles in wp-admin.
 *
 * @since 1.0.0
 */
final class Assets {

	/**
	 * Style handle for global wp-admin styles (`build/admin.css`).
	 */
	private const HANDLE_ADMIN = 'beehiiv-admin';

	/**
	 * Style handle for the settings page (`build/admin-settings.css`).
	 */
	private const HANDLE_ADMIN_SETTINGS = 'beehiiv-admin-settings';

	/**
	 * Webpack entry name for global admin styles.
	 */
	private const BUILD_ENTRY_ADMIN = 'admin';

	/**
	 * Webpack entry name for the settings page styles.
	 */
	private const BUILD_ENTRY_SETTINGS = 'admin-settings';

	/**
	 * Hook asset registration.
	 *
	 * @since 1.0.0
	 */
	public static function init(): void {
		add_action( 'admin_enqueue_scripts', [ self::class, 'enqueue_admin_scripts' ] );
	}

	/**
	 * Enqueue wp-admin scripts and styles (global and screen-specific).
	 *
	 * @param string $hook_suffix Current admin page hook suffix.
	 * @since 1.0.0
	 */
	public static function enqueue_admin_scripts( string $hook_suffix ): void {
		self::enqueue_build_style( self::HANDLE_ADMIN, self::BUILD_ENTRY_ADMIN );

		if ( 'toplevel_page_' . Config::PLUGIN_SLUG !== $hook_suffix ) {
			return;
		}

		self::enqueue_build_style( self::HANDLE_ADMIN_SETTINGS, self::BUILD_ENTRY_SETTINGS );
	}

	/**
	 * Enqueue a compiled stylesheet from the build directory.
	 *
	 * @param string $handle      Style handle.
	 * @param string $build_entry Webpack entry name (without extension).
	 * @since 1.0.0
	 */
	private static function enqueue_build_style( string $handle, string $build_entry ): void {
		$asset_path = BEEHIIV_BUILD_DIR . $build_entry . '.asset.php';
		$style_path = BEEHIIV_BUILD_DIR . $build_entry . '.css';

		if ( ! file_exists( $asset_path ) || ! file_exists( $style_path ) ) {
			return;
		}

		$asset = require $asset_path;

		wp_enqueue_style(
			$handle,
			BEEHIIV_BUILD_URL . $build_entry . '.css',
			[],
			$asset['version']
		);
	}
}
