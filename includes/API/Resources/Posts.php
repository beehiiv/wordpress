<?php
/**
 * Beehiiv API: Posts resource.
 *
 * @package beehiiv
 */

namespace Beehiiv\API\Resources;

use Beehiiv\API\Client;

defined( 'ABSPATH' ) || exit;

/**
 * Create posts (newsletters) in a publication.
 *
 * @link https://developers.beehiiv.com/api-reference/posts/create
 * @since 1.0.0
 */
final class Posts {

	/**
	 * Create a post in a Beehiiv publication.
	 *
	 * @param string              $publication_id Publication ID.
	 * @param array<string,mixed> $payload        Create-post request body.
	 * @return array{success: bool, post_id: string, error: string}
	 * @since 1.0.0
	 */
	public static function create( string $publication_id, array $payload ): array {
		$publication_id = trim( $publication_id );

		if ( '' === $publication_id ) {
			return [
				'success' => false,
				'post_id' => '',
				'error'   => 'Publication ID is empty.',
			];
		}

		$path     = sprintf( '/publications/%s/posts', rawurlencode( $publication_id ) );
		$response = Client::post( $path, $payload );

		$wp_error = Client::get_last_wp_error();

		if ( null !== $wp_error ) {
			return [
				'success' => false,
				'post_id' => '',
				'error'   => $wp_error,
			];
		}

		$status_code = Client::get_last_status_code();

		if ( null !== $status_code && $status_code > 299 ) {
			return [
				'success' => false,
				'post_id' => '',
				'error'   => self::format_error_message( $response, $status_code ),
			];
		}

		$post_id = isset( $response['data']['id'] ) ? (string) $response['data']['id'] : '';

		if ( '' === $post_id ) {
			return [
				'success' => false,
				'post_id' => '',
				'error'   => 'No post ID found in the Beehiiv API response.',
			];
		}

		return [
			'success' => true,
			'post_id' => $post_id,
			'error'   => '',
		];
	}

	/**
	 * Build a log-friendly error string from an API error response.
	 *
	 * @param array<string, mixed> $response    Parsed JSON body.
	 * @param int                  $status_code HTTP status code.
	 * @return string
	 * @since 1.0.0
	 */
	private static function format_error_message( array $response, int $status_code ): string {
		if ( isset( $response['errors'] ) && is_array( $response['errors'] ) ) {
			$messages = [];

			foreach ( $response['errors'] as $error ) {
				if ( is_array( $error ) && isset( $error['message'] ) ) {
					$messages[] = (string) $error['message'];
				} elseif ( is_string( $error ) ) {
					$messages[] = $error;
				}
			}

			if ( ! empty( $messages ) ) {
				return sprintf( 'HTTP %d: %s', $status_code, implode( '; ', $messages ) );
			}
		}

		if ( isset( $response['message'] ) && is_string( $response['message'] ) ) {
			return sprintf( 'HTTP %d: %s', $status_code, $response['message'] );
		}

		return sprintf( 'HTTP %d: Beehiiv create post request failed.', $status_code );
	}
}
