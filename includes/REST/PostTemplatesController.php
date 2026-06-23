<?php
/**
 * REST API controller for beehiiv post templates.
 *
 * @package beehiiv
 */

namespace Beehiiv\REST;

use Beehiiv\API\Resources\PostTemplates;
use Beehiiv\Connection\Manager;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

/**
 * Exposes post templates for admin settings and future editor use.
 *
 * @since 1.0.0
 */
final class PostTemplatesController {

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
			'/post-templates',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ self::class, 'get_items' ],
				'permission_callback' => [ self::class, 'permissions_check' ],
				'args'                => [
					'publication_id' => [
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					],
				],
			]
		);
	}

	/**
	 * Permission check for template requests.
	 *
	 * @since 1.0.0
	 *
	 * @return bool
	 */
	public static function permissions_check(): bool {

		return current_user_can( 'manage_options' ) || current_user_can( 'edit_posts' );
	}

	/**
	 * Return post templates for a publication.
	 *
	 * @since 1.0.0
	 *
	 * @param WP_REST_Request $request REST request.
	 *
	 * @return WP_REST_Response
	 */
	public static function get_items( WP_REST_Request $request ): WP_REST_Response {

		if ( ! Manager::is_connected() ) {
			return new WP_REST_Response(
				[
					'code'    => 'beehiiv_not_connected',
					'message' => __( 'beehiiv is not connected.', 'beehiiv' ),
				],
				400
			);
		}

		$publication_id = trim( (string) $request->get_param( 'publication_id' ) );

		if ( '' === $publication_id ) {
			return new WP_REST_Response(
				[
					'code'    => 'beehiiv_missing_publication',
					'message' => __( 'Publication ID is required.', 'beehiiv' ),
				],
				400
			);
		}

		return new WP_REST_Response(
			PostTemplates::get_post_templates( $publication_id ),
			200
		);
	}
}
