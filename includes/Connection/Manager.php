<?php
/**
 * Beehiiv connection UI helpers (OAuth flow added later).
 *
 * @package beehiiv
 */

namespace Beehiiv\Connection;

use Beehiiv\Config;

defined( 'ABSPATH' ) || exit;

/**
 * Connection card helpers for the settings screen.
 *
 * @since 1.0.0
 */
final class Manager {

	/**
	 * Whether the site is connected via OAuth.
	 *
	 * @since 1.0.0
	 */
	public static function is_connected(): bool {
		return false;
	}

	/**
	 * Human-readable connection status for the settings UI.
	 *
	 * @since 1.0.0
	 */
	public static function get_status_label(): string {
		if ( self::is_connected() ) {
			return __( 'Connected', 'beehiiv' );
		}

		return __( 'Not connected', 'beehiiv' );
	}

	/**
	 * URL for users without a Beehiiv account.
	 *
	 * @since 1.0.0
	 */
	public static function get_signup_url(): string {
		return Config::SIGNUP_URL;
	}
}
