<?php
/**
 * Minimal Beehiiv API client (server-side only).
 *
 * @package beehiiv
 */

namespace Beehiiv\API;

use Beehiiv\Connection\Manager;
use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * Wraps authenticated Beehiiv v2 API requests used by wp-admin settings.
 *
 * @since 1.0.0
 */
final class Client {

	/**
	 * Base URL for Beehiiv public API.
	 *
	 * @since 1.0.0
	 */
	private const API_BASE = 'https://api.beehiiv.com/v2';

	/**
	 * Back-compat wrapper: use Resources\Publications instead.
	 *
	 * @return array<int, array{id: string, name: string}>|\WP_Error
	 * @since 1.0.0
	 */
	public static function get_publications() {
		return \Beehiiv\API\Resources\Publications::list();
	}

	/**
	 * Back-compat wrapper: use Resources\PostTemplates instead.
	 *
	 * @param string $publication_id Publication ID.
	 * @return array<int, array{id: string, name: string}>|\WP_Error
	 * @since 1.0.0
	 */
	public static function get_post_templates( string $publication_id ) {
		return \Beehiiv\API\Resources\PostTemplates::list( $publication_id );
	}

	/**
	 * Make an authenticated request to Beehiiv v2.
	 *
	 * @param string              $path Relative API path (e.g. `/publications`).
	 * @param array<string,mixed> $query Query parameters.
	 * @return array<string,mixed>|\WP_Error
	 * @since 1.0.0
	 */
	public static function request( string $path, array $query = [] ) {
		$api_key = Manager::get_api_key();
		if ( '' === $api_key ) {
			return Errors::missing_api_key();
		}

		$url = self::API_BASE . $path;
		if ( ! empty( $query ) ) {
			$url = add_query_arg( $query, $url );
		}

		$res = wp_remote_get(
			$url,
			[
				'timeout' => 15,
				'headers' => [
					'Authorization' => 'Bearer ' . $api_key,
					'Accept'        => 'application/json',
				],
			]
		);

		if ( is_wp_error( $res ) ) {
			return $res;
		}

		$code = (int) wp_remote_retrieve_response_code( $res );
		$body = (string) wp_remote_retrieve_body( $res );

		$json = json_decode( $body, true );
		if ( ! is_array( $json ) ) {
			return Errors::invalid_json();
		}

		if ( $code < 200 || $code >= 300 ) {
			return Errors::api_error( $code, $json );
		}

		return $json;
	}
}
