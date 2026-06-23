<?php
/**
 * Builds Beehiiv API post payload from a WordPress post.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\Admin\Options;
use Beehiiv\API\Resources\PostTemplates;
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
	 * @param int  $post_id    Post ID.
	 * @param bool $for_update When true, omit schedule validation and `scheduled_at` (used for linked-post updates).
	 * @return array<string, mixed>|WP_Error Beehiiv post settings or error.
	 * @since 1.0.0
	 */
	public static function get_post_settings( int $post_id, bool $for_update = false ) {
		$post_object = get_post( $post_id );

		if ( ! $post_object instanceof WP_Post ) {
			return new WP_Error(
				'beehiiv_post_not_found',
				sprintf( 'Post not found for ID: %d.', $post_id )
			);
		}

		$post_template_id = self::get_post_template_id( $post_id );

		if ( '' === $post_template_id ) {
			return new WP_Error(
				'beehiiv_post_template_id_empty',
				sprintf( 'Beehiiv post template is not configured for post ID: %d.', $post_id )
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

		if ( ! $for_update ) {
			$scheduled_at = self::convert_send_date_to_scheduled_at_utc( $post_object );

			if ( is_wp_error( $scheduled_at ) ) {
				return $scheduled_at;
			}

			if ( null !== $scheduled_at ) {
				$settings['scheduled_at'] = $scheduled_at;
			}
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
	 * Build a Beehiiv update request for a linked newsletter.
	 *
	 * Content is always refreshed via PATCH. When the send time must move later,
	 * {@see Sender::reschedule_linked_post()} recreates the Beehiiv post because the API
	 * does not allow updating `scheduled_at` on confirmed posts.
	 *
	 * @param int $post_id Post ID.
	 * @return array{payload: array<string, mixed>, meta: array{scheduled_at: string|null, clear_custom_date: bool}}|WP_Error
	 * @since 1.0.0
	 */
	public static function build_update( int $post_id ) {
		$settings = self::get_post_settings( $post_id, true );

		if ( is_wp_error( $settings ) ) {
			return $settings;
		}

		$post_object = get_post( $post_id );

		if ( ! $post_object instanceof WP_Post ) {
			return new WP_Error(
				'beehiiv_post_not_found',
				sprintf( 'Post not found for ID: %d.', $post_id )
			);
		}

		$payload = [
			'title'               => $settings['title'],
			'blocks'              => $settings['blocks'],
			'thumbnail_image_url' => $settings['thumbnail_image_url'],
			'email_settings'      => $settings['email_settings'],
			'web_settings'        => $settings['web_settings'],
			'social_share'        => $settings['social_share'],
		];

		$schedule = self::resolve_update_scheduled_at( $post_object );

		if ( is_wp_error( $schedule ) ) {
			return $schedule;
		}

		/**
		 * Filters the Beehiiv newsletter update payload before it is sent.
		 *
		 * @since 1.0.0
		 *
		 * @param array        $payload     Payload for the Beehiiv update-post API.
		 * @param int          $post_id     WordPress post ID.
		 * @param WP_Post|null $post_object WordPress post object.
		 */
		$payload = apply_filters(
			'beehiiv_newsletter_post_update_payload',
			$payload,
			$post_id,
			$post_object
		);

		return [
			'payload' => $payload,
			'meta'    => [
				'scheduled_at'      => $schedule['scheduled_at'],
				'clear_custom_date' => $schedule['clear_custom_date'],
			],
		];
	}

	/**
	 * Build a Beehiiv update-post payload for a scheduled newsletter linked to a WordPress post.
	 *
	 * @param int $post_id Post ID.
	 * @return array<string, mixed>|WP_Error Update payload or error.
	 * @since 1.0.0
	 */
	public static function get_update_payload( int $post_id ) {
		$update = self::build_update( $post_id );

		if ( is_wp_error( $update ) ) {
			return $update;
		}

		return $update['payload'];
	}

	/**
	 * Post template for the post: post meta when set and valid, else plugin default.
	 *
	 * @since 1.0.0
	 *
	 * @param int $post_id Post ID.
	 *
	 * @return string
	 */
	private static function get_post_template_id( int $post_id ): string {

		$post_template_id = get_post_meta( $post_id, Meta::BEEHIIV_POST_TEMPLATE_ID, true );
		$post_template_id = is_string( $post_template_id ) ? trim( $post_template_id ) : '';

		if ( '' !== $post_template_id && self::post_template_exists( $post_template_id ) ) {
			return $post_template_id;
		}

		return self::get_site_post_template_id();
	}

	/**
	 * Whether a template ID exists for the configured publication.
	 *
	 * @since 1.0.0
	 *
	 * @param string $template_id Template ID.
	 *
	 * @return bool
	 */
	private static function post_template_exists( string $template_id ): bool {

		$publication_id = self::get_publication_id();

		if ( '' === $publication_id ) {
			return false;
		}

		foreach ( PostTemplates::get_post_templates( $publication_id ) as $template ) {

			if ( isset( $template['id'] ) && (string) $template['id'] === $template_id ) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Configured Beehiiv publication ID.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	private static function get_publication_id(): string {

		$settings = Options::get();

		return isset( $settings['publication_id'] ) ? trim( (string) $settings['publication_id'] ) : '';
	}

	/**
	 * Default post template from plugin settings.
	 *
	 * @since 1.0.0
	 *
	 * @return string
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
							// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
							'That send date has already passed. Pick a future date and time in the newsletter schedule.',
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
					"That send date isn't valid. Open the newsletter schedule and choose a different date and time.",
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
						'That send date has already passed. Pick a future date and time in the newsletter schedule.',
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
					__(
						// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
						"The newsletter can't send before this post publishes. Choose a later send time, or schedule the post first.",
						'beehiiv'
					)
				);
			}

			return true;
		} catch ( Exception $e ) {
			return new WP_Error(
				'beehiiv_newsletter_invalid_date',
				__(
					"That send date isn't valid. Open the newsletter schedule and choose a different date and time.",
					'beehiiv'
				)
			);
		}
	}

	/**
	 * Resolve whether a linked newsletter `scheduled_at` should move forward on update.
	 *
	 * The newsletter send time only moves later: when the WordPress publish date passes a
	 * custom send time the newsletter switches to send on publish, and any later publish
	 * date pushes Beehiiv forward. Earlier publish dates or publishing immediately never
	 * reschedule the newsletter earlier.
	 *
	 * @param WP_Post $post Post object.
	 * @return array{scheduled_at: string|null, clear_custom_date: bool}|WP_Error
	 * @since 1.0.0
	 */
	private static function resolve_update_scheduled_at( WP_Post $post ) {
		$stored_scheduled_at = get_post_meta( $post->ID, Meta::BEEHIIV_SCHEDULED_AT, true );
		$stored_scheduled_at = is_string( $stored_scheduled_at ) ? trim( $stored_scheduled_at ) : '';
		$stored_timestamp    = self::utc_scheduled_at_to_timestamp( $stored_scheduled_at );

		if ( null === $stored_timestamp ) {
			$stored_timestamp = self::infer_stored_timestamp_from_meta( $post );
		}

		$custom_date = get_post_meta( $post->ID, Meta::SEND_TO_NEWSLETTER_DATE, true );
		$custom_date = is_string( $custom_date ) ? trim( $custom_date ) : '';
		$clear_custom_date = false;

		$wp_publish_ts = self::get_wp_publish_utc_timestamp( $post );

		if ( '' !== $custom_date ) {
			$custom_ts = self::parse_datetime_to_utc_timestamp( $custom_date );

			if ( null === $custom_ts ) {
				return new WP_Error(
					'beehiiv_newsletter_invalid_date',
					__(
						"That send date isn't valid. Open the newsletter schedule and choose a different date and time.",
						'beehiiv'
					)
				);
			}

			if ( null !== $wp_publish_ts && $wp_publish_ts > $custom_ts ) {
				$clear_custom_date = true;
				$desired_timestamp = $wp_publish_ts;
			} else {
				$desired_timestamp = $custom_ts;
			}
		} elseif ( null !== $wp_publish_ts ) {
			$desired_timestamp = $wp_publish_ts;
		} else {
			return [
				'scheduled_at'      => null,
				'clear_custom_date' => false,
			];
		}

		if ( null !== $stored_timestamp ) {
			$final_timestamp = max( $stored_timestamp, $desired_timestamp );
		} else {
			$final_timestamp = $desired_timestamp;
		}

		if ( null !== $stored_timestamp && $final_timestamp <= $stored_timestamp ) {
			return [
				'scheduled_at'      => null,
				'clear_custom_date' => $clear_custom_date,
			];
		}

		if ( $final_timestamp <= time() ) {
			return [
				'scheduled_at'      => null,
				'clear_custom_date' => $clear_custom_date,
			];
		}

		return [
			'scheduled_at'      => self::utc_timestamp_to_scheduled_at( $final_timestamp ),
			'clear_custom_date' => $clear_custom_date,
		];
	}

	/**
	 * UTC unix timestamp for when the WordPress post publishes.
	 *
	 * Prefers `post_date_gmt` (already UTC); falls back to `post_date` in the site timezone.
	 *
	 * @param WP_Post $post Post object.
	 * @return int|null Timestamp, or null when unavailable.
	 * @since 1.0.0
	 */
	private static function get_wp_publish_utc_timestamp( WP_Post $post ): ?int {
		$gmt_date = trim( (string) $post->post_date_gmt );

		if ( '' !== $gmt_date && '0000-00-00 00:00:00' !== $gmt_date ) {
			$gmt_timestamp = self::parse_gmt_mysql_datetime_to_timestamp( $gmt_date );

			if ( null !== $gmt_timestamp ) {
				return $gmt_timestamp;
			}
		}

		$local_date = trim( (string) $post->post_date );

		if ( '' === $local_date ) {
			return null;
		}

		return self::parse_datetime_to_utc_timestamp( $local_date );
	}

	/**
	 * Infer the last known Beehiiv send time from newsletter post meta.
	 *
	 * @param WP_Post $post Post object.
	 * @return int|null UTC unix timestamp, or null when unknown.
	 * @since 1.0.0
	 */
	private static function infer_stored_timestamp_from_meta( WP_Post $post ): ?int {
		$custom_date = get_post_meta( $post->ID, Meta::SEND_TO_NEWSLETTER_DATE, true );
		$custom_date = is_string( $custom_date ) ? trim( $custom_date ) : '';

		if ( '' === $custom_date ) {
			return null;
		}

		return self::parse_datetime_to_utc_timestamp( $custom_date );
	}

	/**
	 * Parse a datetime string to a UTC Unix timestamp.
	 *
	 * Handles ISO 8601 values from the block editor and MySQL datetimes in the site timezone.
	 *
	 * @param string $datetime Datetime string.
	 * @return int|null Timestamp, or null when invalid.
	 * @since 1.0.0
	 */
	private static function parse_datetime_to_utc_timestamp( string $datetime ): ?int {
		$datetime = trim( $datetime );

		if ( '' === $datetime ) {
			return null;
		}

		try {
			if ( preg_match( '/[Tt].*(?:Z|[+-]\d{2}:?\d{2})$/', $datetime ) ) {
				return ( new DateTimeImmutable( $datetime ) )->getTimestamp();
			}

			return ( new DateTimeImmutable( $datetime, wp_timezone() ) )
				->setTimezone( new DateTimeZone( 'UTC' ) )
				->getTimestamp();
		} catch ( Exception $e ) {
			return null;
		}
	}

	/**
	 * Parse a MySQL datetime stored in UTC (`post_date_gmt`) to a Unix timestamp.
	 *
	 * @param string $datetime MySQL datetime in UTC.
	 * @return int|null Timestamp, or null when invalid.
	 * @since 1.0.0
	 */
	private static function parse_gmt_mysql_datetime_to_timestamp( string $datetime ): ?int {
		try {
			return ( new DateTimeImmutable( $datetime, new DateTimeZone( 'UTC' ) ) )->getTimestamp();
		} catch ( Exception $e ) {
			return null;
		}
	}

	/**
	 * Parse a Beehiiv UTC `scheduled_at` string to a Unix timestamp.
	 *
	 * @param string $scheduled_at UTC ISO 8601 datetime.
	 * @return int|null Timestamp, or null when empty or invalid.
	 * @since 1.0.0
	 */
	private static function utc_scheduled_at_to_timestamp( string $scheduled_at ): ?int {
		if ( '' === $scheduled_at ) {
			return null;
		}

		try {
			return ( new DateTimeImmutable( $scheduled_at ) )->getTimestamp();
		} catch ( Exception $e ) {
			return null;
		}
	}

	/**
	 * Format a UTC Unix timestamp for Beehiiv `scheduled_at`.
	 *
	 * @param int $timestamp UTC Unix timestamp.
	 * @return string
	 * @since 1.0.0
	 */
	private static function utc_timestamp_to_scheduled_at( int $timestamp ): string {
		return ( new DateTimeImmutable( '@' . $timestamp ) )
			->setTimezone( new DateTimeZone( 'UTC' ) )
			->format( 'Y-m-d\TH:i:s\Z' );
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
