<?php
/**
 * Unit coverage for the newsletter title and subtitle in the beehiiv payload.
 *
 * PRD-07.1.01 US-008: the email subject line and beehiiv subtitle come from the
 * post's newsletter title and subtitle, on the first send and on every sync.
 *
 * @package beehiiv
 */

use Beehiiv\Config;
use Beehiiv\Editor\Meta;
use Beehiiv\Newsletter\PostSettingsBuilder;

/**
 * Payload coverage for newsletter title and subtitle.
 *
 * @covers \Beehiiv\Newsletter\PostSettingsBuilder::get_post_settings
 * @covers \Beehiiv\Newsletter\PostSettingsBuilder::build_update
 */
class NewsletterPostSettingsBuilderTest extends WP_UnitTestCase {

	/**
	 * Configure a site default post template so the builder needs no API call.
	 */
	public function set_up(): void {
		parent::set_up();

		update_option(
			Config::OPTION_NAME,
			array(
				'publication_id'   => 'pub_test',
				'post_template_id' => 'tmpl_test',
			)
		);
	}

	/**
	 * Create a published post the builder can convert.
	 *
	 * @return int Post ID.
	 */
	private function create_sendable_post(): int {
		return self::factory()->post->create(
			array(
				'post_title'   => 'WordPress post title',
				'post_status'  => 'publish',
				'post_content' => "<!-- wp:paragraph -->\n<p>Newsletter body.</p>\n<!-- /wp:paragraph -->",
			)
		);
	}

	/**
	 * AC-027: an empty newsletter title falls back to the post title.
	 */
	public function test_subject_line_falls_back_to_post_title(): void {
		$settings = PostSettingsBuilder::get_post_settings( $this->create_sendable_post() );

		$this->assertIsArray( $settings );
		$this->assertSame( 'WordPress post title', $settings['email_settings']['email_subject_line'] );
	}

	/**
	 * AC-027 and AC-028: a newsletter title sets the subject line only.
	 */
	public function test_newsletter_title_sets_subject_line_only(): void {
		$post_id = $this->create_sendable_post();
		update_post_meta( $post_id, Meta::NEWSLETTER_TITLE, 'Inbox subject' );

		$settings = PostSettingsBuilder::get_post_settings( $post_id );

		$this->assertSame( 'Inbox subject', $settings['email_settings']['email_subject_line'] );
		$this->assertSame(
			'WordPress post title',
			$settings['title'],
			'AC-028: the headline and web title stay the post title.'
		);
	}

	/**
	 * AC-029: the newsletter subtitle is sent when set, and omitted when empty.
	 */
	public function test_subtitle_sent_only_when_set(): void {
		$post_id = $this->create_sendable_post();

		$this->assertArrayNotHasKey( 'subtitle', PostSettingsBuilder::get_post_settings( $post_id ) );

		update_post_meta( $post_id, Meta::NEWSLETTER_SUBTITLE, 'A short subtitle' );

		$this->assertSame( 'A short subtitle', PostSettingsBuilder::get_post_settings( $post_id )['subtitle'] );
	}

	/**
	 * AC-030 and AC-031: the update payload carries the current subject line and subtitle.
	 */
	public function test_update_payload_carries_subject_line_and_subtitle(): void {
		$post_id = $this->create_sendable_post();
		update_post_meta( $post_id, Meta::NEWSLETTER_TITLE, 'First subject' );
		update_post_meta( $post_id, Meta::NEWSLETTER_SUBTITLE, 'First subtitle' );

		update_post_meta( $post_id, Meta::NEWSLETTER_TITLE, 'Edited subject' );
		update_post_meta( $post_id, Meta::NEWSLETTER_SUBTITLE, 'Edited subtitle' );

		$update = PostSettingsBuilder::build_update( $post_id );

		$this->assertIsArray( $update );
		$this->assertSame( 'Edited subject', $update['payload']['email_settings']['email_subject_line'] );
		$this->assertSame( 'Edited subtitle', $update['payload']['subtitle'] );
		$this->assertSame( 'WordPress post title', $update['payload']['title'] );

		delete_post_meta( $post_id, Meta::NEWSLETTER_TITLE );
		$cleared = PostSettingsBuilder::build_update( $post_id );

		$this->assertSame(
			'WordPress post title',
			$cleared['payload']['email_settings']['email_subject_line'],
			'AC-030: clearing the newsletter title returns the subject line to the post title.'
		);
	}

