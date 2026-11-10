<?php
/**
 * Unit coverage for the Newsletters content type (`beehiiv_newsletter`).
 *
 * Newsletters Content Type PRD AC-004 to AC-008. beehiiv HTTP is faked via `pre_http_request`;
 * the live API is never called.
 *
 * @package beehiiv
 */

use Beehiiv\API\Cache;
use Beehiiv\Config;
use Beehiiv\Editor\Meta;
use Beehiiv\Editor\PostSettings;
use Beehiiv\Newsletter\ContentTypes;
use Beehiiv\Newsletter\NewsletterPostType;
use Beehiiv\Newsletter\Sender;
use Beehiiv\Newsletter\TestSender;
use Beehiiv\OAuth\TokenStore;

/**
 * @covers \Beehiiv\Newsletter\ContentTypes
 * @covers \Beehiiv\Newsletter\NewsletterPostType
 * @covers \Beehiiv\REST\NewslettersController
 */
class NewsletterContentTypeTest extends WP_UnitTestCase {

	/**
	 * Requests recorded by the HTTP fake.
	 *
	 * @var array<int, array{method: string, url: string, body: array}>
	 */
	private $requests = array();

	public function set_up(): void {
		parent::set_up();

		$this->requests = array();
		add_filter( 'pre_http_request', array( $this, 'fake_http' ), 10, 3 );

		// The test case resets post types and meta between tests; register them as `init` does.
		NewsletterPostType::register();
		PostSettings::register_meta();
	}

	public function tear_down(): void {
		remove_filter( 'pre_http_request', array( $this, 'fake_http' ), 10 );
		Cache::flush_all();
		parent::tear_down();
	}

