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
 */
final class Config {

	/**
	 * Admin menu page slug.
	 */
	public const PLUGIN_SLUG = 'beehiiv';

	/**
	 * WordPress option name for plugin settings.
	 */
	public const OPTION_NAME = 'beehiiv_settings';

	/**
	 * Settings API option group.
	 */
	public const SETTINGS_GROUP = 'beehiiv_settings';

	/**
	 * REST API namespace (appended to `/wp-json/`).
	 */
	public const REST_NAMESPACE = 'beehiiv/v1';

	/**
	 * Beehiiv sign-up URL for users without an account.
	 */
	public const SIGNUP_URL = 'https://www.beehiiv.com/';

	/**
	 * Absolute path to admin view templates.
	 */
	public const ADMIN_VIEWS_DIR = BEEHIIV_PLUGIN_DIR . 'includes/Admin/Views/';
}
