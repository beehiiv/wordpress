<?php
/**
 * Builds Beehiiv API post payload from a WordPress post.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\Admin\Options;
use WP_Error;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Gets newsletter post settings, prepares them for Beehiiv create-post API.
 *
 * @since 1.0.0
 */
final class PostSettingsBuilder {

	/**
	 * Create Beehiiv post settings array for the WordPress post.
	 *
	 * @param int $post_id Post ID.
	 * @return array<string, mixed>|WP_Error Beehiiv post settings or error.
	 * @since 1.0.0
	 */
	public static function get_post_settings( int $post_id ) {
		$post_object = get_post( $post_id );

		if ( ! $post_object instanceof WP_Post ) {
			return new WP_Error(
				'beehiiv_post_not_found',
				sprintf( 'Post not found for ID: %d.', $post_id )
			);
		}

		$post_template_id = self::get_site_post_template_id();

		if ( '' === $post_template_id ) {
			return new WP_Error(
				'beehiiv_post_template_id_empty',
				sprintf( 'Beehiiv email template is not configured for post ID: %d.', $post_id )
			);
		}

		if ( '' === $post_object->post_title || '' === $post_object->post_content ) {
			return new WP_Error(
				'beehiiv_post_title_or_content_empty',
				sprintf( 'Post title or content is empty for post ID: %d.', $post_id )
			);
		}

		$beehiiv_blocks = BlockConverter::convert_supported_blocks( $post_object );

		if ( empty( $beehiiv_blocks ) ) {
			return new WP_Error(
				'beehiiv_blocks_empty',
				sprintf( 'No supported Beehiiv blocks for post ID: %d.', $post_id )
			);
		}

		$thumbnail_image_url = get_the_post_thumbnail_url( $post_object, 'full' );
		$thumbnail_image_url = is_string( $thumbnail_image_url ) ? $thumbnail_image_url : '';

		$post_title = html_entity_decode( get_the_title( $post_object ) );

		$settings = [
			'post_template_id'    => $post_template_id,
			'title'               => $post_title,
			'blocks'              => $beehiiv_blocks,
			'status'              => 'confirmed',
			'thumbnail_image_url' => '' !== $thumbnail_image_url ? $thumbnail_image_url : '',
			'email_settings'      => [
				'email_subject_line'        => $post_title,
				'display_title_in_email'    => true,
				'display_byline_in_email'   => false,
				'display_subtitle_in_email' => false,
			],
			'web_settings'        => [
				'slug'                     => $post_object->post_name,
				'display_thumbnail_on_web' => '' !== $thumbnail_image_url,
			],
			'social_share'        => 'none',
		];

		/**
		 * Filters the Beehiiv newsletter post settings before they are sent.
		 *
		 * @since 1.0.0
		 *
		 * @param array   $settings    Payload for the Beehiiv create-post API.
		 * @param int     $post_id     WordPress post ID.
		 * @param WP_Post $post_object WordPress post object.
		 */
		return apply_filters( 'beehiiv_newsletter_post_settings', $settings, $post_id, $post_object );
	}

	/**
	 * Default email template from plugin settings.
	 *
	 * @return string
	 * @since 1.0.0
	 */
	private static function get_site_post_template_id(): string {
		$settings = Options::get();

		if ( isset( $settings['post_template_id'] ) && '' !== (string) $settings['post_template_id'] ) {
			return (string) $settings['post_template_id'];
		}

		return '';
	}
}
