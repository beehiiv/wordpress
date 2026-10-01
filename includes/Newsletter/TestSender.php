<?php
/**
 * Sends beehiiv test emails of WordPress posts.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

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
			if ( self::is_linked_newsletter_sent( $post_id ) ) {
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

		if ( '' === Sender::get_publication_id() ) {
			return new WP_Error(
				'beehiiv_missing_publication',
				__( 'Choose a publication in <a>beehiiv settings</a>, then try again.', 'beehiiv' )
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

		$publication_id  = Sender::get_publication_id();
		$beehiiv_post_id = get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true );
		$beehiiv_post_id = is_string( $beehiiv_post_id ) ? trim( $beehiiv_post_id ) : '';

		if ( '' !== $beehiiv_post_id ) {
			$result = Posts::test_send( $publication_id, $beehiiv_post_id, $recipient_emails );

			return self::finish( $post_id, $publication_id, $result, false );
		}

		$payload = self::build_temporary_draft_payload( $post_id );

		if ( is_wp_error( $payload ) ) {
			return new WP_Error( $payload->get_error_code(), Sender::format_save_error_message( $payload ) );
		}

		$created = Posts::create( $publication_id, $payload );

		if ( ! $created['success'] ) {
			self::log( $post_id, sprintf( 'temporary draft could not be created: %s', $created['error'] ) );

			return self::api_error( $created['error'] );
		}

		$leftover_draft = false;

		try {
			$result = Posts::test_send( $publication_id, $created['post_id'], $recipient_emails );
		} finally {
			$deleted = Posts::delete( $publication_id, $created['post_id'] );

			if ( ! $deleted['success'] || 202 === $deleted['status_code'] ) {
				$leftover_draft = true;
				self::log(
					$post_id,
					sprintf(
						'temporary beehiiv draft %s was not deleted (HTTP %s): %s',
						$created['post_id'],
						null === $deleted['status_code'] ? 'n/a' : (string) $deleted['status_code'],
						'' !== $deleted['error'] ? $deleted['error'] : 'still processing'
					)
				);
			}
		}

		return self::finish( $post_id, $publication_id, $result, $leftover_draft );
	}

	/**
	 * Build the create payload for a temporary beehiiv draft from the saved post.
	 *
	 * Uses the real send's payload builder in its no-schedule mode, then forces draft
	 * status after the public settings filter so a test can never become a real send.
	 *
	 * @param int $post_id Post ID.
	 * @return array<string, mixed>|WP_Error
	 * @since 1.0.0
	 */
	public static function build_temporary_draft_payload( int $post_id ) {
		$settings = PostSettingsBuilder::get_post_settings( $post_id, true );

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
			if ( null !== $result['reset_at'] ) {
				self::remember_reset_at( $publication_id, (int) $result['reset_at'] );
			}

			return [
				'remaining_test_sends' => $result['remaining_test_sends'],
				'reset_at'             => $result['reset_at'],
				'leftover_draft'       => $leftover_draft,
			];
		}

		self::log( $post_id, sprintf( 'test send failed: %s', (string) $result['error'] ) );

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
		$mapped = Sender::format_api_error_message( $error );

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
