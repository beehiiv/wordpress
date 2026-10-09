<?php
/**
 * REST API controller for beehiiv publications.
 *
 * @package beehiiv
 */

namespace Beehiiv\REST;

use Beehiiv\API\Cache;
use Beehiiv\API\Resources\Publications;
use Beehiiv\Connection\Manager;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

/**
 * Exposes connected publications so the settings screen and editor can refresh their lists.
 *
 * @since x.x.x
 */
final class PublicationsController {

	/**
	 * REST namespace.
	 *
	 * @since x.x.x
	 */
	private const NAMESPACE = 'beehiiv/v1';

	/**
	 * Register REST routes.
	 *
	 * @since x.x.x
	 *
	 * @return void
	 */
	public static function register_routes(): void {

		register_rest_route(
			self::NAMESPACE,
			'/publications',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ self::class, 'get_items' ],
				'permission_callback' => [ self::class, 'permissions_check' ],
				'args'                => [
					'refresh' => [
						'required' => false,
						'type'     => 'boolean',
						'default'  => false,
					],
				],
			]
		);
	}

	/**
	 * Permission check for publication requests.
	 *
	 * Settings screen requires manage_options; the editor's Publication selector requires publish_posts.
	 *
	 * @since x.x.x
	 *
	 * @return bool
	 */
	public static function permissions_check(): bool {

		return current_user_can( 'manage_options' ) || current_user_can( 'publish_posts' );
	}

	/**
	 * Return the publications connected to the beehiiv account.
	 *
	 * @since x.x.x
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

		// A manual refresh clears the cached list so the next fetch repopulates it from beehiiv.
		if ( $request->get_param( 'refresh' ) ) {
			Cache::delete_publications();
		}

		return new WP_REST_Response(
			Publications::get_publications(),
			200
		);
	}
}
