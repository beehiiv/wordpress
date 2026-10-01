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
 * @link https://developers.beehiiv.com/api-reference/posts/delete
 * @link https://developers.beehiiv.com/api-reference/posts/update
 * @since 1.0.0
 */
final class Posts {

	/**
	 * Create a post in a beehiiv publication.
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
				'error'   => 'No post ID found in the beehiiv API response.',
			];
		}

		return [
			'success' => true,
			'post_id' => $post_id,
			'error'   => '',
		];
	}

	/**
	 * Delete or archive a post in a beehiiv publication.
	 *
	 * Confirmed posts are archived; drafts are permanently deleted. beehiiv answers
	 * 202 while a Send API post is still processing, in which case nothing was
	 * deleted yet; `status_code` lets callers tell that apart from a 204.
	 *
	 * @param string $publication_id Publication ID.
	 * @param string $post_id        beehiiv post ID.
	 * @return array{success: bool, error: string, status_code: int|null}
	 * @since 1.0.0
	 */
	public static function delete( string $publication_id, string $post_id ): array {
		$publication_id = trim( $publication_id );
		$post_id        = trim( $post_id );

		if ( '' === $publication_id || '' === $post_id ) {
			return [
				'success'     => false,
				'error'       => 'Publication ID or post ID is empty.',
				'status_code' => null,
			];
		}

		$path     = sprintf(
			'/publications/%s/posts/%s',
			rawurlencode( $publication_id ),
			rawurlencode( $post_id )
		);
		$response = Client::delete( $path );

		$wp_error = Client::get_last_wp_error();

		if ( null !== $wp_error ) {
			return [
				'success'     => false,
				'error'       => $wp_error,
				'status_code' => null,
			];
		}

		$status_code = Client::get_last_status_code();

		if ( null !== $status_code && 204 === $status_code ) {
			return [
				'success'     => true,
				'error'       => '',
				'status_code' => $status_code,
			];
		}

		if ( null !== $status_code && $status_code > 299 ) {
			return [
				'success'     => false,
				'error'       => self::format_error_message( $response, $status_code ),
				'status_code' => $status_code,
			];
		}

		return [
			'success'     => true,
			'error'       => '',
			'status_code' => $status_code,
		];
	}

	/**
	 * Send a test email of a beehiiv post to one or more addresses.
	 *
	 * @link https://developers.beehiiv.com/api-reference/posts/test-send
	 *
	 * @param string            $publication_id   Publication ID.
	 * @param string            $post_id          beehiiv post ID.
	 * @param array<int,string> $recipient_emails Addresses to send the test to.
	 * @return array{
	 *     success: bool,
	 *     status_code: int|null,
	 *     remaining_test_sends: int|null,
	 *     reset_at: int|null,
	 *     error: string
	 * }
	 * @since 1.0.0
	 */
	public static function test_send( string $publication_id, string $post_id, array $recipient_emails ): array {
		$publication_id = trim( $publication_id );
		$post_id        = trim( $post_id );
		$result         = [
			'success'              => false,
			'status_code'          => null,
			'remaining_test_sends' => null,
			'reset_at'             => null,
			'error'                => '',
		];

		if ( '' === $publication_id || '' === $post_id ) {
			$result['error'] = 'Publication ID or post ID is empty.';
			return $result;
		}

		$path     = sprintf(
			'/publications/%s/posts/%s/test_sends',
			rawurlencode( $publication_id ),
			rawurlencode( $post_id )
		);
		$response = Client::post( $path, [ 'recipient_emails' => array_values( $recipient_emails ) ] );

		$wp_error = Client::get_last_wp_error();

		if ( null !== $wp_error ) {
			$result['error'] = $wp_error;
			return $result;
		}

		$status_code           = Client::get_last_status_code();
		$result['status_code'] = $status_code;

		if ( null !== $status_code && $status_code > 299 ) {
			$result['error'] = self::format_error_message( $response, $status_code );
			return $result;
		}

		$data      = isset( $response['data'] ) && is_array( $response['data'] ) ? $response['data'] : [];
		$remaining = $data['remaining_test_sends'] ?? null;
		$reset_at  = $data['reset_at'] ?? null;

		$result['success']              = true;
		$result['remaining_test_sends'] = is_numeric( $remaining ) ? (int) $remaining : null;
		$result['reset_at']             = is_numeric( $reset_at ) ? (int) $reset_at : null;

		return $result;
	}

	/**
	 * Update an existing post in a beehiiv publication.
	 *
	 * @param string              $publication_id Publication ID.
	 * @param string              $post_id        beehiiv post ID.
	 * @param array<string,mixed> $payload        Update-post request body.
	 * @return array{success: bool, error: string}
	 * @since 1.0.0
	 */
	public static function update( string $publication_id, string $post_id, array $payload ): array {
		$publication_id = trim( $publication_id );
		$post_id        = trim( $post_id );

		if ( '' === $publication_id || '' === $post_id ) {
			return [
				'success' => false,
				'error'   => 'Publication ID or post ID is empty.',
			];
		}

		if ( empty( $payload ) ) {
			return [
				'success' => false,
				'error'   => 'Update payload is empty.',
			];
		}

		$path     = sprintf(
			'/publications/%s/posts/%s',
			rawurlencode( $publication_id ),
			rawurlencode( $post_id )
		);
		$response = Client::patch( $path, $payload );

		$wp_error = Client::get_last_wp_error();

		if ( null !== $wp_error ) {
			return [
				'success' => false,
				'error'   => $wp_error,
			];
		}

		$status_code = Client::get_last_status_code();

		if ( null !== $status_code && $status_code > 299 ) {
			return [
				'success' => false,
				'error'   => self::format_error_message( $response, $status_code ),
			];
		}

		return [
			'success' => true,
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

		return sprintf( 'HTTP %d: beehiiv API request failed.', $status_code );
	}
}
