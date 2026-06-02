<?php
/**
 * Builds Beehiiv API post payload from a WordPress post.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\Admin\Options;
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
	 * @return array<string, mixed> Beehiiv post settings array.
	 * @since 1.0.0
	 */
	public static function get_post_settings( int $post_id ): array {
		$post_object = get_post( $post_id );

		if ( ! $post_object instanceof WP_Post ) {
			return [];
		}

		$thumbnail_image_url = get_the_post_thumbnail_url( $post_object, 'full' );
		$thumbnail_image_url = is_string( $thumbnail_image_url )
			? self::normalize_thumbnail_url( $thumbnail_image_url )
			: '';

		// TEMP: testing create-post API with separator block only; restore when block converters are ready.
		// $beehiiv_blocks = BlockConverter::convert_all_blocks( $post_object ); // Restore this line.
		$beehiiv_blocks = [
			[
				'type' => 'content_break',
			],
		];

		$post_title = html_entity_decode( get_the_title( $post_object ) );

		$settings = [
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

		$post_template_id = self::get_site_post_template_id();

		if ( '' !== $post_template_id ) {
			$settings['post_template_id'] = $post_template_id;
		}

		/**
		 * Filters the Beehiiv newsletter post settings before they are sent.
		 *
		 * @param array   $settings    Payload for the Beehiiv create-post API.
		 * @param int     $post_id     WordPress post ID.
		 * @param WP_Post $post_object WordPress post object.
		 */
		return apply_filters( 'beehiiv_newsletter_post_settings', $settings, $post_id, $post_object );
	}

	/**
	 * Plugin default email template; empty omits post_template_id from the payload.
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

	/**
	 * Strip non-production host prefixes from image URLs.
	 *
	 * @param string $url Thumbnail URL.
	 * @return string
	 * @since 1.0.0
	 */
	private static function normalize_thumbnail_url( string $url ): string {
		// Convert thumbnail image url to production url.
		// Non-production image urls do not work in Beehiiv and it prevents creating post via API.
		return str_replace( [ 'test.', 'preprod.', 'viptest.' ], '', $url );
	}
}
