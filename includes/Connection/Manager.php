<?php
/**
 * Beehiiv connection helpers.
 *
 * @package beehiiv
 */

namespace Beehiiv\Connection;

use Beehiiv\OAuth\AdminActions;
use Beehiiv\OAuth\TokenRefresher;
use Beehiiv\OAuth\TokenStore;

defined( 'ABSPATH' ) || exit;

/**
 * Connection state and OAuth action URLs for the settings screen.
 *
 * @since 1.0.0
 */
final class Manager {

	/**
	 * Whether the site can call the Beehiiv API via OAuth.
	 *
	 * @since 1.0.0
	 */
	public static function is_connected(): bool {

		return TokenStore::has_credentials();
	}

	/**
	 * Valid OAuth access token for Beehiiv API requests.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_access_token(): string {

		if ( ! self::is_connected() ) {
			return '';
		}

		return TokenRefresher::get_valid_access_token();
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
	 * Connected Beehiiv account label for the settings UI.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_connected_user_label(): string {

		$user = TokenStore::get_connected_user();

		$first = isset( $user['first_name'] ) ? trim( (string) $user['first_name'] ) : '';
		$last  = isset( $user['last_name'] ) ? trim( (string) $user['last_name'] ) : '';
		$email = isset( $user['email'] ) ? trim( (string) $user['email'] ) : '';

		$name = trim( $first . ' ' . $last );

		if ( '' !== $name && '' !== $email ) {
			return sprintf(
				/* translators: 1: user name, 2: email address */
				__( '%1$s (%2$s)', 'beehiiv' ),
				$name,
				$email
			);
		}

		if ( '' !== $email ) {
			return $email;
		}

		if ( '' !== $name ) {
			return $name;
		}

		return '';
	}

	/**
	 * URL to start the OAuth connect flow.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_connect_url(): string {

		return wp_nonce_url(
			admin_url( 'admin-post.php?action=' . AdminActions::ACTION_CONNECT ),
			'beehiiv_oauth_action'
		);
	}

	/**
	 * URL to disconnect the Beehiiv account.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_disconnect_url(): string {

		return wp_nonce_url(
			admin_url( 'admin-post.php?action=' . AdminActions::ACTION_DISCONNECT ),
			'beehiiv_oauth_action'
		);
	}

	/**
	 * URL for users without a Beehiiv account.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_signup_url(): string {

		return \Beehiiv\Config::SIGNUP_URL;
	}
}
