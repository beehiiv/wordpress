<?php
/**
 * Unit coverage for converting top-level core/columns blocks to beehiiv columns blocks.
 *
 * Structured Content Block Conversion PRD, US-006 (AC-011 to AC-019).
 *
 * @package beehiiv
 */

use Beehiiv\Newsletter\BlockConverter;

/**
 * Top-level Columns block conversion.
 *
 * @covers \Beehiiv\Newsletter\BlockConverter::convert_supported_blocks
 * @covers \Beehiiv\Newsletter\BlockConverter::convert_columns_block_to_blocks
 * @covers \Beehiiv\Newsletter\Converters\ColumnsBlockConverter
 */
class BlockConverterColumnsTest extends WP_UnitTestCase {

	/**
	 * Build the saved markup for one core/column block.
	 *
	 * @param string      $inner   Inner block markup.
	 * @param string|null $width   Width attribute value, or null for none.
	 * @param string|null $v_align Vertical alignment attribute value, or null for none.
	 * @return string
	 */
	private function column( string $inner, ?string $width = null, ?string $v_align = null ): string {
		$attrs = array();

		if ( null !== $width ) {
			$attrs['width'] = $width;
		}

		if ( null !== $v_align ) {
			$attrs['verticalAlignment'] = $v_align;
		}

		$json = empty( $attrs ) ? '' : ' ' . wp_json_encode( $attrs );

		return "<!-- wp:column{$json} -->\n<div class=\"wp-block-column\">{$inner}</div>\n<!-- /wp:column -->\n";
	}

	/**
	 * Build the saved markup for a core/columns block.
	 *
	 * @param array<int, string>   $columns Column markup.
	 * @param array<string, mixed> $attrs Columns block attributes.
	 * @return string
	 */
	private function columns( array $columns, array $attrs = array() ): string {
		$json = empty( $attrs ) ? '' : ' ' . wp_json_encode( $attrs );

		$open  = "<!-- wp:columns{$json} -->\n<div class=\"wp-block-columns\">";
		$close = "</div>\n<!-- /wp:columns -->\n";

		return $open . implode( '', $columns ) . $close;
	}

	/**
	 * Saved markup for a paragraph block.
	 *
	 * @param string $text Paragraph text.
	 * @return string
	 */
	private function paragraph( string $text ): string {
		return "<!-- wp:paragraph -->\n<p>{$text}</p>\n<!-- /wp:paragraph -->";
	}

	/**
	 * Convert post content through the full newsletter conversion.
	 *
	 * @param string $content Post content.
	 * @return array<int, array<string, mixed>>
	 */
	private function convert( string $content ): array {
		$post = self::factory()->post->create_and_get( array( 'post_content' => $content ) );

		return BlockConverter::convert_supported_blocks( $post );
	}

	/**
	 * AC-011, AC-012: one columns block, one column per column, inner blocks in order.
	 */
	public function test_columns_block_converts_to_one_columns_block_in_order(): void {
		$blocks = $this->convert(
			$this->columns(
				array(
					$this->column( $this->paragraph( 'One' ) . $this->paragraph( 'Two' ) ),
					$this->column( $this->paragraph( 'Three' ) ),
				)
			)
		);

		$this->assertCount( 1, $blocks );
		$this->assertSame( 'columns', $blocks[0]['type'] );
		$this->assertCount( 2, $blocks[0]['columns'] );
		$this->assertCount( 2, $blocks[0]['columns'][0]['blocks'] );
		$this->assertCount( 1, $blocks[0]['columns'][1]['blocks'] );
		$this->assertSame( 'paragraph', $blocks[0]['columns'][0]['blocks'][0]['type'] );
	}

	/**
	 * AC-012: blocks without a beehiiv equivalent are omitted from the column.
	 */
	public function test_unsupported_inner_block_is_omitted_from_column(): void {
		$spacer = "<!-- wp:spacer -->\n<div class=\"wp-block-spacer\"></div>\n<!-- /wp:spacer -->";
		$blocks = $this->convert(
			$this->columns(
				array(
					$this->column( $this->paragraph( 'Kept' ) . $spacer ),
				)
			)
		);

		$this->assertCount( 1, $blocks[0]['columns'][0]['blocks'] );
	}

	/**
	 * AC-013: percent widths become whole percents, and a missing width stays unset.
	 */
	public function test_percent_widths_round_per_column_and_missing_width_stays_unset(): void {
		$blocks = $this->convert(
			$this->columns(
				array(
					$this->column( $this->paragraph( 'A' ), '33.33%' ),
					$this->column( $this->paragraph( 'B' ), '33.33%' ),
					$this->column( $this->paragraph( 'C' ) ),
				)
			)
		);

		$columns = $blocks[0]['columns'];

		$this->assertSame( 33, $columns[0]['width'] );
		$this->assertSame( 33, $columns[1]['width'] );
		$this->assertArrayNotHasKey( 'width', $columns[2] );
	}

	/**
	 * AC-014: px widths become each column's share of the row.
	 */
	public function test_pixel_widths_become_share_of_the_row(): void {
		$blocks = $this->convert(
			$this->columns(
				array(
					$this->column( $this->paragraph( 'A' ), '100px' ),
					$this->column( $this->paragraph( 'B' ), '300px' ),
				)
			)
		);

		$this->assertSame( 25, $blocks[0]['columns'][0]['width'] );
		$this->assertSame( 75, $blocks[0]['columns'][1]['width'] );
	}

