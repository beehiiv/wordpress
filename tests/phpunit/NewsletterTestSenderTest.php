<?php
/**
 * Unit coverage for the beehiiv test email send (PRD-06.5.01).
 *
 * beehiiv HTTP calls are answered by a method-aware `pre_http_request` stub
 * that records every outbound request, so each test can assert exactly what
 * reached beehiiv and in what order.
 *
 * @package beehiiv
 */

use Beehiiv\Config;
use Beehiiv\Editor\Meta;
use Beehiiv\Newsletter\TestSender;
use Beehiiv\OAuth\TokenStore;
use Beehiiv\REST\TestSendController;

/**
 * @covers \Beehiiv\Newsletter\TestSender
 * @covers \Beehiiv\REST\TestSendController
 * @covers \Beehiiv\API\Resources\Posts::test_send
 */
class NewsletterTestSenderTest extends WP_UnitTestCase {

	private const PUBLICATION_ID = 'pub_test';

	private const TEMP_POST_ID = 'post_temp_1';

	private const LINKED_POST_ID = 'post_linked_1';

	/**
	 * Recorded outbound requests: method, url, body.
	 *
	 * @var array<int, array{method: string, url: string, body: array<string,mixed>|null}>
	 */
	private $requests = [];

	/**
	 * Per-route responses keyed by "METHOD path-suffix".
	 *
	 * @var array<string, array{status: int, body: array<string,mixed>}>
	 */
	private $responses = [];

	/**
	 * Seconds each pause asked for, before the test's zero override.
	 *
	 * @var array<int, float>
	 */
	private $polls = [];

	/**
	 * Record a requested pause and skip the wait (clamped to the 0.1 s minimum).
	 *
	 * @param float $seconds Requested pause.
	 * @return int
	 */
	public function record_poll( $seconds ) {
		$this->polls[] = (float) $seconds;

		return 0;
	}

	public function set_up(): void {
		parent::set_up();

		$this->requests  = [];
		$this->responses = [
			'GET /workspaces/permissions'         => [
				'status' => 200,
				'body'   => [ 'data' => [ 'posts' => [ 'read', 'write' ] ] ],
			],
			'POST /posts'                         => [
				'status' => 201,
				'body'   => [ 'data' => [ 'id' => self::TEMP_POST_ID ] ],
			],
			'POST /posts/' . self::TEMP_POST_ID . '/test_sends' => [
				'status' => 200,
				'body'   => [
					'data' => [
						'remaining_test_sends' => 9,
						'reset_at'             => time() + 3600,
					],
				],
			],
			'POST /posts/' . self::LINKED_POST_ID . '/test_sends' => [
				'status' => 200,
				'body'   => [
					'data' => [
						'remaining_test_sends' => 4,
						'reset_at'             => time() + 7200,
					],
				],
			],
			'DELETE /posts/' . self::TEMP_POST_ID => [
				'status' => 204,
				'body'   => [],
			],
			'GET /posts/' . self::TEMP_POST_ID    => [
				'status' => 200,
				'body'   => [ 'data' => [ 'id' => self::TEMP_POST_ID ] ],
			],
		];

		add_filter( 'pre_http_request', [ $this, 'stub_http' ], 10, 3 );
		$this->polls = [];
		add_filter( 'beehiiv_test_send_poll_seconds', [ $this, 'record_poll' ] );
		add_filter(
			'beehiiv_test_send_cleanup_wait_seconds',
			static function () {
				return 0.3;
			}
		);

		TokenStore::save_tokens(
			'qa-client',
			[
				'access_token'  => 'qa-access',
				'refresh_token' => 'qa-refresh',
				'expires_in'    => 3600,
			]
		);

		update_option(
			Config::OPTION_NAME,
			[
				'publication_id'   => self::PUBLICATION_ID,
				'post_template_id' => 'tpl_default',
			]
		);

		delete_option( TestSender::RESET_AT_OPTION );
	}

