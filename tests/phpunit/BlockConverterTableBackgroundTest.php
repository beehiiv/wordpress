<?php
/**
 * Unit coverage for the table block background colour in newsletter conversion.
 *
 * Structured Content Block Conversion PRD, AC-010.
 *
 * @package beehiiv
 */

use Beehiiv\Newsletter\BlockConverter;

/**
 * Table block background colour.
 *
 * @covers \Beehiiv\Newsletter\BlockConverter::convert_table_block
 * @covers \Beehiiv\Newsletter\FormattedTextParser::resolve_table_block_background_color
 */
class BlockConverterTableBackgroundTest extends WP_UnitTestCase {

	/**
	 * Build a parsed core/table block.
	 *
	 * @param array<string, mixed> $attrs      Block attributes.
	 * @param string               $table_tag  Opening table tag.
	 * @param string               $figure_tag Opening figure tag.
	 * @return array<string, mixed>
	 */
	private function table_block(
		array $attrs,
		string $table_tag = '<table>',
		string $figure_tag = '<figure class="wp-block-table">'
	): array {
		return array(
			'blockName'   => 'core/table',
			'attrs'       => $attrs,
			'innerBlocks' => array(),
			'innerHTML'   => $figure_tag . $table_tag
				. '<tbody><tr><td>Apple</td><td>3</td></tr></tbody></table></figure>',
		);
	}

	/**
	 * A colour set in the block attributes is sent.
	 */
	public function test_background_color_from_block_attributes(): void {
		$block = BlockConverter::convert_table_block(
			$this->table_block( array( 'style' => array( 'color' => array( 'background' => '#eeeeee' ) ) ) )
		);

		$this->assertSame( '#eeeeee', $block['visual_settings']['background_color'] );
	}

	/**
	 * A colour on the table tag is sent.
	 */
	public function test_background_color_from_table_tag(): void {
		$block = BlockConverter::convert_table_block(
			$this->table_block( array(), '<table class="has-background" style="background-color:#ffeeaa">' )
		);

		$this->assertSame( '#ffeeaa', $block['visual_settings']['background_color'] );
	}

	/**
	 * A colour on the figure wrapper is sent.
	 */
	public function test_background_color_from_figure_wrapper(): void {
		$block = BlockConverter::convert_table_block(
			$this->table_block(
				array(),
				'<table>',
				'<figure class="wp-block-table has-background" style="background-color:#112233">'
			)
		);

		$this->assertSame( '#112233', $block['visual_settings']['background_color'] );
	}

	/**
	 * A table without a background colour sends no visual settings.
	 */
	public function test_no_background_color_sends_no_visual_settings(): void {
		$block = BlockConverter::convert_table_block( $this->table_block( array() ) );

		$this->assertArrayNotHasKey( 'visual_settings', $block );
	}
}
