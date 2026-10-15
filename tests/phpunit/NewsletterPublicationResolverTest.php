<?php
/**
 * Unit coverage for per-post publication resolution.
 *
 * Post-Level Publication Selector PRD AC-005, AC-013, AC-019.
 *
 * @package beehiiv
 */

use Beehiiv\API\Cache;
use Beehiiv\Config;
use Beehiiv\Editor\Meta;
use Beehiiv\Newsletter\PublicationResolver;

/**
 * @covers \Beehiiv\Newsletter\PublicationResolver
 */
class NewsletterPublicationResolverTest extends WP_UnitTestCase {

	public function set_up(): void {
		parent::set_up();

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
	}

	public function tear_down(): void {
		Cache::flush_all();
		parent::tear_down();
	}

	/**
	 * AC-005: a post with no stored publication uses the site-wide default.
	 */
	public function test_post_without_publication_uses_default(): void {
		$post_id = self::factory()->post->create();

		$target = PublicationResolver::resolve_target( $post_id );

		$this->assertSame( 'pub_default', $target['publication_id'] );
		$this->assertTrue( $target['is_default'] );
		$this->assertSame( '', $target['fallback_from'] );
	}

	/**
	 * A connected stored publication is used as-is.
	 */
	public function test_connected_stored_publication_is_used(): void {
		$post_id = self::factory()->post->create();
		update_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, 'pub_other' );

		$target = PublicationResolver::resolve_target( $post_id );

		$this->assertSame( 'pub_other', $target['publication_id'] );
		$this->assertFalse( $target['is_default'] );
	}

	/**
	 * AC-019: a stored publication that is no longer connected falls back to the default.
	 */
	public function test_disconnected_stored_publication_falls_back_to_default(): void {
		$post_id = self::factory()->post->create();
		update_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, 'pub_removed' );

		$target = PublicationResolver::resolve_target( $post_id );

		$this->assertSame( 'pub_default', $target['publication_id'] );
		$this->assertSame( 'pub_removed', $target['fallback_from'] );
	}

	/**
	 * When the connected list is unavailable, the stored publication is trusted (no fallback on an outage).
	 */
	public function test_unknown_connection_state_trusts_stored_publication(): void {
		Cache::set_publications( array() );
		add_filter( 'pre_http_request', array( $this, 'fail_http' ) );

		$post_id = self::factory()->post->create();
		update_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, 'pub_other' );

		$target = PublicationResolver::resolve_target( $post_id );

		remove_filter( 'pre_http_request', array( $this, 'fail_http' ) );

		$this->assertSame( 'pub_other', $target['publication_id'] );
		$this->assertSame( '', $target['fallback_from'] );
	}

	/**
	 * AC-013: a linked post resolves to the publication its beehiiv post lives in,
	 * even after the editor's choice or the default changes.
	 */
	public function test_linked_post_uses_linked_publication(): void {
		$post_id = self::factory()->post->create();
		update_post_meta( $post_id, Meta::BEEHIIV_POST_ID, 'post_linked' );
		update_post_meta( $post_id, Meta::BEEHIIV_LINKED_PUBLICATION_ID, 'pub_other' );
		update_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, 'pub_default' );

		$this->assertSame( 'pub_other', PublicationResolver::resolve_for_post( $post_id ) );
	}

	/**
	 * Posts linked before per-post publications existed use the default.
	 */
	public function test_legacy_linked_post_uses_default(): void {
		$post_id = self::factory()->post->create();
		update_post_meta( $post_id, Meta::BEEHIIV_POST_ID, 'post_linked' );

		$this->assertSame( 'pub_default', PublicationResolver::resolve_for_post( $post_id ) );
	}

	/**
	 * Publication names come from the cache; unknown IDs show as-is.
	 */
	public function test_publication_name_lookup(): void {
		$this->assertSame( 'Other Daily', PublicationResolver::get_publication_name( 'pub_other' ) );
		$this->assertSame( 'pub_removed', PublicationResolver::get_publication_name( 'pub_removed' ) );
	}

	/**
	 * Fail every HTTP request (simulates beehiiv being unreachable).
	 *
	 * @return WP_Error
	 */
	public function fail_http() {
		return new WP_Error( 'http_request_failed', 'Unavailable' );
	}
}
