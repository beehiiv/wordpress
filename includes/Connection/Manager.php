<?php
/**
 * Beehiiv connection UI helpers (OAuth flow added later).
 *
 * @package beehiiv
 */

namespace Beehiiv\Connection;

use Beehiiv\Admin\Options;
use Beehiiv\Config;

defined( 'ABSPATH' ) || exit;

/**
 * Connection card helpers for the settings screen.
 *
 * @since 1.0.0
 */
final class Manager {

	/**
	 * Whether the site can call the Beehiiv API.
	 *
	 * @since 1.0.0
	 */
	public static function is_connected(): bool {
		// Temporary until OAuth. Paste your Beehiiv API key here.
		$api_key = 'N2hMYn6zDVuNt1ec8byKeUdiytm2smGik1RXUqKaE6zG3R5A14C5dxBVJ1tRbV94';

		if ( '' !== $api_key ) {
			return true;
		}

		$settings = Options::get();

		return ! empty( $settings['oauth_connected'] );
	}

	/**
	 * Whether the connection card should show the OAuth connect flow.
	 *
	 * @since 1.0.0
	 */
	public static function uses_oauth_connection(): bool {
		return ! self::is_connected();
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
