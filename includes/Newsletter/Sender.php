<?php
/**
 * Sends WordPress posts to Beehiiv as newsletter posts.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\Admin\Options;
use Beehiiv\API\Resources\Posts;
use Beehiiv\Connection\Manager;
use Beehiiv\Editor\Meta;
use DateTimeImmutable;
use Exception;
use WP_Error;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Creates a Beehiiv post in the configured publication when a post is published.
 *
 * @link https://developers.beehiiv.com/api-reference/posts/create
 * @since 1.0.0
 */
final class Sender {

	/**
	 * Post type that supports Beehiiv newsletters.
	 *
	 * @since 1.0.0
	 */
	private const POST_TYPE = 'post';

	/**
	 * Register hooks that send newsletters on publish (immediate sends only).
	 *
	 * @return void
	 * @since 1.0.0
	 */
	public static function init(): void {
		add_action( 'rest_after_insert_' . self::POST_TYPE, [ self::class, 'on_rest_insert' ], 10, 1 );
		add_action( 'future_to_publish', [ self::class, 'on_future_to_publish' ], 10, 1 );
	}

	/**
	 * Send on block editor save when the post is published.
	 *
	 * @param WP_Post $post Inserted or updated post.
	 * @return void
	 * @since 1.0.0
	 */
	public static function on_rest_insert( WP_Post $post ): void {
		self::maybe_send_on_publish( $post );
	}

	/**
	 * Send when a scheduled WordPress post goes live (no REST save on that transition).
	 *
	 * @param WP_Post $post Post object.
	 * @return void
	 * @since 1.0.0
	 */
	public static function on_future_to_publish( WP_Post $post ): void {
		if ( self::POST_TYPE !== $post->post_type ) {
			return;
		}

		self::maybe_send_on_publish( $post );
	}

	/**
	 * Send immediately when post meta and status allow (no WP-Cron scheduling).
	 *
	 * @param WP_Post $post Post object.
	 * @return void
	 * @since 1.0.0
	 */
	public static function maybe_send_on_publish( WP_Post $post ): void {
		if ( self::POST_TYPE !== $post->post_type ) {
			return;
		}

		if ( ! Manager::is_connected() ) {
			return;
		}

		if ( self::has_beehiiv_post_id( $post->ID ) ) {
			return;
		}

		if ( ! self::is_send_to_newsletter_enabled( $post->ID ) ) {
			return;
		}

		if ( self::has_future_send_date( $post->ID ) ) {
			return;
		}

		$send_snippet = (bool) get_post_meta( $post->ID, Meta::SEND_TO_NEWSLETTER_SNIPPET, true );

		if ( $send_snippet && 'publish' !== $post->post_status ) {
			return;
		}

		if ( 'publish' !== $post->post_status ) {
			return;
		}

		self::send( $post->ID );
	}

	/**
	 * Send a WordPress post to Beehiiv as a newsletter.
	 *
	 * @param int $post_id Post ID.
	 * @return void
	 * @since 1.0.0
	 */
	public static function send( int $post_id ): void {
		if ( '' === Manager::get_api_key() ) {
			self::log_error( $post_id, 'Beehiiv API key is not configured.' );
			return;
		}

		$publication_id = self::get_publication_id();

		if ( '' === $publication_id ) {
			self::log_error( $post_id, 'Publication ID is not configured.' );
			return;
		}

		$post_object = get_post( $post_id );

		if ( ! $post_object instanceof WP_Post ) {
			self::log_error( $post_id, 'Post not found.' );
			return;
		}

		if ( self::has_beehiiv_post_id( $post_id ) ) {
			return;
		}

		$send_snippet = (bool) get_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER_SNIPPET, true );

		if ( $send_snippet && 'publish' !== $post_object->post_status ) {
			self::log_error( $post_id, 'Snippet newsletter requires a published post.' );
			return;
		}

		$beehiiv_post_data = PostSettingsBuilder::get_post_settings( $post_id );

		if ( is_wp_error( $beehiiv_post_data ) ) {
			self::log_error( $post_id, $beehiiv_post_data->get_error_message() );
			return;
		}

		$result = Posts::create( $publication_id, $beehiiv_post_data );

		if ( ! $result['success'] ) {
			self::log_error( $post_id, $result['error'] );
			return;
		}

		update_post_meta( $post_id, Meta::BEEHIIV_POST_ID, $result['post_id'] );
		update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, false );
	}

	/**
	 * Site-wide Beehiiv publication ID from plugin settings.
	 *
	 * @return string
	 * @since 1.0.0
	 */
	public static function get_publication_id(): string {
		$settings = Options::get();

		return isset( $settings['publication_id'] )
			? trim( (string) $settings['publication_id'] )
			: '';
	}

	/**
	 * Whether this WordPress post already has a linked Beehiiv post.
	 *
	 * @param int $post_id Post ID.
	 * @return bool
	 * @since 1.0.0
	 */
	public static function has_beehiiv_post_id( int $post_id ): bool {
		$beehiiv_post_id = get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true );

		return is_string( $beehiiv_post_id ) && '' !== $beehiiv_post_id;
	}

	/**
	 * Log a newsletter send failure.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $message Error message.
	 * @return void
	 * @since 1.0.0
	 */
	private static function log_error( int $post_id, string $message ): void {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( sprintf( 'Beehiiv newsletter send failed for post ID %d: %s', $post_id, $message ) );
	}

	/**
	 * Whether the post is marked to send to the Beehiiv newsletter.
	 *
	 * @param int $post_id Post ID.
	 * @return bool
	 * @since 1.0.0
	 */
	private static function is_send_to_newsletter_enabled( int $post_id ): bool {
		$value = get_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, true );

		return rest_sanitize_boolean( $value );
	}

	/**
	 * Whether a future send date is set (scheduled sends are not implemented yet).
	 *
	 * @param int $post_id Post ID.
	 * @return bool
	 * @since 1.0.0
	 */
	private static function has_future_send_date( int $post_id ): bool {
		$scheduled_date = get_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER_DATE, true );
		$scheduled_date = is_string( $scheduled_date ) ? trim( $scheduled_date ) : '';

		if ( '' === $scheduled_date ) {
			return false;
		}

		try {
			$scheduled_date_object = new DateTimeImmutable( $scheduled_date, wp_timezone() );

			return $scheduled_date_object->getTimestamp() > time();
		} catch ( Exception $e ) {
			return false;
		}
	}
}
