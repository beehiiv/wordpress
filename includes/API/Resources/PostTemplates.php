<?php
/**
 * Beehiiv API: Post templates resource.
 *
 * @package beehiiv
 */

namespace Beehiiv\API\Resources;

use Beehiiv\API\Client;
use Beehiiv\API\Errors;
use WP_Error;

defined( 'ABSPATH' ) || exit;

/**
 * Post templates endpoints (email templates).
 *
 * @since 1.0.0
 */
final class PostTemplates {

	/**
	 * Cache TTL (seconds) for post templates list.
	 *
	 * @since 1.0.0
	 */
	private const CACHE_TTL = 300;

	/**
	 * Retrieve post templates available for a publication.
	 *
	 * @param string $publication_id Publication ID.
	 * @return array<int, array{id: string, name: string}>|\WP_Error
	 * @since 1.0.0
	 */
	public static function list( string $publication_id ) {
		$publication_id = trim( $publication_id );
		if ( '' === $publication_id ) {
			return Errors::missing_publication_id();
		}

		$cache_key = 'beehiiv_post_templates_v2_' . md5( $publication_id );
		$cached    = get_transient( $cache_key );

		if ( is_array( $cached ) ) {
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
