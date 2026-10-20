<?php
/**
 * REST API controller for the in-editor email preview.
 *
 * @package beehiiv
 */

namespace Beehiiv\REST;

use Beehiiv\Newsletter\EmailPreview;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

/**
 * Lets the block editor preview the real beehiiv email of the saved post.
 *
 * @since 1.0.0
 */
final class EmailPreviewController {

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
			'/email-preview',
			[
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => [ self::class, 'preview' ],
				'permission_callback' => [ self::class, 'permissions_check' ],
				'args'                => [
					'post_id'    => [
						'required'          => true,
						'type'              => 'integer',
						'sanitize_callback' => 'absint',
					],
					'fetch_only' => [
						'required'          => false,
						'type'              => 'boolean',
						'default'           => false,
						'sanitize_callback' => 'rest_sanitize_boolean',
					],
				],
			]
		);
	}

	/**
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
	 * Sync the linked draft and return the rendered email HTML.
	 *
	 * @since 1.0.0
	 *
	 * @param WP_REST_Request $request REST request.
	 * @return WP_REST_Response
	 */
	public static function preview( WP_REST_Request $request ): WP_REST_Response {

		$result = EmailPreview::render(
			absint( $request->get_param( 'post_id' ) ),
			(bool) $request->get_param( 'fetch_only' )
		);

		if ( is_wp_error( $result ) ) {
			return new WP_REST_Response(
				[
					'code'    => $result->get_error_code(),
					'message' => $result->get_error_message(),
				],
				400
			);
		}

		// 202: beehiiv is still preparing the email; the editor asks again shortly.
		return new WP_REST_Response( $result, isset( $result['processing'] ) ? 202 : 200 );
	}
}
