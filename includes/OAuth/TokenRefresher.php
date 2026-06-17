<?php
/**
 * OAuth access token refresh.
 *
 * @package beehiiv
 */

namespace Beehiiv\OAuth;

use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * Refreshes access tokens before expiry or after API 401.
 *
 * @since 1.0.0
 */
final class TokenRefresher {

	/**
	 * Whether a token refresh is in progress (prevents recursion).
	 *
	 * @var bool
	 */
	private static $refreshing = false;

	/**
	 * Return a valid access token, refreshing when needed.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function get_valid_access_token(): string {

		$access_token = TokenStore::get_access_token();

		if ( '' === $access_token ) {
			return '';
		}

		$expires_at = TokenStore::get_expires_at();

		if ( $expires_at > 0 && ( $expires_at - time() ) < Config::REFRESH_BUFFER_SECONDS ) {
			$refreshed = self::refresh();

			if ( is_wp_error( $refreshed ) ) {
				return $access_token;
			}

			return TokenStore::get_access_token();
		}

		return $access_token;
	}

	/**
	 * Refresh the stored access token.
	 *
	 * @since 1.0.0
	 *
	 * @return bool|WP_Error
	 */
	public static function refresh() {

		if ( self::$refreshing ) {
			return new WP_Error( 'beehiiv_refresh_loop', __( 'Token refresh already in progress.', 'beehiiv' ) );
		}

		$client_id     = TokenStore::get_client_id();
		$refresh_token = TokenStore::get_refresh_token();

		if ( '' === $client_id || '' === $refresh_token ) {
			return new WP_Error( 'beehiiv_refresh_missing', __( 'OAuth refresh credentials are missing.', 'beehiiv' ) );
		}

		self::$refreshing = true;

		$response = HttpClient::post_form(
			'/oauth/token',
			[
				'grant_type'    => 'refresh_token',
				'refresh_token' => $refresh_token,
				'client_id'     => $client_id,
			]
		);

		self::$refreshing = false;

		if ( null !== $response['error'] ) {
			return new WP_Error(
				'beehiiv_refresh_transport',
				__( 'Could not reach Beehiiv to refresh the connection.', 'beehiiv' )
			);
		}

		if ( 200 !== $response['status'] || ! is_array( $response['body'] ) ) {
			return new WP_Error(
				'beehiiv_refresh_failed',
				__( 'Beehiiv rejected the token refresh request.', 'beehiiv' )
			);
		}

		if ( ! TokenStore::save_tokens( $client_id, $response['body'], TokenStore::get_connected_user() ) ) {
			return new WP_Error(
				'beehiiv_refresh_storage',
				__( 'Could not save refreshed Beehiiv credentials.', 'beehiiv' )
			);
		}

		return true;
	}
}
