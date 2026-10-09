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
}
