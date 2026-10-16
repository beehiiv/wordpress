<?php
/**
 * REST API controller for beehiiv test emails.
 *
 * @package beehiiv
 */

namespace Beehiiv\REST;

use Beehiiv\Newsletter\TestSender;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

/**
 * Lets the block editor send a beehiiv test email of the post being edited.
 *
 * @since 1.0.0
 */
final class TestSendController {

	/**
	 * REST namespace.
	 *
	 * @since 1.0.0
	 */
	private const NAMESPACE = 'beehiiv/v1';

	/**
	 * Register REST routes.
	 *
	 * @since 1.0.0
	 *
	 * @return void
	 */
	public static function register_routes(): void {

		register_rest_route(
			self::NAMESPACE,
			'/test-send',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => [ self::class, 'send_test' ],
				'permission_callback' => [ self::class, 'permissions_check' ],
				'args'                => [
					'post_id'    => [
						'required'          => true,
						'type'              => 'integer',
						'sanitize_callback' => 'absint',
					],
					'recipients' => [
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_textarea_field',
					],
				],
			]
		);
	}

	/**
	 * Permission check for test-send requests.
	 *
	 * Requires publish rights and edit access to the referenced post.
	 *
	 * @since 1.0.0
	 *
	 * @param WP_REST_Request $request REST request.
	 * @return bool
	 */
	public static function permissions_check( WP_REST_Request $request ): bool {

		$post_id = absint( $request->get_param( 'post_id' ) );

		return $post_id
			&& current_user_can( 'edit_post', $post_id )
			&& current_user_can( 'publish_posts' );
	}

	/**
	 * Send a test email of the saved post.
	 *
	 * @since 1.0.0
	 *
	 * @param WP_REST_Request $request REST request.
	 * @return WP_REST_Response
	 */
	public static function send_test( WP_REST_Request $request ): WP_REST_Response {

		$recipients = self::parse_recipients( (string) $request->get_param( 'recipients' ) );

		if ( empty( $recipients ) ) {
			return self::error_response(
				'beehiiv_test_send_no_recipients',
				__( 'Enter at least one email address.', 'beehiiv' )
			);
		}

		$invalid = array_values(
			array_filter(
				$recipients,
				static function ( $email ) {
					return ! is_email( $email );
				}
			)
		);

		if ( ! empty( $invalid ) ) {
			return self::error_response(
				'beehiiv_test_send_invalid_recipients',
				sprintf(
					/* translators: %s: comma-separated list of invalid email addresses. */
					__( "These email addresses aren't valid: %s", 'beehiiv' ),
					implode( ', ', $invalid )
				)
			);
		}

		$result = TestSender::send( absint( $request->get_param( 'post_id' ) ), $recipients );

		if ( is_wp_error( $result ) ) {
			$data = $result->get_error_data();

			return self::error_response(
				$result->get_error_code(),
				$result->get_error_message(),
				is_array( $data ) && ! empty( $data['leftover_draft'] )
			);
		}

		return new WP_REST_Response( $result, 200 );
	}

	/**
	 * Split a recipients string on commas and new lines, trimmed and de-duplicated.
	 *
	 * Duplicates are matched case-insensitively; the first spelling is kept.
	 *
	 * @since 1.0.0
	 *
	 * @param string $raw Raw recipients field value.
	 * @return array<int, string>
	 */
	public static function parse_recipients( string $raw ): array {

		$parts  = preg_split( '/[,\r\n]+/', $raw );
		$parts  = is_array( $parts ) ? $parts : [];
		$unique = [];

		foreach ( $parts as $part ) {
			$email = trim( $part );

			if ( '' === $email ) {
				continue;
			}

			$key = strtolower( $email );

			if ( ! isset( $unique[ $key ] ) ) {
				$unique[ $key ] = $email;
			}
		}

		return array_values( $unique );
	}

	/**
	 * Error response in the shape the other beehiiv REST controllers use.
	 *
	 * @since 1.0.0
	 *
	 * @param string $code           Error code.
	 * @param string $message        Editor-facing message.
	 * @param bool   $leftover_draft Whether a temporary beehiiv draft may be left behind.
	 * @return WP_REST_Response
	 */
	private static function error_response(
		string $code,
		string $message,
		bool $leftover_draft = false
	): WP_REST_Response {

		$body = [
			'code'    => $code,
			'message' => $message,
		];

		if ( $leftover_draft ) {
			$body['leftover_draft'] = true;
		}

		return new WP_REST_Response( $body, 400 );
	}
}
