<?php
/**
 * Unit coverage for empty paragraph blocks in newsletter conversion.
 *
 * Block Conversion Framework PRD, AC-005.
 *
 * @package beehiiv
 */

use Beehiiv\Newsletter\BlockConverter;

/**
 * Empty and whitespace-only paragraph blocks are omitted.
 *
 * @covers \Beehiiv\Newsletter\BlockConverter::convert_paragraph_block
 */
class BlockConverterParagraphTest extends WP_UnitTestCase {

	/**
	 * Build a parsed core/paragraph block.
	 *
	 * @param string $inner_html Saved paragraph HTML.
	 * @return array<string, mixed>
	 */
	private function paragraph_block( string $inner_html ): array {
		return array(
			'blockName'   => 'core/paragraph',
			'attrs'       => array(),
			'innerBlocks' => array(),
			'innerHTML'   => $inner_html,
		);
	}

	/**
	 * Paragraphs with no visible text are omitted.
	 *
	 * @return array<string, array<int, string>>
	 */
	public function blank_paragraph_provider(): array {
		return array(
			'empty'              => array( '<p></p>' ),
			'spaces'             => array( '<p>   </p>' ),
			'non-breaking space' => array( '<p>&nbsp;</p>' ),
			'spaces and nbsp'    => array( '<p>   &nbsp;  </p>' ),
			'several nbsp'       => array( '<p>&nbsp;&nbsp;</p>' ),
		);
	}

	/**
	 * A paragraph with no visible text is omitted.
	 *
	 * @dataProvider blank_paragraph_provider
	 *
	 * @param string $inner_html Saved paragraph HTML.
	 */
	public function test_blank_paragraph_is_omitted( string $inner_html ): void {
		$this->assertSame( array(), BlockConverter::convert_paragraph_block( $this->paragraph_block( $inner_html ) ) );
	}

	/**
	 * A paragraph with real text is kept.
	 */
	public function test_paragraph_with_text_is_kept(): void {
		$block = BlockConverter::convert_paragraph_block( $this->paragraph_block( '<p>Real&nbsp;text</p>' ) );

		$this->assertSame( 'paragraph', $block['type'] );
	}
}