	/**
	 * Record requests and answer like beehiiv.
	 *
	 * @param false|array $preempt Short-circuit value.
	 * @param array       $args    Request args.
	 * @param string      $url     Request URL.
	 * @return array
	 */
	public function fake_http( $preempt, $args, $url ) {
		$method = isset( $args['method'] ) ? strtoupper( $args['method'] ) : 'GET';
		$body   = isset( $args['body'] ) && is_string( $args['body'] ) ? json_decode( $args['body'], true ) : array();

		$this->requests[] = array(
			'method' => $method,
			'url'    => $url,
			'body'   => is_array( $body ) ? $body : array(),
		);

		$code = 'DELETE' === $method ? 204 : 200;
		$data = 'POST' === $method ? array( 'data' => array( 'id' => 'post_new' ) ) : array( 'data' => array() );

		return array(
			'headers'  => array(),
			'body'     => wp_json_encode( $data ),
			'response' => array(
				'code'    => $code,
				'message' => '',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	}

	/**
	 * Connect and configure a publication so sending can run.
	 */
	private function connect(): void {
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
		Cache::set_publications( array( array( 'id' => 'pub_default', 'name' => 'Default' ) ) );
		Cache::set_post_templates( 'pub_default', array( array( 'id' => 'tpl_default', 'name' => 'Default' ) ) );
	}

	/**
	 * Create a newsletter.
	 *
	 * @param array $args Post args.
	 * @return int
	 */
	private function create_newsletter( array $args = array() ): int {
		return self::factory()->post->create(
			array_merge(
				array(
					'post_type'   => ContentTypes::NEWSLETTER,
					'post_status' => 'publish',
					'post_title'  => 'Campaign',
				),
				$args
			)
		);
	}

	public function test_supported_content_types_are_shared_and_exact(): void {
		$this->assertSame( array( 'post', 'beehiiv_newsletter' ), ContentTypes::supported() );
		$this->assertTrue( ContentTypes::is_supported( 'post' ) );
		$this->assertTrue( ContentTypes::is_supported( 'beehiiv_newsletter' ) );
		$this->assertFalse( ContentTypes::is_supported( 'page' ) );
		$this->assertFalse( ContentTypes::is_supported( null ) );
		$this->assertTrue( ContentTypes::send_default( 'beehiiv_newsletter' ) );
		$this->assertFalse( ContentTypes::send_default( 'post' ) );
	}

	/**
	 * AC-004: no public page, search, sitemap, nav menu or rewrite.
	 */
	public function test_post_type_is_non_public(): void {
		$type = get_post_type_object( ContentTypes::NEWSLETTER );

		$this->assertNotNull( $type );
		$this->assertFalse( $type->public );
		$this->assertFalse( $type->publicly_queryable );
		$this->assertTrue( $type->exclude_from_search );
		$this->assertFalse( $type->show_in_nav_menus );
		$this->assertFalse( $type->rewrite );
		$this->assertFalse( $type->query_var );
		$this->assertTrue( $type->show_ui );
		$this->assertTrue( $type->show_in_rest );
		$this->assertSame( Config::PLUGIN_SLUG, $type->show_in_menu );
		$this->assertTrue( post_type_supports( ContentTypes::NEWSLETTER, 'custom-fields' ) );
		$this->assertFalse( is_post_type_viewable( $type ) );
		$this->assertArrayNotHasKey( ContentTypes::NEWSLETTER, get_post_types( array( 'public' => true ) ) );

		$post_id = $this->create_newsletter();
		$this->assertFalse( is_post_publicly_viewable( $post_id ) );
	}

	/**
	 * Meta is registered for both types with the per-type "Send to newsletter" default.
	 */
	public function test_send_to_newsletter_defaults_on_for_newsletters_only(): void {
		$newsletter_id = $this->create_newsletter( array( 'post_status' => 'draft' ) );
		$post_id       = self::factory()->post->create( array( 'post_status' => 'draft' ) );

		$this->assertTrue( rest_sanitize_boolean( get_post_meta( $newsletter_id, Meta::SEND_TO_NEWSLETTER, true ) ) );
		$this->assertFalse( rest_sanitize_boolean( get_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, true ) ) );

		// The editor reads the same default through the REST schema.
		$schema = get_registered_meta_keys( 'post', ContentTypes::NEWSLETTER )[ Meta::SEND_TO_NEWSLETTER ];
		$this->assertTrue( $schema['default'] );
		$this->assertFalse( get_registered_meta_keys( 'post', 'post' )[ Meta::SEND_TO_NEWSLETTER ]['default'] );

		// A saved "off" stays off.
		update_post_meta( $newsletter_id, Meta::SEND_TO_NEWSLETTER, false );
		$this->assertFalse( rest_sanitize_boolean( get_post_meta( $newsletter_id, Meta::SEND_TO_NEWSLETTER, true ) ) );
	}

	/**
	 * AC-008 / status mapping from local meta only.
	 */
	public function test_status_mapping_uses_local_meta_only(): void {
		$id = $this->create_newsletter();
		$this->assertSame( 'not_sent', NewsletterPostType::get_status( $id ) );
		$this->assertSame( 'Not sent', NewsletterPostType::status_label( 'not_sent' ) );

		update_post_meta( $id, Meta::BEEHIIV_POST_ID, 'post_1' );
		$this->assertSame( 'sent', NewsletterPostType::get_status( $id ), 'Linked with an empty send time counts as sent.' );

		update_post_meta( $id, Meta::BEEHIIV_SCHEDULED_AT, gmdate( 'Y-m-d\TH:i:s\Z', time() + DAY_IN_SECONDS ) );
		$this->assertSame( 'scheduled', NewsletterPostType::get_status( $id ) );

		update_post_meta( $id, Meta::BEEHIIV_SCHEDULED_AT, gmdate( 'Y-m-d\TH:i:s\Z', time() - HOUR_IN_SECONDS ) );
		$this->assertSame( 'sent', NewsletterPostType::get_status( $id ) );

		update_post_meta( $id, Meta::NEWSLETTER_ERROR, 'Send failed.' );
		$this->assertSame( 'failed', NewsletterPostType::get_status( $id ), 'A non-empty error wins.' );

		update_post_meta( $id, Meta::NEWSLETTER_ERROR, '' );
		$this->assertSame( 'sent', NewsletterPostType::get_status( $id ) );

		$this->assertSame( array(), $this->requests, 'Status must not call beehiiv.' );
	}

	public function test_list_columns_are_title_status_author_date(): void {
		$columns = apply_filters( 'manage_beehiiv_newsletter_posts_columns', array( 'cb' => 'x', 'title' => 'Title' ) );

		$this->assertSame( array( 'cb', 'title', 'beehiiv_status', 'author', 'date' ), array_keys( $columns ) );

		$id = $this->create_newsletter();
		update_post_meta( $id, Meta::NEWSLETTER_ERROR, 'Boom' );
		ob_start();
		do_action( 'manage_beehiiv_newsletter_posts_custom_column', 'beehiiv_status', $id );
		$this->assertSame( 'Failed', ob_get_clean() );
	}

	/**
	 * R-003: read-only send fields cannot be written on the newsletter REST route.
	 */
	public function test_rest_save_drops_readonly_meta_on_newsletters(): void {
		$author_id = self::factory()->user->create( array( 'role' => 'author' ) );
		$id        = $this->create_newsletter( array( 'post_author' => $author_id, 'post_status' => 'draft' ) );

		update_post_meta( $id, Meta::BEEHIIV_POST_ID, 'post_linked' );
		wp_set_current_user( $author_id );
		do_action( 'rest_api_init' );

		$request = new WP_REST_Request( 'POST', '/wp/v2/beehiiv-newsletters/' . $id );
		$request->set_header( 'content-type', 'application/json' );
		$request->set_body(
			wp_json_encode(
				array(
					'meta' => array(
						Meta::BEEHIIV_POST_ID      => 'hijacked',
						Meta::BEEHIIV_SCHEDULED_AT => '2030-01-01T00:00:00Z',
						Meta::NEWSLETTER_TITLE     => 'Subject',
					),
				)
			)
		);

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'post_linked', get_post_meta( $id, Meta::BEEHIIV_POST_ID, true ) );
		$this->assertSame( '', get_post_meta( $id, Meta::BEEHIIV_SCHEDULED_AT, true ) );
		$this->assertSame( 'Subject', get_post_meta( $id, Meta::NEWSLETTER_TITLE, true ) );
		$this->assertSame( 'post_linked', $response->get_data()['meta'][ Meta::BEEHIIV_POST_ID ] );
	}

