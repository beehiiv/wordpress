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
use WP_Post;
use WP_REST_Request;

defined( 'ABSPATH' ) || exit;

/**
 * Creates or schedules a Beehiiv post in the configured publication when newsletter
 * send is enabled and the post is published (or scheduled). Draft saves are skipped
 * unless retrying after a previous failed send. Future send times use Beehiiv
 * `scheduled_at` (UTC).
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
	 * Register hooks that sync newsletters to Beehiiv on save.
	 *
	 * @return void
	 * @since 1.0.0
	 */
	public static function init(): void {
		add_action( 'rest_after_insert_' . self::POST_TYPE, [ self::class, 'on_rest_insert' ], 10, 2 );
		add_action( 'future_to_publish', [ self::class, 'on_future_to_publish' ], 10, 1 );
		add_filter( 'update_post_metadata', [ self::class, 'guard_beehiiv_post_id' ], 10, 3 );
	}

	/**
	 * Prevent clearing or changing the Beehiiv post ID after a successful send.
	 *
	 * @param mixed  $check    Whether to allow updating metadata for the given type.
	 * @param int    $post_id  Post ID.
	 * @param string $meta_key Meta key.
	 * @return mixed False to block the update, or $check to proceed.
	 * @since 1.0.0
	 */
	public static function guard_beehiiv_post_id( $check, $post_id, $meta_key ) {
		if (
			Meta::BEEHIIV_POST_ID === $meta_key
			&& self::has_beehiiv_post_id( (int) $post_id )
		) {
			return false;
		}

		return $check;
	}

	/**
	 * Sync on block editor save when newsletter meta allows.
	 *
	 * @param WP_Post              $post    Inserted or updated post.
	 * @param WP_REST_Request|null $request REST request (meta may only be present here on the same request).
	 * @return void
	 * @since 1.0.0
	 */
	public static function on_rest_insert( WP_Post $post, $request = null ): void {
		self::maybe_send_post_newsletter(
			$post,
			$request instanceof WP_REST_Request ? $request : null
		);
	}

	/**
	 * Sync when a scheduled (`future`) post transitions to `publish` without a REST save.
	 *
	 * Block editor publishes use `rest_after_insert_post`. WordPress releases scheduled posts
	 * via cron (`future` → `publish`) without the REST API; core fires `future_to_publish`.
	 *
	 * @param WP_Post $post Post object.
	 * @return void
	 * @since 1.0.0
	 */
	public static function on_future_to_publish( WP_Post $post ): void {
		if ( self::POST_TYPE !== $post->post_type ) {
			return;
		}

		self::maybe_send_post_newsletter( $post );
	}

	/**
	 * Create or schedule a Beehiiv newsletter when post meta and status allow.
	 *
	 * Draft saves are skipped unless retrying after a failed send. Snippet newsletters
	 * require a public permalink for Read more; defer until `publish`.
	 *
	 * @param WP_Post              $post    Post object.
	 * @param WP_REST_Request|null $request Optional REST request from the block editor save.
	 * @return void
	 * @since 1.0.0
	 */
	public static function maybe_send_post_newsletter( WP_Post $post, ?WP_REST_Request $request = null ): void {
		if ( self::POST_TYPE !== $post->post_type ) {
			return;
		}

		// If post is already sent as newsletter, do nothing.
		if ( self::has_beehiiv_post_id( $post->ID ) ) {
			return;
		}

		if ( ! self::is_send_to_newsletter_enabled( $post->ID, $request ) ) {
			self::clear_error( $post->ID );
			return;
		}

		if ( ! self::should_attempt_send( $post ) ) {
			return;
		}

		if ( ! Manager::is_connected() ) {
			self::record_error(
				$post->ID,
				'send',
				__( 'This site is not connected to Beehiiv.', 'beehiiv' )
			);
			return;
		}

		$send_newsletter_snippet = (bool) get_post_meta( $post->ID, Meta::SEND_TO_NEWSLETTER_SNIPPET, true );

		if ( $send_newsletter_snippet && 'publish' !== $post->post_status ) {
			return;
		}

		self::send( $post->ID );
	}

	/**
	 * Send a WordPress post to Beehiiv as a newsletter (immediate or via scheduled_at).
	 *
	 * @param int $post_id Post ID.
	 * @return void
	 * @since 1.0.0
	 */
	public static function send( int $post_id ): void {
		self::clear_error( $post_id );

		if ( '' === Manager::get_api_key() ) {
			self::fail(
				$post_id,
				'send',
				__( 'Beehiiv API key is not configured.', 'beehiiv' ),
				'Beehiiv API key is not configured.'
			);
			return;
		}

		$publication_id = self::get_publication_id();

		if ( '' === $publication_id ) {
			self::fail(
				$post_id,
				'send',
				__( 'No Beehiiv publication is configured.', 'beehiiv' ),
				'Publication ID is not configured.'
			);
			return;
		}

		$post_object = get_post( $post_id );

		if ( ! $post_object instanceof WP_Post ) {
			self::fail(
				$post_id,
				'save',
				__( 'This post could not be found.', 'beehiiv' ),
				'Post not found.'
			);
			return;
		}

		if ( self::has_beehiiv_post_id( $post_id ) ) {
			return;
		}

		$send_newsletter_snippet = (bool) get_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER_SNIPPET, true );

		// If snippet newsletter is enabled and post is not published, do nothing.
		if ( $send_newsletter_snippet && 'publish' !== $post_object->post_status ) {
			return;
		}

		$beehiiv_post_data = PostSettingsBuilder::get_post_settings( $post_id );

		if ( is_wp_error( $beehiiv_post_data ) ) {
			self::fail(
				$post_id,
				'save',
				self::format_save_error_message( $beehiiv_post_data ),
				$beehiiv_post_data->get_error_message()
			);
			return;
		}

		$result = Posts::create( $publication_id, $beehiiv_post_data );

		if ( ! $result['success'] ) {
			self::fail(
				$post_id,
				'send',
				self::format_send_error_message( $result['error'] ),
				$result['error']
			);
			return;
		}

		// Post created successfully for sending the newsletter.
		// Save the Beehiiv post ID in the post meta.
		update_post_meta( $post_id, Meta::BEEHIIV_POST_ID, $result['post_id'] );
		update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, false );
		self::clear_error( $post_id );
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
	 * Persist a newsletter failure for the block editor and log it.
	 *
	 * @param int    $post_id        Post ID.
	 * @param string $type           `save` or `send`.
	 * @param string $user_message   Message shown in the editor.
	 * @param string $log_message    Message written to the error log.
	 * @return void
	 * @since 1.0.0
	 */
	private static function fail( int $post_id, string $type, string $user_message, string $log_message ): void {
		self::record_error( $post_id, $type, $user_message );
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( sprintf( 'Beehiiv newsletter send failed for post ID %d: %s', $post_id, $log_message ) );
	}

	/**
	 * Store a newsletter error on the post for display in the editor.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $type    `save` or `send`.
	 * @param string $message User-facing error message.
	 * @return void
	 * @since 1.0.0
	 */
	private static function record_error( int $post_id, string $type, string $message ): void {
		$message = trim( $message );

		if ( '' === $message ) {
			self::clear_error( $post_id );
			return;
		}

		update_post_meta( $post_id, Meta::NEWSLETTER_ERROR_TYPE, $type );
		update_post_meta( $post_id, Meta::NEWSLETTER_ERROR, $message );
	}

	/**
	 * Remove any stored newsletter error from the post.
	 *
	 * @param int $post_id Post ID.
	 * @return void
	 * @since 1.0.0
	 */
	private static function clear_error( int $post_id ): void {
		delete_post_meta( $post_id, Meta::NEWSLETTER_ERROR );
		delete_post_meta( $post_id, Meta::NEWSLETTER_ERROR_TYPE );
	}

	/**
	 * Map post-settings validation errors to editor-friendly copy.
	 *
	 * @param \WP_Error $error Validation error from PostSettingsBuilder.
	 * @return string
	 * @since 1.0.0
	 */
	private static function format_save_error_message( \WP_Error $error ): string {
		switch ( $error->get_error_code() ) {
			case 'beehiiv_post_template_id_empty':
				return __( 'No default email template is configured in Beehiiv settings.', 'beehiiv' );
			case 'beehiiv_post_title_or_content_empty':
				return __( 'Add a title and content before sending to Beehiiv.', 'beehiiv' );
			case 'beehiiv_blocks_empty':
				return __( 'This post has no content blocks supported by Beehiiv.', 'beehiiv' );
			case 'beehiiv_post_not_found':
				return __( 'This post could not be found.', 'beehiiv' );
			case 'beehiiv_newsletter_in_past':
				return __(
					'Newsletter cannot be scheduled in the past. Please select a future date and time.',
					'beehiiv'
				);
			case 'beehiiv_newsletter_before_publish':
				return __( 'The newsletter cannot be scheduled before this post is published.', 'beehiiv' );
			case 'beehiiv_newsletter_invalid_date':
				return __(
					'The newsletter send date is not valid. Please select a different date and time.',
					'beehiiv'
				);
			default:
				return $error->get_error_message();
		}
	}

	/**
	 * Map Beehiiv API failures to editor-friendly copy.
	 *
	 * @param string $error Error string from the API client.
	 * @return string
	 * @since 1.0.0
	 */
	private static function format_send_error_message( string $error ): string {
		$error = trim( $error );

		if ( '' === $error ) {
			return __( 'Beehiiv could not send this newsletter. Please try again.', 'beehiiv' );
		}

		return $error;
	}

	/**
	 * Whether this save should trigger a Beehiiv send attempt.
	 *
	 * Sends on publish or schedule (`publish`, `future`), and on any save while a
	 * previous send failure is still recorded so the editor can retry.
	 *
	 * @param WP_Post $post Post object.
	 * @return bool
	 * @since 1.0.0
	 */
	private static function should_attempt_send( WP_Post $post ): bool {
		if ( self::has_newsletter_error( $post->ID ) ) {
			return true;
		}

		return in_array( $post->post_status, [ 'publish', 'future' ], true );
	}

	/**
	 * Whether a prior newsletter save or send left an error on this post.
	 *
	 * @param int $post_id Post ID.
	 * @return bool
	 * @since 1.0.0
	 */
	private static function has_newsletter_error( int $post_id ): bool {
		$error = get_post_meta( $post_id, Meta::NEWSLETTER_ERROR, true );

		return is_string( $error ) && '' !== trim( $error );
	}

	/**
	 * Whether the post is marked to send to the Beehiiv newsletter.
	 *
	 * @param int                  $post_id Post ID.
	 * @param WP_REST_Request|null $request REST request when syncing on editor save.
	 * @return bool
	 * @since 1.0.0
	 */
	private static function is_send_to_newsletter_enabled( int $post_id, ?WP_REST_Request $request = null ): bool {
		if ( $request instanceof WP_REST_Request ) {
			$meta = $request->get_param( 'meta' );

			if ( is_array( $meta ) && array_key_exists( Meta::SEND_TO_NEWSLETTER, $meta ) ) {
				return rest_sanitize_boolean( $meta[ Meta::SEND_TO_NEWSLETTER ] );
			}
		}

		$value = get_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, true );

		return rest_sanitize_boolean( $value );
	}
}
