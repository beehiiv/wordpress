<?php
/**
 * Top-level plugin bootstrap.
 *
 * @package beehiiv
 */

namespace Beehiiv;

defined( 'ABSPATH' ) || exit;

/**
 * Wires up the plugin's feature modules.
 *
 * @since 1.0.0
 */
final class Plugin {

	/**
	 * Register core hooks and bootstrap feature modules.
	 *
	 * Runs on `plugins_loaded` from the main plugin file.
	 *
	 * @since 1.0.0
	 */
	public static function init(): void {
		Frontend\Assets::init();
		Admin\Assets::init();
		add_action( 'init', [ Blocks\Registry::class, 'register_category' ] );
		add_action( 'init', [ Blocks\Registry::class, 'register_blocks' ] );
		add_action( 'init', [ Editor\PostSettings::class, 'register_meta' ] );
		add_action( 'enqueue_block_editor_assets', [ Editor\PostSettings::class, 'enqueue_assets' ] );
		add_action( 'admin_menu', [ Admin\Menu::class, 'register' ] );
		add_action( 'admin_init', [ self::class, 'bootstrap_admin_features' ] );
	}

	/**
	 * Initializes admin feature hooks during `admin_init`.
	 *
	 * @since 1.0.0
	 */
	public static function bootstrap_admin_features(): void {
		Admin\SettingsPage::init();
	}
}
