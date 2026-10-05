<?php
/**
 * Sends WordPress posts to beehiiv as newsletter posts.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\API\Resources\Posts;
use Beehiiv\Connection\Manager;
use Beehiiv\Editor\Meta;
use WP_Post;
use WP_REST_Request;

defined( 'ABSPATH' ) || exit;

/**
 * Creates or schedules a beehiiv post in the post's publication when newsletter
 * send is enabled and the post is published (or scheduled). Updates linked beehiiv posts
 * when the WordPress post changes before the newsletter sends. Draft saves are skipped
 * unless retrying after a previous failed send. Future send times use beehiiv
 * `scheduled_at` (UTC).
 *
 * @link https://developers.beehiiv.com/api-reference/posts/create
 * @link https://developers.beehiiv.com/api-reference/posts/update
 * @since 1.0.0
 */
final class Sender {

	/**
	 * Post type that supports beehiiv newsletters.
	 *
	 * @since 1.0.0
	 */
	private const POST_TYPE = 'post';

	/**
	 * Seconds before `scheduled_at` from which a scheduled newsletter counts as sent.
	 *
	 * Keeps a publication or template move from racing beehiiv's own send.
	 *
	 * @since x.x.x
	 */
	private const SENT_SAFETY_MARGIN = 60;

	/**
	 * Meta keys that lock once beehiiv has sent the newsletter.
	 *
	 * @since x.x.x
	 */
	private const LOCKED_AFTER_SEND_META_KEYS = [
		Meta::BEEHIIV_PUBLICATION_ID,
		Meta::BEEHIIV_POST_TEMPLATE_ID,
	];

	/**
	 * Whether the server is writing locked meta itself.
	 *
	 * @var bool
	 */
	private static $bypass_meta_lock = false;

	/**
	 * Register hooks that sync newsletters to beehiiv on save.
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
		add_filter( 'update_post_metadata', [ self::class, 'guard_locked_newsletter_meta' ], 10, 4 );
		add_filter( 'add_post_metadata', [ self::class, 'guard_locked_newsletter_meta' ], 10, 4 );
	}

	/**
	 * Keep the post's publication and template unchanged once beehiiv has sent the newsletter.
	 *
	 * Applies to every save path (block editor, REST, PHP). Changes are ignored
	 * rather than rejected so a full editor save does not fail.
	 *
	 * @since x.x.x
	 *
	 * @param mixed  $check      Whether to allow updating metadata for the given type.
	 * @param int    $post_id    Post ID.
	 * @param string $meta_key   Meta key.
	 * @param mixed  $meta_value Proposed meta value.
	 *
	 * @return mixed Null to proceed, true to skip without updating.
	 */
	public static function guard_locked_newsletter_meta( $check, $post_id, $meta_key, $meta_value ) {

		if ( self::$bypass_meta_lock || ! in_array( $meta_key, self::LOCKED_AFTER_SEND_META_KEYS, true ) ) {
			return $check;
		}

		if ( ! self::is_newsletter_sent( (int) $post_id ) ) {
			return $check;
		}

		$existing = get_post_meta( (int) $post_id, $meta_key, true );
		$existing = is_string( $existing ) ? trim( $existing ) : '';
		$incoming = is_string( $meta_value ) ? trim( wp_unslash( $meta_value ) ) : '';

		if ( $incoming === $existing ) {
			return $check;
		}

		return true;
	}

	/**
	 * Whether beehiiv has sent (or is about to send) the post's newsletter.
	 *
	 * A linked newsletter counts as sent when it was sent immediately (no
	 * `scheduled_at`) or its scheduled send time is within
	 * {@see SENT_SAFETY_MARGIN} seconds or has passed.
	 *
	 * @param int $post_id Post ID.
	 * @return bool
	 * @since x.x.x
	 */
	public static function is_newsletter_sent( int $post_id ): bool {
		return self::has_beehiiv_post_id( $post_id ) && self::send_time_has_passed( $post_id );
	}

