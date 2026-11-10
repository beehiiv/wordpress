<?php
/**
 * Beehiiv top-level admin menu.
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
	 * The top-level entry is open to anyone who can publish posts so authors can
	 * reach Newsletters. The Settings page is registered first as its own
	 * `manage_options` submenu under the same slug, so it stays administrator-only.
	 * This runs on `admin_menu` priority 5, before core adds the Newsletters
	 * submenu (priority 10), so Settings is first and the parent already exists.
	 *
	 * @since 1.0.0
	 */
	public static function register(): void {
		add_menu_page(
			__( 'beehiiv Settings', 'beehiiv' ),
			__( 'beehiiv', 'beehiiv' ),
			'publish_posts',
			Config::PLUGIN_SLUG,
			[ SettingsPage::class, 'render' ],
			'none',
			99
		);

		// Registered before any other submenu so it replaces the automatic first
		// submenu item, which would otherwise inherit the lower top-level capability.
		add_submenu_page(
			Config::PLUGIN_SLUG,
			__( 'beehiiv Settings', 'beehiiv' ),
			__( 'Settings', 'beehiiv' ),
			'manage_options',
			Config::PLUGIN_SLUG,
			[ SettingsPage::class, 'render' ]
		);
	}

	/**
	 * Keep the top-level entry from landing non-administrators on Settings.
	 *
	 * Core skips the Settings submenu for users without `manage_options`, then adds
	 * an automatic first item that points at the top-level slug (the Settings page).
	 * That item is dropped so the top-level entry opens the first remaining submenu,
	 * Newsletters. Users who cannot publish posts get no beehiiv menu at all, because
	 * the top-level capability would deny them the Newsletters page anyway.
	 *
	 * Runs on `admin_menu` after core adds the post type submenus (priority 10).
	 *
	 * @since x.x.x
	 */
	public static function prune_for_non_administrators(): void {
		global $submenu;

		if ( current_user_can( 'manage_options' ) ) {
			return;
		}

		if ( ! current_user_can( 'publish_posts' ) ) {
			remove_menu_page( Config::PLUGIN_SLUG );
			return;
		}

		if ( empty( $submenu[ Config::PLUGIN_SLUG ] ) || ! is_array( $submenu[ Config::PLUGIN_SLUG ] ) ) {
			return;
		}

		foreach ( $submenu[ Config::PLUGIN_SLUG ] as $index => $item ) {
			if ( Config::PLUGIN_SLUG === $item[2] ) {
				unset( $submenu[ Config::PLUGIN_SLUG ][ $index ] );
			}
		}
	}
}
