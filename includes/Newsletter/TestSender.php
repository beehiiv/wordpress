<?php
/**
 * Sends beehiiv test emails of WordPress posts.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\Admin\Options;
use Beehiiv\API\Resources\Posts;
use Beehiiv\API\Resources\Workspace;
use Beehiiv\Connection\Manager;
use Beehiiv\Editor\Meta;
use DateTimeImmutable;
use DateTimeZone;
use Exception;
use WP_Error;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Sends a test email of a post's saved version through beehiiv's test-send endpoint.
 *
 * Tests the post's linked newsletter when beehiiv has not sent it yet. Otherwise a
 * temporary beehiiv draft is built from the saved post, tested, and deleted. A test
 * never writes the post's newsletter meta, so the real newsletter is never affected.
 *
 * @link https://developers.beehiiv.com/api-reference/posts/test-send
 * @since 1.0.0
 */
final class TestSender {

	/**
	 * Option holding the last known test-send reset time per publication.
	 *
	 * @since 1.0.0
	 */
	public const RESET_AT_OPTION = 'beehiiv_test_send_reset_at';

	/**
	 * Saved post statuses that can send a test email.
	 *
	 * @since 1.0.0
	 */
	private const ELIGIBLE_STATUSES = [ 'draft', 'pending', 'future' ];

	/**
	 * Post type that supports beehiiv newsletters.
	 *
	 * @since 1.0.0
	 */
	private const POST_TYPE = 'post';

	/**
	 * Longest a test send waits for beehiiv to finish creating a temporary draft, in seconds.
	 *
	 * @since 1.0.0
	 */
	private const CREATION_WAIT_SECONDS = 20;

	/**
	 * Pause between creation checks when beehiiv sends no Retry-After, in seconds.
	 *
	 * @since 1.0.0
	 */
	private const CREATION_POLL_SECONDS = 1;

	/**
	 * Longest single pause between creation checks, in seconds.
	 *
	 * @since 1.0.0
	 */
	private const CREATION_POLL_MAX_SECONDS = 5;

	/**
	 * Shortest pause between beehiiv checks, in seconds, whatever a filter returns.
	 *
	 * @since 1.0.0
	 */
	private const POLL_MIN_SECONDS = 0.1;

	/**
	 * Upper bound for the filtered creation wait, in seconds.
	 *
	 * @since 1.0.0
	 */
	private const CREATION_WAIT_MAX_SECONDS = 60;

	/**
	 * How long cleanup keeps retrying a delete beehiiv answers "still processing", in seconds.
	 *
	 * @since 1.0.0
	 */
	private const CLEANUP_WAIT_SECONDS = 10;

	/**
	 * Upper bound for the filtered cleanup wait, in seconds.
	 *
	 * @since 1.0.0
	 */
	private const CLEANUP_WAIT_MAX_SECONDS = 30;

	/**
	 * Longest HTTP timeout for a single creation check, in seconds.
	 *
	 * @since 1.0.0
	 */
	private const CHECK_TIMEOUT_MAX_SECONDS = 10;

