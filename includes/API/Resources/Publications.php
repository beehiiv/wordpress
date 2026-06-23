<?php
/**
 * beehiiv API: Publications resource.
 *
 * @package beehiiv
 */

namespace Beehiiv\API\Resources;

use Beehiiv\API\Cache;
use Beehiiv\API\Client;

defined( 'ABSPATH' ) || exit;

/**
 * Publications endpoints.
 *
 * @since 1.0.0
 */
final class Publications {

	/**
	 * Retrieve publications available for the connected account.
	 *
	 * @since 1.0.0
	 *
	 * @return array<int, array{id: string, name: string}>
	 */
	public static function get_publications(): array {

		$cached = Cache::get_publications();

		if ( null !== $cached ) {
			return $cached;
		}

		$response = Client::request(
			'/publications',
			[
				'limit' => 100,
				'page'  => 1,
			]
		);

		$items = self::normalize_list( $response );

		if ( ! empty( $items ) || 200 === Client::get_last_status_code() ) {
			Cache::set_publications( $items );
		}

		return $items;
	}

	/**
	 * Normalize publication list response data.
	 *
	 * @since 1.0.0
	 *
	 * @param array<string,mixed> $response API response.
	 *
	 * @return array<int, array{id: string, name: string}>
	 */
	private static function normalize_list( array $response ): array {

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

		return $out;
	}
}
