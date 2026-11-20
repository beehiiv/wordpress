<?php
/**
 * Unit coverage for converting Custom HTML blocks to beehiiv HTML blocks.
 *
 * PRD-07.2.02 US-001, US-002 and US-003: a Custom HTML block becomes a beehiiv HTML Snippet,
 * script and iframe elements are removed, and a newsletter-only block is hidden on the site.
 *
 * @package beehiiv
 */

use Beehiiv\Config;
use Beehiiv\Newsletter\BlockConverter;

/**
 * Custom HTML conversion and newsletter-only coverage.
 *
 * @covers \Beehiiv\Newsletter\BlockConverter::convert_supported_blocks
 * @covers \Beehiiv\Newsletter\Converters\HtmlBlockConverter
 * @covers \Beehiiv\Editor\NewsletterOnlyHtml
 */
class BlockConverterHtmlTest extends WP_UnitTestCase {

	/**
	 * Configure a site default post template so conversion needs no API call.
	 */
	public function set_up(): void {
		parent::set_up();

		// Run as an administrator, who may save unfiltered HTML. Without a user, WordPress strips
		// script tags when a post is saved and leaves their text behind, which is not what a
		// publisher who can add a Custom HTML block gets.
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

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
	 * Build a Custom HTML block's markup.
	 *
	 * @param string $html            Block HTML.
	 * @param bool   $newsletter_only Whether the block is newsletter only.
	 * @return string
	 */
	private function html_block( string $html, bool $newsletter_only = false ): string {
		$attrs = $newsletter_only ? ' {"beehiivNewsletterOnly":true}' : '';

		return "<!-- wp:html{$attrs} -->\n{$html}\n<!-- /wp:html -->";
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
				'post_title'   => 'HTML post',
				'post_status'  => 'publish',
				'post_content' => $content,
			)
		);

