<?php
/**
 * Unit coverage for converting Group blocks to beehiiv sections.
 *
 * PRD-07.2.01 US-006 (AC-009 to AC-014): a Group block becomes a beehiiv section for
 * posts first synced with section support. Posts synced before it keep omitting Groups.
 *
 * @package beehiiv
 */

use Beehiiv\Config;
use Beehiiv\Editor\Meta;
use Beehiiv\Newsletter\BlockConverter;
use Beehiiv\Newsletter\PostSettingsBuilder;

/**
 * Group-to-section conversion coverage.
 *
 * @covers \Beehiiv\Newsletter\BlockConverter::convert_supported_blocks
 * @covers \Beehiiv\Newsletter\PostSettingsBuilder::get_post_settings
 */
class BlockConverterGroupTest extends WP_UnitTestCase {

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
	 * Build a paragraph block's markup.
	 *
	 * @param string $text Paragraph text.
	 * @return string
	 */
	private function paragraph( string $text ): string {
		return "<!-- wp:paragraph -->\n<p>{$text}</p>\n<!-- /wp:paragraph -->";
	}

	/**
	 * Wrap block markup in a Group block.
	 *
	 * @param string $inner Inner block markup.
	 * @return string
	 */
	private function group( string $inner ): string {
		return "<!-- wp:group -->\n<div class=\"wp-block-group\">{$inner}</div>\n<!-- /wp:group -->";
	}

	/**
	 * Create a published post with the given content.
	 *
	 * @param string $content Block markup.
	 * @return WP_Post
	 */
	private function create_post( string $content ): WP_Post {
		$post_id = self::factory()->post->create(
			array(
				'post_title'   => 'Group post',
				'post_status'  => 'publish',
				'post_content' => $content,
			)
		);

		return get_post( $post_id );
	}

	/**
	 * AC-009 and AC-013: a Group with a heading and two paragraphs is one section with three children.
	 */
	public function test_group_becomes_one_section_with_children_in_order(): void {
		$heading = "<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">Title</h2>\n<!-- /wp:heading -->";
		$post    = $this->create_post(
			$this->group( $heading . $this->paragraph( 'First' ) . $this->paragraph( 'Second' ) )
		);

		$blocks = BlockConverter::convert_supported_blocks( $post, true );

		$this->assertCount( 1, $blocks );
		$this->assertSame( 'section', $blocks[0]['type'] );
		$this->assertCount( 3, $blocks[0]['blocks'] );
		$this->assertSame(
			array( 'heading', 'paragraph', 'paragraph' ),
			array_column( $blocks[0]['blocks'], 'type' )
		);
	}

	/**
	 * AC-009: blocks around a Group stay in place and the section keeps their order.
	 */
	public function test_section_sits_between_sibling_blocks(): void {
		$post = $this->create_post(
			$this->paragraph( 'Before' ) . $this->group( $this->paragraph( 'Inside' ) ) . $this->paragraph( 'After' )
		);

		$blocks = BlockConverter::convert_supported_blocks( $post, true );

		$this->assertSame(
			array( 'paragraph', 'section', 'paragraph' ),
			array_column( $blocks, 'type' )
		);
	}

	/**
	 * AC-010: a Group inside a Group becomes a nested section.
	 */
	public function test_nested_group_becomes_nested_section(): void {
		$inner = $this->group( $this->paragraph( 'Deep' ) );
		$post  = $this->create_post( $this->group( $this->paragraph( 'Top' ) . $inner ) );

		$blocks = BlockConverter::convert_supported_blocks( $post, true );

		$this->assertCount( 1, $blocks );
		$this->assertSame( 'section', $blocks[0]['type'] );
		$this->assertSame(
			array( 'paragraph', 'section' ),
			array_column( $blocks[0]['blocks'], 'type' )
		);
		$this->assertCount( 1, $blocks[0]['blocks'][1]['blocks'] );
	}

	/**
	 * AC-011: a section carries only its type and blocks, never Group styling.
	 */
	public function test_section_uses_default_settings(): void {
		$attrs   = '{"backgroundColor":"vivid-red","style":{"spacing":{"padding":{"top":"40px"}}}}';
		$content = "<!-- wp:group {$attrs} -->\n"
			. '<div class="wp-block-group has-vivid-red-background-color has-background">'
			. $this->paragraph( 'Styled' )
			. "</div>\n<!-- /wp:group -->";

		$blocks = BlockConverter::convert_supported_blocks( $this->create_post( $content ), true );

		$this->assertSame( array( 'type', 'blocks' ), array_keys( $blocks[0] ) );
	}

