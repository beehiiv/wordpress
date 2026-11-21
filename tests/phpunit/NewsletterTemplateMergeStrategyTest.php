<?php
/**
 * Unit coverage for keeping the beehiiv template header on update.
 *
 * PRD-07.1.01 US-013: an update to a post created from a template asks beehiiv to
 * keep the template content first; any other post is updated as before.
 *
 * @package beehiiv
 */

use Beehiiv\Config;
use Beehiiv\Editor\Meta;
use Beehiiv\Newsletter\PostSettingsBuilder;

/**
 * Payload coverage for the template merge strategy.
 *
 * @covers \Beehiiv\Newsletter\PostSettingsBuilder::apply_template_merge_strategy
 * @covers \Beehiiv\Newsletter\PostSettingsBuilder::build_update
 * @covers \Beehiiv\Newsletter\PostSettingsBuilder::build_draft_update_payload
 */
class NewsletterTemplateMergeStrategyTest extends WP_UnitTestCase {

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
	 * AC-050: a post created from a template is updated with the merge strategy and its blocks.
	 */
	public function test_update_of_a_template_post_appends_to_the_template(): void {
		$post_id = $this->create_sendable_post();
		update_post_meta( $post_id, Meta::BEEHIIV_LINKED_POST_TEMPLATE_ID, 'tmpl_test' );

		$update = PostSettingsBuilder::build_update( $post_id );

		$this->assertIsArray( $update );
		$this->assertSame( 'append_to_template', $update['payload']['content_merge_strategy'] );
		$this->assertNotEmpty( $update['payload']['blocks'] );
	}

	/**
	 * AC-051: a post with no stored template ID is updated as it is today.
	 */
	public function test_update_of_a_post_without_a_stored_template_is_unchanged(): void {
		$post_id = $this->create_sendable_post();

		$update = PostSettingsBuilder::build_update( $post_id );

		$this->assertIsArray( $update );
		$this->assertArrayNotHasKey( 'content_merge_strategy', $update['payload'] );

		update_post_meta( $post_id, Meta::BEEHIIV_LINKED_POST_TEMPLATE_ID, '  ' );
		$blank = PostSettingsBuilder::build_update( $post_id );

		$this->assertArrayNotHasKey(
			'content_merge_strategy',
			$blank['payload'],
			'AC-051: a blank stored template ID counts as no template.'
		);
	}

	/**
	 * AC-052: the Preview draft update gets the same strategy.
	 */
	public function test_preview_draft_update_appends_to_the_template(): void {
		$post_id = $this->create_sendable_post();
		update_post_meta( $post_id, Meta::BEEHIIV_LINKED_POST_TEMPLATE_ID, 'tmpl_test' );

		$payload = PostSettingsBuilder::build_draft_update_payload( $post_id, 'pub_test' );

		$this->assertIsArray( $payload );
		$this->assertSame( 'append_to_template', $payload['content_merge_strategy'] );

		$plain_id = $this->create_sendable_post();
		$plain    = PostSettingsBuilder::build_draft_update_payload( $plain_id, 'pub_test' );

		$this->assertArrayNotHasKey( 'content_merge_strategy', $plain );
	}

	/**
	 * AC-052: two syncs send the same request, so beehiiv rebuilds the same body each time.
	 */
	public function test_repeated_updates_send_the_same_payload(): void {
		$post_id = $this->create_sendable_post();
		update_post_meta( $post_id, Meta::BEEHIIV_LINKED_POST_TEMPLATE_ID, 'tmpl_test' );

		$first  = PostSettingsBuilder::build_update( $post_id );
		$second = PostSettingsBuilder::build_update( $post_id );

		$this->assertSame( $first['payload'], $second['payload'] );
	}

	/**
	 * AC-053: the helper never adds the strategy to a payload without blocks, and never
	 * uses append or prepend.
	 */
	public function test_payload_without_blocks_is_left_alone(): void {
		$post_id = $this->create_sendable_post();
		update_post_meta( $post_id, Meta::BEEHIIV_LINKED_POST_TEMPLATE_ID, 'tmpl_test' );

		$body_only = array( 'body_content' => '<p>Hello</p>' );

		$this->assertSame( $body_only, PostSettingsBuilder::apply_template_merge_strategy( $body_only, $post_id ) );

		$update = PostSettingsBuilder::build_update( $post_id );

		$strategy = $update['payload']['content_merge_strategy'];

		$this->assertNotContains( $strategy, array( 'append', 'prepend', 'replace' ) );
	}
}
