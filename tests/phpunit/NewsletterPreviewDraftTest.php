<?php
/**
 * Unit coverage for the Preview draft lifecycle (PRD-07.1.01, US-010).
 *
 * beehiiv HTTP calls are answered by a method-aware `pre_http_request` stub that
 * records every outbound request.
 *
 * @package beehiiv
 */

use Beehiiv\Config;
use Beehiiv\Editor\Meta;
use Beehiiv\Newsletter\Sender;
use Beehiiv\OAuth\TokenStore;

/**
 * @covers \Beehiiv\Newsletter\Sender
 * @covers \Beehiiv\Newsletter\PostSettingsBuilder
 */
class NewsletterPreviewDraftTest extends WP_UnitTestCase {

	private const PUBLICATION_ID = 'pub_test';

	private const DRAFT_ID = 'post_draft_1';

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

	public function set_up(): void {
		parent::set_up();

		$this->requests  = [];
		$this->responses = [
			'POST /posts'                     => [
				'status' => 201,
				'body'   => [ 'data' => [ 'id' => self::DRAFT_ID ] ],
			],
			'PATCH /posts/' . self::DRAFT_ID  => [
				'status' => 200,
				'body'   => [ 'data' => [ 'id' => self::DRAFT_ID ] ],
			],
			'DELETE /posts/' . self::DRAFT_ID => [
				'status' => 204,
				'body'   => [],
			],
		];

		add_filter( 'pre_http_request', [ $this, 'stub_http' ], 10, 3 );

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

		wp_set_current_user( self::factory()->user->create( [ 'role' => 'administrator' ] ) );
	}