	public function tear_down(): void {
		remove_filter( 'pre_http_request', [ $this, 'stub_http' ], 10 );
		remove_all_filters( 'beehiiv_test_send_poll_seconds' );
		remove_all_filters( 'beehiiv_test_send_creation_wait_seconds' );
		remove_all_filters( 'beehiiv_test_send_cleanup_wait_seconds' );
		remove_all_filters( 'beehiiv_newsletter_post_settings' );
		TokenStore::delete_all();
		delete_option( Config::OPTION_NAME );
		delete_option( TestSender::RESET_AT_OPTION );
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	/**
	 * Answer beehiiv API calls from $this->responses and record them.
	 *
	 * @param false|array $preempt Short-circuit value.
	 * @param array       $args    Request args.
	 * @param string      $url     Request URL.
	 * @return false|array
	 */
	public function stub_http( $preempt, $args, $url ) {
		if ( false === strpos( $url, 'beehiiv.com' ) ) {
			return $preempt;
		}

		$method = strtoupper( (string) ( $args['method'] ?? 'GET' ) );
		$path   = (string) wp_parse_url( $url, PHP_URL_PATH );
		$body   = isset( $args['body'] ) ? json_decode( (string) $args['body'], true ) : null;

		$this->requests[] = [
			'method' => $method,
			'url'    => $url,
			'body'   => is_array( $body ) ? $body : null,
		];

		$match = null;

		foreach ( $this->responses as $key => $response ) {
			list( $route_method, $suffix ) = explode( ' ', $key, 2 );

			if ( $route_method === $method && substr( $path, -strlen( $suffix ) ) === $suffix ) {
				// Prefer the longest (most specific) suffix match.
				if ( null === $match || strlen( $suffix ) > $match[0] ) {
					$match = [ strlen( $suffix ), $response, $key ];
				}
			}
		}

		$response = null === $match ? [
			'status' => 404,
			'body'   => [ 'errors' => [ [ 'message' => 'not stubbed' ] ] ],
		] : $match[1];

		// A `sequence` answers one response per call, repeating the last one.
		if ( isset( $response['sequence'] ) ) {
			$sequence = $response['sequence'];
			$response = array_shift( $sequence );

			if ( ! empty( $sequence ) ) {
				$this->responses[ $match[2] ]['sequence'] = $sequence;
			}
		}

		return [
			'headers'  => $response['headers'] ?? [],
			'body'     => wp_json_encode( $response['body'] ),
			'response' => [
				'code'    => $response['status'],
				'message' => 'stub',
			],
			'cookies'  => [],
			'filename' => null,
		];
	}

	/**
	 * Methods and path suffixes of every recorded request, for order assertions.
	 *
	 * @return array<int, string>
	 */
	private function request_log(): array {
		return array_map(
			static function ( $request ) {
				$path = (string) wp_parse_url( $request['url'], PHP_URL_PATH );

				$path = preg_replace( '#^/v2#', '', $path );

				return $request['method'] . ' ' . preg_replace( '#^/publications/[^/]+#', '', $path );
			},
			$this->requests
		);
	}

	private function create_post( string $status = 'draft', array $meta = [] ): int {
		$args = [
			'post_status'  => $status,
			'post_title'   => 'Weekly roundup',
			'post_content' => "<!-- wp:paragraph -->\n<p>Hello subscribers.</p>\n<!-- /wp:paragraph -->",
		];

		if ( 'future' === $status ) {
			$args['post_date'] = gmdate( 'Y-m-d H:i:s', time() + DAY_IN_SECONDS );
		}

		$post_id = self::factory()->post->create( $args );

		foreach ( $meta as $key => $value ) {
			update_post_meta( $post_id, $key, $value );
		}

		return $post_id;
	}

	private function all_post_meta( int $post_id ): array {
		$meta = get_post_meta( $post_id );
		ksort( $meta );

		return $meta;
	}

	/**
	 * AC-008, AC-009, AC-010, AC-018, AC-019: an unlinked draft is tested via a
	 * temporary beehiiv draft that is deleted, forced to draft even when a filter
	 * tries to make it a real send, without touching the post's newsletter meta.
	 */
	public function test_unlinked_draft_uses_temporary_draft_and_leaves_post_untouched(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );

		add_filter(
			'beehiiv_newsletter_post_settings',
			static function ( $settings ) {
				$settings['status']       = 'confirmed';
				$settings['scheduled_at'] = '2030-01-01T00:00:00Z';

				return $settings;
			}
		);

		$before = $this->all_post_meta( $post_id );
		$result = TestSender::send( $post_id, [ 'a@example.com', 'b@example.com' ] );

		$this->assertIsArray( $result, 'Expected a successful test send.' );
		$this->assertSame( 9, $result['remaining_test_sends'] );
		$this->assertFalse( $result['leftover_draft'] );

		$this->assertSame(
			[
				'GET /workspaces/permissions',
				'POST /posts',
				'GET /posts/' . self::TEMP_POST_ID,
				'POST /posts/' . self::TEMP_POST_ID . '/test_sends',
				'DELETE /posts/' . self::TEMP_POST_ID,
			],
			$this->request_log()
		);

		$create_body = $this->requests[1]['body'];
		$this->assertSame( 'draft', $create_body['status'], 'AC-009: temporary post must always be a draft.' );
		$this->assertArrayNotHasKey( 'scheduled_at', $create_body, 'AC-009: temporary post must never be scheduled.' );
		$this->assertSame( [ 'a@example.com', 'b@example.com' ], $this->requests[3]['body']['recipient_emails'] );

		$this->assertSame( $before, $this->all_post_meta( $post_id ), 'AC-010: test send must not change post meta.' );
		$this->assertSame( $result['reset_at'], TestSender::get_remembered_reset_at( self::PUBLICATION_ID ), 'AC-019' );
	}

