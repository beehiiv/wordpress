<?php
/**
 * Tests for core/quote block conversion.
 *
 * @package beehiiv
 */

namespace Beehiiv\Tests\Newsletter;

use Beehiiv\Newsletter\BlockConverter;
use PHPUnit\Framework\TestCase;

/**
 * @covers \Beehiiv\Newsletter\BlockConverter::convert_quote_block
 */
final class QuoteBlockConverterTest extends TestCase {

	/**
	 * Build a parse_blocks()-shaped core/quote block.
	 *
	 * WordPress stores the quote body as core/paragraph inner blocks and the
	 * citation as a `<cite>` element inside the block's saved HTML.
	 *
	 * @param array<int, string> $paragraph_html Inner paragraph HTML fragments.
	 * @param string             $inner_html     Saved quote block HTML (with any `<cite>`).
	 * @return array<string, mixed>
	 */
	private function quote_block( array $paragraph_html, string $inner_html ): array {
		$inner_blocks = [];

		foreach ( $paragraph_html as $html ) {
			$inner_blocks[] = [
				'blockName'    => 'core/paragraph',
				'attrs'        => [],
				'innerHTML'    => $html,
				'innerBlocks'  => [],
				'innerContent' => [ $html ],
			];
		}

		return [
			'blockName'    => 'core/quote',
			'attrs'        => [],
			'innerHTML'    => $inner_html,
			'innerBlocks'  => $inner_blocks,
			'innerContent' => [],
		];
	}

	public function test_citation_is_read_from_the_cite_element(): void {
		$block = $this->quote_block(
			[ '<p>The only way to do great work is to love what you do.</p>' ],
			'<blockquote class="wp-block-quote"><cite>Steve Jobs</cite></blockquote>'
		);

		$result = BlockConverter::convert_quote_block( $block );

		$this->assertSame( 'quote', $result['type'] );
		$this->assertSame( 'The only way to do great work is to love what you do.', $result['quote'] );
		$this->assertArrayHasKey( 'author', $result, 'The <cite> author must be preserved.' );
		$this->assertSame( 'Steve Jobs', $result['author'] );
	}

	public function test_multi_paragraph_quote_keeps_every_paragraph_and_invents_no_author(): void {
		$block = $this->quote_block(
			[ '<p>First line.</p>', '<p>Second paragraph, not a citation.</p>' ],
			'<blockquote class="wp-block-quote"></blockquote>'
		);

		$result = BlockConverter::convert_quote_block( $block );

		$this->assertSame( "First line.\nSecond paragraph, not a citation.", $result['quote'] );
		$this->assertArrayNotHasKey( 'author', $result, 'A second paragraph must not become the author.' );
	}

	public function test_quote_without_a_citation_has_no_author(): void {
		$block = $this->quote_block(
			[ '<p>A quote with no attribution.</p>' ],
			'<blockquote class="wp-block-quote"></blockquote>'
		);

		$result = BlockConverter::convert_quote_block( $block );

		$this->assertSame( 'A quote with no attribution.', $result['quote'] );
		$this->assertArrayNotHasKey( 'author', $result );
	}

	public function test_citation_inline_markup_is_flattened_to_plain_text(): void {
		$block = $this->quote_block(
			[ '<p>Stay hungry, stay foolish.</p>' ],
			'<blockquote class="wp-block-quote"><cite>Steve <strong>Jobs</strong></cite></blockquote>'
		);

		$result = BlockConverter::convert_quote_block( $block );

		$this->assertSame( 'Steve Jobs', $result['author'] );
	}

	public function test_empty_quote_is_omitted(): void {
		$block = $this->quote_block(
			[ '<p></p>' ],
			'<blockquote class="wp-block-quote"></blockquote>'
		);

		$this->assertSame( [], BlockConverter::convert_quote_block( $block ) );
	}
}