	public function tear_down(): void {
		remove_filter( 'pre_http_request', [ $this, 'stub_http' ], 10 );
		remove_all_filters( 'beehiiv_newsletter_post_settings' );
		TokenStore::delete_all();
		delete_option( Config::OPTION_NAME );
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
					$match = [ strlen( $suffix ), $response ];
				}
			}
		}

		$response = null === $match ? [
			'status' => 404,
			'body'   => [ 'errors' => [ [ 'message' => 'not stubbed' ] ] ],
		] : $match[1];

		return [
			'headers'  => [],
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

	private function find_request( string $method ): ?array {
		foreach ( $this->requests as $request ) {
			if ( $request['method'] === $method ) {
				return $request;
			}
		}

		return null;
	}

	/**
	 * AC-037, AC-039, AC-040, AC-043: Preview on an opted-in saved post creates a draft,
	 * links it in the draft state, forces draft status through a filter, and leaves the
	 * toggle and error state alone.
	 */
	public function test_preview_creates_linked_draft_even_when_a_filter_tries_to_confirm(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );

		add_filter(
			'beehiiv_newsletter_post_settings',
			static function ( $settings ) {
				$settings['status']       = 'confirmed';
				$settings['scheduled_at'] = '2030-01-01T00:00:00Z';

				return $settings;
			}
		);

		$result = Sender::sync_preview_draft( $post_id );

		$this->assertIsArray( $result );
		$this->assertTrue( $result['created'] );
		$this->assertSame( self::DRAFT_ID, get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
		$this->assertSame( 'draft', get_post_meta( $post_id, Meta::BEEHIIV_POST_STATE, true ) );
		$this->assertTrue( Sender::is_draft_linked( $post_id ) );

		$body = $this->find_request( 'POST' )['body'];
		$this->assertSame( 'draft', $body['status'] );
		$this->assertArrayNotHasKey( 'scheduled_at', $body );

		$this->assertSame( '1', get_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, true ), 'AC-043: toggle untouched.' );
		$this->assertSame( '', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR, true ) );
	}

	/**
	 * A preview that starts while another is in flight is refused, so only one beehiiv draft
	 * is ever created; the lock is released afterwards, and an abandoned lock is taken over.
	 */
	public function test_simultaneous_previews_create_only_one_draft(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );

		// Another request holds the lock.
		add_option( 'beehiiv_preview_lock_' . $post_id, time(), '', false );

		$result = Sender::sync_preview_draft( $post_id );

		$this->assertWPError( $result );
		$this->assertSame( 'beehiiv_preview_in_progress', $result->get_error_code() );
		$this->assertSame( [], $this->requests );
		$this->assertSame( '', get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );

		// An abandoned (stale) lock is taken over.
		update_option( 'beehiiv_preview_lock_' . $post_id, time() - 3600 );

		$result = Sender::sync_preview_draft( $post_id );

		$this->assertIsArray( $result );
		$this->assertFalse( get_option( 'beehiiv_preview_lock_' . $post_id ), 'The lock is released after the sync.' );
		$this->assertSame( [ 'POST /posts' ], $this->request_log() );
	}

	/**
	 * AC-038: a later Preview updates the same beehiiv post and never confirms it.
	 */
	public function test_second_preview_updates_same_draft(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );

		Sender::sync_preview_draft( $post_id );
		$this->requests = [];

		$result = Sender::sync_preview_draft( $post_id );

		$this->assertIsArray( $result );
		$this->assertFalse( $result['created'] );
		$this->assertSame( [ 'PATCH /posts/' . self::DRAFT_ID ], $this->request_log() );

		$body = $this->requests[0]['body'];
		$this->assertArrayNotHasKey( 'status', $body );
		$this->assertArrayNotHasKey( 'scheduled_at', $body );
		$this->assertSame( self::DRAFT_ID, get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
	}

	/**
	 * AC-041, AC-043: a post that is not opted in gets no draft, and a beehiiv failure is
	 * returned without storing a newsletter error or changing the toggle.
	 */
	public function test_preview_requires_opt_in_and_failures_leave_post_state_alone(): void {
		$not_opted = $this->create_post( 'draft' );
		$result    = Sender::sync_preview_draft( $not_opted );

		$this->assertWPError( $result );
		$this->assertSame( 'beehiiv_preview_not_opted_in', $result->get_error_code() );
		$this->assertSame( [], $this->requests );

		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );

		$this->responses['POST /posts'] = [
			'status' => 422,
			'body'   => [ 'errors' => [ [ 'message' => 'Nope' ] ] ],
		];

		$result = Sender::sync_preview_draft( $post_id );

		$this->assertWPError( $result );
		$this->assertSame( '', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR, true ) );
		$this->assertSame( '', get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
		$this->assertSame( '1', get_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, true ) );
	}

	/**
	 * AC-042: moving the post to a non-public status leaves the draft; AC-012: draft saves
	 * make no beehiiv call.
	 */
	public function test_status_change_and_draft_saves_leave_the_draft_alone(): void {
		$post_id = $this->create_post( 'publish', [ Meta::SEND_TO_NEWSLETTER => '1' ] );
		update_post_meta( $post_id, Meta::BEEHIIV_POST_ID, self::DRAFT_ID );
		update_post_meta( $post_id, Meta::BEEHIIV_POST_STATE, 'draft' );

		wp_update_post(
			[
				'ID'          => $post_id,
				'post_status' => 'draft',
			]
		);

		$this->assertSame( self::DRAFT_ID, get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
		$this->assertTrue( Sender::is_draft_linked( $post_id ) );

		Sender::maybe_send_post_newsletter( get_post( $post_id ) );

		$this->assertSame( [], $this->requests );
	}

	/**
	 * Publishing a post with a previewed draft replaces the draft with a real send, so the
	 * email is never left behind as an unsent draft.
	 */
	public function test_publishing_replaces_the_draft_with_a_real_send(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );
		Sender::sync_preview_draft( $post_id );
		$this->requests = [];

		$this->responses['POST /posts'] = [
			'status' => 201,
			'body'   => [ 'data' => [ 'id' => 'post_sent_1' ] ],
		];

		wp_update_post(
			[
				'ID'          => $post_id,
				'post_status' => 'publish',
			]
		);

		$log = $this->request_log();
		$this->assertContains( 'DELETE /posts/' . self::DRAFT_ID, $log );
		$this->assertContains( 'POST /posts', $log );
		$this->assertLessThan( array_search( 'POST /posts', $log, true ), array_search( 'DELETE /posts/' . self::DRAFT_ID, $log, true ) );
		$this->assertSame( 'confirmed', $this->find_request( 'POST' )['body']['status'] );
		$this->assertSame( 'post_sent_1', get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
		$this->assertFalse( Sender::is_draft_linked( $post_id ) );
	}

	/**
	 * A failed draft cleanup on publish is reported and keeps the draft link, so a later save retries.
	 */
	public function test_failed_draft_cleanup_on_publish_is_reported_and_retried(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );
		Sender::sync_preview_draft( $post_id );

		$this->responses[ 'DELETE /posts/' . self::DRAFT_ID ] = [
			'status' => 500,
			'body'   => [],
		];

		wp_update_post(
			[
				'ID'          => $post_id,
				'post_status' => 'publish',
			]
		);

		$this->assertNotSame( '', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR, true ) );
		$this->assertTrue( Sender::is_draft_linked( $post_id ) );
		$this->assertNotContains( 'confirmed', array_column( array_column( $this->requests, 'body' ), 'status' ) );
	}

	/**
	 * AC-042: deleting the WordPress post deletes the draft.
	 */
	public function test_deleting_the_post_deletes_the_draft(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );
		Sender::sync_preview_draft( $post_id );
		$this->requests = [];

		wp_delete_post( $post_id, true );

		$this->assertSame( [ 'DELETE /posts/' . self::DRAFT_ID ], $this->request_log() );
	}

	/**
	 * AC-043: turning off Send to newsletter deletes the draft and clears the link.
	 */
	public function test_turning_off_the_toggle_deletes_the_draft(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );
		Sender::sync_preview_draft( $post_id );
		$this->requests = [];

		update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, false );
		Sender::maybe_send_post_newsletter( get_post( $post_id ) );

		$this->assertSame( [ 'DELETE /posts/' . self::DRAFT_ID ], $this->request_log() );
		$this->assertSame( '', get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
		$this->assertSame( '', get_post_meta( $post_id, Meta::BEEHIIV_POST_STATE, true ) );
	}

	/**
	 * Legacy links (no state) keep syncing until sent: they are treated as the existing path.
	 */
	public function test_legacy_link_without_state_still_syncs_on_save(): void {
		$post_id = $this->create_post( 'publish', [ Meta::SEND_TO_NEWSLETTER => '0' ] );
		update_post_meta( $post_id, Meta::BEEHIIV_POST_ID, self::DRAFT_ID );

		$this->assertFalse( Sender::is_draft_linked( $post_id ) );

		$this->responses[ 'GET /posts/' . self::DRAFT_ID ] = [
			'status' => 200,
			'body'   => [
				'data' => [
					'id'     => self::DRAFT_ID,
					'status' => 'confirmed',
				],
			],
		];

		Sender::maybe_send_post_newsletter( get_post( $post_id ) );

		// The sent-state check (GET) runs first when no send time is known, then the update.
		$this->assertSame(
			[ 'GET /posts/' . self::DRAFT_ID, 'PATCH /posts/' . self::DRAFT_ID ],
			$this->request_log()
		);
	}
}
