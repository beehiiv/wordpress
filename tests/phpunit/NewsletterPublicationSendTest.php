<?php
/**
 * Unit coverage for sending, syncing, moving and cancelling newsletters in a post's publication.
 *
 * Post-Level Publication Selector PRD AC-011 to AC-019. beehiiv HTTP is mocked via `pre_http_request`.
 *
 * @package beehiiv
 */

use Beehiiv\API\Cache;
use Beehiiv\Config;
use Beehiiv\Editor\Meta;
use Beehiiv\Newsletter\Sender;
use Beehiiv\OAuth\TokenStore;

/**
 * @covers \Beehiiv\Newsletter\Sender
 * @covers \Beehiiv\Newsletter\PostSettingsBuilder::resolve_post_template_id
 */
class NewsletterPublicationSendTest extends WP_UnitTestCase {

	/**
	 * HTTP requests made during the test.
	 *
	 * @var array<int, array{method: string, url: string, body: array}>
	 */
	private $requests = array();

	/**
	 * HTTP status returned for create (POST) requests.
	 *
	 * @var int
	 */
	private $create_status = 200;

	public function set_up(): void {
		parent::set_up();

		$this->requests      = array();
		$this->create_status = 200;

		TokenStore::save_tokens(
			'client_test',
			array(
				'access_token'  => 'access_test',
				'refresh_token' => 'refresh_test',
				'expires_in'    => DAY_IN_SECONDS,
			)
		);

		update_option(
			Config::OPTION_NAME,
			array(
				'publication_id'   => 'pub_default',
				'post_template_id' => 'tpl_default',
			)
		);

		Cache::set_publications(
			array(
				array(
					'id'   => 'pub_default',
					'name' => 'Default Weekly',
				),
				array(
					'id'   => 'pub_other',
					'name' => 'Other Daily',
				),
			)
		);
		Cache::set_post_templates(
			'pub_default',
			array(
				array(
					'id'   => 'tpl_default',
					'name' => 'Default template',
				),
				array(
					'id'   => 'tpl_alt',
					'name' => 'Alt template',
				),
			)
		);
		Cache::set_post_templates(
			'pub_other',
			array(
				array(
					'id'   => 'tpl_other',
					'name' => 'Other template',
				),
			)
		);

		add_filter( 'pre_http_request', array( $this, 'mock_http' ), 10, 3 );
	}

	public function tear_down(): void {
		remove_filter( 'pre_http_request', array( $this, 'mock_http' ), 10 );
		Cache::flush_all();
		parent::tear_down();
	}

	/**
	 * Record every request and answer as beehiiv would.
	 *
	 * @param false|array $preempt Short-circuit value.
	 * @param array       $args    Request args.
	 * @param string      $url     Request URL.
	 * @return array
	 */
	public function mock_http( $preempt, $args, $url ) {
		$method = isset( $args['method'] ) ? strtoupper( $args['method'] ) : 'GET';
		$body   = isset( $args['body'] ) && is_string( $args['body'] ) ? json_decode( $args['body'], true ) : array();

		$this->requests[] = array(
			'method' => $method,
			'url'    => $url,
			'body'   => is_array( $body ) ? $body : array(),
		);

		if ( 'DELETE' === $method ) {
			return $this->http_response( 204, array() );
		}

		if ( 'POST' === $method ) {
			if ( 200 !== $this->create_status ) {
				return $this->http_response( $this->create_status, array( 'message' => 'Server error' ) );
			}

			return $this->http_response( 200, array( 'data' => array( 'id' => 'post_new' ) ) );
		}

		return $this->http_response( 200, array( 'data' => array( 'id' => 'post_linked' ) ) );
	}

	/**
	 * Build a WP HTTP API response array.
	 *
	 * @param int   $code HTTP status.
	 * @param array $body JSON body.
	 * @return array
	 */
	private function http_response( int $code, array $body ): array {
		return array(
			'headers'  => array(),
			'body'     => wp_json_encode( $body ),
			'response' => array(
				'code'    => $code,
				'message' => '',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	}

	/**
	 * Create a published post queued for the newsletter.
	 *
	 * @param array<string, string> $meta Meta to set before anything is linked.
	 * @return int Post ID.
	 */
	private function create_post( array $meta = array() ): int {
		$post_id = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_title'   => 'Weekly roundup',
				'post_content' => "<!-- wp:paragraph -->\n<p>Hello subscribers.</p>\n<!-- /wp:paragraph -->",
			)
		);

		update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, true );

