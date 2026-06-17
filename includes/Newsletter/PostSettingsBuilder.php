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

		$scheduled_at = self::convert_send_date_to_scheduled_at_utc( $post_object );

		if ( is_wp_error( $scheduled_at ) ) {
			return $scheduled_at;
		}

		if ( null !== $scheduled_at ) {
			$settings['scheduled_at'] = $scheduled_at;
		}

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
	 * Build a Beehiiv update-post payload for a scheduled newsletter linked to a WordPress post.
	 *
	 * Omits `scheduled_at` because Beehiiv only allows that field on draft posts; linked
	 * newsletters are created as `confirmed`.
	 *
	 * @param int $post_id Post ID.
	 * @return array<string, mixed>|WP_Error Update payload or error.
	 * @since 1.0.0
	 */
	public static function get_update_payload( int $post_id ) {
		$settings = self::get_post_settings( $post_id );

		if ( is_wp_error( $settings ) ) {
			return $settings;
		}

		$payload = [
			'title'               => $settings['title'],
			'blocks'              => $settings['blocks'],
			'thumbnail_image_url' => $settings['thumbnail_image_url'],
			'email_settings'      => $settings['email_settings'],
			'web_settings'        => $settings['web_settings'],
			'social_share'        => $settings['social_share'],
		];

		$post_object = get_post( $post_id );

		/**
		 * Filters the Beehiiv newsletter update payload before it is sent.
		 *
		 * @since 1.0.0
		 *
		 * @param array        $payload     Payload for the Beehiiv update-post API.
		 * @param int          $post_id     WordPress post ID.
		 * @param WP_Post|null $post_object WordPress post object.
		 */
		return apply_filters(
			'beehiiv_newsletter_post_update_payload',
			$payload,
			$post_id,
			$post_object instanceof WP_Post ? $post_object : null
		);
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
	 * Convert the send datetime (site timezone) to Beehiiv scheduled_at (UTC).
	 *
	 * Uses `_beehiiv_send_to_newsletter_date` when set; otherwise the WordPress post publish
	 * datetime (`post_date`) for "On publish".
	 *
	 * Custom send times must be in the future and not before the post publish time when the
	 * post is not yet public. "On publish" returns null when the publish time is past or now
	 * so the field is omitted from the payload (immediate send).
	 *
	 * @param WP_Post $post Post object.
	 * @return string|WP_Error|null ISO 8601 UTC datetime (e.g. 2024-12-25T12:00:00Z), error, or null.
	 * @since 1.0.0
	 */
	private static function convert_send_date_to_scheduled_at_utc( WP_Post $post ) {
		$custom_date = get_post_meta( $post->ID, Meta::SEND_TO_NEWSLETTER_DATE, true );
		$custom_date = is_string( $custom_date ) ? trim( $custom_date ) : '';
		$has_custom  = '' !== $custom_date;

		if ( $has_custom ) {
			$validation = self::validate_custom_send_date( $post, $custom_date );

			if ( is_wp_error( $validation ) ) {
				return $validation;
			}

			$scheduled_date = $custom_date;
		} else {
			$scheduled_date = trim( (string) $post->post_date );
		}

		if ( '' === $scheduled_date ) {
			return null;
		}

		try {
			$local = new DateTimeImmutable( $scheduled_date, wp_timezone() );
			$utc   = $local->setTimezone( new DateTimeZone( 'UTC' ) );

			if ( $utc->getTimestamp() <= time() ) {
				if ( $has_custom ) {
					return new WP_Error(
						'beehiiv_newsletter_in_past',
						__(
							'Newsletter cannot be scheduled in the past. Please select a future date and time.',
							'beehiiv'
						)
					);
				}

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

			return new WP_Error(
				'beehiiv_newsletter_invalid_date',
				__(
					'The newsletter send date is not valid. Please select a different date and time.',
					'beehiiv'
				)
			);
		}
	}

	/**
	 * Validate a user-chosen newsletter send datetime.
	 *
	 * @param WP_Post $post           Post object.
	 * @param string  $scheduled_date Send datetime in site timezone.
	 * @return true|WP_Error
	 * @since 1.0.0
	 */
	private static function validate_custom_send_date( WP_Post $post, string $scheduled_date ) {
		try {
			$timezone = wp_timezone();
			$send     = new DateTimeImmutable( $scheduled_date, $timezone );
			$now      = new DateTimeImmutable( 'now', $timezone );

			if ( $send <= $now ) {
				return new WP_Error(
					'beehiiv_newsletter_in_past',
					__(
						'Newsletter cannot be scheduled in the past. Please select a future date and time.',
						'beehiiv'
					)
				);
			}

			$publish_date = trim( (string) $post->post_date );

			if ( '' === $publish_date ) {
				return true;
			}

			$publish = new DateTimeImmutable( $publish_date, $timezone );

			if ( $publish > $now && $send < $publish ) {
				return new WP_Error(
					'beehiiv_newsletter_before_publish',
					__( 'The newsletter cannot be scheduled before this post is published.', 'beehiiv' )
				);
			}

			return true;
		} catch ( Exception $e ) {
			return new WP_Error(
				'beehiiv_newsletter_invalid_date',
				__(
					'The newsletter send date is not valid. Please select a different date and time.',
					'beehiiv'
				)
			);
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
