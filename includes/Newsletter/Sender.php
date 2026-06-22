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
 * send is enabled and the post is published (or scheduled). Updates linked Beehiiv posts
 * when the WordPress post changes before the newsletter sends. Draft saves are skipped
 * unless retrying after a previous failed send. Future send times use Beehiiv
 * `scheduled_at` (UTC).
 *
 * @link https://developers.beehiiv.com/api-reference/posts/create
 * @link https://developers.beehiiv.com/api-reference/posts/update
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
		add_action( 'transition_post_status', [ self::class, 'on_transition_post_status' ], 10, 3 );
		add_action( 'before_delete_post', [ self::class, 'on_before_delete_post' ], 10, 1 );
		add_filter( 'update_post_metadata', [ self::class, 'guard_beehiiv_post_id' ], 10, 4 );
	}

	/**
	 * Prevent clearing or changing the Beehiiv post ID after a successful send.
	 *
	 * During block editor publish, newsletter sync can run on `transition_post_status`
	 * before REST meta is applied. The REST payload may include `_beehiiv_post_id`
	 * as an empty string even though the database already has a linked ID. Do not
	 * overwrite the stored value; short-circuit as success so the REST save does not fail.
	 *
	 * @since 1.0.0
	 *
	 * @param mixed  $check      Whether to allow updating metadata for the given type.
	 * @param int    $post_id    Post ID.
	 * @param string $meta_key   Meta key.
	 * @param mixed  $meta_value Proposed meta value.
	 *
	 * @return mixed Null to proceed, true to allow without updating, false to block.
	 */
	public static function guard_beehiiv_post_id( $check, $post_id, $meta_key, $meta_value ) {

		if ( Meta::BEEHIIV_POST_ID !== $meta_key ) {
			return $check;
		}

		$existing = get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true );
		$existing = is_string( $existing ) ? trim( $existing ) : '';

		if ( '' === $existing ) {
			return $check;
		}

		$incoming = is_string( $meta_value ) ? trim( wp_unslash( $meta_value ) ) : '';

		if ( $incoming === $existing ) {
			return $check;
		}

		// Keep the stored ID when REST sends empty or attempts to change it.
		return true;
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
	 * Cancel or resend Beehiiv newsletters when post visibility changes.
	 *
	 * @param string  $new_status New post status.
	 * @param string  $old_status Old post status.
	 * @param WP_Post $post       Post object.
	 * @return void
	 * @since 1.0.0
	 */
	public static function on_transition_post_status( string $new_status, string $old_status, WP_Post $post ): void {
		if ( self::POST_TYPE !== $post->post_type || $new_status === $old_status ) {
			return;
		}

		if ( self::should_cancel_newsletter_for_status_change( $new_status, $post ) ) {
			self::cancel_scheduled_newsletter( $post->ID );
			return;
		}

		if ( self::should_resend_newsletter_for_status_change( $new_status, $old_status, $post ) ) {
			self::maybe_send_post_newsletter( $post );
		}
	}

	/**
	 * Cancel a linked Beehiiv newsletter before the WordPress post is deleted.
	 *
	 * @param int $post_id Post ID.
	 * @return void
	 * @since 1.0.0
	 */
	public static function on_before_delete_post( int $post_id ): void {
		$post = get_post( $post_id );

		if ( ! $post instanceof WP_Post || self::POST_TYPE !== $post->post_type ) {
			return;
		}

		self::cancel_scheduled_newsletter( $post_id );
	}

	/**
	 * Delete or archive the linked Beehiiv post and re-queue send for republication.
	 *
	 * @param int $post_id Post ID.
	 * @return void
	 * @since 1.0.0
	 */
	public static function cancel_scheduled_newsletter( int $post_id ): void {
		if ( ! self::has_beehiiv_post_id( $post_id ) ) {
			return;
		}

		$beehiiv_post_id = get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true );
		$beehiiv_post_id = is_string( $beehiiv_post_id ) ? trim( $beehiiv_post_id ) : '';

		if ( '' === $beehiiv_post_id ) {
			return;
		}

		if ( Manager::is_connected() ) {
			$publication_id = self::get_publication_id();

			if ( '' !== $publication_id ) {
				$result = Posts::delete( $publication_id, $beehiiv_post_id );

				if ( ! $result['success'] ) {
					self::record_error(
						$post_id,
						'send',
						__(
							// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
							"We couldn't cancel the scheduled newsletter in Beehiiv. Try saving the post again, or cancel it directly in Beehiiv.",
							'beehiiv'
						)
					);
					// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
					error_log(
						sprintf(
							'Beehiiv newsletter cancel failed for post ID %d: %s',
							$post_id,
							$result['error']
						)
					);
					return;
				}
			}
		}

		delete_post_meta( $post_id, Meta::BEEHIIV_POST_ID );
		update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, true );
		self::clear_error( $post_id );
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

		if ( self::has_beehiiv_post_id( $post->ID ) ) {
			self::maybe_update_post_newsletter( $post );
			return;
		}

		if ( ! self::is_send_to_newsletter_enabled( $post->ID, $request ) ) {
			self::clear_error( $post->ID );
			return;
		}

		if ( ! self::can_sync_newsletter( $post ) ) {
			return;
		}

		if ( ! Manager::is_connected() ) {
			self::record_error(
				$post->ID,
				'send',
				self::not_connected_message()
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
	 * Update a linked Beehiiv newsletter when the WordPress post changes before send.
	 *
	 * @param WP_Post $post Post object.
	 * @return void
	 * @since 1.0.0
	 */
	public static function maybe_update_post_newsletter( WP_Post $post ): void {
		if ( ! self::can_sync_newsletter( $post ) ) {
			return;
		}

		if ( ! Manager::is_connected() ) {
			self::record_error(
				$post->ID,
				'send',
				self::not_connected_message()
			);
			return;
		}

		$send_newsletter_snippet = (bool) get_post_meta( $post->ID, Meta::SEND_TO_NEWSLETTER_SNIPPET, true );

		if ( $send_newsletter_snippet && 'publish' !== $post->post_status ) {
			return;
		}

		self::update( $post->ID );
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

		if ( ! Manager::is_connected() ) {
			self::fail(
				$post_id,
				'send',
				self::not_connected_message(),
				'Beehiiv is not connected.'
			);
			return;
		}

		$publication_id = self::get_publication_id();

		if ( '' === $publication_id ) {
			self::fail(
				$post_id,
				'send',
				self::no_publication_message(),
				'Publication ID is not configured.'
			);
			return;
		}

		$post_object = get_post( $post_id );

		if ( ! $post_object instanceof WP_Post ) {
			self::fail(
				$post_id,
				'save',
				__( 'This post no longer exists. Save or reload the editor and try again.', 'beehiiv' ),
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
	 * Update a linked Beehiiv newsletter before it is sent.
	 *
	 * @param int $post_id Post ID.
	 * @return void
	 * @since 1.0.0
	 */
	public static function update( int $post_id ): void {
		self::clear_error( $post_id );

		if ( '' === Manager::is_connected() ) {
			self::fail(
				$post_id,
				'send',
				self::not_connected_message(),
				'Beehiiv is not connected.'
			);
			return;
		}

		$publication_id = self::get_publication_id();

		if ( '' === $publication_id ) {
			self::fail(
				$post_id,
				'send',
				self::no_publication_message(),
				'Publication ID is not configured.'
			);
			return;
		}

		$beehiiv_post_id = get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true );
		$beehiiv_post_id = is_string( $beehiiv_post_id ) ? trim( $beehiiv_post_id ) : '';

		if ( '' === $beehiiv_post_id ) {
			return;
		}

		$post_object = get_post( $post_id );

		if ( ! $post_object instanceof WP_Post ) {
			self::fail(
				$post_id,
				'save',
				__( 'This post no longer exists. Save or reload the editor and try again.', 'beehiiv' ),
				'Post not found.'
			);
			return;
		}

		$payload = PostSettingsBuilder::get_update_payload( $post_id );

		if ( is_wp_error( $payload ) ) {
			self::fail(
				$post_id,
				'save',
				self::format_save_error_message( $payload ),
				$payload->get_error_message()
			);
			return;
		}

		$result = Posts::update( $publication_id, $beehiiv_post_id, $payload );

		if ( ! $result['success'] ) {
			self::fail(
				$post_id,
				'send',
				self::format_update_error_message( $result['error'] ),
				$result['error']
			);
			return;
		}

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
				return __(
					// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
					'Choose a default post template in <a>Beehiiv settings</a>, or pick one for this post in the Beehiiv sidebar.',
					'beehiiv'
				);
			case 'beehiiv_post_title_or_content_empty':
				return __( 'Add a title and body content before sending this newsletter.', 'beehiiv' );
			case 'beehiiv_blocks_empty':
				return __(
					"This post doesn't include any blocks Beehiiv can send. Add supported content and try again.",
					'beehiiv'
				);
			case 'beehiiv_post_not_found':
				return __( 'This post no longer exists. Save or reload the editor and try again.', 'beehiiv' );
			case 'beehiiv_newsletter_in_past':
				return __(
					'That send date has already passed. Pick a future date and time in the newsletter schedule.',
					'beehiiv'
				);
			case 'beehiiv_newsletter_before_publish':
				return __(
					// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
					"The newsletter can't send before this post publishes. Choose a later send time, or schedule the post first.",
					'beehiiv'
				);
			case 'beehiiv_newsletter_invalid_date':
				return __(
					"That send date isn't valid. Open the newsletter schedule and choose a different date and time.",
					'beehiiv'
				);
			default:
				return $error->get_error_message();
		}
	}

	/**
	 * User-facing message when the site is not connected to Beehiiv.
	 *
	 * Uses an `<a>` placeholder rendered as a settings link in the block editor.
	 *
	 * @return string
	 * @since 1.0.0
	 */
	private static function not_connected_message(): string {
		return __(
			'Connect your Beehiiv account in <a>Beehiiv settings</a> to send this newsletter.',
			'beehiiv'
		);
	}

	/**
	 * User-facing message when no publication is configured.
	 *
	 * @return string
	 * @since 1.0.0
	 */
	private static function no_publication_message(): string {
		return __( 'Choose a publication in <a>Beehiiv settings</a>, then try again.', 'beehiiv' );
	}

	/**
	 * Map raw API and transport error strings to editor-friendly copy.
	 *
	 * Log messages keep the original string from {@see Posts} or {@see Client}.
	 *
	 * @param string $error Error string from the API client.
	 * @return string Mapped message, or empty when input is empty.
	 * @since 1.0.0
	 */
	private static function format_api_error_message( string $error ): string {
		$error = trim( $error );

		if ( '' === $error ) {
			return '';
		}

		if ( preg_match( '/^HTTP 404:/i', $error ) ) {
			return __( 'Post not found.', 'beehiiv' );
		}

		if ( preg_match( '/^HTTP 401:/i', $error ) || preg_match( '/^HTTP 403:/i', $error ) ) {
			return __(
				'Your Beehiiv connection expired. Reconnect in <a>Beehiiv settings</a>.',
				'beehiiv'
			);
		}

		if ( preg_match( '/^HTTP 422:/i', $error ) ) {
			return __( 'Beehiiv rejected this newsletter.', 'beehiiv' );
		}

		if ( preg_match( '/^HTTP 429:/i', $error ) ) {
			return __( 'Too many requests. Try again in a moment.', 'beehiiv' );
		}

		if ( preg_match( '/^HTTP 5\d\d:/i', $error ) ) {
			return __( 'Beehiiv is temporarily unavailable. Try again later.', 'beehiiv' );
		}

		if ( preg_match( '/^HTTP \d+:/i', $error ) ) {
			return __( 'Something went wrong. Try saving the post again.', 'beehiiv' );
		}

		if ( 'Publication ID is empty.' === $error ) {
			return self::no_publication_message();
		}

		if ( 'Publication ID or post ID is empty.' === $error ) {
			return __( 'Post not found.', 'beehiiv' );
		}

		if ( 'Update payload is empty.' === $error || 'No post ID found in the Beehiiv API response.' === $error ) {
			return __( 'Something went wrong. Try saving the post again.', 'beehiiv' );
		}

		if ( false !== stripos( $error, 'timed out' ) ) {
			return __( 'Beehiiv took too long to respond. Try again.', 'beehiiv' );
		}

		if ( false !== stripos( $error, 'cURL error' ) ) {
			return __( "Couldn't reach Beehiiv. Try again.", 'beehiiv' );
		}

		return $error;
	}

	/**
	 * Map Beehiiv API failures to editor-friendly copy.
	 *
	 * @param string $error Error string from the API client.
	 * @return string
	 * @since 1.0.0
	 */
	private static function format_send_error_message( string $error ): string {
		$mapped = self::format_api_error_message( $error );

		if ( '' === $mapped ) {
			return __( "Something went wrong and the newsletter wasn't sent. Try saving the post again.", 'beehiiv' );
		}

		return $mapped;
	}

	/**
	 * Map Beehiiv update API failures to editor-friendly copy.
	 *
	 * @param string $error Error string from the API client.
	 * @return string
	 * @since 1.0.0
	 */
	private static function format_update_error_message( string $error ): string {
		$mapped = self::format_api_error_message( $error );

		if ( '' === $mapped ) {
			return __(
				"Something went wrong and the newsletter couldn't be updated. Try saving the post again.",
				'beehiiv'
			);
		}

		return $mapped;
	}

	/**
	 * Whether Beehiiv should sync for this post right now.
	 *
	 * Syncs only when the post is published or scheduled, and only when the current
	 * user can publish posts (system/cron requests are always allowed).
	 *
	 * @param WP_Post $post Post object.
	 * @return bool
	 * @since 1.0.0
	 */
	private static function can_sync_newsletter( WP_Post $post ): bool {
		if ( ! in_array( $post->post_status, [ 'publish', 'future' ], true ) ) {
			return false;
		}

		if ( doing_action( 'future_to_publish' ) || wp_doing_cron() ) {
			return true;
		}

		if ( ! is_user_logged_in() ) {
			return true;
		}

		return current_user_can( 'publish_posts', $post->ID );
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

	/**
	 * Whether a status change should cancel a linked Beehiiv newsletter.
	 *
	 * @param string  $new_status New post status.
	 * @param WP_Post $post       Post object.
	 * @return bool
	 * @since 1.0.0
	 */
	private static function should_cancel_newsletter_for_status_change( string $new_status, WP_Post $post ): bool {
		return self::has_beehiiv_post_id( $post->ID ) && self::is_non_public_status( $new_status );
	}

	/**
	 * Whether a status change should attempt to send the newsletter again.
	 *
	 * @param string  $new_status New post status.
	 * @param string  $old_status Old post status.
	 * @param WP_Post $post       Post object.
	 * @return bool
	 * @since 1.0.0
	 */
	private static function should_resend_newsletter_for_status_change(
		string $new_status,
		string $old_status,
		WP_Post $post
	): bool {
		if ( self::has_beehiiv_post_id( $post->ID ) ) {
			return false;
		}

		if ( ! self::is_public_send_status( $new_status ) || ! self::is_non_public_status( $old_status ) ) {
			return false;
		}

		return self::is_send_to_newsletter_enabled( $post->ID );
	}

	/**
	 * Post statuses that allow creating or scheduling a Beehiiv newsletter.
	 *
	 * @param string $status Post status.
	 * @return bool
	 * @since 1.0.0
	 */
	private static function is_public_send_status( string $status ): bool {
		return in_array( $status, [ 'publish', 'future' ], true );
	}

	/**
	 * Post statuses where the post is not publicly available.
	 *
	 * @param string $status Post status.
	 * @return bool
	 * @since 1.0.0
	 */
	private static function is_non_public_status( string $status ): bool {
		return in_array( $status, [ 'draft', 'pending', 'private', 'trash' ], true );
	}
}