	/**
	 * AC-032: preview text is never set from either field.
	 */
	public function test_preview_text_is_not_set(): void {
		$post_id = $this->create_sendable_post();
		update_post_meta( $post_id, Meta::NEWSLETTER_TITLE, 'Inbox subject' );
		update_post_meta( $post_id, Meta::NEWSLETTER_SUBTITLE, 'A short subtitle' );

		$settings = PostSettingsBuilder::get_post_settings( $post_id );
		$update   = PostSettingsBuilder::build_update( $post_id );

		$this->assertArrayNotHasKey( 'email_preview_text', $settings['email_settings'] );
		$this->assertArrayNotHasKey( 'email_preview_text', $update['payload']['email_settings'] );
	}

	/**
	 * AC-033 and AC-034: a post that never set the choice hides the title and subtitle on create and on update.
	 */
	public function test_title_and_subtitle_hidden_in_email_by_default(): void {
		$post_id = $this->create_sendable_post();

		$settings = PostSettingsBuilder::get_post_settings( $post_id );
		$update   = PostSettingsBuilder::build_update( $post_id );

		$this->assertFalse( $settings['email_settings']['display_title_in_email'] );
		$this->assertFalse( $settings['email_settings']['display_subtitle_in_email'] );
		$this->assertFalse( $update['payload']['email_settings']['display_title_in_email'] );
		$this->assertFalse( $update['payload']['email_settings']['display_subtitle_in_email'] );
	}

	/**
	 * AC-034: turning the choice on shows both the title and the subtitle.
	 */
	public function test_title_and_subtitle_shown_in_email_when_on(): void {
		$post_id = $this->create_sendable_post();
		update_post_meta( $post_id, Meta::NEWSLETTER_SHOW_TITLE_IN_EMAIL, true );

		$settings = PostSettingsBuilder::get_post_settings( $post_id );

		$this->assertTrue( $settings['email_settings']['display_title_in_email'] );
		$this->assertTrue( $settings['email_settings']['display_subtitle_in_email'] );
	}

	/**
	 * AC-035: changing the choice changes the sync payload on the next save.
	 */
	public function test_update_payload_follows_changed_choice(): void {
		$post_id = $this->create_sendable_post();
		update_post_meta( $post_id, Meta::NEWSLETTER_SHOW_TITLE_IN_EMAIL, true );

		$update = PostSettingsBuilder::build_update( $post_id );
		$this->assertTrue( $update['payload']['email_settings']['display_title_in_email'] );

		update_post_meta( $post_id, Meta::NEWSLETTER_SHOW_TITLE_IN_EMAIL, false );
		$update = PostSettingsBuilder::build_update( $post_id );

		$this->assertFalse( $update['payload']['email_settings']['display_title_in_email'] );
		$this->assertFalse( $update['payload']['email_settings']['display_subtitle_in_email'] );
	}

	/**
	 * AC-036: the byline stays hidden whatever the choice.
	 */
	public function test_byline_stays_hidden_in_email(): void {
		$post_id = $this->create_sendable_post();

		$settings = PostSettingsBuilder::get_post_settings( $post_id );
		$this->assertFalse( $settings['email_settings']['display_byline_in_email'] );

		update_post_meta( $post_id, Meta::NEWSLETTER_SHOW_TITLE_IN_EMAIL, true );

		$settings = PostSettingsBuilder::get_post_settings( $post_id );
		$this->assertFalse( $settings['email_settings']['display_byline_in_email'] );
	}
}
