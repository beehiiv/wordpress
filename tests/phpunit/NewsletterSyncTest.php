<?php
/**
 * Unit coverage for save-time sync of SEO metadata and tags, and sent-newsletter protection.
 *
 * Newsletter Send PRD AC-021 to AC-026. beehiiv HTTP is mocked via `pre_http_request`.
 *
 * @package beehiiv
 */

use Beehiiv\Config;
use Beehiiv\Editor\Meta;
use Beehiiv\Newsletter\PostSettingsBuilder;
use Beehiiv\Newsletter\Sender;
use Beehiiv\OAuth\TokenStore;

/**
 * Save-time sync of SEO metadata and tags, and sent-newsletter protection.
 *
 * @covers \Beehiiv\Newsletter\PostSettingsBuilder::build_update
 * @covers \Beehiiv\Newsletter\SeoMetadata::resolve
 * @covers \Beehiiv\Newsletter\Sender::maybe_update_post_newsletter
 * @covers \Beehiiv\API\Resources\Posts::get
 */
class NewsletterSyncTest extends WP_UnitTestCase {

	/**
	 * HTTP requests made during the test: method and URL.
	 *
	 * @var array<int, array{method: string, url: string}>
	 */
	private $requests = array();

	/**
	 * Canned beehiiv GET post response: status code and `data` body.
	 *
	 * @var array{code: int, data: array<string, mixed>}
	 */
	private $get_response = array(
		'code' => 200,
		'data' => array(),
	);