	/**
	 * AC-011, AC-021: a failed test send still deletes the temporary draft, and
	 * rate limiting gets its own message.
	 */
	public function test_failed_test_send_still_deletes_temporary_draft(): void {
		$post_id = $this->create_post( 'pending' );

		$this->responses[ 'POST /posts/' . self::TEMP_POST_ID . '/test_sends' ] = [
			'status' => 429,
			'body'   => [ 'errors' => [ [ 'message' => 'Rate limited' ] ] ],
		];

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertWPError( $result );
		$this->assertSame( 'beehiiv_test_send_rate_limited', $result->get_error_code() );
		$this->assertSame( 'Too many requests. Try again in a moment.', $result->get_error_message() );
		$this->assertContains( 'DELETE /posts/' . self::TEMP_POST_ID, $this->request_log(), 'AC-011' );
	}

	/**
	 * AC-020: the daily-limit message uses the remembered reset time when it is
	 * still in the future, and no time otherwise.
	 */
	public function test_daily_limit_message_uses_remembered_reset_time(): void {
		$post_id = $this->create_post( 'draft' );

		$this->responses[ 'POST /posts/' . self::TEMP_POST_ID . '/test_sends' ] = [
			'status' => 422,
			'body'   => [ 'errors' => [ [ 'message' => 'Daily limit reached' ] ] ],
		];

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );
		$this->assertSame( "You've used all test sends for today.", $result->get_error_message() );

