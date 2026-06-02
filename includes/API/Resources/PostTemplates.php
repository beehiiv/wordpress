<?php
/**
 * Beehiiv API: Post templates resource.
 *
 * @package beehiiv
 */

namespace Beehiiv\API\Resources;

use Beehiiv\API\Client;

defined( 'ABSPATH' ) || exit;

/**
 * Post templates endpoints (email templates).
 *
 * @since 1.0.0
 */
final class PostTemplates {

	/**
	 * Retrieve post templates available for a publication.
	 *
	 * @param string $publication_id Publication ID.
	 * @return array<int, array{id: string, name: string}>
	 * @since 1.0.0
	 */
	public static function get_post_templates( string $publication_id ): array {
		$publication_id = trim( $publication_id );

		if ( '' === $publication_id ) {
			return [];
		}

		$path     = sprintf( '/publications/%s/post_templates', rawurlencode( $publication_id ) );
		$response = Client::request(
			$path,
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
