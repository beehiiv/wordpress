<?php
/**
 * Builds Beehiiv API post payload from a WordPress post.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\Admin\Options;
use Beehiiv\Editor\Meta;
use DateTimeImmutable;
use DateTimeZone;
use Exception;
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

		$beehiiv_blocks = BlockConverter::convert_all_blocks( $post_object );

		if ( empty( $beehiiv_blocks ) ) {
			return new WP_Error(
				'beehiiv_blocks_empty',
				sprintf( 'No supported Beehiiv blocks for post ID: %d.', $post_id )
			);
		}

		$thumbnail_image_url = get_the_post_thumbnail_url( $post_object, 'full' );
		$thumbnail_image_url = is_string( $thumbnail_image_url )
			? self::normalize_thumbnail_url( $thumbnail_image_url )
			: '';

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

		$scheduled_at = self::convert_send_date_to_scheduled_at_utc( $post_object );

		if ( null !== $scheduled_at ) {
			$settings['scheduled_at'] = $scheduled_at;
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

	/**
	 * Strip non-production host prefixes from image URLs.
	 *
	 * @param string $url Thumbnail URL.
	 * @return string
	 * @since 1.0.0
	 */
	private static function normalize_thumbnail_url( string $url ): string {
		// Non-production image urls do not work in Beehiiv and it prevents creating post via API.
		return str_replace( [ 'test.', 'preprod.', 'viptest.' ], '', $url );
	}

	/**
	 * Convert the send datetime (site timezone) to Beehiiv scheduled_at (UTC).
	 *
	 * Uses `_beehiiv_send_to_newsletter_date` when set; otherwise the WordPress post publish
	 * datetime (`post_date`) for "On publish".
	 *
	 * Returns null when send is immediate (past or now) so the field is omitted from the payload.
	 *
	 * @param WP_Post $post Post object.
	 * @return string|null ISO 8601 UTC datetime (e.g. 2024-12-25T12:00:00Z), or null.
	 * @since 1.0.0
	 */
	private static function convert_send_date_to_scheduled_at_utc( WP_Post $post ): ?string {
		$scheduled_date = get_post_meta( $post->ID, Meta::SEND_TO_NEWSLETTER_DATE, true );
		$scheduled_date = is_string( $scheduled_date ) ? trim( $scheduled_date ) : '';

		if ( '' === $scheduled_date ) {
			$scheduled_date = trim( (string) $post->post_date );
		}

		if ( '' === $scheduled_date ) {
			return null;
		}

		try {
			$local = new DateTimeImmutable( $scheduled_date, wp_timezone() );
			$utc   = $local->setTimezone( new DateTimeZone( 'UTC' ) );

			if ( $utc->getTimestamp() <= time() ) {
				return null;
			}

			return $utc->format( 'Y-m-d\TH:i:s\Z' );
		} catch ( Exception $e ) {
			self::log_error(
				$post->ID,
				sprintf(
					'Invalid newsletter send date "%s": %s',
					$scheduled_date,
					$e->getMessage()
				)
			);

			return null;
		}
	}

	/**
	 * Log a newsletter post settings failure.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $message Error message.
	 * @return void
	 * @since 1.0.0
	 */
	private static function log_error( int $post_id, string $message ): void {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( sprintf( 'Beehiiv newsletter post settings failed for post ID %d: %s', $post_id, $message ) );
	}
}
