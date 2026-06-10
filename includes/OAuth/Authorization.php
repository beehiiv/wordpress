<?php
/**
 * OAuth authorization redirect and PKCE state storage.
 *
 * @package beehiiv
 */

namespace Beehiiv\OAuth;

use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * Builds authorize URLs and validates callback state.
 *
 * @since 1.0.0
 */
final class Authorization {

	/**
	 * Transient key prefix for PKCE verifier.
	 *
	 * @since 1.0.0
	 */
	private const VERIFIER_TRANSIENT_PREFIX = 'beehiiv_oauth_verifier_';

	/**
	 * Transient key prefix for CSRF state.
	 *
	 * @since 1.0.0
	 */
	private const STATE_TRANSIENT_PREFIX = 'beehiiv_oauth_state_';

	/**
	 * Begin OAuth authorization and return the redirect URL.
	 *
	 * @since 1.0.0
	 *
	 * @return string|WP_Error
	 */
	public static function get_authorize_url(): string|WP_Error {

		$client_id = TokenStore::get_client_id();

		if ( '' === $client_id ) {
			$registered = ClientRegistrar::register();

			if ( is_wp_error( $registered ) ) {
				return $registered;
			}

			$client_id = $registered;
		}

		$pkce    = Pkce::generate();
		$state   = wp_generate_password( 32, false, false );
		$user_id = get_current_user_id();

		set_transient(
			self::VERIFIER_TRANSIENT_PREFIX . $user_id,
			$pkce['code_verifier'],
			Config::PKCE_TRANSIENT_TTL
		);
		set_transient(
			self::STATE_TRANSIENT_PREFIX . $user_id,
			$state,
			Config::PKCE_TRANSIENT_TTL
		);

		$params = [
			'client_id'             => $client_id,
			'redirect_uri'          => Config::get_redirect_uri(),
			'response_type'         => 'code',
			'scope'                 => Config::SCOPES,
			'state'                 => $state,
			'code_challenge'        => $pkce['code_challenge'],
			'code_challenge_method' => 'S256',
		];

		$base = trailingslashit( Config::get_oauth_base_url() ) . 'oauth/authorize';

		return $base . '?' . http_build_query( $params, '', '&', PHP_QUERY_RFC3986 );
	}

	/**
	 * Validate callback state for the current user.
	 *
	 * @since 1.0.0
	 *
	 * @param string $state State query parameter.
	 *
	 * @return bool
	 */
	public static function validate_state( string $state ): bool {

		$state = trim( $state );

		if ( '' === $state ) {
			return false;
		}

		$user_id      = get_current_user_id();
		$stored_state = get_transient( self::STATE_TRANSIENT_PREFIX . $user_id );

		return is_string( $stored_state ) && hash_equals( $stored_state, $state );
	}

	/**
	 * Retrieve and clear the stored PKCE verifier for the current user.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	public static function consume_code_verifier(): string {

		$user_id  = get_current_user_id();
		$key      = self::VERIFIER_TRANSIENT_PREFIX . $user_id;
		$verifier = get_transient( $key );

		delete_transient( $key );
		delete_transient( self::STATE_TRANSIENT_PREFIX . $user_id );

		return is_string( $verifier ) ? $verifier : '';
	}
}
