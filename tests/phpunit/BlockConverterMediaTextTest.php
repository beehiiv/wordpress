<?php
/**
 * Unit coverage for Media & Text blocks without a valid image.
 *
 * Structured Content Block Conversion PRD, AC-009 and BR-008.
 *
 * @package beehiiv
 */

use Beehiiv\Newsletter\BlockConverter;

/**
 * Media & Text with no valid image URL is omitted.
 *
 * @covers \Beehiiv\Newsletter\BlockConverter::convert_media_text_block
 */
class BlockConverterMediaTextTest extends WP_UnitTestCase {

	/**
	 * Build a parsed core/media-text block.
	 *
	 * @param string $media_html Media figure inner HTML.
	 * @return array<string, mixed>
	 */
	private function media_text_block( string $media_html ): array {
		$html = '<div class="wp-block-media-text"><figure class="wp-block-media-text__media">'
			. $media_html . '</figure><div class="wp-block-media-text__content"></div></div>';

		return array(
			'blockName'   => 'core/media-text',
			'attrs'       => array(
				'mediaType'  => 'image',
				'mediaWidth' => 30,
			),
			'innerBlocks' => array(
				array(
					'blockName'   => 'core/paragraph',
					'attrs'       => array(),
					'innerBlocks' => array(),
					'innerHTML'   => '<p>Side text</p>',
				),
			),
			'innerHTML'   => $html,
		);
	}

	/**
	 * With no image URL the whole block is omitted, text included.
	 */
	public function test_media_text_without_image_url_is_omitted(): void {
		$this->assertSame( array(), BlockConverter::convert_media_text_block( $this->media_text_block( '' ) ) );
	}

	/**
	 * With a valid image URL the block converts to a columns block.
	 */
	public function test_media_text_with_image_url_converts(): void {
		$block = BlockConverter::convert_media_text_block(
			$this->media_text_block( '<img src="https://example.com/a.jpg" alt=""/>' )
		);

		$this->assertSame( 'columns', $block['type'] );
		$this->assertCount( 2, $block['columns'] );
	}
}
