<?php
/**
 * Unit coverage for the styling a Columns block sends as visual settings.
 *
 * Structured Content Block Conversion PRD, US-006 (AC-021 and AC-022): a Columns block's
 * background color, text color, padding, margin and border become the columns block's
 * visual settings.
 *
 * @package beehiiv
 */

use Beehiiv\Newsletter\BlockConverter;

/**
 * Columns block styling.
 *
 * @covers \Beehiiv\Newsletter\BlockConverter::convert_columns_block_to_blocks
 * @covers \Beehiiv\Newsletter\Converters\ColumnsStyleConverter
 */
class BlockConverterColumnsStyleTest extends WP_UnitTestCase {

	/**
	 * Build the saved markup for a Columns block with the given attributes and column count.
	 *
	 * @param array<string, mixed> $attrs   Columns block attributes.
	 * @param int                  $columns Number of columns.
	 * @param string               $style   Inline style on the wrapper.
	 * @param string               $classes   Extra classes on the wrapper.
	 * @return string
	 */
	private function columns_markup( array $attrs, int $columns = 2, string $style = '', string $classes = '' ): string {
		$json    = empty( $attrs ) ? '' : ' ' . wp_json_encode( $attrs );
		$style   = '' === $style ? '' : ' style="' . $style . '"';
		$classes = '' === $classes ? '' : ' ' . $classes;
		$inside  = '';

		for ( $i = 1; $i <= $columns; $i++ ) {
			$inside .= "<!-- wp:column -->\n<div class=\"wp-block-column\">"
				. "<!-- wp:paragraph -->\n<p>Column {$i}</p>\n<!-- /wp:paragraph -->"
				. "</div>\n<!-- /wp:column -->\n";
		}

		$open  = "<!-- wp:columns{$json} -->\n<div class=\"wp-block-columns{$classes}\"{$style}>";
		$close = "</div>\n<!-- /wp:columns -->";

		return $open . $inside . $close;
	}

	/**
	 * Convert a Columns block's markup to beehiiv blocks.
	 *
	 * @param array<string, mixed> $attrs   Columns block attributes.
	 * @param int                  $columns Number of columns.
	 * @param string               $style   Inline style on the wrapper.
	 * @param string               $classes   Extra classes on the wrapper.
	 * @return array<int, array<string, mixed>>
	 */
	private function convert( array $attrs, int $columns = 2, string $style = '', string $classes = '' ): array {
		$markup = $this->columns_markup( $attrs, $columns, $style, $classes );
		$blocks = parse_blocks( $markup );

		return BlockConverter::convert_columns_block_to_blocks( $blocks[0] );
	}

	/**
	 * The visual settings of the section that wraps the converted columns block.
	 *
	 * @param array<string, mixed> $attrs   Columns block attributes.
	 * @param int                  $columns Number of columns.
	 * @param string               $style   Inline style on the wrapper.
	 * @param string               $classes   Extra classes on the wrapper.
	 * @return array<string, mixed>
	 */
	private function visual_settings( array $attrs, int $columns = 2, string $style = '', string $classes = '' ): array {
		$blocks = $this->convert( $attrs, $columns, $style, $classes );

		$this->assertSame( 'section', $blocks[0]['type'] );
		$this->assertCount( 1, $blocks[0]['blocks'] );
		$this->assertSame( 'columns', $blocks[0]['blocks'][0]['type'] );
		$this->assertArrayNotHasKey( 'visual_settings', $blocks[0]['blocks'][0] );

		return $blocks[0]['visual_settings'];
	}

	/**
	 * A Columns block with no styling is sent as a plain columns block, with no section.
	 */
	public function test_unstyled_columns_have_no_visual_settings(): void {
		$blocks = $this->convert( array() );

		$this->assertSame( 'columns', $blocks[0]['type'] );
		$this->assertArrayNotHasKey( 'visual_settings', $blocks[0] );
	}

	/**
	 * Custom background and text colors become visual settings.
	 */
	public function test_custom_colors_become_visual_settings(): void {
		$settings = $this->visual_settings(
			array(
				'style' => array(
					'color' => array(
						'background' => '#ffeeaa',
						'text'       => '#112233',
					),
				),
			)
		);

		$this->assertSame( '#ffeeaa', $settings['background_color'] );
		$this->assertSame( '#112233', $settings['text_color'] );
	}