	/**
	 * AC-012: a Group with no blocks, or no convertible blocks, produces no section.
	 */
	public function test_group_without_convertible_blocks_produces_no_section(): void {
		$unsupported = "<!-- wp:code -->\n<pre class=\"wp-block-code\"><code>x</code></pre>\n<!-- /wp:code -->";

		$empty            = BlockConverter::convert_supported_blocks(
			$this->create_post( $this->paragraph( 'Kept' ) . $this->group( '' ) ),
			true
		);
		$only_unsupported = BlockConverter::convert_supported_blocks(
			$this->create_post( $this->paragraph( 'Kept' ) . $this->group( $unsupported ) ),
			true
		);

		$this->assertSame( array( 'paragraph' ), array_column( $empty, 'type' ) );
		$this->assertSame( array( 'paragraph' ), array_column( $only_unsupported, 'type' ) );
	}

	/**
	 * AC-012: a Group that mixes convertible and unconvertible blocks keeps only the convertible ones.
	 */
	public function test_mixed_group_keeps_only_convertible_blocks(): void {
		$unsupported = "<!-- wp:code -->\n<pre class=\"wp-block-code\"><code>x</code></pre>\n<!-- /wp:code -->";
		$post        = $this->create_post(
			$this->group( $this->paragraph( 'One' ) . $unsupported . $this->paragraph( 'Two' ) )
		);

		$blocks = BlockConverter::convert_supported_blocks( $post, true );

		$this->assertSame( 'section', $blocks[0]['type'] );
		$this->assertCount( 2, $blocks[0]['blocks'] );
	}

	/**
	 * Without the flag a Group and its inner blocks are omitted, as before section support.
	 */
	public function test_group_is_omitted_when_conversion_is_off(): void {
		$post = $this->create_post( $this->paragraph( 'Kept' ) . $this->group( $this->paragraph( 'Lost' ) ) );

		$blocks = BlockConverter::convert_supported_blocks( $post );

		$this->assertSame( array( 'paragraph' ), array_column( $blocks, 'type' ) );
	}

	/**
	 * AC-014: a post with no beehiiv post yet converts Groups.
	 */
	public function test_first_sync_converts_groups(): void {
		$post     = $this->create_post( $this->paragraph( 'Kept' ) . $this->group( $this->paragraph( 'Inside' ) ) );
		$settings = PostSettingsBuilder::get_post_settings( $post->ID );

		$this->assertIsArray( $settings );
		$this->assertSame( array( 'paragraph', 'section' ), array_column( $settings['blocks'], 'type' ) );
	}

	/**
	 * AC-014: a post first synced before section support keeps omitting Groups on re-sync.
	 */
	public function test_post_synced_before_section_support_keeps_omitting_groups(): void {
		$post = $this->create_post( $this->paragraph( 'Kept' ) . $this->group( $this->paragraph( 'Inside' ) ) );
		update_post_meta( $post->ID, Meta::BEEHIIV_POST_ID, 'post_legacy' );

		$settings = PostSettingsBuilder::get_post_settings( $post->ID, true );

		$this->assertIsArray( $settings );
		$this->assertSame( array( 'paragraph' ), array_column( $settings['blocks'], 'type' ) );
	}

	/**
	 * AC-014: a post first synced with sections keeps its sections when it is synced again.
	 */
	public function test_post_first_synced_with_sections_keeps_them_on_resync(): void {
		$post = $this->create_post( $this->paragraph( 'Kept' ) . $this->group( $this->paragraph( 'Inside' ) ) );
		update_post_meta( $post->ID, Meta::BEEHIIV_POST_ID, 'post_new' );
		update_post_meta( $post->ID, Meta::BEEHIIV_GROUP_SECTIONS, true );

		$settings = PostSettingsBuilder::get_post_settings( $post->ID, true );

		$this->assertIsArray( $settings );
		$this->assertSame( array( 'paragraph', 'section' ), array_column( $settings['blocks'], 'type' ) );
	}
}