	/**
	 * Whether the saved post can send a test email right now.
	 *
	 * @param int $post_id Post ID.
	 * @return true|WP_Error True when eligible, or an error with an editor-facing message.
	 * @since 1.0.0
	 */
	public static function check_eligibility( int $post_id ) {
		$post = get_post( $post_id );

		if ( ! $post instanceof WP_Post || self::POST_TYPE !== $post->post_type ) {
			return new WP_Error(
				'beehiiv_test_send_post_not_found',
				__( 'This post no longer exists. Save or reload the editor and try again.', 'beehiiv' )
			);
		}

		if ( ! in_array( $post->post_status, self::ELIGIBLE_STATUSES, true ) ) {
			return new WP_Error(
				'beehiiv_test_send_ineligible_status',
				__( 'Test emails are available for drafts, pending posts, and scheduled posts.', 'beehiiv' )
			);
		}

		if ( Sender::has_beehiiv_post_id( $post_id ) ) {
			// The sync flow's stored flag wins: once beehiiv is known to have sent the
			// newsletter, it is sent whatever the stored schedule says.
			if ( Sender::is_newsletter_sent( $post_id ) || self::is_linked_newsletter_sent( $post_id ) ) {
				return new WP_Error(
					'beehiiv_test_send_already_sent',
					__( "This post's newsletter was already sent, so it can't send a test email.", 'beehiiv' )
				);
			}

			if ( self::has_newsletter_error( $post_id ) ) {
				return new WP_Error(
					'beehiiv_test_send_out_of_sync',
					__(
						// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
						"This post's newsletter isn't in sync with beehiiv. Save the post again, then send a test email.",
						'beehiiv'
					)
				);
			}
		}

		if ( ! Manager::is_connected() ) {
			return new WP_Error(
				'beehiiv_not_connected',
				__( 'Connect your beehiiv account in <a>beehiiv settings</a> to send a test email.', 'beehiiv' )
			);
		}

		if ( '' === PublicationResolver::resolve_for_post( $post_id ) ) {
			return new WP_Error(
				'beehiiv_missing_publication',
				__( 'Choose a publication in <a>beehiiv settings</a>, then try again.', 'beehiiv' )
			);
		}

		if ( '' === self::get_default_post_template_id() ) {
			return new WP_Error(
				'beehiiv_missing_post_template',
				__( 'Choose a default post template in <a>beehiiv settings</a> to send a test email.', 'beehiiv' )
			);
		}

		if ( ! Workspace::can_write_posts() ) {
			return new WP_Error(
				'beehiiv_send_api_unavailable',
				__( 'Test emails need beehiiv Send API access, available on the Max and Enterprise plans.', 'beehiiv' )
			);
		}

		return true;
	}

	/**
	 * Send a test email of the saved post.
	 *
	 * @param int               $post_id          Post ID.
	 * @param array<int,string> $recipient_emails Validated, de-duplicated addresses.
	 * @return array{remaining_test_sends: int|null, reset_at: int|null, leftover_draft: bool}|WP_Error
	 * @since 1.0.0
	 */
	public static function send( int $post_id, array $recipient_emails ) {
		$eligibility = self::check_eligibility( $post_id );

		if ( is_wp_error( $eligibility ) ) {
			return $eligibility;
		}

		// The linked newsletter's publication, or the post's chosen one when unlinked --
		// the same publication a real send or sync of this post uses.
		$publication_id  = PublicationResolver::resolve_for_post( $post_id );
		$beehiiv_post_id = get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true );
		$beehiiv_post_id = is_string( $beehiiv_post_id ) ? trim( $beehiiv_post_id ) : '';

		if ( '' !== $beehiiv_post_id ) {
			$result = Posts::test_send( $publication_id, $beehiiv_post_id, $recipient_emails );

			return self::finish( $post_id, $publication_id, $result, false );
		}

		$payload = self::build_temporary_draft_payload( $post_id, $publication_id );

		if ( is_wp_error( $payload ) ) {
			return new WP_Error( $payload->get_error_code(), Sender::format_save_error_message( $payload ) );
		}

		$created = Posts::create( $publication_id, $payload );

		if ( ! $created['success'] ) {
			self::log( $post_id, sprintf( 'temporary draft could not be created: %s', $created['error'] ) );

			return self::api_error( $created['error'] );
		}

		$failure = null;
		$result  = [];

		/**
		 * Filters how long a test send waits for beehiiv to create its temporary draft.
		 *
		 * Clamped to 0–60 seconds.
		 *
		 * @since 1.0.0
		 *
		 * @param float $seconds Seconds to wait before giving up.
		 */
		$wait_seconds = self::bounded_seconds(
			apply_filters( 'beehiiv_test_send_creation_wait_seconds', (float) self::CREATION_WAIT_SECONDS ),
			0,
			self::CREATION_WAIT_MAX_SECONDS,
			self::CREATION_WAIT_SECONDS
		);
		$deadline     = microtime( true ) + $wait_seconds;