		return get_post( $post_id );
	}

	/**
	 * AC-001, AC-002, AC-003: each Custom HTML block is one snippet, in order, with the HTML as written.
	 */
	public function test_each_html_block_becomes_one_snippet_in_order(): void {
		$first  = '<div style="color:red"><table><tr><td>A</td></tr></table></div>';
		$second = '<a href="https://example.com/?utm=1"><img src="https://example.com/a.png"></a>';
		$post   = $this->create_post(
			$this->paragraph( 'Before' )
			. $this->html_block( $first )
			. $this->paragraph( 'Middle' )
			. $this->html_block( $second )
		);

		$blocks = BlockConverter::convert_supported_blocks( $post );

		$this->assertSame( array( 'paragraph', 'html', 'paragraph', 'html' ), array_column( $blocks, 'type' ) );
		$this->assertSame( $first, $blocks[1]['html'] );
		$this->assertSame( $second, $blocks[3]['html'] );
	}

	/**
	 * AC-004: an empty or whitespace-only block sends no snippet.
	 */
	public function test_empty_html_block_sends_no_snippet(): void {
		$post   = $this->create_post( $this->html_block( '   ' ) . $this->paragraph( 'Text' ) );
		$blocks = BlockConverter::convert_supported_blocks( $post );

		$this->assertSame( array( 'paragraph' ), array_column( $blocks, 'type' ) );
	}

	/**
	 * AC-005: a Custom HTML block inside a Group stays inside the section.
	 */
	public function test_html_block_inside_group_stays_in_the_section(): void {
		$group = "<!-- wp:group -->\n<div class=\"wp-block-group\">"
			. $this->paragraph( 'In' ) . $this->html_block( '<p>Snippet</p>' )
			. "</div>\n<!-- /wp:group -->";
		$post  = $this->create_post( $group );

		$blocks = BlockConverter::convert_supported_blocks( $post, true );

		$this->assertSame( array( 'section' ), array_column( $blocks, 'type' ) );
		$this->assertSame( array( 'paragraph', 'html' ), array_column( $blocks[0]['blocks'], 'type' ) );
	}

	/**
	 * AC-006: a Custom HTML block inside Columns is sent right after the columns block.
	 */
	public function test_html_block_inside_columns_follows_the_columns_block(): void {
		$columns = "<!-- wp:columns -->\n<div class=\"wp-block-columns\">"
			. "<!-- wp:column -->\n<div class=\"wp-block-column\">"
			. $this->paragraph( 'Col' ) . $this->html_block( '<p>Snippet</p>' )
			. "</div>\n<!-- /wp:column --></div>\n<!-- /wp:columns -->";
		$post    = $this->create_post( $columns );

		$blocks = BlockConverter::convert_supported_blocks( $post );

		$this->assertSame( array( 'columns', 'html' ), array_column( $blocks, 'type' ) );
		$this->assertSame( '<p>Snippet</p>', $blocks[1]['html'] );
		$this->assertSame( array( 'paragraph' ), array_column( $blocks[0]['columns'][0]['blocks'], 'type' ) );
	}

	/**
	 * AC-009, AC-010, AC-011: script and iframe elements are removed, and a block of only those sends nothing.
	 */
	public function test_script_and_iframe_elements_are_removed(): void {
		$post = $this->create_post(
			$this->html_block( '<p>Keep</p><script>alert(1)</script><iframe src="https://example.com"></iframe>' )
			. $this->html_block( '<script>only()</script>' )
		);

		$blocks = BlockConverter::convert_supported_blocks( $post );

		$this->assertCount( 1, $blocks );
		$this->assertSame( '<p>Keep</p>', $blocks[0]['html'] );
	}

	/**
	 * AC-015, AC-021: a newsletter-only block still syncs and carries no visibility rule.
	 */
	public function test_newsletter_only_block_still_syncs_without_visibility_rule(): void {
		$post   = $this->create_post( $this->html_block( '<p>Ad</p>', true ) );
		$blocks = BlockConverter::convert_supported_blocks( $post );

		$this->assertCount( 1, $blocks );
		$this->assertSame( 'html', $blocks[0]['type'] );
		$this->assertArrayNotHasKey( 'visibility_settings', $blocks[0] );
	}

	/**
	 * AC-014, AC-016, AC-017, AC-019: a newsletter-only block renders nothing, others render as today.
	 */
	public function test_newsletter_only_block_is_hidden_from_rendered_content_and_the_feed(): void {
		$post = $this->create_post(
			$this->html_block( '<p>Visible block</p>' ) . $this->html_block( '<p>Newsletter ad</p>', true )
		);

		$rendered = apply_filters( 'the_content', $post->post_content );

		$this->assertStringContainsString( 'Visible block', $rendered );
		$this->assertStringNotContainsString( 'Newsletter ad', $rendered );

		$feed = apply_filters( 'the_content_feed', $rendered );
		$this->assertStringNotContainsString( 'Newsletter ad', $feed );

		$excerpt = wp_trim_excerpt( '', $post );
		$this->assertStringNotContainsString( 'Newsletter ad', $excerpt );

		$request  = new WP_REST_Request( 'GET', '/wp/v2/posts/' . $post->ID );
		$response = rest_do_request( $request );
		$data     = $response->get_data();
		$this->assertStringNotContainsString( 'Newsletter ad', $data['content']['rendered'] );
		$this->assertStringContainsString( 'Visible block', $data['content']['rendered'] );
	}

	/**
	 * AC-020: turning the option off shows the block again.
	 */
	public function test_turning_the_option_off_restores_the_block(): void {
		$post = $this->create_post( $this->html_block( '<p>Ad</p>', true ) );
		$this->assertStringNotContainsString( 'Ad', apply_filters( 'the_content', $post->post_content ) );

		wp_update_post(
			array(
				'ID'           => $post->ID,
				'post_content' => $this->html_block( '<p>Ad</p>' ),
			)
		);

		$this->assertStringContainsString(
			'Ad',
			apply_filters( 'the_content', get_post( $post->ID )->post_content )
		);
	}
}
