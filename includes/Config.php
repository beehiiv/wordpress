<?php
/**
 * Plugin-wide configuration constants.
 *
 * @package beehiiv
 */

namespace Beehiiv;

defined( 'ABSPATH' ) || exit;

/**
 * Centralizes shared configuration values for consistency across the plugin.
 *
 * @since 1.0.0
 */
final class Config {

	/**
	 * Admin menu page slug.
	 *
	 * @since 1.0.0
	 */
	public const PLUGIN_SLUG = 'beehiiv';

	/**
	 * WordPress option name for plugin settings.
	 *
	 * @since 1.0.0
	 */
	public const OPTION_NAME = 'beehiiv_settings';

	/**
	 * Settings API option group.
	 *
	 * @since 1.0.0
	 */
	public const SETTINGS_GROUP = 'beehiiv_settings';

	/**
	 * Beehiiv sign-up URL for users without an account.
	 *
	 * @since 1.0.0
	 */
	public const SIGNUP_URL = 'https://www.beehiiv.com/';

	/**
	 * Beehiiv web app URL (post editor, account dashboard).
	 *
	 * @since 1.0.0
	 */
	public const APP_URL = 'https://app.beehiiv.com';

	/**
	 * Plugin documentation on WordPress.org.
	 *
	 * @since 1.0.0
	 */
	public const PLUGIN_DOC_URL = 'https://wordpress.org/plugins/beehiiv/';

	/**
	 * Absolute path to admin view templates.
	 *
	 * @since 1.0.0
	 */
	public const ADMIN_VIEWS_DIR = BEEHIIV_PLUGIN_DIR . 'includes/Admin/Views/';
}
