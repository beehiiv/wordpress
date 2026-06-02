<?php
/**
 * Beehiiv API error helpers.
 *
 * Centralizes error codes/messages/data so all API resources behave consistently.
 *
 * @package beehiiv
 */

namespace Beehiiv\API;

use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * API error factory.
 *
 * @since 1.0.0
 */
final class Errors {

	/**
	 * Missing API key.
	 *
	 * @since 1.0.0
	 */
	public static function missing_api_key(): WP_Error {
		return new WP_Error(
			'beehiiv_missing_api_key',
			__( 'Beehiiv API key is missing.', 'beehiiv' )
		);
	}

	/**
	 * API response was not valid JSON.
	 *
	 * @since 1.0.0
	 */
	public static function invalid_json(): WP_Error {
		return new WP_Error(
			'beehiiv_invalid_json',
			__( 'Unexpected Beehiiv API response.', 'beehiiv' )
		);
	}

	/**
	 * Non-2xx API response.
	 *
	 * @param int                 $status HTTP status.
	 * @param array<string,mixed> $body   Decoded JSON body.
	 * @since 1.0.0
	 */
	public static function api_error( int $status, array $body ): WP_Error {
		$message = isset( $body['message'] ) ? (string) $body['message'] : '';

		return new WP_Error(
			'beehiiv_api_error',
			'' !== $message ? $message : __( 'Beehiiv API request failed.', 'beehiiv' ),
			[
				'status' => $status,
				'body'   => $body,
			]
		);
	}

	/**
	 * Resource request is missing a publication ID.
	 *
	 * @since 1.0.0
	 */
	public static function missing_publication_id(): WP_Error {
		return new WP_Error(
			'beehiiv_missing_publication_id',
			__( 'Select a publication to load templates.', 'beehiiv' )
		);
	}
}
