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
	 * PRD-06.8.01 AC-015 / BR-001: users without publish rights cannot write
	 * the newsletter title or subtitle.
	 */
	public function test_newsletter_wording_fields_are_denied_for_contributor(): void {
		$contributor_id = self::factory()->user->create( array( 'role' => 'contributor' ) );
		$post_id        = self::factory()->post->create(
			array(
				'post_author' => $contributor_id,
				'post_status' => 'draft',
			)
		);

		wp_set_current_user( $contributor_id );

		foreach ( array( Meta::NEWSLETTER_TITLE, Meta::NEWSLETTER_SUBTITLE ) as $meta_key ) {
			$this->assertFalse(
				PostSettings::authorize_meta( false, $meta_key, $post_id ),
				sprintf( 'PRD-06.8.01 AC-015: a contributor must not be authorized to write %s.', $meta_key )
			);
		}
	}

	/**
	 * PRD-06.8.01 AC-014: users with publish rights can write the newsletter
	 * title and subtitle.
	 */
	public function test_newsletter_wording_fields_are_allowed_for_author(): void {
		$author_id = self::factory()->user->create( array( 'role' => 'author' ) );
		$post_id   = self::factory()->post->create( array( 'post_author' => $author_id ) );

		wp_set_current_user( $author_id );

		foreach ( array( Meta::NEWSLETTER_TITLE, Meta::NEWSLETTER_SUBTITLE ) as $meta_key ) {
			$this->assertTrue(
				PostSettings::authorize_meta( false, $meta_key, $post_id ),
				sprintf( 'PRD-06.8.01 AC-014: an author must be authorized to write %s.', $meta_key )
			);
		}
	}

	/**
	 * PRD-06.8.01 AC-002, AC-003, AC-007, AC-008: both fields are registered as
	 * REST-visible single strings that start empty, stored as plain text.
	 */
	public function test_newsletter_wording_fields_are_registered_empty_and_sanitized(): void {
		PostSettings::register_meta();

		$registered = get_registered_meta_keys( 'post', 'post' );
		$post_id    = self::factory()->post->create();

		foreach ( array( Meta::NEWSLETTER_TITLE, Meta::NEWSLETTER_SUBTITLE ) as $meta_key ) {
			$this->assertArrayHasKey( $meta_key, $registered, sprintf( '%s must be registered.', $meta_key ) );
			$this->assertSame( 'string', $registered[ $meta_key ]['type'] );
			$this->assertTrue( $registered[ $meta_key ]['single'] );
			$this->assertNotEmpty( $registered[ $meta_key ]['show_in_rest'] );
			$this->assertSame(
				'',
				get_post_meta( $post_id, $meta_key, true ),
				sprintf( '%s must start empty.', $meta_key )
			);

			update_post_meta( $post_id, $meta_key, "<b>Hello</b>\nworld" );
			$this->assertSame(
				'Hello world',
				get_post_meta( $post_id, $meta_key, true ),
				sprintf( '%s must be stored as plain single-line text.', $meta_key )
			);
		}
	}

	/**
	 * PRD-06.8.01 AC-024 / BR-008: users without publish rights cannot write
	 * the email title/subtitle display choice.
	 */
	public function test_show_title_in_email_is_denied_for_contributor(): void {
		$contributor_id = self::factory()->user->create( array( 'role' => 'contributor' ) );
		$post_id        = self::factory()->post->create(
			array(
				'post_author' => $contributor_id,
				'post_status' => 'draft',
			)
		);

		wp_set_current_user( $contributor_id );

		$this->assertFalse(
			PostSettings::authorize_meta( false, Meta::NEWSLETTER_SHOW_TITLE_IN_EMAIL, $post_id ),
			'PRD-06.8.01 AC-024: a contributor must not be authorized to write the email display choice.'
		);
	}

	/**
	 * PRD-06.8.01 AC-024: users with publish rights can write the email
	 * title/subtitle display choice.
	 */
	public function test_show_title_in_email_is_allowed_for_author(): void {
		$author_id = self::factory()->user->create( array( 'role' => 'author' ) );
		$post_id   = self::factory()->post->create( array( 'post_author' => $author_id ) );

		wp_set_current_user( $author_id );

		$this->assertTrue(
			PostSettings::authorize_meta( false, Meta::NEWSLETTER_SHOW_TITLE_IN_EMAIL, $post_id ),
			'PRD-06.8.01 AC-024: an author must be authorized to write the email display choice.'
		);
	}

	/**
	 * PRD-06.8.01 AC-021, AC-022, AC-026: the email display choice is a
	 * REST-visible single boolean that reads as hidden when never set.
	 */
	public function test_show_title_in_email_is_registered_and_hidden_by_default(): void {
		PostSettings::register_meta();

		$registered = get_registered_meta_keys( 'post', 'post' );
		$post_id    = self::factory()->post->create();
		$meta_key   = Meta::NEWSLETTER_SHOW_TITLE_IN_EMAIL;

		$this->assertArrayHasKey( $meta_key, $registered );
		$this->assertSame( 'boolean', $registered[ $meta_key ]['type'] );
		$this->assertTrue( $registered[ $meta_key ]['single'] );
		$this->assertNotEmpty( $registered[ $meta_key ]['show_in_rest'] );
		$this->assertFalse(
			(bool) get_post_meta( $post_id, $meta_key, true ),
			'PRD-06.8.01 AC-021: a post that never set the choice must read as hidden.'
		);

		update_post_meta( $post_id, $meta_key, true );
		$this->assertTrue(
			(bool) get_post_meta( $post_id, $meta_key, true ),
			'PRD-06.8.01 AC-022: the saved choice must persist on the post.'
		);
	}
}
