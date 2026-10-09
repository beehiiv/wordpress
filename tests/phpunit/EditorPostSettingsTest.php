<?php
/**
 * Unit coverage for Beehiiv\Editor\PostSettings::authorize_meta().
 *
 * Complements tests/e2e/specs/meta-registration.spec.js -- the same
 * acceptance criteria checked at the REST/behavioral level there are pinned
 * here at the function level, isolating exactly which callback is
 * responsible when a check fails.
 *
 * @package beehiiv
 */

use Beehiiv\Editor\Meta;
use Beehiiv\Editor\PostSettings;

/**
 * @covers \Beehiiv\Editor\PostSettings::authorize_meta
 */
class EditorPostSettingsTest extends WP_UnitTestCase {

	/**
	 * AC-019: readonly fields cannot be modified via REST.
	 *
	 * authorize_meta() must deny write for keys registered as readonly rather
	 * than falling through to the edit_posts check.
	 */
	public function test_readonly_meta_key_must_not_be_writable_via_rest(): void {
		$contributor_id = self::factory()->user->create( array( 'role' => 'contributor' ) );
		$post_id        = self::factory()->post->create(
			array(
				'post_author' => $contributor_id,
				'post_status' => 'draft',
			)
		);

		wp_set_current_user( $contributor_id );

		$allowed = PostSettings::authorize_meta( false, Meta::BEEHIIV_POST_ID, $post_id );

		$this->assertFalse(
			$allowed,
			'AC-019: readonly meta keys must not be authorized for write.'
		);
	}

	/**
	 * AC-020: writes to send-scheduling/snippet fields respect publish_posts,
	 * not just edit_posts.
	 */
	public function test_publish_posts_gated_key_is_denied_for_contributor(): void {
		$contributor_id = self::factory()->user->create( array( 'role' => 'contributor' ) );
		$post_id        = self::factory()->post->create(
			array(
				'post_author' => $contributor_id,
				'post_status' => 'draft',
			)
		);

		wp_set_current_user( $contributor_id );

		$allowed = PostSettings::authorize_meta( false, Meta::SEND_TO_NEWSLETTER, $post_id );

		$this->assertFalse(
			$allowed,
			'AC-020: a contributor (edit_posts only, no publish_posts) must not be authorized to write send_to_newsletter.'
		);
	}

	/**
	 * AC-022: the newsletter wording fields are writable by edit_posts alone,
	 * deliberately looser than the publish_posts-gated fields (BR-003).
	 */
	public function test_newsletter_wording_field_is_allowed_for_contributor(): void {
		if ( ! defined( Meta::class . '::NEWSLETTER_TITLE' ) ) {
			$this->markTestSkipped( 'Meta::NEWSLETTER_TITLE is not defined on this branch (title/subtitle feature not merged).' );
		}

		$contributor_id = self::factory()->user->create( array( 'role' => 'contributor' ) );
		$post_id        = self::factory()->post->create(
			array(
				'post_author' => $contributor_id,
				'post_status' => 'draft',
			)
		);

		wp_set_current_user( $contributor_id );

		$allowed = PostSettings::authorize_meta( false, Meta::NEWSLETTER_TITLE, $post_id );

		$this->assertTrue(
			$allowed,
			'AC-022: newsletter title/subtitle/subject-line fields must be writable by edit_posts alone, not gated behind publish_posts.'
		);
	}

	/**
	 * Post-Level Publication Selector AC-006: only users who can publish may change a post's publication.
	 */
	public function test_publication_key_is_denied_for_contributor(): void {
		$contributor_id = self::factory()->user->create( array( 'role' => 'contributor' ) );
		$post_id        = self::factory()->post->create(
			array(
				'post_author' => $contributor_id,
				'post_status' => 'draft',
			)
		);

		wp_set_current_user( $contributor_id );

		$this->assertFalse(
			PostSettings::authorize_meta( false, Meta::BEEHIIV_PUBLICATION_ID, $post_id ),
			'AC-006: a contributor must not be authorized to change the post\'s publication.'
		);
	}

	/**
	 * Post-Level Publication Selector AC-006: an author with publish_posts may change a post's publication.
	 */
	public function test_publication_key_is_allowed_for_author(): void {
		$author_id = self::factory()->user->create( array( 'role' => 'author' ) );
		$post_id   = self::factory()->post->create(
			array(
				'post_author' => $author_id,
				'post_status' => 'draft',
			)
		);

		wp_set_current_user( $author_id );

		$this->assertTrue(
			PostSettings::authorize_meta( false, Meta::BEEHIIV_PUBLICATION_ID, $post_id ),
			'AC-006: an author (publish_posts) must be authorized to change the post\'s publication.'
		);
	}

	/**
	 * An editor save that carries readonly keys (as the block editor always does)
	 * succeeds, and the readonly values sent are ignored rather than written.
	 */
	public function test_editor_save_with_readonly_meta_is_not_rejected(): void {
		// Earlier tests' teardown clears registered meta; register it as the plugin does on init.
		PostSettings::register_meta();

		$author_id = self::factory()->user->create( array( 'role' => 'author' ) );
		$post_id   = self::factory()->post->create(
			array(
				'post_author' => $author_id,
				'post_status' => 'draft',
			)
		);

		wp_set_current_user( $author_id );

		$request = new WP_REST_Request( 'POST', '/wp/v2/posts/' . $post_id );
		$request->set_header( 'content-type', 'application/json' );
		$request->set_body(
			wp_json_encode(
				array(
					'meta' => array(
						Meta::BEEHIIV_PUBLICATION_ID => 'pub_qa',
						Meta::BEEHIIV_POST_ID        => 'forged-id',
						Meta::NEWSLETTER_ERROR       => '',
					),
				)
			)
		);

		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'pub_qa', get_post_meta( $post_id, Meta::BEEHIIV_PUBLICATION_ID, true ) );
		$this->assertSame( '', get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
	}
}