	/**
	 * Whether the linked newsletter's send time has been reached.
	 *
	 * @param int $post_id Post ID.
	 * @return bool
	 * @since x.x.x
	 */
	private static function send_time_has_passed( int $post_id ): bool {
		$scheduled_at = get_post_meta( $post_id, Meta::BEEHIIV_SCHEDULED_AT, true );
		$scheduled_at = is_string( $scheduled_at ) ? trim( $scheduled_at ) : '';

		if ( '' === $scheduled_at ) {
			return true;
		}

		$timestamp = strtotime( $scheduled_at );

		if ( false === $timestamp ) {
			return true;
		}

		return $timestamp <= time() + self::SENT_SAFETY_MARGIN;
	}

	/**
	 * Write a meta key that locks after send, bypassing the lock for server writes.
	 *
	 * @param int    $post_id  Post ID.
	 * @param string $meta_key Meta key.
	 * @param string $value    Value.
	 * @return void
	 * @since x.x.x
	 */
	private static function update_locked_meta( int $post_id, string $meta_key, string $value ): void {
		self::$bypass_meta_lock = true;
		update_post_meta( $post_id, $meta_key, $value );
		self::$bypass_meta_lock = false;
	}

	/**
	 * Record where the linked beehiiv post lives and which template it uses.
	 *
	 * @param int    $post_id          Post ID.
	 * @param string $publication_id   Publication the beehiiv post was created in.
	 * @param string $post_template_id Template it was created with.
	 * @return void
	 * @since x.x.x
	 */
	private static function record_linked_publication(
		int $post_id,
		string $publication_id,
		string $post_template_id
	): void {
		self::update_locked_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, $publication_id );
		update_post_meta( $post_id, Meta::BEEHIIV_LINKED_PUBLICATION_ID, $publication_id );
		update_post_meta( $post_id, Meta::BEEHIIV_LINKED_POST_TEMPLATE_ID, $post_template_id );
	}

	/**
	 * Forget where a beehiiv post lived after it was deleted.
	 *
	 * @param int $post_id Post ID.
	 * @return void
	 * @since x.x.x
	 */
	private static function clear_linked_publication( int $post_id ): void {
		delete_post_meta( $post_id, Meta::BEEHIIV_LINKED_PUBLICATION_ID );
		delete_post_meta( $post_id, Meta::BEEHIIV_LINKED_POST_TEMPLATE_ID );
	}

	/**
	 * Prevent clearing the beehiiv post ID after a successful send.
	 *
	 * During block editor publish, newsletter sync can run on `rest_after_insert_post`
	 * after REST meta is applied. The REST payload may include `_beehiiv_post_id`
	 * as an empty string even though the database already has a linked ID. Do not
	 * overwrite the stored value; short-circuit as success so the REST save does not fail.
	 *
	 * Intentional ID changes (for example after {@see recreate_linked_post()}) must
	 * still be allowed so later updates target the active beehiiv post.
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

		// Keep the stored ID when REST sends an empty value.
		if ( '' === $incoming ) {
			return true;
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
	 * Cancel or resend beehiiv newsletters when post visibility changes.
	 *
	 * Block editor saves defer send/update to {@see on_rest_insert()} so newsletter meta
	 * from the REST payload is available and sync runs once per request. Cancels still run
	 * here so unpublishing via the block editor removes linked beehiiv posts promptly.
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

		if ( self::should_defer_send_to_rest() ) {
			return;
		}

		if ( self::should_resend_newsletter_for_status_change( $new_status, $old_status, $post ) ) {
			self::maybe_send_post_newsletter( $post );
		}
	}

	/**
	 * Cancel a linked beehiiv newsletter before the WordPress post is deleted.
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
	 * Delete or archive the linked beehiiv post and re-queue send for republication.
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
			$publication_id = PublicationResolver::get_linked_publication_id( $post_id );

			if ( '' !== $publication_id ) {
				$result = Posts::delete( $publication_id, $beehiiv_post_id );

				if ( ! $result['success'] ) {
					self::record_error(
						$post_id,
						'send',
						__(
							// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
							"We couldn't cancel the scheduled newsletter in beehiiv. Try saving the post again, or cancel it directly in beehiiv.",
							'beehiiv'
						)
					);
					// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
					error_log(
						sprintf(
							'beehiiv newsletter cancel failed for post ID %d: %s',
							$post_id,
							$result['error']
						)
					);
					return;
				}
			}
		}

		delete_post_meta( $post_id, Meta::BEEHIIV_POST_ID );
		delete_post_meta( $post_id, Meta::BEEHIIV_SCHEDULED_AT );
		self::clear_linked_publication( $post_id );
		update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, true );
		self::clear_error( $post_id );
	}

	/**
	 * Create or schedule a beehiiv newsletter when post meta and status allow.
	 *
	 * Draft saves are skipped unless retrying after a failed send. Future send times use
	 * beehiiv `scheduled_at` (UTC).
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

		self::send( $post->ID );
	}

	/**
	 * Update a linked beehiiv newsletter when the WordPress post changes before send.
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

		self::update( $post->ID );
	}

	/**
	 * Send a WordPress post to beehiiv as a newsletter (immediate or via scheduled_at).
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
				'beehiiv is not connected.'
			);
			return;
		}

		$target         = PublicationResolver::resolve_target( $post_id );
		$publication_id = $target['publication_id'];

		if ( '' === $publication_id ) {
			self::fail(
				$post_id,
				'send',
				self::no_post_publication_message(),
				'No publication chosen for the post and no default publication configured.'
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

		$beehiiv_post_data = PostSettingsBuilder::get_post_settings( $post_id, false, $publication_id );

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
		// Record its publication before the link so later actions target it.
		self::record_linked_publication(
			$post_id,
			$publication_id,
			(string) ( $beehiiv_post_data['post_template_id'] ?? '' )
		);
		update_post_meta( $post_id, Meta::BEEHIIV_POST_ID, $result['post_id'] );
		update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, false );
		self::persist_scheduled_at_meta( $post_id, $beehiiv_post_data['scheduled_at'] ?? null );
		self::clear_error( $post_id );

		if ( '' !== $target['fallback_from'] ) {
			self::record_error(
				$post_id,
				'publication_fallback',
				self::publication_fallback_message( $target['fallback_from'], $publication_id )
			);
		}
	}

	/**
	 * Update a linked beehiiv newsletter before it is sent.
	 *
	 * @param int $post_id Post ID.
	 * @return void
	 * @since 1.0.0
	 */
	public static function update( int $post_id ): void {
		self::clear_error( $post_id );

		if ( ! Manager::is_connected() ) {
			self::fail(
				$post_id,
				'send',
				self::not_connected_message(),
				'beehiiv is not connected.'
			);
			return;
		}

		$publication_id = PublicationResolver::get_linked_publication_id( $post_id );

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

		$target_publication_id = self::get_move_target_publication( $post_id, $publication_id );

		$update = PostSettingsBuilder::build_update(
			$post_id,
			'' !== $target_publication_id ? $target_publication_id : $publication_id
		);

		if ( is_wp_error( $update ) ) {
			self::fail(
				$post_id,
				'save',
				self::format_save_error_message( $update ),
				$update->get_error_message()
			);
			return;
		}

		$new_scheduled_at = $update['meta']['scheduled_at'];

		if ( '' !== $target_publication_id ) {
			if ( ! is_string( $new_scheduled_at ) || '' === trim( $new_scheduled_at ) ) {
				$new_scheduled_at = get_post_meta( $post_id, Meta::BEEHIIV_SCHEDULED_AT, true );
				$new_scheduled_at = is_string( $new_scheduled_at ) ? trim( $new_scheduled_at ) : '';
			}

			self::recreate_linked_post(
				$post_id,
				$publication_id,
				$beehiiv_post_id,
				$target_publication_id,
				$new_scheduled_at,
				$update['meta']
			);
			return;
		}

		if ( is_string( $new_scheduled_at ) && '' !== trim( $new_scheduled_at ) ) {
			self::recreate_linked_post(
				$post_id,
				$publication_id,
				$beehiiv_post_id,
				$publication_id,
				$new_scheduled_at,
				$update['meta']
			);
			return;
		}

		$result = Posts::update( $publication_id, $beehiiv_post_id, $update['payload'] );

		if ( ! $result['success'] ) {
			self::fail(
				$post_id,
				'send',
				self::format_update_error_message( $result['error'] ),
				$result['error']
			);
			return;
		}

		self::apply_update_meta( $post_id, $update['meta'] );
		self::clear_error( $post_id );
	}

	/**
	 * Publication a scheduled, unsent newsletter must move to, if any.
	 *
	 * A move is needed when the post's chosen publication differs from the one its
	 * beehiiv post lives in, or when its chosen template differs from the one the
	 * beehiiv post was created with (the update API cannot change the template).
	 * Posts linked before per-post publications have no recorded template, so only
	 * a publication change moves them.
	 *
	 * @param int    $post_id               Post ID.
	 * @param string $linked_publication_id Publication the beehiiv post lives in.
	 * @return string Target publication ID, or empty when no move is needed.
	 * @since x.x.x
	 */
	private static function get_move_target_publication( int $post_id, string $linked_publication_id ): string {
		if ( self::is_newsletter_sent( $post_id ) ) {
			return '';
		}

		$target_publication_id = PublicationResolver::resolve_target( $post_id )['publication_id'];

		if ( '' !== $target_publication_id && $target_publication_id !== $linked_publication_id ) {
			return $target_publication_id;
		}

		$linked_template_id = get_post_meta( $post_id, Meta::BEEHIIV_LINKED_POST_TEMPLATE_ID, true );
		$linked_template_id = is_string( $linked_template_id ) ? trim( $linked_template_id ) : '';
		$chosen_template_id = get_post_meta( $post_id, Meta::BEEHIIV_POST_TEMPLATE_ID, true );
		$chosen_template_id = is_string( $chosen_template_id ) ? trim( $chosen_template_id ) : '';

		if ( '' !== $linked_template_id && '' !== $chosen_template_id && $chosen_template_id !== $linked_template_id ) {
			return $linked_publication_id;
		}

		return '';
	}

	/**
	 * Recreate a linked beehiiv post in a publication.
	 *
	 * Used when its send time must move later, or when a scheduled, unsent newsletter
	 * moves to another publication or template. The update API rejects `scheduled_at`
	 * and template changes on confirmed posts, so we delete the existing post and
	 * create a new one. The new payload is validated first, so nothing is deleted
	 * when it cannot be created.
	 *
	 * @param int                                                       $post_id             Post ID.
	 * @param string                                                    $from_publication_id Current publication.
	 * @param string                                                    $beehiiv_post_id     Linked beehiiv post ID.
	 * @param string                                                    $to_publication_id   New publication.
	 * @param string                                                    $scheduled_at        UTC send time.
	 * @param array{scheduled_at: string|null, clear_custom_date: bool} $meta                Meta updates.
	 * @return void
	 * @since 1.0.0
	 */
	private static function recreate_linked_post(
		int $post_id,
		string $from_publication_id,
		string $beehiiv_post_id,
		string $to_publication_id,
		string $scheduled_at,
		array $meta
	): void {
		$create_payload = PostSettingsBuilder::get_post_settings( $post_id, true, $to_publication_id );

		if ( is_wp_error( $create_payload ) ) {
			self::fail(
				$post_id,
				'save',
				self::format_save_error_message( $create_payload ),
				$create_payload->get_error_message()
			);
			return;
		}

		if ( '' !== $scheduled_at ) {
			$create_payload['scheduled_at'] = $scheduled_at;
		}

		$delete_result = Posts::delete( $from_publication_id, $beehiiv_post_id );

		if ( ! $delete_result['success'] ) {
			self::fail(
				$post_id,
				'send',
				self::format_update_error_message( $delete_result['error'] ),
				$delete_result['error']
			);
			return;
		}

		$result = Posts::create( $to_publication_id, $create_payload );

		if ( ! $result['success'] ) {
			delete_post_meta( $post_id, Meta::BEEHIIV_POST_ID );
			delete_post_meta( $post_id, Meta::BEEHIIV_SCHEDULED_AT );
			self::clear_linked_publication( $post_id );
			update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, true );

			self::fail(
				$post_id,
				'send',
				self::format_send_error_message( $result['error'] ),
				$result['error']
			);
			return;
		}

		self::record_linked_publication(
			$post_id,
			$to_publication_id,
			(string) ( $create_payload['post_template_id'] ?? '' )
		);
		update_post_meta( $post_id, Meta::BEEHIIV_POST_ID, $result['post_id'] );
		self::apply_update_meta( $post_id, $meta );
		self::clear_error( $post_id );
	}

	/**
	 * Persist the beehiiv `scheduled_at` value synced for a linked post.
	 *
	 * @param int         $post_id      Post ID.
	 * @param string|null $scheduled_at UTC ISO 8601 datetime, or null when omitted.
	 * @return void
	 * @since 1.0.0
	 */
	private static function persist_scheduled_at_meta( int $post_id, ?string $scheduled_at ): void {
		$scheduled_at = is_string( $scheduled_at ) ? trim( $scheduled_at ) : '';

		if ( '' === $scheduled_at ) {
			delete_post_meta( $post_id, Meta::BEEHIIV_SCHEDULED_AT );
			return;
		}

		update_post_meta( $post_id, Meta::BEEHIIV_SCHEDULED_AT, $scheduled_at );
	}

	/**
	 * Apply post meta changes after a successful beehiiv newsletter update.
	 *
	 * @param int                                                       $post_id Post ID.
	 * @param array{scheduled_at: string|null, clear_custom_date: bool} $meta    Meta updates.
	 * @return void
	 * @since 1.0.0
	 */
	private static function apply_update_meta( int $post_id, array $meta ): void {
		if ( ! empty( $meta['clear_custom_date'] ) ) {
			update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER_DATE, '' );
		}

		if ( null !== $meta['scheduled_at'] ) {
			self::persist_scheduled_at_meta( $post_id, $meta['scheduled_at'] );
		}
	}

	/**
	 * Site-wide default beehiiv publication ID from plugin settings.
	 *
	 * Use {@see PublicationResolver::resolve_for_post()} for a post's publication.
	 *
	 * @return string
	 * @since 1.0.0
	 */
	public static function get_publication_id(): string {
		return PublicationResolver::get_default_publication_id();
	}

	/**
	 * Whether this WordPress post already has a linked beehiiv post.
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
		error_log( sprintf( 'beehiiv newsletter send failed for post ID %d: %s', $post_id, $log_message ) );
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
					'Choose a default post template in <a>beehiiv settings</a>, or pick one for this post in the beehiiv sidebar.',
					'beehiiv'
				);
			case 'beehiiv_post_template_required':
				return __( "Pick a post template for this post's publication in the beehiiv sidebar.", 'beehiiv' );
			case 'beehiiv_publication_missing':
				return self::no_post_publication_message();
			case 'beehiiv_post_title_or_content_empty':
				return __( 'Add a title and body content before sending this newsletter.', 'beehiiv' );
			case 'beehiiv_blocks_empty':
				return __(
					"This post doesn't include any blocks beehiiv can send. Add supported content and try again.",
					'beehiiv'
				);
			case 'beehiiv_advertisement_no_ad':
				return __(
					// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
					'Select an advertisement for the Advertisement block, or remove the block, to send this newsletter.',
					'beehiiv'
				);
			case 'beehiiv_advertisement_unavailable':
				return __(
					// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
					'The selected advertisement is no longer available in beehiiv. Choose a different advertisement or remove the Advertisement block, then try again.',
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
	 * User-facing message when the site is not connected to beehiiv.
	 *
	 * Uses an `<a>` placeholder rendered as a settings link in the block editor.
	 *
	 * @return string
	 * @since 1.0.0
	 */
	private static function not_connected_message(): string {
		return __(
			'Connect your beehiiv account in <a>beehiiv settings</a> to send this newsletter.',
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
		return __( 'Choose a publication in <a>beehiiv settings</a>, then try again.', 'beehiiv' );
	}

	/**
	 * User-facing message when a post has no publication and there is no default.
	 *
	 * @return string
	 * @since x.x.x
	 */
	private static function no_post_publication_message(): string {
		return __( 'Choose a publication for this post in the beehiiv sidebar.', 'beehiiv' );
	}

	/**
	 * User-facing notice when a post's publication is gone and the default was used.
	 *
	 * @param string $removed_publication_id Publication no longer connected.
	 * @param string $default_publication_id Default publication used instead.
	 * @return string
	 * @since x.x.x
	 */
	private static function publication_fallback_message(
		string $removed_publication_id,
		string $default_publication_id
	): string {
		return sprintf(
			/* translators: 1: removed publication name, 2: default publication name. */
			__(
				// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
				'The publication "%1$s" is no longer connected, so this newsletter was sent to the default publication "%2$s" instead.',
				'beehiiv'
			),
			PublicationResolver::get_publication_name( $removed_publication_id ),
			PublicationResolver::get_publication_name( $default_publication_id )
		);
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
				'Your beehiiv connection expired. Reconnect in <a>beehiiv settings</a>.',
				'beehiiv'
			);
		}

		if ( preg_match( '/^HTTP 422:\s*(.+)/i', $error, $matches ) ) {
			return sprintf(
				/* translators: %s: error message from the beehiiv API. */
				__( 'beehiiv rejected this newsletter: %s', 'beehiiv' ),
				$matches[1]
			);
		}

		if ( preg_match( '/^HTTP 429:/i', $error ) ) {
			return __( 'Too many requests. Try again in a moment.', 'beehiiv' );
		}

		if ( preg_match( '/^HTTP 5\d\d:/i', $error ) ) {
			return __( 'beehiiv is temporarily unavailable. Try again later.', 'beehiiv' );
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

		if ( 'Update payload is empty.' === $error || 'No post ID found in the beehiiv API response.' === $error ) {
			return __( 'Something went wrong. Try saving the post again.', 'beehiiv' );
		}

		if ( false !== stripos( $error, 'timed out' ) ) {
			return __( 'beehiiv took too long to respond. Try again.', 'beehiiv' );
		}

		if ( false !== stripos( $error, 'cURL error' ) ) {
			return __( "Couldn't reach beehiiv. Try again.", 'beehiiv' );
		}

		return $error;
	}

	/**
	 * Map beehiiv API failures to editor-friendly copy.
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
	 * Map beehiiv update API failures to editor-friendly copy.
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
	 * Whether send/update should wait for {@see on_rest_insert()} instead of transition hooks.
	 *
	 * @return bool
	 * @since 1.0.0
	 */
	private static function should_defer_send_to_rest(): bool {
		return defined( 'REST_REQUEST' ) && REST_REQUEST;
	}

	/**
	 * Whether beehiiv should sync for this post right now.
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
	 * Whether the post is marked to send to the beehiiv newsletter.
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
	 * Whether a status change should cancel a linked beehiiv newsletter.
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
	 * Post statuses that allow creating or scheduling a beehiiv newsletter.
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