	/**
	 * Connect the site, configure a publication and template, and mock beehiiv HTTP.
	 */
	public function set_up(): void {
		parent::set_up();

		$this->requests = array();

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
				'publication_id'   => 'pub_test',
				'post_template_id' => 'tpl_test',
			)
		);

		add_filter( 'pre_http_request', array( $this, 'mock_http' ), 10, 3 );
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
		$method           = isset( $args['method'] ) ? strtoupper( $args['method'] ) : 'GET';
		$this->requests[] = array(
			'method' => $method,
			'url'    => $url,
		);

		if ( 'GET' === $method ) {
			return $this->http_response( $this->get_response['code'], array( 'data' => $this->get_response['data'] ) );
		}

		if ( 'DELETE' === $method ) {
			return $this->http_response( 204, array() );
		}

		return $this->http_response( 200, array( 'data' => array( 'id' => 'post_new' ) ) );
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
	 * Create a published post already linked to a beehiiv newsletter.
	 *
	 * @param array $args Extra post args.
	 * @return int Post ID.
	 */
	private function create_linked_post( array $args = array() ): int {
		$post_id = self::factory()->post->create(
			array_merge(
				array(
					'post_status'  => 'publish',
					'post_title'   => 'Weekly roundup',
					'post_excerpt' => 'Everything that happened this week.',
					'post_content' => "<!-- wp:paragraph -->\n<p>Hello subscribers.</p>\n<!-- /wp:paragraph -->",
				),
				$args
			)
		);

		update_post_meta( $post_id, Meta::BEEHIIV_POST_ID, 'post_linked' );
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
	 * AC-021: SEO title and description fall back to the post title and excerpt.
	 */
	public function test_update_payload_includes_seo_settings_from_title_and_excerpt(): void {
		$post_id = $this->create_linked_post();

		$update = PostSettingsBuilder::build_update( $post_id );

		$this->assertIsArray( $update );
		$seo = $update['payload']['seo_settings'];
		$this->assertSame( 'Weekly roundup', $seo['default_title'] );
		$this->assertSame( 'Everything that happened this week.', $seo['default_description'] );
		$this->assertSame( 'Weekly roundup', $seo['og_title'] );
		$this->assertSame( 'Everything that happened this week.', $seo['twitter_description'] );
	}

	/**
	 * AC-021: another SEO source can supply values through the filter.
	 */
	public function test_seo_settings_filter_supplies_values(): void {
		$post_id = $this->create_linked_post();

		add_filter(
			'beehiiv_newsletter_seo_settings',
			static function ( $settings ) {
				$settings['default_title'] = 'Custom SEO title';
				return $settings;
			}
		);

		$update = PostSettingsBuilder::build_update( $post_id );

		$this->assertSame( 'Custom SEO title', $update['payload']['seo_settings']['default_title'] );
	}

	/**
	 * AC-022: beehiiv tags match the WordPress tags.
	 */
	public function test_update_payload_tags_match_wordpress_tags(): void {
		$post_id = $this->create_linked_post();
		wp_set_post_tags( $post_id, array( 'Alpha', 'Beta' ) );

		$update = PostSettingsBuilder::build_update( $post_id );

		$tags = $update['payload']['content_tags'];
		sort( $tags );
		$this->assertSame( array( 'Alpha', 'Beta' ), $tags );
	}

	/**
	 * AC-022: a post with no tags clears beehiiv's tags.
	 */
	public function test_update_payload_sends_empty_tags_when_post_has_none(): void {
		$post_id = $this->create_linked_post();

		$update = PostSettingsBuilder::build_update( $post_id );

		$this->assertSame( array(), $update['payload']['content_tags'] );
	}

	/**
	 * AC-023: a failure resolving SEO metadata never blocks the sync; it falls back to the post title and excerpt.
	 */
	public function test_seo_failure_falls_back_and_does_not_block(): void {
		$post_id = $this->create_linked_post();

		add_filter(
			'beehiiv_newsletter_seo_settings',
			static function () {
				throw new RuntimeException( 'SEO plugin broke.' );
			}
		);

		$update = PostSettingsBuilder::build_update( $post_id );

		$this->assertIsArray( $update );
		$this->assertSame( 'Weekly roundup', $update['payload']['seo_settings']['default_title'] );
		$this->assertArrayHasKey( 'content_tags', $update['payload'] );
	}

	/**
	 * AC-021: without a manual excerpt, the description is the opening text with no "read more" suffix.
	 */
	public function test_seo_description_from_content_has_no_more_suffix(): void {
		$post_id = $this->create_linked_post( array( 'post_excerpt' => '' ) );

		$update = PostSettingsBuilder::build_update( $post_id );

		$this->assertSame( 'Hello subscribers.', $update['payload']['seo_settings']['default_description'] );
	}

	/**
	 * AC-022: a first send leaves out an empty tag list.
	 */
	public function test_create_payload_omits_empty_tags(): void {
		$post_id = $this->create_linked_post();

		$this->assertArrayNotHasKey( 'content_tags', PostSettingsBuilder::get_post_settings( $post_id ) );
	}

	/**
	 * AC-024 / AC-025: past or unknown send time confirms with beehiiv; a sent newsletter is marked and never updated.
	 */
	public function test_sent_newsletter_is_marked_and_not_updated(): void {
		$post_id            = $this->create_linked_post();
		$this->get_response = array(
			'code' => 200,
			'data' => array(
				'status'       => 'confirmed',
				'publish_date' => time() - HOUR_IN_SECONDS,
			),
		);

		Sender::maybe_update_post_newsletter( get_post( $post_id ) );

		$this->assertCount( 1, $this->requests_with( 'GET' ) );
		$this->assertCount( 0, $this->requests_with( 'PATCH' ) );
		$this->assertCount( 0, $this->requests_with( 'DELETE' ) );
		$this->assertTrue( Sender::is_newsletter_sent( $post_id ) );
		$this->assertSame( '', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR, true ) );
	}

	/**
	 * AC-024: a sent newsletter whose send time moved later is never archived and recreated.
	 */
	public function test_sent_newsletter_is_not_rescheduled(): void {
		$post_id = $this->create_linked_post();
		update_post_meta( $post_id, Meta::BEEHIIV_SCHEDULED_AT, gmdate( 'Y-m-d\TH:i:s\Z', time() - HOUR_IN_SECONDS ) );
		update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER_DATE, gmdate( 'Y-m-d\TH:i:s', time() + DAY_IN_SECONDS ) );
		$this->get_response = array(
			'code' => 200,
			'data' => array(
				'status'       => 'confirmed',
				'publish_date' => time() - HOUR_IN_SECONDS,
			),
		);

		Sender::maybe_update_post_newsletter( get_post( $post_id ) );

		$this->assertCount( 0, $this->requests_with( 'DELETE' ) );
		$this->assertCount( 0, $this->requests_with( 'POST' ) );
		$this->assertCount( 0, $this->requests_with( 'PATCH' ) );
		$this->assertTrue( Sender::is_newsletter_sent( $post_id ) );
	}

	/**
	 * A newsletter archived in beehiiv is no longer updated, and later saves leave beehiiv alone.
	 */
	public function test_archived_newsletter_is_not_updated(): void {
		$post_id            = $this->create_linked_post();
		$this->get_response = array(
			'code' => 200,
			'data' => array( 'status' => 'archived' ),
		);

		Sender::maybe_update_post_newsletter( get_post( $post_id ) );

		$this->assertCount( 0, $this->requests_with( 'PATCH' ) );
		$this->assertTrue( Sender::is_newsletter_sent( $post_id ) );
		$this->assertSame( '', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR, true ) );
	}

	/**
	 * AC-025: a newsletter beehiiv has not sent yet is updated after the check.
	 */
	public function test_unsent_newsletter_is_updated_after_check(): void {
		$post_id            = $this->create_linked_post();
		$this->get_response = array(
			'code' => 200,
			'data' => array(
				'status'       => 'confirmed',
				'publish_date' => time() + DAY_IN_SECONDS,
			),
		);

		Sender::maybe_update_post_newsletter( get_post( $post_id ) );

		$this->assertCount( 1, $this->requests_with( 'GET' ) );
		$this->assertCount( 1, $this->requests_with( 'PATCH' ) );
		$this->assertFalse( Sender::is_newsletter_sent( $post_id ) );
	}

	/**
	 * AC-025: a newsletter still scheduled for the future updates without the extra check.
	 */
	public function test_future_scheduled_newsletter_updates_without_check(): void {
		$post_id = $this->create_linked_post();
		update_post_meta( $post_id, Meta::BEEHIIV_SCHEDULED_AT, gmdate( 'Y-m-d\TH:i:s\Z', time() + DAY_IN_SECONDS ) );

		Sender::maybe_update_post_newsletter( get_post( $post_id ) );

		$this->assertCount( 0, $this->requests_with( 'GET' ) );
		$this->assertCount( 1, $this->requests_with( 'PATCH' ) );
	}

	/**
	 * AC-026: once marked sent, later saves make no contact with beehiiv.
	 */
	public function test_marked_sent_post_makes_no_requests(): void {
		$post_id = $this->create_linked_post();
		update_post_meta( $post_id, Meta::BEEHIIV_NEWSLETTER_SENT, true );

		Sender::maybe_update_post_newsletter( get_post( $post_id ) );

		$this->assertCount( 0, $this->requests );
		$this->assertSame( '', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR, true ) );
	}

	/**
	 * Q-007: when beehiiv can't be reached to confirm sent state, skip the update and show the editor error.
	 */
	public function test_failed_sent_check_skips_update_and_records_error(): void {
		$post_id            = $this->create_linked_post();
		$this->get_response = array(
			'code' => 500,
			'data' => array(),
		);

		Sender::maybe_update_post_newsletter( get_post( $post_id ) );

		$this->assertCount( 0, $this->requests_with( 'PATCH' ) );
		$this->assertNotSame( '', get_post_meta( $post_id, Meta::NEWSLETTER_ERROR, true ) );
		$this->assertFalse( Sender::is_newsletter_sent( $post_id ) );
	}

	/**
	 * Removing the beehiiv link clears the sent marker so a later new newsletter can sync.
	 */
	public function test_cancel_clears_sent_marker(): void {
		$post_id = $this->create_linked_post();
		update_post_meta( $post_id, Meta::BEEHIIV_NEWSLETTER_SENT, true );

		Sender::cancel_scheduled_newsletter( $post_id );

		$this->assertFalse( Sender::is_newsletter_sent( $post_id ) );
		$this->assertSame( '', get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
	}
}
