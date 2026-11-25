<?php
/**
 * REST route that previews a Post Roundup block in the editor.
 *
 * @package beehiiv
 */

namespace Beehiiv\REST;

use Beehiiv\Newsletter\PostRoundup;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

/**
 * Returns the cards for a roundup using the same resolver the send step uses.
 *
 * @since x.x.x
 */
final class PostRoundupController {

	/**
	 * REST namespace.
	 *
	 * @since x.x.x
	 */
	private const NAMESPACE = 'beehiiv/v1';

	/**
	 * Most manual picks a preview resolves.
	 *
	 * @since x.x.x
	 */
	private const MAX_IDS = 50;

	/**
	 * Register REST routes.
	 *
	 * @return void
	 * @since x.x.x
	 */
	public static function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/post-roundup',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ self::class, 'get_items' ],
				'permission_callback' => [ self::class, 'permissions_check' ],
				'args'                => [
					'post_id' => [
						'required'          => true,
						'type'              => 'integer',
						'sanitize_callback' => 'absint',
					],
					'mode'    => [
						'type'    => 'string',
						'enum'    => [ PostRoundup::MODE_AUTO, PostRoundup::MODE_MANUAL ],
						'default' => PostRoundup::MODE_AUTO,
					],
					'count'   => [
						'type'    => 'integer',
						'default' => PostRoundup::DEFAULT_COUNT,
					],
					'ids'     => [
						'type'     => 'array',
						'items'    => [ 'type' => 'integer' ],
						'maxItems' => self::MAX_IDS,
						'default'  => [],
					],
					'uid'     => [
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => 'sanitize_key',
					],
				],
			]
		);
	}

	/**
	 * Require edit access to the newsletter being written.
	 *
	 * @param WP_REST_Request $request REST request.
	 * @return bool
	 * @since x.x.x
	 */
	public static function permissions_check( WP_REST_Request $request ): bool {
		$post_id = absint( $request->get_param( 'post_id' ) );

		return $post_id && current_user_can( 'edit_post', $post_id );
	}

	/**
	 * Cards for the block's current settings.
	 *
	 * @param WP_REST_Request $request REST request.
	 * @return WP_REST_Response
	 * @since x.x.x
	 */
	public static function get_items( WP_REST_Request $request ): WP_REST_Response {
		$attrs = [
			'mode'  => $request->get_param( 'mode' ),
			'count' => $request->get_param( 'count' ),
			'posts' => array_map( 'absint', (array) $request->get_param( 'ids' ) ),
		];

		$ids = PostRoundup::resolve_ids(
			$attrs,
			absint( $request->get_param( 'post_id' ) ),
			(string) $request->get_param( 'uid' )
		);

		return new WP_REST_Response( PostRoundup::cards( $ids ), 200 );
	}
}
