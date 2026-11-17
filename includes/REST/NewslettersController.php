<?php
/**
 * REST controller for the newsletter content type.
 *
 * @package beehiiv
 */

namespace Beehiiv\REST;

use WP_Post;
use WP_REST_Posts_Controller;

defined( 'ABSPATH' ) || exit;

/**
 * Standard posts controller that never serves newsletters to anyone who cannot edit them.
 *
 * Core lets anonymous visitors read published items of any REST-enabled type,
 * which would expose newsletters that have no public page.
 *
 * @since x.x.x
 */
class NewslettersController extends WP_REST_Posts_Controller {

	/**
	 * Only users who can edit the newsletter may read it.
	 *
	 * @param WP_Post $post Post object.
	 * @return bool
	 * @since x.x.x
	 */
	public function check_read_permission( $post ) {
		return $post instanceof WP_Post && current_user_can( 'edit_post', $post->ID );
	}

	/**
	 * Listing requires the ability to edit newsletters.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return true|\WP_Error
	 * @since x.x.x
	 */
	public function get_items_permissions_check( $request ) {
		$post_type = get_post_type_object( $this->post_type );

		if ( ! $post_type || ! current_user_can( $post_type->cap->edit_posts ) ) {
			return new \WP_Error(
				'rest_forbidden',
				__( 'Sorry, you are not allowed to view newsletters.', 'beehiiv' ),
				[ 'status' => rest_authorization_required_code() ]
			);
		}

		return parent::get_items_permissions_check( $request );
	}
}