		try {
			// beehiiv creates Send API posts in the background, so the new draft can't be
			// tested until it reports ready.
			$ready = self::wait_until_created( $publication_id, $created['post_id'], $deadline );

			if ( is_wp_error( $ready ) ) {
				$failure = $ready;
			} else {
				$result = Posts::test_send( $publication_id, $created['post_id'], $recipient_emails );

				// A ready post can still briefly be missing from the test-send lookup; retry once.
				if ( empty( $result['success'] ) && 404 === $result['status_code'] ) {
					$delay = self::poll_delay( null );

					if ( microtime( true ) + $delay < $deadline ) {
						self::sleep_seconds( $delay );
						$result = Posts::test_send( $publication_id, $created['post_id'], $recipient_emails );
					}
				}
			}
		} finally {
			$leftover_draft = ! self::delete_temporary_draft( $post_id, $publication_id, $created['post_id'] );
		}

		if ( null !== $failure ) {
			self::log(
				$post_id,
				sprintf( 'temporary draft %s not ready: %s', $created['post_id'], $failure->get_error_message() )
			);

			return self::with_leftover( $failure, $leftover_draft );
		}

		return self::finish( $post_id, $publication_id, $result, $leftover_draft );
	}

	/**
	 * Wait until beehiiv has finished creating a post made through the Send API.
	 *
	 * Polls the post until it reports ready, honoring beehiiv's Retry-After. Rate
	 * limiting, server errors and transport errors keep it waiting; an auth failure
	 * or other unexpected status stops waiting and lets the test send report what
	 * beehiiv says. Each check's HTTP timeout is capped to the time left.
	 *
	 * @param string $publication_id  Publication ID.
	 * @param string $beehiiv_post_id beehiiv post ID returned by the create call.
	 * @param float  $deadline        Unix time (with microseconds) to stop waiting at.
	 * @return true|WP_Error True when ready (or unknown), an error when creation failed or timed out.
	 * @since 1.0.0
	 */
	private static function wait_until_created(
		string $publication_id,
		string $beehiiv_post_id,
		float $deadline
	) {
		while ( true ) {
			$timeout = (int) max( 1, min( self::CHECK_TIMEOUT_MAX_SECONDS, ceil( $deadline - microtime( true ) ) ) );
			$state   = Posts::get_creation_state( $publication_id, $beehiiv_post_id, $timeout );

			if ( 'failed' === $state['state'] ) {
				return new WP_Error(
					'beehiiv_test_send_draft_failed',
					__( "beehiiv couldn't prepare the test email. Try again.", 'beehiiv' )
				);
			}

			if ( 'pending' !== $state['state'] ) {
				return true;
			}

			$delay = self::poll_delay( $state['retry_after'] );

			if ( microtime( true ) + $delay > $deadline ) {
				return new WP_Error(
					'beehiiv_test_send_draft_pending',
					__( 'beehiiv is still preparing the test email. Try again in a moment.', 'beehiiv' )
				);
			}

			self::sleep_seconds( $delay );
		}
	}

	/**
	 * Delete a temporary beehiiv draft, retrying while beehiiv is still processing it.
	 *
	 * A 404 counts as already gone (for example after creation failed). Anything left
	 * behind is logged.
	 *
	 * @param int    $post_id         WordPress post ID, for the log.
	 * @param string $publication_id  Publication ID.
	 * @param string $beehiiv_post_id beehiiv post ID of the temporary draft.
	 * @return bool True when the draft is gone, false when it may be left behind.
	 * @since 1.0.0
	 */
	private static function delete_temporary_draft(
		int $post_id,
		string $publication_id,
		string $beehiiv_post_id
	): bool {
		/**
		 * Filters how long cleanup retries deleting a draft beehiiv is still processing.
		 *
		 * Clamped to 0–30 seconds.
		 *
		 * @since 1.0.0
		 *
		 * @param float $seconds Seconds to keep retrying.
		 */
		$deadline = microtime( true ) + self::bounded_seconds(
			apply_filters( 'beehiiv_test_send_cleanup_wait_seconds', (float) self::CLEANUP_WAIT_SECONDS ),
			0,
			self::CLEANUP_WAIT_MAX_SECONDS,
			self::CLEANUP_WAIT_SECONDS
		);

		while ( true ) {
			$deleted = Posts::delete( $publication_id, $beehiiv_post_id );

			if ( 404 === $deleted['status_code'] || ( $deleted['success'] && 202 !== $deleted['status_code'] ) ) {
				return true;
			}

			$delay = self::poll_delay( $deleted['retry_after'] );

			if ( 202 === $deleted['status_code'] && microtime( true ) + $delay <= $deadline ) {
				self::sleep_seconds( $delay );
				continue;
			}

			self::log(
				$post_id,
				sprintf(
					'temporary beehiiv draft %s was not deleted (HTTP %s): %s',
					$beehiiv_post_id,
					null === $deleted['status_code'] ? 'n/a' : (string) $deleted['status_code'],
					'' !== $deleted['error'] ? $deleted['error'] : 'still processing'
				)
			);

			return false;
		}
	}

	/**
	 * Seconds to pause before the next beehiiv check.
	 *
	 * Starts from beehiiv's Retry-After (or a 1-second default), clamped to 1–5 seconds,
	 * then runs the result through a filter, clamped again to 0.1–5 seconds. The same
	 * value is used for the deadline check and the actual pause.
	 *
	 * @param int|null $retry_after Retry-After seconds from beehiiv, if any.
	 * @return float
	 * @since 1.0.0
	 */
	private static function poll_delay( ?int $retry_after ): float {
		$requested = null !== $retry_after ? $retry_after : self::CREATION_POLL_SECONDS;
		$requested = (float) max( self::CREATION_POLL_SECONDS, min( self::CREATION_POLL_MAX_SECONDS, $requested ) );

		/**
		 * Filters how long a test send pauses between beehiiv checks.
		 *
		 * Clamped to 0.1–5 seconds.
		 *
		 * @since 1.0.0
		 *
		 * @param float $seconds Seconds to wait, from beehiiv's Retry-After when given.
		 */
		return self::bounded_seconds(
			apply_filters( 'beehiiv_test_send_poll_seconds', $requested ),
			self::POLL_MIN_SECONDS,
			self::CREATION_POLL_MAX_SECONDS,
			$requested
		);
	}

	/**
	 * Clamp a filtered number of seconds, falling back when it isn't a finite number.
	 *
	 * @param mixed $value    Filtered value.
	 * @param float $min      Smallest allowed value.
	 * @param float $max      Largest allowed value.
	 * @param float $fallback Value used when the filtered value isn't a finite number.
	 * @return float
	 * @since 1.0.0
	 */
	private static function bounded_seconds( $value, float $min, float $max, float $fallback ): float {
		$seconds = is_numeric( $value ) ? (float) $value : $fallback;

		if ( ! is_finite( $seconds ) ) {
			$seconds = $fallback;
		}

		return max( $min, min( $max, $seconds ) );
	}

	/**
	 * Sleep for a number of seconds.
	 *
	 * @param float $seconds Seconds to sleep.
	 * @return void
	 * @since 1.0.0
	 */
	private static function sleep_seconds( float $seconds ): void {
		if ( $seconds > 0 ) {
			usleep( (int) round( $seconds * 1000000 ) );
		}
	}

	/**
	 * Mark an error as having left a temporary draft behind in beehiiv.
	 *
	 * @param WP_Error $error          Error to return to the editor.
	 * @param bool     $leftover_draft Whether a temporary draft could not be deleted.
	 * @return WP_Error
	 * @since 1.0.0
	 */
	private static function with_leftover( WP_Error $error, bool $leftover_draft ): WP_Error {
		if ( $leftover_draft ) {
			$error->add_data( [ 'leftover_draft' => true ] );
		}

		return $error;
	}

	/**
	 * Build the create payload for a temporary beehiiv draft from the saved post.
	 *
	 * Uses the real send's payload builder in its no-schedule mode, then forces draft
	 * status after the public settings filter so a test can never become a real send.
	 *
	 * @param int         $post_id        Post ID.
	 * @param string|null $publication_id Publication the draft is created in; defaults to the post's resolved one.
	 * @return array<string, mixed>|WP_Error
	 * @since 1.0.0
	 */
	public static function build_temporary_draft_payload( int $post_id, ?string $publication_id = null ) {
		$settings = PostSettingsBuilder::get_post_settings( $post_id, true, $publication_id );

		if ( is_wp_error( $settings ) ) {
			return $settings;
		}

		if ( ! is_array( $settings ) ) {
			return new WP_Error(
				'beehiiv_test_send_invalid_settings',
				__( "Something went wrong and the test email wasn't sent. Try again.", 'beehiiv' )
			);
		}

		$settings['status'] = 'draft';
		unset( $settings['scheduled_at'] );

		return $settings;
	}

	/**
	 * Whether a linked newsletter has already been sent.
	 *
	 * Mirrors the linked-status notice: the newsletter counts as scheduled while the
	 * stored beehiiv send time, or else the custom send date, is in the future.
	 *
	 * @param int $post_id Post ID.
	 * @return bool
	 * @since 1.0.0
	 */
	public static function is_linked_newsletter_sent( int $post_id ): bool {
		$candidates = [
			[ get_post_meta( $post_id, Meta::BEEHIIV_SCHEDULED_AT, true ), new DateTimeZone( 'UTC' ) ],
			[ get_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER_DATE, true ), wp_timezone() ],
		];

		foreach ( $candidates as $candidate ) {
			$value = is_string( $candidate[0] ) ? trim( $candidate[0] ) : '';

			if ( '' === $value ) {
				continue;
			}

			try {
				$send_time = new DateTimeImmutable( $value, $candidate[1] );
			} catch ( Exception $e ) {
				continue;
			}

			if ( $send_time->getTimestamp() > time() ) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Last remembered test-send reset time for a publication.
	 *
	 * @param string $publication_id Publication ID.
	 * @return int|null Unix timestamp, or null when none is stored.
	 * @since 1.0.0
	 */
	public static function get_remembered_reset_at( string $publication_id ): ?int {
		$stored = get_option( self::RESET_AT_OPTION, [] );

		if ( ! is_array( $stored ) || ! isset( $stored[ $publication_id ] ) ) {
			return null;
		}

		if ( ! is_numeric( $stored[ $publication_id ] ) ) {
			return null;
		}

		return (int) $stored[ $publication_id ];
	}

	/**
	 * Turn a test-send result into the REST response data or a classified error.
	 *
	 * @param int                 $post_id        Post ID.
	 * @param string              $publication_id Publication ID.
	 * @param array<string,mixed> $result         Result from {@see Posts::test_send()}.
	 * @param bool                $leftover_draft Whether a temporary draft could not be deleted.
	 * @return array{remaining_test_sends: int|null, reset_at: int|null, leftover_draft: bool}|WP_Error
	 * @since 1.0.0
	 */
	private static function finish( int $post_id, string $publication_id, array $result, bool $leftover_draft ) {
		if ( ! empty( $result['success'] ) ) {
			$reset_at = $result['reset_at'];

			if ( null !== $reset_at ) {
				self::remember_reset_at( $publication_id, (int) $reset_at );
			} else {
				// beehiiv's reset time is optional; fall back to the last one it sent.
				$remembered = self::get_remembered_reset_at( $publication_id );
				$reset_at   = null !== $remembered && $remembered > time() ? $remembered : null;
			}

			return [
				'remaining_test_sends' => $result['remaining_test_sends'],
				'reset_at'             => $reset_at,
				'leftover_draft'       => $leftover_draft,
			];
		}

		self::log( $post_id, sprintf( 'test send failed: %s', (string) $result['error'] ) );

		return self::with_leftover( self::classify_failure( $publication_id, $result ), $leftover_draft );
	}

	/**
	 * Classified error for a failed test send.
	 *
	 * @param string              $publication_id Publication ID.
	 * @param array<string,mixed> $result         Result from {@see Posts::test_send()}.
	 * @return WP_Error
	 * @since 1.0.0
	 */
	private static function classify_failure( string $publication_id, array $result ): WP_Error {

		if ( 422 === $result['status_code'] ) {
			$reset_at = self::get_remembered_reset_at( $publication_id );

			if ( null !== $reset_at && $reset_at > time() ) {
				return new WP_Error(
					'beehiiv_test_send_daily_limit',
					sprintf(
						/* translators: %s: date, time, and timezone when test sends reset. */
						__( "You've used all test sends for today. They reset on %s.", 'beehiiv' ),
						wp_date( 'F j, g:i a T', $reset_at )
					)
				);
			}

			return new WP_Error(
				'beehiiv_test_send_daily_limit',
				__( "You've used all test sends for today.", 'beehiiv' )
			);
		}

		if ( 429 === $result['status_code'] ) {
			return new WP_Error(
				'beehiiv_test_send_rate_limited',
				__( 'Too many requests. Try again in a moment.', 'beehiiv' )
			);
		}

		return self::api_error( (string) $result['error'] );
	}

	/**
	 * Generic test-send failure carrying beehiiv's (mapped) message.
	 *
	 * @param string $error Error string from the API client.
	 * @return WP_Error
	 * @since 1.0.0
	 */
	private static function api_error( string $error ): WP_Error {
		// Keep beehiiv's own wording for request errors; only auth and rate-limit
		// statuses, and transport errors, use the shared editor-friendly copy.
		if ( preg_match( '/^HTTP (\d+):\s*(.+)$/is', trim( $error ), $matches )
			&& ! in_array( (int) $matches[1], [ 401, 403, 429 ], true ) ) {
			$mapped = trim( $matches[2] );
		} else {
			$mapped = Sender::format_api_error_message( $error );
		}

		if ( '' === $mapped ) {
			return new WP_Error(
				'beehiiv_test_send_failed',
				__( "Something went wrong and the test email wasn't sent. Try again.", 'beehiiv' )
			);
		}

		return new WP_Error(
			'beehiiv_test_send_failed',
			sprintf(
				/* translators: %s: error message from beehiiv. */
				__( "The test email wasn't sent: %s", 'beehiiv' ),
				$mapped
			)
		);
	}

	/**
	 * Site-wide default beehiiv post template from plugin settings.
	 *
	 * The same setting the editor's newsletter readiness rule checks.
	 *
	 * @return string
	 * @since 1.0.0
	 */
	private static function get_default_post_template_id(): string {
		$settings = Options::get();

		return isset( $settings['post_template_id'] ) ? trim( (string) $settings['post_template_id'] ) : '';
	}

	/**
	 * Store the latest test-send reset time for a publication.
	 *
	 * @param string $publication_id Publication ID.
	 * @param int    $reset_at       Unix timestamp.
	 * @return void
	 * @since 1.0.0
	 */
	private static function remember_reset_at( string $publication_id, int $reset_at ): void {
		$stored = get_option( self::RESET_AT_OPTION, [] );
		$stored = is_array( $stored ) ? $stored : [];

		$stored[ $publication_id ] = $reset_at;

		update_option( self::RESET_AT_OPTION, $stored, false );
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
	 * Write a test-send problem to the error log.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $message Log message.
	 * @return void
	 * @since 1.0.0
	 */
	private static function log( int $post_id, string $message ): void {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( sprintf( 'beehiiv test email for post ID %d: %s', $post_id, $message ) );
	}
}