	/**
	 * AC-014: with a non-percent width and one column missing a width, no column gets a width.
	 */
	public function test_pixel_widths_with_a_missing_width_leave_the_row_unset(): void {
		$blocks = $this->convert(
			$this->columns(
				array(
					$this->column( $this->paragraph( 'A' ), '100px' ),
					$this->column( $this->paragraph( 'B' ) ),
				)
			)
		);

		$this->assertArrayNotHasKey( 'width', $blocks[0]['columns'][0] );
		$this->assertArrayNotHasKey( 'width', $blocks[0]['columns'][1] );
	}

	/**
	 * AC-015: vertical alignment on a column or the Columns block is carried over.
	 */
	public function test_vertical_alignment_is_carried_over(): void {
		$blocks = $this->convert(
			$this->columns(
				array(
					$this->column( $this->paragraph( 'A' ), null, 'center' ),
					$this->column( $this->paragraph( 'B' ) ),
				),
				array( 'verticalAlignment' => 'bottom' )
			)
		);

		$this->assertSame( 'middle', $blocks[0]['columns'][0]['verticalAlign'] );
		$this->assertSame( 'bottom', $blocks[0]['columns'][1]['verticalAlign'] );
	}

	/**
	 * AC-016: columns stack on mobile by default and not when the block says so.
	 */
	public function test_stack_on_mobile_defaults_to_true(): void {
		$stacked   = $this->convert( $this->columns( array( $this->column( $this->paragraph( 'A' ) ) ) ) );
		$unstacked = $this->convert(
			$this->columns(
				array( $this->column( $this->paragraph( 'A' ) ) ),
				array( 'isStackedOnMobile' => false )
			)
		);

		$this->assertTrue( $stacked[0]['stackOnMobile'] );
		$this->assertFalse( $unstacked[0]['stackOnMobile'] );
	}

	/**
	 * AC-017: more than 3 columns are omitted entirely, with no columns block and no top-level blocks.
	 */
	public function test_more_than_three_columns_are_omitted(): void {
		$blocks = $this->convert(
			$this->paragraph( 'Before' )
				. $this->columns(
					array(
						$this->column( $this->paragraph( 'A' ) ),
						$this->column( $this->paragraph( 'B' ) ),
						$this->column( $this->paragraph( 'C' ) ),
						$this->column( $this->paragraph( 'D' ) ),
					)
				)
				. $this->paragraph( 'After' )
		);

		$this->assertCount( 2, $blocks );
		$this->assertSame( 'Before', $blocks[0]['plaintext'] );
		$this->assertSame( 'After', $blocks[1]['plaintext'] );
	}

	/**
	 * AC-017: exactly three columns still convert to a columns block.
	 */
	public function test_three_columns_convert_to_a_columns_block(): void {
		$blocks = $this->convert(
			$this->columns(
				array(
					$this->column( $this->paragraph( 'A' ) ),
					$this->column( $this->paragraph( 'B' ) ),
					$this->column( $this->paragraph( 'C' ) ),
				)
			)
		);

		$this->assertCount( 1, $blocks );
		$this->assertCount( 3, $blocks[0]['columns'] );
	}

	/**
	 * AC-018: nested columns put their inner blocks at the top level after the outer block.
	 */
	public function test_nested_columns_fall_back_to_top_level_blocks(): void {
		$nested = $this->columns(
			array(
				$this->column( $this->paragraph( 'Nested one' ) ),
				$this->column( $this->paragraph( 'Nested two' ) ),
			)
		);

		$blocks = $this->convert(
			$this->columns(
				array(
					$this->column( $this->paragraph( 'Outer' ) . $nested ),
				)
			)
		);

		$this->assertCount( 3, $blocks );
		$this->assertSame( 'columns', $blocks[0]['type'] );
		$this->assertCount( 1, $blocks[0]['columns'][0]['blocks'] );
		$this->assertSame( 'paragraph', $blocks[1]['type'] );
		$this->assertSame( 'paragraph', $blocks[2]['type'] );
	}

	/**
	 * AC-019: a three-column layout with an image, a heading plus paragraph, and a button.
	 */
	public function test_three_column_layout_with_image_heading_paragraph_and_button(): void {
		$image   = "<!-- wp:image -->\n<figure class=\"wp-block-image\">"
			. "<img src=\"https://example.com/a.jpg\" alt=\"\"/></figure>\n<!-- /wp:image -->";
		$heading = "<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">Title</h2>\n<!-- /wp:heading -->";
		$button  = "<!-- wp:buttons -->\n<div class=\"wp-block-buttons\"><!-- wp:button -->\n"
			. '<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" '
			. "href=\"https://example.com\">Go</a></div>\n<!-- /wp:button --></div>\n<!-- /wp:buttons -->";

		$blocks = $this->convert(
			$this->columns(
				array(
					$this->column( $image, '33.33%' ),
					$this->column( $heading . $this->paragraph( 'Body' ), '33.33%' ),
					$this->column( $button, '33.33%' ),
				)
			)
		);

		$this->assertCount( 1, $blocks );
		$this->assertCount( 3, $blocks[0]['columns'] );
		$this->assertSame( 'image', $blocks[0]['columns'][0]['blocks'][0]['type'] );
		$this->assertSame( 'heading', $blocks[0]['columns'][1]['blocks'][0]['type'] );
		$this->assertSame( 'paragraph', $blocks[0]['columns'][1]['blocks'][1]['type'] );
		$this->assertSame( 'button', $blocks[0]['columns'][2]['blocks'][0]['type'] );
	}
}
