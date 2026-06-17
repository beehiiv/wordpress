<?php
/**
 * Beehiiv API: Post templates resource.
 *
 * @package beehiiv
 */

namespace Beehiiv\API\Resources;

use Beehiiv\API\Cache;
use Beehiiv\API\Client;

defined( 'ABSPATH' ) || exit;

/**
 * Post templates endpoints.
 *
 * @since 1.0.0
 */
final class PostTemplates {

	/**
	 * Retrieve post templates available for a publication.
	 *
	 * @since 1.0.0
	 *
	 * @param string $publication_id Publication ID.
	 *
	 * @return array<int, array{id: string, name: string}>
	 */
	public static function get_post_templates( string $publication_id ): array {

		$publication_id = trim( $publication_id );

		if ( '' === $publication_id ) {
			return [];
		}

		$cached = Cache::get_post_templates( $publication_id );

		if ( null !== $cached ) {
			return $cached;
		}

		$path     = sprintf( '/publications/%s/post_templates', rawurlencode( $publication_id ) );
		$response = Client::request(
			$path,
			[
				'limit' => 100,
				'page'  => 1,
			]
		);

		$items = self::normalize_list( $response );

		if ( ! empty( $items ) || 200 === Client::get_last_status_code() ) {
			Cache::set_post_templates( $publication_id, $items );
		}

		return $items;
	}

	/**
	 * Normalize template list response data.
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
