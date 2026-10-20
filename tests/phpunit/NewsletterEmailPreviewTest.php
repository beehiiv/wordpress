<?php
/**
 * Unit coverage for the in-editor email preview (PRD-06.5.02).
 *
 * @package beehiiv
 */

use Beehiiv\Config;
use Beehiiv\Editor\Meta;
use Beehiiv\Newsletter\EmailPreview;
use Beehiiv\OAuth\TokenStore;
use Beehiiv\REST\EmailPreviewController;

/**
 * @covers \Beehiiv\Newsletter\EmailPreview
 * @covers \Beehiiv\REST\EmailPreviewController
 * @covers \Beehiiv\API\Resources\Posts::get_email_content
 */
class NewsletterEmailPreviewTest extends WP_UnitTestCase {

	private const PUBLICATION_ID = 'pub_test';

	private const DRAFT_ID = 'post_draft_1';

	/**
	 * @var array<int, array{method: string, url: string, body: array<string,mixed>|null}>
	 */
	private $requests = [];

	/**
	 * @var array<string, array{status: int, body: array<string,mixed>}>
	 */
	private $responses = [];

	public function set_up(): void {
		parent::set_up();

		$this->requests  = [];
		$this->responses = [
			'GET /workspaces/permissions'    => [
				'status' => 200,
				'body'   => [ 'data' => [ 'posts' => [ 'read', 'write' ] ] ],
			],
			'GET /publications'              => [
				'status' => 200,
				'body'   => [
					'data' => [
						[
							'id'   => self::PUBLICATION_ID,
							'name' => 'Zack Newsletter',
						],
					],

				],
			],
			'POST /posts'                    => [
				'status' => 201,
				'body'   => [ 'data' => [ 'id' => self::DRAFT_ID ] ],
			],
			'PATCH /posts/' . self::DRAFT_ID => [
				'status' => 200,
				'body'   => [ 'data' => [ 'id' => self::DRAFT_ID ] ],
			],
			'GET /posts/' . self::DRAFT_ID   => [
				'status' => 200,
				'body'   => [
					'data' => [
						'title'          => 'Weekly roundup',
						'email_settings' => [
							'email_subject_line' => 'Subject line',
							'email_preview_text' => 'Preview text',
						],
						'content'        => [ 'free' => [ 'email' => '<html><body>Rendered</body></html>' ] ],
					],
				],
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

	private function post_meta_snapshot( int $post_id ): array {
		$keep = [
			Meta::SEND_TO_NEWSLETTER,
			Meta::SEND_TO_NEWSLETTER_DATE,
			Meta::NEWSLETTER_ERROR,
			Meta::NEWSLETTER_ERROR_TYPE,
		];
		$out  = [];

		foreach ( $keep as $key ) {
			$out[ $key ] = get_post_meta( $post_id, $key, true );
		}

		return $out;
	}

	/**
	 * AC-003, AC-004: the first preview creates the draft, then returns beehiiv's rendered email.
	 */
	public function test_preview_creates_draft_then_returns_rendered_email(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );

		$result = EmailPreview::render( $post_id );

		$this->assertSame( '<html><body>Rendered</body></html>', $result['html'] );
		$this->assertSame( 'Subject line', $result['subject'] );
		$this->assertSame( 'Preview text', $result['preview_text'] );
		$this->assertSame( 'Zack Newsletter', $result['from_name'] );
		$this->assertSame(
			[ 'GET /workspaces/permissions', 'POST /posts', 'GET /posts/' . self::DRAFT_ID, 'GET /publications' ],
			$this->request_log()
		);
		$this->assertSame( 'draft', $this->requests[1]['body']['status'] );
		$this->assertStringContainsString( 'expand=free_email_content', $this->requests[2]['url'] );
	}

	/**
	 * AC-003, AC-007: every preview syncs the same draft again and fetches again.
	 */
	public function test_each_preview_updates_the_same_draft_and_refetches(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );
		EmailPreview::render( $post_id );
		$this->requests = [];

		EmailPreview::render( $post_id );

		$this->assertSame(
			[ 'GET /workspaces/permissions', 'PATCH /posts/' . self::DRAFT_ID, 'GET /posts/' . self::DRAFT_ID ],
			$this->request_log()
		);
		$this->assertSame( self::DRAFT_ID, get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
	}

	/**
	 * AC-012, AC-009: not opted in, or beehiiv not ready, never reaches beehiiv to create a post.
	 */
	public function test_ineligible_posts_never_get_a_beehiiv_post(): void {
		$not_opted = $this->create_post( 'draft' );
		$result    = EmailPreview::render( $not_opted );
		$this->assertWPError( $result );
		$this->assertSame( 'beehiiv_preview_not_opted_in', $result->get_error_code() );

		update_option(
			Config::OPTION_NAME,
			[
				'publication_id'   => '',
				'post_template_id' => 'tpl_default',
			]
		);
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );
		$result  = EmailPreview::render( $post_id );
		$this->assertSame( 'beehiiv_missing_publication', $result->get_error_code() );

		$this->assertNotContains( 'POST /posts', $this->request_log() );
	}

	/**
	 * AC-009, AC-013: a workspace without Send API access gets the plan message.
	 */
	public function test_plan_without_send_api_is_reported(): void {
		$this->responses['GET /workspaces/permissions']['body'] = [ 'data' => [ 'posts' => [ 'read' ] ] ];
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );

		$result = EmailPreview::render( $post_id );

		$this->assertSame( 'beehiiv_preview_plan', $result->get_error_code() );
		$this->assertNotContains( 'POST /posts', $this->request_log() );
	}

