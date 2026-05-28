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
	 * REST API namespace (appended to `/wp-json/`).
	 *
	 * @since 1.0.0
	 */
	public const REST_NAMESPACE = 'beehiiv/v1';

	/**
	 * Beehiiv sign-up URL for users without an account.
	 *
	 * @since 1.0.0
	 */
	public const SIGNUP_URL = 'https://www.beehiiv.com/';

	/**
	 * Absolute path to admin view templates.
	 *
	 * @since 1.0.0
	 */
	public const ADMIN_VIEWS_DIR = BEEHIIV_PLUGIN_DIR . 'includes/Admin/Views/';
}
