<?php
/**
 * HTTP transport for beehiiv OAuth endpoints.
 *
 * @package beehiiv
 */

namespace Beehiiv\OAuth;

defined( 'ABSPATH' ) || exit;

/**
 * Server-side requests to app.beehiiv.com OAuth routes.
 *
 * @since 1.0.0
 */
final class HttpClient {

	/**
	 * Request timeout in seconds.
	 *
	 * @since 1.0.0
	 */
	private const REQUEST_TIMEOUT = 30;

	/**
	 * POST JSON to an OAuth endpoint.
	 *
	 * @since 1.0.0
	 *
	 * @param string               $path    Path relative to OAuth base (e.g. `/oauth/register`).
	 * @param array<string,mixed>  $body    JSON body.
	 * @param array<string,string> $headers Extra headers.
	 *
	 * @return array{status: int, body: array<string,mixed>|null, error: string|null}
	 */
	public static function post_json( string $path, array $body, array $headers = [] ): array {

		$url = trailingslashit( Config::get_oauth_base_url() ) . ltrim( $path, '/' );

		$args = [
			'method'    => 'POST',
			'timeout'   => self::REQUEST_TIMEOUT,
			'sslverify' => Config::should_verify_ssl(),
			'headers'   => array_merge(
				[
					'Content-Type' => 'application/json',
					'Accept'       => 'application/json',
				],
				$headers
			),
			'body'      => wp_json_encode( $body ),
		];

		return self::parse_response( wp_remote_request( $url, $args ) );
	}

	/**
	 * POST form-encoded data to an OAuth endpoint.
	 *
	 * @since 1.0.0
	 *
	 * @param string               $path OAuth path.
	 * @param array<string,string> $body Form fields.
	 *
	 * @return array{status: int, body: array<string,mixed>|null, error: string|null}
	 */
	public static function post_form( string $path, array $body ): array {

		$url = trailingslashit( Config::get_oauth_base_url() ) . ltrim( $path, '/' );

		$args = [
			'method'    => 'POST',
			'timeout'   => self::REQUEST_TIMEOUT,
			'sslverify' => Config::should_verify_ssl(),
			'headers'   => [
				'Content-Type' => 'application/x-www-form-urlencoded',
				'Accept'       => 'application/json',
			],
			'body'      => $body,
		];

		return self::parse_response( wp_remote_request( $url, $args ) );
	}

	/**
	 * Parse a wp_remote_request response.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string,mixed>|\WP_Error $response HTTP response.
	 *
	 * @return array{status: int, body: array<string,mixed>|null, error: string|null}
	 */
	private static function parse_response( $response ): array {

		if ( is_wp_error( $response ) ) {
			return [
				'status' => 0,
				'body'   => null,
				'error'  => $response->get_error_message(),
			];
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$raw    = (string) wp_remote_retrieve_body( $response );
		$json   = json_decode( $raw, true );

		return [
			'status' => $status,
			'body'   => is_array( $json ) ? $json : null,
			'error'  => null,
		];
	}
}
