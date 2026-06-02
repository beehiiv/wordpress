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
	 * `wp-config.php` constant name for the Beehiiv API key.
	 *
	 * @since 1.0.0
	 */
	private const API_KEY_CONST = 'BEEHIIV_API_KEY';

	/**
	 * Whether the site can call the Beehiiv API.
	 *
	 * @since 1.0.0
	 */
	public static function is_connected(): bool {
		if ( '' !== self::get_api_key() ) {
			return true;
		}

		$settings = Options::get();

		return ! empty( $settings['oauth_connected'] );
	}

	/**
	 * API key for Beehiiv API requests.
	 *
	 * Hardcoded temporarily until OAuth is implemented.
	 *
	 * @return string
	 * @since 1.0.0
	 */
	public static function get_api_key(): string {
		$api_key = '';

		if ( defined( self::API_KEY_CONST ) ) {
			// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedConstantFound -- Consumed from wp-config.php.
			$api_key = (string) constant( self::API_KEY_CONST );
		} elseif ( function_exists( 'getenv' ) ) {
			$env_key = getenv( self::API_KEY_CONST );
			if ( is_string( $env_key ) ) {
				$api_key = $env_key;
			}
		}

		return trim( $api_key );
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