	/**
	 * AC-010: a confirmed (scheduled or sent) newsletter can't be previewed.
	 */
	public function test_confirmed_newsletter_cannot_be_previewed(): void {
		$post_id = $this->create_post(
			'publish',
			[
				Meta::BEEHIIV_POST_ID    => self::DRAFT_ID,
				Meta::BEEHIIV_POST_STATE => 'confirmed',
			]
		);

		$result = EmailPreview::render( $post_id );

		$this->assertSame( 'beehiiv_newsletter_confirmed', $result->get_error_code() );
		$this->assertSame( [], $this->requests );
	}

	/**
	 * AC-006: an email beehiiv is still preparing returns `processing` at once, without waiting;
	 * a follow-up fetch-only call returns the email without syncing the draft again.
	 */
	public function test_still_preparing_email_returns_processing_then_fetch_only_completes(): void {
		$ready = $this->responses[ 'GET /posts/' . self::DRAFT_ID ];

		$this->responses[ 'GET /posts/' . self::DRAFT_ID ]['body'] = [ 'data' => [ 'content' => [ 'free' => [ 'email' => '' ] ] ] ];
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );

		$start  = microtime( true );
		$result = EmailPreview::render( $post_id );

		$this->assertSame( [ 'processing' => true ], $result );
		$this->assertLessThan( 1.0, microtime( true ) - $start, 'The request must not wait for beehiiv.' );

		$this->requests                                    = [];
		$this->responses[ 'GET /posts/' . self::DRAFT_ID ] = $ready;

		$result = EmailPreview::render( $post_id, true );

