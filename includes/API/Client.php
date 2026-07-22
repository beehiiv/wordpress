<?php
/**
 * Minimal beehiiv API client (server-side only).
 *
 * @package beehiiv
 */

namespace Beehiiv\API;

use Beehiiv\Connection\Manager;
use Beehiiv\OAuth\Config as OAuthConfig;
use Beehiiv\OAuth\TokenRefresher;

defined( 'ABSPATH' ) || exit;

/**
 * Wraps authenticated beehiiv v2 API requests.
 *
 * @since 1.0.0
 */
final class Client {

	/**
	 * HTTP status code from the most recent request.
	 *
	 * @var int|null
	 */
	private static $last_status_code = null;

	/**
	 * WP_Error message from the most recent request, if any.
	 *
	 * @var string|null
	 */
	private static $last_wp_error = null;

	/**
	 * Whether a 401 retry is allowed for the current outer request.
	 *
	 * @var bool
	 */
	private static $allow_retry = true;

	/**
	 * HTTP timeout in seconds for beehiiv API requests.
	 *
	 * @since 1.0.0
	 */
	private const REQUEST_TIMEOUT = 30;

	/**
	 * Make an authenticated GET request to beehiiv v2.
	 *
	 * @param string              $path Relative API path (e.g. `/publications`).
	 * @param array<string,mixed> $query Query parameters.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function request( string $path, array $query = [] ): array {
		return self::send( 'GET', $path, $query, null );
	}

	/**
	 * HTTP status code from the most recent request.
	 *
	 * @return int|null
	 * @since 1.0.0
	 */
	public static function get_last_status_code(): ?int {
		return self::$last_status_code;
	}

	/**
	 * Transport error from the most recent request.
	 *
	 * @return string|null
	 * @since 1.0.0
	 */
	public static function get_last_wp_error(): ?string {
		return self::$last_wp_error;
	}

	/**
	 * Make an authenticated POST request with a JSON body.
	 *
	 * @param string              $path Relative API path.
	 * @param array<string,mixed> $body Request body (JSON-encoded).
	 * @param array<string,mixed> $query Optional query parameters.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function post( string $path, array $body, array $query = [] ): array {
		return self::send( 'POST', $path, $query, $body );
	}

	/**
	 * Make an authenticated DELETE request.
	 *
	 * @param string              $path  Relative API path.
	 * @param array<string,mixed> $query Optional query parameters.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function delete( string $path, array $query = [] ): array {
		return self::send( 'DELETE', $path, $query, null );
	}

	/**
	 * Make an authenticated PATCH request with a JSON body.
	 *
	 * @param string              $path  Relative API path.
	 * @param array<string,mixed> $body  Request body (JSON-encoded).
	 * @param array<string,mixed> $query Optional query parameters.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function patch( string $path, array $body, array $query = [] ): array {
		return self::send( 'PATCH', $path, $query, $body );
	}

	/**
	 * Shared HTTP transport for beehiiv v2 requests.
	 *
	 * @param string                   $method HTTP method.
	 * @param string                   $path   Relative API path.
	 * @param array<string,mixed>      $query  Query parameters.
	 * @param array<string,mixed>|null $body   JSON body for POST and PATCH; null for GET and DELETE.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	private static function send( string $method, string $path, array $query, ?array $body ): array {

		$access_token = Manager::get_access_token();
		$url          = OAuthConfig::get_api_base_url() . $path;

		if ( ! empty( $query ) ) {
			$url = add_query_arg( $query, $url );
		}

		$args = [
			'method'    => $method,
			'timeout'   => self::REQUEST_TIMEOUT,
			'sslverify' => OAuthConfig::should_verify_ssl(),
			'headers'   => [
				'Authorization' => 'Bearer ' . $access_token,
				'Accept'        => 'application/json',
			],
		];

		if ( null !== $body ) {
			$args['headers']['Content-Type'] = 'application/json';
			$args['body']                    = wp_json_encode( $body );
		}

		$res = wp_remote_request( $url, $args );

		self::$last_status_code = is_wp_error( $res ) ? null : (int) wp_remote_retrieve_response_code( $res );
		self::$last_wp_error    = is_wp_error( $res ) ? $res->get_error_message() : null;

		$raw  = is_wp_error( $res ) ? '' : (string) wp_remote_retrieve_body( $res );
		$json = json_decode( $raw, true );

		if ( 401 === self::$last_status_code && self::$allow_retry ) {
			self::$allow_retry = false;
			$refreshed         = TokenRefresher::refresh();

			if ( ! is_wp_error( $refreshed ) ) {
				return self::send( $method, $path, $query, $body );
			}
		}

		self::$allow_retry = true;

		return is_array( $json ) ? $json : [];
	}
}
