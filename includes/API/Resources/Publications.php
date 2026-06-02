<?php
/**
 * Beehiiv API: Publications resource.
 *
 * @package beehiiv
 */

namespace Beehiiv\API\Resources;

use Beehiiv\API\Client;

defined( 'ABSPATH' ) || exit;

/**
 * Publications endpoints.
 *
 * @since 1.0.0
 */
final class Publications {

	/**
	 * Retrieve publications available for the configured API key.
	 *
	 * @return array<int, array{id: string, name: string}>
	 * @since 1.0.0
	 */
	public static function get_publications(): array {
		$response = Client::request(
			'/publications',
			[
				'limit' => 100,
				'page'  => 1,
			]
		);

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