	/**
	 * Colors saved only in the wrapper's inline style are still read.
	 */
	public function test_colors_from_the_wrapper_style_are_read(): void {
		$settings = $this->visual_settings(
			array(),
			2,
			'background-color:#abcdef;color:#102030',
			'has-background has-text-color'
		);

		$this->assertSame( '#abcdef', $settings['background_color'] );
		$this->assertSame( '#102030', $settings['text_color'] );
	}

	/**
	 * Padding becomes inner spacing in whole pixels, side by side.
	 */
	public function test_padding_becomes_inner_spacing_in_pixels(): void {
		$settings = $this->visual_settings(
			array(
				'style' => array(
					'spacing' => array(
						'padding' => array(
							'top'    => '20px',
							'bottom' => '1.5rem',
							'left'   => '10px',
							'right'  => '2em',
						),
					),
				),
			)
		);

		$this->assertSame( 20, $settings['inner_spacing_top'] );
		$this->assertSame( 24, $settings['inner_spacing_bottom'] );
		$this->assertSame( 10, $settings['inner_spacing_left'] );
		$this->assertSame( 32, $settings['inner_spacing_right'] );
	}

	/**
	 * A single padding value applies to every side.
	 */
	public function test_single_padding_value_applies_to_every_side(): void {
		$settings = $this->visual_settings(
			array( 'style' => array( 'spacing' => array( 'padding' => '12px' ) ) )
		);

		foreach ( array( 'top', 'bottom', 'left', 'right' ) as $side ) {
			$this->assertSame( 12, $settings[ 'inner_spacing_' . $side ] );
		}
	}

	/**
	 * A side that cannot be turned into pixels is left out.
	 */
	public function test_padding_that_is_not_in_pixels_is_left_out(): void {
		$settings = $this->visual_settings(
			array(
				'style' => array(
					'spacing' => array(
						'padding' => array(
							'top'    => '10%',
							'bottom' => '20px',
							'left'   => '5vw',
							'right'  => 'auto',
						),
					),
				),
			)
		);

		$this->assertSame( 20, $settings['inner_spacing_bottom'] );
		$this->assertArrayNotHasKey( 'inner_spacing_top', $settings );
		$this->assertArrayNotHasKey( 'inner_spacing_left', $settings );
		$this->assertArrayNotHasKey( 'inner_spacing_right', $settings );
	}

	/**
	 * Margin becomes outer spacing, next to padding as inner spacing.
	 */
	public function test_margin_becomes_outer_spacing_in_pixels(): void {
		$settings = $this->visual_settings(
			array(
				'style' => array(
					'spacing' => array(
						'padding' => array( 'top' => '8px' ),
						'margin'  => array(
							'top'    => '30px',
							'bottom' => '2rem',
						),
					),
				),
			)
		);

		$this->assertSame( 8, $settings['inner_spacing_top'] );
		$this->assertSame( 30, $settings['outer_spacing_top'] );
		$this->assertSame( 32, $settings['outer_spacing_bottom'] );
		$this->assertArrayNotHasKey( 'outer_spacing_left', $settings );
	}

	/**
	 * A border sends its color, width, style and radius.
	 */
	public function test_border_becomes_visual_settings(): void {
		$settings = $this->visual_settings(
			array(
				'style' => array(
					'border' => array(
						'color'  => '#ff0000',
						'width'  => '2px',
						'style'  => 'dashed',
						'radius' => '6px',
					),
				),
			)
		);

		$this->assertSame( '#ff0000', $settings['border_color'] );
		$this->assertSame( 2, $settings['border_width'] );
		$this->assertSame( 'dashed', $settings['border_style'] );
		$this->assertSame( 6, $settings['border_radius'] );
	}

	/**
	 * A border with a color or width and no style is sent as solid.
	 */
	public function test_border_without_a_style_is_solid(): void {
		$settings = $this->visual_settings(
			array( 'style' => array( 'border' => array( 'width' => '1px' ) ) )
		);

		$this->assertSame( 'solid', $settings['border_style'] );
		$this->assertSame( 1, $settings['border_width'] );
	}

