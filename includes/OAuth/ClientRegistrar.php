<?php
/**
 * Dynamic OAuth client registration.
 *
 * @package beehiiv
 */

namespace Beehiiv\OAuth;

use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * Registers one OAuth client per WordPress installation.
 *
 * @since 1.0.0
 */
final class ClientRegistrar {

	/**
	 * Register an OAuth client when none is stored yet.
	 *
	 * @since 1.0.0
	 *
	 * @return string|WP_Error Client ID on success.
	 */
	public static function register() {

		$existing = TokenStore::get_client_id();

		if ( '' !== $existing ) {
			return $existing;
		}

		if ( ! Config::has_registration_token() ) {
			return new WP_Error(
				'beehiiv_registration_token_missing',
				__(
					'beehiiv connection is not configured for this plugin build. Contact your site administrator.',
					'beehiiv'
				)
			);
		}

		$response = HttpClient::post_json(
			'/oauth/register',
			[
				'client_name'                => get_bloginfo( 'name' ),
				'redirect_uris'              => [ Config::get_redirect_uri() ],
				'token_endpoint_auth_method' => 'none',
			],
			[
				'Authorization' => 'Bearer ' . Config::get_registration_token(),
			]
		);

		if ( null !== $response['error'] ) {
			return new WP_Error(
				'beehiiv_register_transport',
				__( 'Could not reach beehiiv to register this site. Please try again.', 'beehiiv' )
			);
		}

		if ( 201 !== $response['status'] ) {
			return new WP_Error(
				'beehiiv_register_failed',
				__( 'beehiiv rejected client registration for this site. Please try again.', 'beehiiv' )
			);
		}

		$client_id = isset( $response['body']['client_id'] )
			? trim( (string) $response['body']['client_id'] )
			: '';

		if ( '' === $client_id ) {
			return new WP_Error(
				'beehiiv_register_invalid',
				__( 'beehiiv returned an invalid client registration response.', 'beehiiv' )
			);
		}

		if ( ! TokenStore::save_client_id( $client_id ) ) {
			return new WP_Error(
				'beehiiv_register_storage',
				__( 'Could not save beehiiv client credentials on this site.', 'beehiiv' )
			);
		}

		return $client_id;
	}
}
