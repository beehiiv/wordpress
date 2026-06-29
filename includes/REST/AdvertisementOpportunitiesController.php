<?php
/**
 * REST API controller for beehiiv advertisement opportunities.
 *
 * @package beehiiv
 */

namespace Beehiiv\REST;

use Beehiiv\Admin\Options;
use Beehiiv\Advertisement\Reservations;
use Beehiiv\API\Cache;
use Beehiiv\API\Resources\AdvertisementOpportunities;
use Beehiiv\Connection\Manager;
use WP_REST_Request;
use WP_REST_Response;
use WP_REST_Server;

defined( 'ABSPATH' ) || exit;

/**
 * Exposes advertisement opportunities to the block editor ad picker.
 *
 * Ads reserved by other posts are hidden so each opportunity is used only once.
 *
 * @since 1.0.0
 */
final class AdvertisementOpportunitiesController {

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
			'/advertisement-opportunities',
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
	 * Permission check for advertisement requests.
	 *
	 * @since 1.0.0
	 *
	 * @return bool
	 */
	public static function permissions_check(): bool {

		return current_user_can( 'manage_options' ) || current_user_can( 'edit_posts' );
	}

	/**
	 * Return advertisement opportunities available to a post.
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

		$settings       = Options::get();
		$publication_id = isset( $settings['publication_id'] ) ? trim( (string) $settings['publication_id'] ) : '';

		if ( '' === $publication_id ) {
			return new WP_REST_Response(
				[
					'code'    => 'beehiiv_missing_publication',
					'message' => __( 'Publication ID is not configured.', 'beehiiv' ),
				],
				400
			);
		}

		// A manual refresh clears the cached list so the next fetch repopulates it from beehiiv.
		if ( $request->get_param( 'refresh' ) ) {
			Cache::delete_advertisement_opportunities( $publication_id );
		}

		$post_id = absint( $request->get_param( 'post_id' ) );
		$items   = AdvertisementOpportunities::get_opportunities( $publication_id );

		// Release reservations for ads the API no longer offers (used or expired).
		Reservations::prune_missing( array_column( $items, 'id' ) );

		// Hide ads reserved by other posts, keeping this post's own selection.
		$reserved_by_others = Reservations::reserved_ad_ids_excluding_post( $post_id );

		if ( ! empty( $reserved_by_others ) ) {
			$items = array_values(
				array_filter(
					$items,
					static function ( $item ) use ( $reserved_by_others ) {
						return ! in_array( (string) $item['id'], $reserved_by_others, true );
					}
				)
			);
		}

		return new WP_REST_Response( $items, 200 );
	}
}