		$reset_at = time() + 1800;
		update_option( TestSender::RESET_AT_OPTION, [ self::PUBLICATION_ID => $reset_at ] );

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );
		$this->assertSame( 'beehiiv_test_send_daily_limit', $result->get_error_code() );
		$this->assertStringContainsString( wp_date( 'F j, g:i a T', $reset_at ), $result->get_error_message() );

		update_option( TestSender::RESET_AT_OPTION, [ self::PUBLICATION_ID => time() - 60 ] );

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );
		$this->assertSame( "You've used all test sends for today.", $result->get_error_message() );
	}

	/**
	 * AC-007: a linked newsletter scheduled for later is tested directly, with no
	 * temporary draft.
	 */
	public function test_linked_scheduled_newsletter_is_tested_directly(): void {
		$post_id = $this->create_post(
			'future',
			[
				Meta::BEEHIIV_POST_ID      => self::LINKED_POST_ID,
				Meta::BEEHIIV_SCHEDULED_AT => gmdate( 'Y-m-d\TH:i:s\Z', time() + DAY_IN_SECONDS ),
			]
		);

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertIsArray( $result );
		$this->assertSame( 4, $result['remaining_test_sends'] );
		$this->assertSame(
			[ 'GET /workspaces/permissions', 'POST /posts/' . self::LINKED_POST_ID . '/test_sends' ],
			$this->request_log()
		);
	}

	/**
	 * AC-013, AC-017: an already-sent linked newsletter can't be tested, and
	 * nothing is sent to beehiiv.
	 */
	public function test_already_sent_newsletter_is_refused(): void {
		$post_id = $this->create_post(
			'future',
			[
				Meta::BEEHIIV_POST_ID      => self::LINKED_POST_ID,
				Meta::BEEHIIV_SCHEDULED_AT => gmdate( 'Y-m-d\TH:i:s\Z', time() - HOUR_IN_SECONDS ),
			]
		);

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertWPError( $result );
		$this->assertSame( 'beehiiv_test_send_already_sent', $result->get_error_code() );
		$this->assertSame( [], $this->request_log() );
	}

	/**
	 * AC-016: a scheduled newsletter whose last sync failed can't be tested.
	 */
	public function test_out_of_sync_newsletter_is_refused(): void {
		$post_id = $this->create_post(
			'future',
			[
				Meta::BEEHIIV_POST_ID      => self::LINKED_POST_ID,
				Meta::BEEHIIV_SCHEDULED_AT => gmdate( 'Y-m-d\TH:i:s\Z', time() + DAY_IN_SECONDS ),
				Meta::NEWSLETTER_ERROR     => 'Something went wrong.',
			]
		);

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertSame( 'beehiiv_test_send_out_of_sync', $result->get_error_code() );
		$this->assertSame( [], $this->request_log() );
	}

	/**
	 * AC-012, AC-013: draft, pending and scheduled are eligible; published and
	 * private are not.
	 */
	public function test_eligible_statuses(): void {
		foreach ( [ 'draft', 'pending', 'future' ] as $status ) {
			$this->assertTrue( TestSender::check_eligibility( $this->create_post( $status ) ), $status );
		}

		foreach ( [ 'publish', 'private' ] as $status ) {
			$result = TestSender::check_eligibility( $this->create_post( $status ) );
			$this->assertWPError( $result, $status );
			$this->assertSame( 'beehiiv_test_send_ineligible_status', $result->get_error_code(), $status );
		}
	}

	/**
	 * AC-015, AC-017: readiness is enforced on the server.
	 */
	public function test_readiness_is_enforced(): void {
		$post_id = $this->create_post( 'draft' );

		$this->responses['GET /workspaces/permissions']['body'] = [ 'data' => [ 'posts' => [ 'read' ] ] ];
		$this->assertSame( 'beehiiv_send_api_unavailable', TestSender::check_eligibility( $post_id )->get_error_code() );

		TokenStore::delete_all();
		$this->assertSame( 'beehiiv_not_connected', TestSender::check_eligibility( $post_id )->get_error_code() );
	}

	/**
	 * AC-015, AC-017, BR-002: without a default post template, a linked newsletter
	 * is refused on the server too, and nothing reaches beehiiv.
	 */
	public function test_missing_default_template_is_refused_on_linked_path(): void {
		update_option( Config::OPTION_NAME, [ 'publication_id' => self::PUBLICATION_ID ] );

		$post_id = $this->create_post(
			'future',
			[
				Meta::BEEHIIV_POST_ID      => self::LINKED_POST_ID,
				Meta::BEEHIIV_SCHEDULED_AT => gmdate( 'Y-m-d\TH:i:s\Z', time() + DAY_IN_SECONDS ),
			]
		);

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertWPError( $result );
		$this->assertSame( 'beehiiv_missing_post_template', $result->get_error_code() );
		$this->assertSame( [], $this->request_log() );
	}

	/**
	 * AC-022: content problems show the same message a real send would.
	 */
	public function test_content_problem_uses_real_send_message(): void {
		$post_id = self::factory()->post->create(
			[
				'post_status'  => 'draft',
				'post_title'   => 'No body',
				'post_content' => '',
			]
		);

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertSame( 'Add a title and body content before sending this newsletter.', $result->get_error_message() );
		$this->assertNotContains( 'POST /posts', $this->request_log() );
	}

	/**
	 * AC-022: other beehiiv failures show a generic error with beehiiv's message.
	 */
	public function test_other_failure_includes_beehiiv_message(): void {
		$post_id = $this->create_post( 'draft' );

		$this->responses[ 'POST /posts/' . self::TEMP_POST_ID . '/test_sends' ] = [
			'status' => 400,
			'body'   => [ 'errors' => [ [ 'message' => 'Recipient list rejected' ] ] ],
		];

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertSame( 'beehiiv_test_send_failed', $result->get_error_code() );
		$this->assertSame( "The test email wasn't sent: Recipient list rejected", $result->get_error_message() );

		$this->responses[ 'POST /posts/' . self::TEMP_POST_ID . '/test_sends' ] = [
			'status' => 503,
			'body'   => [ 'errors' => [ [ 'message' => 'Service unavailable' ] ] ],
		];

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );
		$this->assertSame( "The test email wasn't sent: Service unavailable", $result->get_error_message() );
	}

	/**
	 * AC-022: auth failures keep the reconnect guidance instead of beehiiv's text.
	 */
	public function test_auth_failure_points_to_reconnect(): void {
		$post_id = $this->create_post( 'draft' );

		$this->responses[ 'POST /posts/' . self::TEMP_POST_ID . '/test_sends' ] = [
			'status' => 403,
			'body'   => [ 'errors' => [ [ 'message' => 'Forbidden' ] ] ],
		];

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertStringContainsString( 'Reconnect in <a>beehiiv settings</a>', $result->get_error_message() );
	}

	/**
	 * Count recorded requests matching "METHOD path-suffix".
	 *
	 * @param string $entry Request log entry.
	 * @return int
	 */
	private function count_requests( string $entry ): int {
		return count(
			array_filter(
				$this->request_log(),
				static function ( $logged ) use ( $entry ) {
					return $logged === $entry;
				}
			)
		);
	}

	/**
	 * AC-024: a delete beehiiv keeps answering 202 "still processing" leaves a draft
	 * behind; the test still counts as sent and the leftover is flagged.
	 */
	public function test_still_processing_delete_flags_leftover_draft(): void {
		$post_id = $this->create_post( 'draft' );

		$this->responses[ 'DELETE /posts/' . self::TEMP_POST_ID ] = [
			'status' => 202,
			'body'   => [],
		];

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertIsArray( $result );
		$this->assertTrue( $result['leftover_draft'] );
		$this->assertGreaterThan( 1, $this->count_requests( 'DELETE /posts/' . self::TEMP_POST_ID ), 'A 202 delete is retried.' );
	}

	/**
	 * A delete that answers 202 once and then 204 is retried and leaves nothing behind.
	 */
	public function test_still_processing_delete_is_retried_until_gone(): void {
		$post_id = $this->create_post( 'draft' );

		$this->responses[ 'DELETE /posts/' . self::TEMP_POST_ID ] = [
			'sequence' => [
				[
					'status' => 202,
					'body'   => [],
				],
				[
					'status' => 204,
					'body'   => [],
				],
			],
		];

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertIsArray( $result );
		$this->assertFalse( $result['leftover_draft'] );
		$this->assertSame( 2, $this->count_requests( 'DELETE /posts/' . self::TEMP_POST_ID ) );
	}

	/**
	 * AC-025: the test send waits until the temporary draft reports ready, honoring
	 * beehiiv's Retry-After, instead of failing with "Couldn't find post".
	 */
	public function test_waits_for_temporary_draft_to_finish_creating(): void {
		$post_id = $this->create_post( 'draft' );

		$this->responses[ 'GET /posts/' . self::TEMP_POST_ID ] = [
			'sequence' => [
				[
					'status'  => 202,
					'headers' => [ 'retry-after' => '3' ],
					'body'    => [ 'data' => [ 'state' => 'pending' ] ],
				],
				[
					'status' => 202,
					'body'   => [ 'data' => [ 'state' => 'pending' ] ],
				],
				[
					'status' => 200,
					'body'   => [ 'data' => [ 'id' => self::TEMP_POST_ID ] ],
				],
			],
		];

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertIsArray( $result );
		$this->assertSame( [ 3.0, 1.0 ], $this->polls, 'Retry-After is honored; the default applies without it.' );
		$this->assertSame(
			[
				'GET /workspaces/permissions',
				'POST /posts',
				'GET /posts/' . self::TEMP_POST_ID,
				'GET /posts/' . self::TEMP_POST_ID,
				'GET /posts/' . self::TEMP_POST_ID,
				'POST /posts/' . self::TEMP_POST_ID . '/test_sends',
				'DELETE /posts/' . self::TEMP_POST_ID,
			],
			$this->request_log()
		);
	}

	/**
	 * A Retry-After given as an HTTP date is honored too.
	 */
	public function test_retry_after_http_date_is_honored(): void {
		$post_id = $this->create_post( 'draft' );

		$this->responses[ 'GET /posts/' . self::TEMP_POST_ID ] = [
			'sequence' => [
				[
					'status'  => 202,
					'headers' => [ 'retry-after' => gmdate( 'D, d M Y H:i:s', time() + 4 ) . ' GMT' ],
					'body'    => [],
				],
				[
					'status' => 200,
					'body'   => [ 'data' => [ 'id' => self::TEMP_POST_ID ] ],
				],
			],
		];

		$this->assertIsArray( TestSender::send( $post_id, [ 'a@example.com' ] ) );
		$this->assertCount( 1, $this->polls );
		$this->assertGreaterThanOrEqual( 3.0, $this->polls[0] );
		$this->assertLessThanOrEqual( 4.0, $this->polls[0] );
	}

	/**
	 * Rate limiting on the creation check keeps waiting instead of sending early.
	 */
	public function test_rate_limited_creation_check_keeps_waiting(): void {
		$post_id = $this->create_post( 'draft' );

		$this->responses[ 'GET /posts/' . self::TEMP_POST_ID ] = [
			'sequence' => [
				[
					'status' => 429,
					'body'   => [ 'errors' => [ [ 'message' => 'Rate limited' ] ] ],
				],
				[
					'status' => 200,
					'body'   => [ 'data' => [ 'id' => self::TEMP_POST_ID ] ],
				],
			],
		];

		$this->assertIsArray( TestSender::send( $post_id, [ 'a@example.com' ] ) );
		$this->assertSame( 2, $this->count_requests( 'GET /posts/' . self::TEMP_POST_ID ) );
	}

	/**
	 * When beehiiv reports the temporary draft's creation failed, nothing is sent, the
	 * editor gets a clear message, and a 404 on cleanup counts as already gone.
	 */
	public function test_failed_draft_creation_is_reported(): void {
		$post_id = $this->create_post( 'draft' );

		$this->responses[ 'GET /posts/' . self::TEMP_POST_ID ]    = [
			'status' => 404,
			'body'   => [ 'errors' => [ [ 'code' => 'POST_CREATION_FAILED' ] ] ],
		];
		$this->responses[ 'DELETE /posts/' . self::TEMP_POST_ID ] = [
			'status' => 404,
			'body'   => [ 'errors' => [ [ 'message' => 'Not found' ] ] ],
		];

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertWPError( $result );
		$this->assertSame( 'beehiiv_test_send_draft_failed', $result->get_error_code() );
		$this->assertSame( 0, $this->count_requests( 'POST /posts/' . self::TEMP_POST_ID . '/test_sends' ) );
		$this->assertSame( 1, $this->count_requests( 'DELETE /posts/' . self::TEMP_POST_ID ) );
		$this->assertEmpty( $result->get_error_data(), 'A draft that was never created is not a leftover.' );
	}

	/**
	 * AC-025: a draft still being created when the (real, non-zero) wait runs out gives
	 * a "try again" message, never a send; a draft beehiiv is still processing can't be
	 * deleted yet, so the error carries the leftover flag.
	 */
	public function test_draft_still_pending_after_wait_limit(): void {
		$post_id = $this->create_post( 'draft' );

		add_filter(
			'beehiiv_test_send_creation_wait_seconds',
			static function () {
				return 0.35;
			}
		);
		$this->responses[ 'GET /posts/' . self::TEMP_POST_ID ]    = [
			'status' => 202,
			'body'   => [ 'data' => [ 'state' => 'pending' ] ],
		];
		$this->responses[ 'DELETE /posts/' . self::TEMP_POST_ID ] = [
			'status' => 202,
			'body'   => [],
		];

		$started = microtime( true );
		$result  = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertWPError( $result );
		$this->assertSame( 'beehiiv_test_send_draft_pending', $result->get_error_code() );
		$this->assertGreaterThanOrEqual( 3, $this->count_requests( 'GET /posts/' . self::TEMP_POST_ID ) );
		$this->assertSame( 0, $this->count_requests( 'POST /posts/' . self::TEMP_POST_ID . '/test_sends' ) );
		$this->assertSame( [ 'leftover_draft' => true ], $result->get_error_data() );
		$this->assertLessThan( 2.0, microtime( true ) - $started, 'The wait budget bounds the request.' );
	}

	/**
	 * A test send that still can't find a just-created draft is retried exactly once.
	 */
	public function test_not_found_test_send_is_retried_once(): void {
		$post_id = $this->create_post( 'draft' );

		$this->responses[ 'POST /posts/' . self::TEMP_POST_ID . '/test_sends' ] = [
			'sequence' => [
				[
					'status' => 404,
					'body'   => [ 'errors' => [ [ 'message' => "Couldn't find post with 'id'=" . self::TEMP_POST_ID ] ] ],
				],
				[
					'status' => 200,
					'body'   => [ 'data' => [ 'remaining_test_sends' => 8 ] ],
				],
			],
		];

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertIsArray( $result );
		$this->assertSame( 8, $result['remaining_test_sends'] );
		$this->assertSame( 2, $this->count_requests( 'POST /posts/' . self::TEMP_POST_ID . '/test_sends' ) );
	}

	/**
	 * AC-018: when beehiiv leaves out the reset time, the remembered one is shown.
	 */
	public function test_missing_reset_time_falls_back_to_remembered(): void {
		$post_id    = $this->create_post( 'draft' );
		$remembered = time() + 5400;
		update_option( TestSender::RESET_AT_OPTION, [ self::PUBLICATION_ID => $remembered ] );

		$this->responses[ 'POST /posts/' . self::TEMP_POST_ID . '/test_sends' ] = [
			'status' => 200,
			'body'   => [ 'data' => [ 'remaining_test_sends' => 6 ] ],
		];

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertSame( $remembered, $result['reset_at'] );
	}

	/**
	 * R-003: a failed test send that also leaves a draft behind tells the editor so.
	 */
	public function test_leftover_draft_is_reported_on_failure(): void {
		do_action( 'rest_api_init' );
		wp_set_current_user( self::factory()->user->create( [ 'role' => 'editor' ] ) );

		$post_id = $this->create_post( 'draft' );

		$this->responses[ 'POST /posts/' . self::TEMP_POST_ID . '/test_sends' ] = [
			'status' => 500,
			'body'   => [ 'errors' => [ [ 'message' => 'Internal error' ] ] ],
		];
		$this->responses[ 'DELETE /posts/' . self::TEMP_POST_ID ]               = [
			'status' => 202,
			'body'   => [],
		];

		$request = new WP_REST_Request( 'POST', '/beehiiv/v1/test-send' );
		$request->set_param( 'post_id', $post_id );
		$request->set_param( 'recipients', 'a@example.com' );
		$response = rest_do_request( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertTrue( $response->get_data()['leftover_draft'] );
	}

	/**
	 * A post set to its own publication creates its temporary draft and sends the
	 * test there, with that publication's template, not the site-wide default.
	 */
	public function test_unlinked_post_uses_its_own_publication(): void {
		\Beehiiv\API\Cache::set_publications(
			[
				[
					'id'   => self::PUBLICATION_ID,
					'name' => 'Default',
				],
				[
					'id'   => 'pub_other',
					'name' => 'Other',
				],
			]
		);
		\Beehiiv\API\Cache::set_post_templates(
			'pub_other',
			[
				[
					'id'   => 'tpl_other',
					'name' => 'Other template',
				],
			]
		);

		$post_id = $this->create_post(
			'draft',
			[
				Meta::BEEHIIV_PUBLICATION_ID   => 'pub_other',
				Meta::BEEHIIV_POST_TEMPLATE_ID => 'tpl_other',
			]
		);

		$this->assertIsArray( TestSender::send( $post_id, [ 'a@example.com' ] ) );

		$beehiiv_calls = array_values(
			array_filter(
				$this->requests,
				static function ( $request ) {
					return false !== strpos( $request['url'], '/publications/' );
				}
			)
		);

		$this->assertNotEmpty( $beehiiv_calls );

		foreach ( $beehiiv_calls as $request ) {
			$this->assertStringContainsString( '/publications/pub_other/', $request['url'] );
		}

		$this->assertSame( 'tpl_other', $beehiiv_calls[0]['body']['post_template_id'] );
	}

	/**
	 * A linked newsletter is tested in the publication it was created in.
	 */
	public function test_linked_newsletter_uses_its_linked_publication(): void {
		$post_id = $this->create_post(
			'future',
			[
				Meta::BEEHIIV_POST_ID               => self::LINKED_POST_ID,
				Meta::BEEHIIV_SCHEDULED_AT          => gmdate( 'Y-m-d\\TH:i:s\\Z', time() + DAY_IN_SECONDS ),
				Meta::BEEHIIV_LINKED_PUBLICATION_ID => 'pub_linked',
			]
		);

		$this->assertIsArray( TestSender::send( $post_id, [ 'a@example.com' ] ) );

		$sends = array_values(
			array_filter(
				$this->requests,
				static function ( $request ) {
					return false !== strpos( $request['url'], '/test_sends' );
				}
			)
		);

		$this->assertCount( 1, $sends );
		$this->assertStringContainsString(
			'/publications/pub_linked/posts/' . self::LINKED_POST_ID . '/test_sends',
			$sends[0]['url']
		);
	}

	/**
	 * AC-013: once the sync flow has recorded that beehiiv sent the newsletter, the
	 * post can't send a test, even while its stored schedule is still in the future.
	 */
	public function test_sent_flag_from_sync_refuses_test_send(): void {
		$post_id = $this->create_post(
			'future',
			[
				Meta::BEEHIIV_POST_ID         => self::LINKED_POST_ID,
				Meta::BEEHIIV_SCHEDULED_AT    => gmdate( 'Y-m-d\\TH:i:s\\Z', time() + DAY_IN_SECONDS ),
				Meta::BEEHIIV_NEWSLETTER_SENT => '1',
			]
		);

		$result = TestSender::send( $post_id, [ 'a@example.com' ] );

		$this->assertWPError( $result );
		$this->assertSame( 'beehiiv_test_send_already_sent', $result->get_error_code() );
		$this->assertSame( 0, $this->count_requests( 'POST /posts/' . self::LINKED_POST_ID . '/test_sends' ) );
	}

	/**
	 * AC-003: recipients split on commas and new lines, trimmed, de-duplicated.
	 */
	public function test_parse_recipients(): void {
		$this->assertSame(
			[ 'a@example.com', 'b@example.com', 'c@example.com' ],
			TestSendController::parse_recipients( " a@example.com, b@example.com\nA@Example.com\r\n\n c@example.com ," )
		);
	}

	/**
	 * AC-004, AC-014, AC-017: the REST route needs publish rights and edit rights,
	 * and refuses invalid addresses without calling beehiiv.
	 */
	public function test_rest_route_permissions_and_validation(): void {
		do_action( 'rest_api_init' );

		$post_id = $this->create_post( 'draft' );

		$contributor = self::factory()->user->create( [ 'role' => 'contributor' ] );
		wp_set_current_user( $contributor );

		$request = new WP_REST_Request( 'POST', '/beehiiv/v1/test-send' );
		$request->set_param( 'post_id', $post_id );
		$request->set_param( 'recipients', 'a@example.com' );

		$this->assertSame( 403, rest_do_request( $request )->get_status(), 'AC-014: contributors cannot send tests.' );

		wp_set_current_user( self::factory()->user->create( [ 'role' => 'editor' ] ) );

		$request->set_param( 'recipients', 'a@example.com, not-an-email' );
		$response = rest_do_request( $request );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'beehiiv_test_send_invalid_recipients', $response->get_data()['code'] );
		$this->assertStringContainsString( 'not-an-email', $response->get_data()['message'] );
		$this->assertSame( [], $this->request_log(), 'AC-004: nothing is sent when an address is invalid.' );

		$request->set_param( 'recipients', 'a@example.com' );
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 9, $response->get_data()['remaining_test_sends'] );
	}
}