		$this->assertSame( '<html><body>Rendered</body></html>', $result['html'] );
		$this->assertSame(
			[ 'GET /workspaces/permissions', 'GET /posts/' . self::DRAFT_ID, 'GET /publications' ],
			$this->request_log(),
			'A fetch-only call never creates or updates the draft.'
		);
	}

	/**
	 * A fetch-only call without a linked draft is refused rather than creating one.
	 */
	public function test_fetch_only_without_a_linked_draft_is_refused(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );

		$result = EmailPreview::render( $post_id, true );

		$this->assertWPError( $result );
		$this->assertNotContains( 'POST /posts', $this->request_log() );
	}

	/**
	 * AC-013, AC-014: classified failures leave the post's newsletter state alone.
	 */
	public function test_failures_are_classified_and_leave_post_state_alone(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );
		$before  = $this->post_meta_snapshot( $post_id );

		$this->responses['POST /posts'] = [
			'status' => 403,
			'body'   => [ 'errors' => [ [ 'message' => 'Forbidden' ] ] ],
		];
		$result                         = EmailPreview::render( $post_id );
		$this->assertSame( 'beehiiv_preview_connection', $result->get_error_code() );

		$this->responses['POST /posts'] = [
			'status' => 422,
			'body'   => [ 'errors' => [ [ 'message' => 'Subject too long' ] ] ],
		];
		$result                         = EmailPreview::render( $post_id );
		$this->assertSame( 'beehiiv_preview_failed', $result->get_error_code() );
		$this->assertStringContainsString( 'Subject too long', $result->get_error_message() );

		$empty = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );
		wp_update_post(
			[
				'ID'           => $empty,
				'post_content' => '',
			]
		);
		$result = EmailPreview::render( $empty );
		$this->assertSame( 'beehiiv_preview_content', $result->get_error_code() );

		$this->assertSame( $before, $this->post_meta_snapshot( $post_id ), 'AC-014' );
		$this->assertSame( '', get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
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
	 * The newsletter title and subtitle override the subject and preview text: they reach
	 * beehiiv in the draft, and a preview shows them even if beehiiv returns the fields empty.
	 */
	public function test_newsletter_title_and_subtitle_override_subject_and_preview_text(): void {
		$post_id = $this->create_post(
			'draft',
			[
				Meta::SEND_TO_NEWSLETTER  => '1',
				Meta::NEWSLETTER_TITLE    => 'Inbox wording',
				Meta::NEWSLETTER_SUBTITLE => 'Inbox subtitle',
			]
		);

		$this->responses[ 'GET /posts/' . self::DRAFT_ID ]['body'] = [
			'data' => [
				'title'   => 'Weekly roundup',
				'content' => [ 'free' => [ 'email' => '<html></html>' ] ],
			],
		];

		$result = EmailPreview::render( $post_id );

		$created = $this->find_request( 'POST' )['body'];
		$this->assertSame( 'Inbox wording', $created['email_settings']['email_subject_line'] );
		$this->assertSame( 'Weekly roundup', $created['title'], 'The headline stays the post title.' );
		$this->assertSame( 'Inbox subtitle', $created['subtitle'] );

		$this->assertSame( 'Inbox wording', $result['subject'] );
		$this->assertSame( 'Inbox subtitle', $result['preview_text'] );

		// Clearing both falls back to the post title and no preview text, and the next
		// preview update clears the subtitle in beehiiv.
		delete_post_meta( $post_id, Meta::NEWSLETTER_TITLE );
		delete_post_meta( $post_id, Meta::NEWSLETTER_SUBTITLE );
		$this->requests = [];

		$result = EmailPreview::render( $post_id );

		$patched = $this->find_request( 'PATCH' )['body'];
		$this->assertSame( 'Weekly roundup', $patched['email_settings']['email_subject_line'] );
		$this->assertSame( '', $patched['subtitle'] );
		$this->assertSame( 'Weekly roundup', $result['subject'] );
		$this->assertSame( '', $result['preview_text'] );
	}

	/**
	 * AC-011: the REST route requires publish rights and edit access.
	 */
	public function test_rest_permission_requires_publish_and_edit_rights(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );
		$request = new WP_REST_Request( 'POST', '/beehiiv/v1/email-preview' );
		$request->set_param( 'post_id', $post_id );

		$this->assertTrue( EmailPreviewController::permissions_check( $request ) );

		wp_set_current_user( self::factory()->user->create( [ 'role' => 'contributor' ] ) );
		$this->assertFalse( EmailPreviewController::permissions_check( $request ) );

		wp_set_current_user( 0 );
		$this->assertFalse( EmailPreviewController::permissions_check( $request ) );
	}

	/**
	 * AC-011: the controller returns the HTML on success and a code/message error otherwise.
	 */
	public function test_rest_controller_response_shapes(): void {
		$post_id = $this->create_post( 'draft', [ Meta::SEND_TO_NEWSLETTER => '1' ] );
		$request = new WP_REST_Request( 'POST', '/beehiiv/v1/email-preview' );
		$request->set_param( 'post_id', $post_id );

		$ok = EmailPreviewController::preview( $request );
		$this->assertSame( 200, $ok->get_status() );
		$this->assertArrayHasKey( 'html', $ok->get_data() );

		$this->responses[ 'GET /posts/' . self::DRAFT_ID ]['body'] = [ 'data' => [ 'content' => [ 'free' => [ 'email' => '' ] ] ] ];
		$request->set_param( 'fetch_only', true );
		$processing = EmailPreviewController::preview( $request );
		$this->assertSame( 202, $processing->get_status() );
		$this->assertSame( [ 'processing' => true ], $processing->get_data() );
		$request->set_param( 'fetch_only', false );

		delete_post_meta( $post_id, Meta::BEEHIIV_POST_ID );
		delete_post_meta( $post_id, Meta::BEEHIIV_POST_STATE );
		update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, '0' );

		$err = EmailPreviewController::preview( $request );
		$this->assertSame( 400, $err->get_status() );
		$this->assertSame( 'beehiiv_preview_not_opted_in', $err->get_data()['code'] );
	}
}