	public function test_route_pattern_covers_both_types(): void {
		$pattern = ContentTypes::rest_route_pattern();

		foreach ( array( '/wp/v2/posts', '/wp/v2/posts/5', '/wp/v2/beehiiv-newsletters', '/wp/v2/beehiiv-newsletters/5/autosaves' ) as $route ) {
			$this->assertSame( 1, preg_match( $pattern, $route ), $route );
		}
		$this->assertSame( 0, preg_match( $pattern, '/wp/v2/pages/5' ) );
	}

	/**
	 * Anonymous REST reads of a published newsletter are blocked.
	 */
	public function test_anonymous_rest_reads_are_blocked(): void {
		$id = $this->create_newsletter();
		wp_set_current_user( 0 );
		do_action( 'rest_api_init' );

		$single = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/wp/v2/beehiiv-newsletters/' . $id ) );
		$list   = rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/wp/v2/beehiiv-newsletters' ) );

		$this->assertContains( $single->get_status(), array( 401, 403 ) );
		$this->assertContains( $list->get_status(), array( 401, 403 ) );

		$author_id = self::factory()->user->create( array( 'role' => 'author' ) );
		$own       = $this->create_newsletter( array( 'post_author' => $author_id ) );
		wp_set_current_user( $author_id );
		$this->assertSame( 200, rest_get_server()->dispatch( new WP_REST_Request( 'GET', '/wp/v2/beehiiv-newsletters/' . $own ) )->get_status() );
	}

	/**
	 * Public query surfaces: core sitemap provider list and the main query exclude newsletters.
	 */
	public function test_newsletters_are_absent_from_sitemaps_and_search(): void {
		$id = $this->create_newsletter( array( 'post_title' => 'Zebrafish campaign' ) );

		$this->assertArrayNotHasKey( ContentTypes::NEWSLETTER, wp_get_sitemap_providers()['posts']->get_object_subtypes() );

		$query = new WP_Query( array( 's' => 'Zebrafish', 'post_type' => 'any' ) );
		$this->assertSame( array(), wp_list_pluck( $query->posts, 'ID' ) );
		$this->assertNotContains( $id, wp_list_pluck( get_posts( array( 'post_type' => 'any' ) ), 'ID' ) );
	}

	/**
	 * AC-007: sending creates one beehiiv post carrying the content in order.
	 */
	public function test_sending_a_newsletter_creates_one_beehiiv_post_in_order(): void {
		$this->connect();

		$content = "<!-- wp:paragraph -->\n<p>Intro paragraph.</p>\n<!-- /wp:paragraph -->\n\n"
			. "<!-- wp:heading -->\n<h2>Middle heading</h2>\n<!-- /wp:heading -->\n\n"
			. "<!-- wp:paragraph -->\n<p>Closing paragraph.</p>\n<!-- /wp:paragraph -->";

		$id = $this->create_newsletter(
			array(
				'post_status'  => 'draft',
				'post_content' => $content,
			)
		);
		$this->requests = array();

		wp_update_post( array( 'ID' => $id, 'post_status' => 'publish' ) );

		$creates = array_values(
			array_filter(
				$this->requests,
				static fn( $r ) => 'POST' === $r['method'] && false !== strpos( $r['url'], '/posts' )
			)
		);

		$this->assertCount( 1, $creates, 'Exactly one beehiiv post is created (send is on by default).' );
		$this->assertSame( 'post_new', get_post_meta( $id, Meta::BEEHIIV_POST_ID, true ) );

		$json = wp_json_encode( $creates[0]['body'] );
		$pos  = array(
			strpos( $json, 'Intro paragraph' ),
			strpos( $json, 'Middle heading' ),
			strpos( $json, 'Closing paragraph' ),
		);
		$this->assertNotContains( false, $pos );
		$this->assertTrue( $pos[0] < $pos[1] && $pos[1] < $pos[2], 'Content keeps the written order.' );

		// Sender::send() turns the toggle off after a send.
		$this->assertFalse( rest_sanitize_boolean( get_post_meta( $id, Meta::SEND_TO_NEWSLETTER, true ) ) );
	}