		foreach ( $meta as $key => $value ) {
			update_post_meta( $post_id, $key, $value );
		}

		$this->requests = array();

		return $post_id;
	}

	/**
	 * Create a post linked to a scheduled, unsent beehiiv newsletter.
	 *
	 * @param string                $linked_publication Publication the beehiiv post lives in.
	 * @param string                $linked_template    Template the beehiiv post was created with.
	 * @param array<string, string> $meta               Meta to set before linking.
	 * @return int Post ID.
	 */
	private function create_scheduled_linked_post( string $linked_publication, string $linked_template, array $meta = array() ): int {
		$send_at = gmdate( 'Y-m-d\TH:i:s\Z', time() + DAY_IN_SECONDS );
		$post_id = $this->create_post( $meta );

		update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER_DATE, get_date_from_gmt( gmdate( 'Y-m-d H:i:s', time() + DAY_IN_SECONDS ), 'Y-m-d\TH:i:s' ) );
		update_post_meta( $post_id, Meta::BEEHIIV_SCHEDULED_AT, $send_at );
		update_post_meta( $post_id, Meta::BEEHIIV_LINKED_PUBLICATION_ID, $linked_publication );
		update_post_meta( $post_id, Meta::BEEHIIV_LINKED_POST_TEMPLATE_ID, $linked_template );
		update_post_meta( $post_id, Meta::BEEHIIV_POST_ID, 'post_linked' );
		update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, false );

		$this->requests = array();

		return $post_id;
	}

	/**
	 * Requests made with a given HTTP method.
	 *
	 * @param string $method HTTP method.
	 * @return array
	 */
	private function requests_with( string $method ): array {
		return array_values(
			array_filter(
				$this->requests,
				static function ( $request ) use ( $method ) {
					return $method === $request['method'];
				}
			)
		);
	}

	/**
	 * AC-012: the newsletter is created in the post's publication, and the publication is recorded.
	 */
	public function test_send_creates_in_chosen_publication_and_records_it(): void {
		$post_id = $this->create_post(
			array(
				Meta::BEEHIIV_PUBLICATION_ID   => 'pub_other',
				Meta::BEEHIIV_POST_TEMPLATE_ID => 'tpl_other',
			)
		);

		Sender::send( $post_id );

		$creates = $this->requests_with( 'POST' );
		$this->assertCount( 1, $creates );
		$this->assertStringContainsString( '/publications/pub_other/posts', $creates[0]['url'] );
		$this->assertSame( 'tpl_other', $creates[0]['body']['post_template_id'] );
		$this->assertSame( 'post_new', get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
		$this->assertSame( 'pub_other', get_post_meta( $post_id, Meta::BEEHIIV_LINKED_PUBLICATION_ID, true ) );
		$this->assertSame( 'tpl_other', get_post_meta( $post_id, Meta::BEEHIIV_LINKED_POST_TEMPLATE_ID, true ) );
		$this->assertSame( 'pub_other', get_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, true ) );
	}

	/**
	 * AC-005, AC-012: a post with no publication is sent to the default with the default template.
	 */
	public function test_send_without_choice_uses_default_publication_and_template(): void {
		$post_id = $this->create_post();

		Sender::send( $post_id );

		$creates = $this->requests_with( 'POST' );
		$this->assertCount( 1, $creates );
		$this->assertStringContainsString( '/publications/pub_default/posts', $creates[0]['url'] );
		$this->assertSame( 'tpl_default', $creates[0]['body']['post_template_id'] );
		$this->assertSame( 'pub_default', get_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, true ) );
	}

	/**
	 * AC-011, AC-018: a non-default publication with no template is refused; the default template never applies.
	 */
	public function test_send_to_other_publication_without_template_is_refused(): void {
		$post_id = $this->create_post( array( Meta::BEEHIIV_PUBLICATION_ID => 'pub_other' ) );

		Sender::send( $post_id );

		$this->assertCount( 0, $this->requests_with( 'POST' ) );
		$this->assertSame( 'save', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR_TYPE, true ) );
		$this->assertStringContainsString( 'Pick a post template', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR, true ) );
		$this->assertSame( '', get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
	}

	/**
	 * AC-018: a post with its own template sends even when no site default template is set.
	 */
	public function test_post_template_is_enough_without_site_default_template(): void {
		update_option(
			Config::OPTION_NAME,
			array(
				'publication_id'   => 'pub_default',
				'post_template_id' => '',
			)
		);
		$post_id = $this->create_post( array( Meta::BEEHIIV_POST_TEMPLATE_ID => 'tpl_alt' ) );

		Sender::send( $post_id );

		$creates = $this->requests_with( 'POST' );
		$this->assertCount( 1, $creates );
		$this->assertSame( 'tpl_alt', $creates[0]['body']['post_template_id'] );
	}

	/**
	 * AC-019: a disconnected publication falls back to the default, with a notice naming both.
	 */
	public function test_disconnected_publication_falls_back_to_default_with_notice(): void {
		$post_id = $this->create_post(
			array(
				Meta::BEEHIIV_PUBLICATION_ID   => 'pub_removed',
				Meta::BEEHIIV_POST_TEMPLATE_ID => 'tpl_removed',
			)
		);

		Sender::send( $post_id );

		$creates = $this->requests_with( 'POST' );
		$this->assertCount( 1, $creates );
		$this->assertStringContainsString( '/publications/pub_default/posts', $creates[0]['url'] );
		$this->assertSame( 'tpl_default', $creates[0]['body']['post_template_id'] );
		$this->assertSame( 'publication_fallback', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR_TYPE, true ) );
		$this->assertStringContainsString( 'Default Weekly', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR, true ) );
		$this->assertSame( 'pub_default', get_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, true ) );
	}

	/**
	 * AC-013: later syncs target the recorded publication even after the site default changes.
	 */
	public function test_update_targets_linked_publication_after_default_changes(): void {
		$post_id = $this->create_scheduled_linked_post(
			'pub_other',
			'tpl_other',
			array(
				Meta::BEEHIIV_PUBLICATION_ID   => 'pub_other',
				Meta::BEEHIIV_POST_TEMPLATE_ID => 'tpl_other',
			)
		);
		update_option(
			Config::OPTION_NAME,
			array(
				'publication_id'   => 'pub_default',
				'post_template_id' => 'tpl_alt',
			)
		);

		Sender::update( $post_id );

		$this->assertCount( 0, $this->requests_with( 'DELETE' ) );
		$this->assertCount( 0, $this->requests_with( 'POST' ) );
		$patches = $this->requests_with( 'PATCH' );
		$this->assertCount( 1, $patches );
		$this->assertStringContainsString( '/publications/pub_other/posts/post_linked', $patches[0]['url'] );
	}

	/**
	 * AC-014: changing the publication of a scheduled, unsent post moves it.
	 */
	public function test_publication_change_moves_scheduled_post(): void {
		$post_id = $this->create_scheduled_linked_post(
			'pub_default',
			'tpl_default',
			array(
				Meta::BEEHIIV_PUBLICATION_ID   => 'pub_other',
				Meta::BEEHIIV_POST_TEMPLATE_ID => 'tpl_other',
			)
		);
		$scheduled_at = get_post_meta( $post_id, Meta::BEEHIIV_SCHEDULED_AT, true );

		Sender::update( $post_id );

		$deletes = $this->requests_with( 'DELETE' );
		$creates = $this->requests_with( 'POST' );
		$this->assertCount( 1, $deletes );
		$this->assertStringContainsString( '/publications/pub_default/posts/post_linked', $deletes[0]['url'] );
		$this->assertCount( 1, $creates );
		$this->assertStringContainsString( '/publications/pub_other/posts', $creates[0]['url'] );
		$this->assertSame( 'tpl_other', $creates[0]['body']['post_template_id'] );
		$this->assertSame( $scheduled_at, $creates[0]['body']['scheduled_at'] );
		$this->assertSame( 'post_new', get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
		$this->assertSame( 'pub_other', get_post_meta( $post_id, Meta::BEEHIIV_LINKED_PUBLICATION_ID, true ) );
		$this->assertSame( '', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR, true ) );
	}

	/**
	 * AC-014, AC-017: changing the template of a scheduled, unsent post recreates it.
	 */
	public function test_template_change_recreates_scheduled_post(): void {
		$post_id = $this->create_scheduled_linked_post(
			'pub_default',
			'tpl_default',
			array( Meta::BEEHIIV_POST_TEMPLATE_ID => 'tpl_alt' )
		);

		Sender::update( $post_id );

		$this->assertCount( 1, $this->requests_with( 'DELETE' ) );
		$creates = $this->requests_with( 'POST' );
		$this->assertCount( 1, $creates );
		$this->assertStringContainsString( '/publications/pub_default/posts', $creates[0]['url'] );
		$this->assertSame( 'tpl_alt', $creates[0]['body']['post_template_id'] );
		$this->assertSame( 'tpl_alt', get_post_meta( $post_id, Meta::BEEHIIV_LINKED_POST_TEMPLATE_ID, true ) );
	}

	/**
	 * AC-014: a move with no template for the new publication changes nothing in beehiiv.
	 */
	public function test_move_without_template_deletes_nothing(): void {
		$post_id = $this->create_scheduled_linked_post(
			'pub_default',
			'tpl_default',
			array( Meta::BEEHIIV_PUBLICATION_ID => 'pub_other' )
		);

		Sender::update( $post_id );

		$this->assertCount( 0, $this->requests_with( 'DELETE' ) );
		$this->assertCount( 0, $this->requests_with( 'POST' ) );
		$this->assertSame( 'post_linked', get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
		$this->assertStringContainsString( 'Pick a post template', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR, true ) );
	}

	/**
	 * R-002: when the new post cannot be created, the post is never left linked to the deleted one.
	 */
	public function test_failed_move_clears_link(): void {
		$post_id = $this->create_scheduled_linked_post(
			'pub_default',
			'tpl_default',
			array(
				Meta::BEEHIIV_PUBLICATION_ID   => 'pub_other',
				Meta::BEEHIIV_POST_TEMPLATE_ID => 'tpl_other',
			)
		);
		$this->create_status = 500;

		Sender::update( $post_id );

		$this->assertSame( '', get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
		$this->assertSame( '', get_post_meta( $post_id, Meta::BEEHIIV_LINKED_PUBLICATION_ID, true ) );
		$this->assertTrue( (bool) get_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, true ) );
		$this->assertSame( 'send', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR_TYPE, true ) );
	}

	/**
	 * AC-015: cancelling deletes in the linked publication, keeps the choice, and unlocks.
	 */
	public function test_cancel_uses_linked_publication_and_keeps_choice(): void {
		$post_id = $this->create_scheduled_linked_post(
			'pub_other',
			'tpl_other',
			array( Meta::BEEHIIV_PUBLICATION_ID => 'pub_other' )
		);

		Sender::cancel_scheduled_newsletter( $post_id );

		$deletes = $this->requests_with( 'DELETE' );
		$this->assertCount( 1, $deletes );
		$this->assertStringContainsString( '/publications/pub_other/posts/post_linked', $deletes[0]['url'] );
		$this->assertSame( '', get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
		$this->assertSame( '', get_post_meta( $post_id, Meta::BEEHIIV_LINKED_PUBLICATION_ID, true ) );
		$this->assertSame( 'pub_other', get_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, true ) );

		update_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, 'pub_default' );
		$this->assertSame( 'pub_default', get_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, true ) );
	}

	/**
	 * AC-016, AC-017: once sent, the publication and template cannot change on any save path.
	 */
	public function test_publication_and_template_lock_after_send(): void {
		$post_id = $this->create_post(
			array(
				Meta::BEEHIIV_PUBLICATION_ID   => 'pub_other',
				Meta::BEEHIIV_POST_TEMPLATE_ID => 'tpl_other',
			)
		);
		Sender::send( $post_id );

		update_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, 'pub_default' );
		update_post_meta( $post_id, Meta::BEEHIIV_POST_TEMPLATE_ID, 'tpl_default' );

		$this->assertTrue( Sender::is_newsletter_sent( $post_id ) );
		$this->assertSame( 'pub_other', get_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, true ) );
		$this->assertSame( 'tpl_other', get_post_meta( $post_id, Meta::BEEHIIV_POST_TEMPLATE_ID, true ) );
	}

	/**
	 * AC-017: before send, a scheduled post's publication and template stay editable.
	 */
	public function test_scheduled_post_stays_editable(): void {
		$post_id = $this->create_scheduled_linked_post( 'pub_default', 'tpl_default' );

		update_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, 'pub_other' );
		update_post_meta( $post_id, Meta::BEEHIIV_POST_TEMPLATE_ID, 'tpl_other' );

		$this->assertFalse( Sender::is_newsletter_sent( $post_id ) );
		$this->assertSame( 'pub_other', get_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, true ) );
		$this->assertSame( 'tpl_other', get_post_meta( $post_id, Meta::BEEHIIV_POST_TEMPLATE_ID, true ) );
	}
}
