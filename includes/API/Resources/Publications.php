<?php
/**
 * Beehiiv API: Publications resource.
 *
 * @package beehiiv
 */

namespace Beehiiv\API\Resources;

use Beehiiv\API\Client;
use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * Publications endpoints.
 *
 * @since 1.0.0
 */
final class Publications {

	/**
	 * Cache TTL (seconds) for publications list.
	 *
	 * @since 1.0.0
	 */
	private const CACHE_TTL = 300;

	/**
	 * Retrieve publications available for the configured API key.
	 *
	 * @return array<int, array{id: string, name: string}>|\WP_Error
	 * @since 1.0.0
	 */
	public static function list() {
		$cache_key = 'beehiiv_publications_v2';
		$cached    = get_transient( $cache_key );

		if ( is_array( $cached ) ) {
			return $cached;
		}

		$response = Client::request(
			'/publications',
			[
				'limit' => 100,
				'page'  => 1,
			]
		);
		if ( is_wp_error( $response ) ) {
			return $response;
		}

		$data = isset( $response['data'] ) && is_array( $response['data'] ) ? $response['data'] : [];
		$out  = [];

		foreach ( $data as $row ) {
			if ( ! is_array( $row ) ) {
				continue;
			}

			$id   = isset( $row['id'] ) ? (string) $row['id'] : '';
			$name = isset( $row['name'] ) ? (string) $row['name'] : '';

			if ( '' === $id ) {
				continue;
			}

			$out[] = [
				'id'   => $id,
				'name' => '' !== $name ? $name : $id,
			];
		}

		set_transient( $cache_key, $out, self::CACHE_TTL );

		return $out;
	}
}