	/**
	 * BR-001: a draft newsletter never sends.
	 */
	public function test_draft_newsletter_does_not_send(): void {
		$this->connect();
		$this->create_newsletter( array( 'post_status' => 'draft', 'post_content' => 'Hello' ) );

		$this->assertSame( array(), $this->requests );
	}

	/**
	 * BR-002: unpublishing a linked newsletter cancels the beehiiv post and re-enables send.
	 */
	public function test_unpublishing_a_linked_newsletter_cancels_it(): void {
		$this->connect();
		$id = $this->create_newsletter( array( 'post_content' => 'Hello' ) );
		update_post_meta( $id, Meta::BEEHIIV_POST_ID, 'post_linked' );
		update_post_meta( $id, Meta::BEEHIIV_LINKED_PUBLICATION_ID, 'pub_default' );
		update_post_meta( $id, Meta::SEND_TO_NEWSLETTER, false );
		$this->requests = array();

		wp_update_post( array( 'ID' => $id, 'post_status' => 'draft' ) );

		$deletes = array_filter( $this->requests, static fn( $r ) => 'DELETE' === $r['method'] );
		$this->assertCount( 1, $deletes );
		$this->assertFalse( Sender::has_beehiiv_post_id( $id ) );
		$this->assertTrue( rest_sanitize_boolean( get_post_meta( $id, Meta::SEND_TO_NEWSLETTER, true ) ) );
	}

	/**
	 * Snippet mode never applies to newsletters (no public post to link to).
	 */
	public function test_snippet_meta_is_ignored_for_newsletters(): void {
		$id = $this->create_newsletter(
			array( 'post_content' => "<!-- wp:paragraph -->\n<p>Before</p>\n<!-- /wp:paragraph -->\n\n<!--more-->\n\n<!-- wp:paragraph -->\n<p>After</p>\n<!-- /wp:paragraph -->" )
		);
		update_post_meta( $id, Meta::SEND_TO_NEWSLETTER_SNIPPET, true );

		$json = wp_json_encode( \Beehiiv\Newsletter\BlockConverter::convert_supported_blocks( get_post( $id ) ) );
		$this->assertStringContainsString( 'After', $json, 'Snippet mode would have stopped at the More block.' );
	}

	/**
	 * Test Email Send applies to newsletters via the shared list.
	 */
	public function test_test_sender_accepts_newsletters_and_rejects_other_types(): void {
		$draft = $this->create_newsletter( array( 'post_status' => 'draft', 'post_content' => 'Hello' ) );
		$page  = self::factory()->post->create( array( 'post_type' => 'page', 'post_status' => 'draft' ) );

		$result = TestSender::check_eligibility( $draft );
		$this->assertTrue(
			true === $result || 'beehiiv_test_send_post_not_found' !== $result->get_error_code(),
			'A newsletter must not be rejected as an unsupported type.'
		);

		$page_result = TestSender::check_eligibility( $page );
		$this->assertWPError( $page_result );
		$this->assertSame( 'beehiiv_test_send_post_not_found', $page_result->get_error_code() );
	}

	public function test_send_meta_authorization_matches_posts_for_newsletters(): void {
		$contributor = self::factory()->user->create( array( 'role' => 'contributor' ) );
		$id          = $this->create_newsletter( array( 'post_author' => $contributor, 'post_status' => 'draft' ) );
		wp_set_current_user( $contributor );

		$this->assertFalse( PostSettings::authorize_meta( false, Meta::SEND_TO_NEWSLETTER, $id ) );
		$this->assertFalse( PostSettings::authorize_meta( false, Meta::BEEHIIV_POST_ID, $id ) );
		$this->assertTrue( PostSettings::authorize_meta( false, Meta::BEEHIIV_POST_TEMPLATE_ID, $id ) );
	}
}