	/**
	 * A border style beehiiv does not accept is not sent.
	 */
	public function test_unsupported_border_style_is_not_sent(): void {
		$settings = $this->visual_settings(
			array(
				'style' => array(
					'border' => array(
						'width' => '2px',
						'style' => 'double',
					),
				),
			)
		);

		$this->assertArrayNotHasKey( 'border_style', $settings );
	}

	/**
	 * Widths and radii can be set per side and per corner.
	 */
	public function test_border_widths_and_radii_can_be_set_per_side_and_corner(): void {
		$settings = $this->visual_settings(
			array(
				'style' => array(
					'border' => array(
						'top'    => array( 'width' => '1px' ),
						'right'  => array( 'width' => '2px' ),
						'radius' => array(
							'topLeft'     => '4px',
							'bottomRight' => '8px',
						),
					),
				),
			)
		);

		$this->assertSame( 1, $settings['border_width_top'] );
		$this->assertSame( 2, $settings['border_width_right'] );
		$this->assertSame( 4, $settings['border_radius_top_left'] );
		$this->assertSame( 8, $settings['border_radius_bottom_right'] );
		$this->assertArrayNotHasKey( 'border_radius_top_right', $settings );
	}

	/**
	 * Border colors and styles that differ by side are not sent.
	 */
	public function test_border_colors_and_styles_that_differ_by_side_are_not_sent(): void {
		$settings = $this->visual_settings(
			array(
				'style' => array(
					'border' => array(
						'top'    => array(
							'width' => '1px',
							'color' => '#ff0000',
							'style' => 'solid',
						),
						'bottom' => array(
							'width' => '1px',
							'color' => '#00ff00',
							'style' => 'dotted',
						),
					),
				),
			)
		);

		$this->assertArrayNotHasKey( 'border_color', $settings );
		$this->assertSame( 'solid', $settings['border_style'] );
	}

	/**
	 * A border radius in percent is not sent.
	 */
	public function test_border_radius_in_percent_is_not_sent(): void {
		$settings = $this->visual_settings(
			array(
				'style' => array(
					'border' => array(
						'width'  => '1px',
						'radius' => '50%',
					),
				),
			)
		);

		$this->assertArrayNotHasKey( 'border_radius', $settings );
	}

	/**
	 * Styling does not change how the columns inside the section convert.
	 */
	public function test_styling_does_not_change_the_columns(): void {
		$blocks = $this->convert(
			array( 'style' => array( 'color' => array( 'background' => '#ffeeaa' ) ) ),
			3
		);

		$this->assertCount( 1, $blocks );
		$this->assertSame( 'section', $blocks[0]['type'] );
		$columns = $blocks[0]['blocks'][0];
		$this->assertCount( 3, $columns['columns'] );
		$this->assertTrue( $columns['stackOnMobile'] );
	}

	/**
	 * A styled Columns block with more than 3 columns is still omitted.
	 */
	public function test_styled_columns_with_more_than_three_columns_are_omitted(): void {
		$blocks = $this->convert(
			array( 'style' => array( 'color' => array( 'background' => '#ffeeaa' ) ) ),
			4
		);

		$this->assertSame( array(), $blocks );
	}

	/**
	 * Styling that cannot be converted leaves a plain columns block, with no empty section.
	 */
	public function test_styling_that_cannot_be_converted_sends_no_section(): void {
		$blocks = $this->convert(
			array( 'style' => array( 'spacing' => array( 'padding' => '10%' ) ) )
		);

		$this->assertCount( 1, $blocks );
		$this->assertSame( 'columns', $blocks[0]['type'] );
	}

	/**
	 * A styled Columns block with nothing convertible inside sends no section and no columns block.
	 */
	public function test_styled_columns_with_nothing_convertible_send_nothing(): void {
		$markup = '<!-- wp:columns {"style":{"color":{"background":"#ffeeaa"}}} -->'
			. '<div class="wp-block-columns"><!-- wp:column --><div class="wp-block-column">'
			. '<!-- wp:spacer --><div class="wp-block-spacer"></div><!-- /wp:spacer -->'
			. '</div><!-- /wp:column --></div><!-- /wp:columns -->';
		$blocks = parse_blocks( $markup );

		$this->assertSame( array(), BlockConverter::convert_columns_block_to_blocks( $blocks[0] ) );
	}
}
