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
	 * Theme preset filter added by a test, removed in tear_down.
	 *
	 * @var callable|null
	 */
	private $theme_json_filter = null;

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
	 * AC-010: a Group inside a Group is omitted, because a beehiiv section cannot hold a section.
	 */
	public function test_nested_group_is_omitted_with_its_content(): void {
		$inner = $this->group( $this->paragraph( 'Deep' ) );
		$post  = $this->create_post( $this->group( $this->paragraph( 'Top' ) . $inner . $this->paragraph( 'Last' ) ) );

		$blocks = BlockConverter::convert_supported_blocks( $post, true );

		$this->assertCount( 1, $blocks );
		$this->assertSame( 'section', $blocks[0]['type'] );
		$this->assertSame(
			array( 'paragraph', 'paragraph' ),
			array_column( $blocks[0]['blocks'], 'type' )
		);
		$this->assertStringNotContainsString( 'Deep', wp_json_encode( $blocks ) );
	}

	/**
	 * AC-010: no section is nested at any depth, and a Group holding only a nested Group sends nothing.
	 */
	public function test_no_section_is_nested_at_any_depth(): void {
		$deep = $this->group( $this->group( $this->group( $this->paragraph( 'Deep' ) ) ) );
		$post = $this->create_post( $this->paragraph( 'Kept' ) . $deep );

		$blocks = BlockConverter::convert_supported_blocks( $post, true );

		$this->assertSame( array( 'paragraph' ), array_column( $blocks, 'type' ) );
	}

	/**
	 * Build a styled Group block's markup from block attributes and the wrapper class and style.
	 *
	 * @param array<string, mixed> $attrs Group block attributes.
	 * @param string               $class Extra wrapper classes.
	 * @param string               $style Wrapper inline style.
	 * @return string
	 */
	private function styled_group( array $attrs, string $class = '', string $style = '' ): string {
		$style_attr = '' === $style ? '' : ' style="' . $style . '"';

		return '<!-- wp:group ' . wp_json_encode( $attrs ) . " -->\n"
			. '<div class="wp-block-group' . $class . '"' . $style_attr . '>'
			. $this->paragraph( 'Styled' )
			. "</div>\n<!-- /wp:group -->";
	}

	/**
	 * Convert one styled Group and return its section block.
	 *
	 * @param string $content Group block markup.
	 * @return array<string, mixed>
	 */
	private function convert_to_section( string $content ): array {
		$blocks = BlockConverter::convert_supported_blocks( $this->create_post( $content ), true );

		$this->assertSame( 'section', $blocks[0]['type'] );

		return $blocks[0];
	}

	/**
	 * AC-011: an unstyled Group sends a section without visual settings.
	 */
	public function test_unstyled_group_has_no_visual_settings(): void {
		$section = $this->convert_to_section( $this->group( $this->paragraph( 'Plain' ) ) );

		$this->assertSame( array( 'type', 'blocks' ), array_keys( $section ) );
	}

	/**
	 * AC-011: a custom background colour and text colour become the section's colours.
	 */
	public function test_custom_colors_become_visual_settings(): void {
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'color' => array(
							'background' => '#112233',
							'text'       => '#ffeedd',
						),
					),
				),
				' has-text-color has-background',
				'color:#ffeedd;background-color:#112233'
			)
		);

		$this->assertSame(
			array(
				'background_color' => '#112233',
				'text_color'       => '#ffeedd',
			),
			$section['visual_settings']
		);
	}

	/**
	 * AC-011: a palette colour is sent as its colour value, not its slug.
	 */
	public function test_palette_colors_are_sent_as_color_values(): void {
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'backgroundColor' => 'vivid-red',
					'textColor'       => 'white',
				),
				' has-white-color has-vivid-red-background-color has-text-color has-background'
			)
		);

		$this->assertMatchesRegularExpression( '/^#[0-9a-f]{3,8}$/i', $section['visual_settings']['background_color'] );
		$this->assertMatchesRegularExpression( '/^#[0-9a-f]{3,8}$/i', $section['visual_settings']['text_color'] );
	}

	/**
	 * AC-011: padding on each side becomes whole-pixel inner spacing, converting rem and em.
	 */
	public function test_padding_becomes_inner_spacing_in_pixels(): void {
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'spacing' => array(
							'padding' => array(
								'top'    => '40px',
								'bottom' => '2.5rem',
								'left'   => '1em',
								'right'  => '0',
							),
						),
					),
				)
			)
		);

		$this->assertSame(
			array(
				'inner_spacing_top'    => 40,
				'inner_spacing_bottom' => 40,
				'inner_spacing_left'   => 16,
				'inner_spacing_right'  => 0,
			),
			$section['visual_settings']
		);
	}

	/**
	 * AC-011: a single padding value applies to every side.
	 */
	public function test_single_padding_value_applies_to_every_side(): void {
		$section = $this->convert_to_section(
			$this->styled_group( array( 'style' => array( 'spacing' => array( 'padding' => '24px' ) ) ) )
		);

		$this->assertSame(
			array(
				'inner_spacing_top'    => 24,
				'inner_spacing_bottom' => 24,
				'inner_spacing_left'   => 24,
				'inner_spacing_right'  => 24,
			),
			$section['visual_settings']
		);
	}

	/**
	 * AC-011: padding that cannot become pixels is left out, so beehiiv keeps its default for that side.
	 *
	 * A fluid `clamp()` is not left out: it is sent at its maximum, see the fluid size test.
	 */
	public function test_padding_that_is_not_in_pixels_is_left_out(): void {
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'spacing' => array(
							'padding' => array(
								'top'    => '10%',
								'bottom' => '5vw',
								'left'   => 'clamp(1rem, 2vw, 3rem)',
								'right'  => '30px',
							),
						),
					),
				)
			)
		);

		$this->assertSame(
			array(
				'inner_spacing_left'  => 48,
				'inner_spacing_right' => 30,
			),
			$section['visual_settings']
		);
	}

	/**
	 * AC-011: margin on each side becomes whole-pixel outer spacing, converting rem and em.
	 */
	public function test_margin_becomes_outer_spacing_in_pixels(): void {
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'spacing' => array(
							'margin' => array(
								'top'    => '12px',
								'bottom' => '1.5rem',
								'left'   => '1em',
								'right'  => '0',
							),
						),
					),
				)
			)
		);

		$this->assertEquals(
			array(
				'outer_spacing_top'    => 12,
				'outer_spacing_bottom' => 24,
				'outer_spacing_left'   => 16,
				'outer_spacing_right'  => 0,
			),
			$section['visual_settings']
		);
	}

	/**
	 * AC-011: padding and margin are sent together as inner and outer spacing.
	 */
	public function test_padding_and_margin_are_sent_as_inner_and_outer_spacing(): void {
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'spacing' => array(
							'padding' => array(
								'top'    => '20px',
								'bottom' => '20px',
							),
							'margin'  => array(
								'top'    => '40px',
								'bottom' => '8px',
							),
						),
					),
				)
			)
		);

		$this->assertEquals(
			array(
				'inner_spacing_top'    => 20,
				'inner_spacing_bottom' => 20,
				'outer_spacing_top'    => 40,
				'outer_spacing_bottom' => 8,
			),
			$section['visual_settings']
		);
	}

	/**
	 * AC-011: a spacing preset margin is sent as pixels, and a margin that cannot become pixels is left out.
	 */
	public function test_margin_presets_convert_and_unusable_margins_are_left_out(): void {
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'spacing' => array(
							'margin' => array(
								'top'    => 'auto',
								'bottom' => '-10px',
								'left'   => '5%',
								'right'  => '16px',
							),
						),
					),
				)
			)
		);

		$this->assertEquals( array( 'outer_spacing_right' => 16 ), $section['visual_settings'] );
	}

	/**
	 * Make the theme define its own spacing sizes and palette colours.
	 *
	 * The theme turns WordPress's default spacing sizes and palette off, redefines the `40`
	 * spacing size and the `vivid-red` colour, and adds sizes and a colour with its own names.
	 * While the defaults are on, WordPress ignores a theme entry that reuses a default slug.
	 * The cached preset maps are cleared so the converter reads the new settings.
	 */
	private function use_theme_presets(): void {
		$filter = static function ( $theme_json ) {
			return $theme_json->update_with(
				array(
					'version'  => 3,
					'settings' => array(
						'spacing' => array(
							'defaultSpacingSizes' => false,
							'spacingSizes'        => array(
								array(
									'name' => 'Small',
									'slug' => '40',
									'size' => '2rem',
								),
								array(
									'name' => 'Small',
									'slug' => 'small',
									'size' => '10px',
								),
								array(
									'name' => 'Large',
									'slug' => 'large',
									'size' => '1.5em',
								),
								array(
									'name' => 'Fluid',
									'slug' => 'fluid',
									'size' => 'clamp(30px, 5vw, 50px)',
								),
								array(
									'name' => 'Capped',
									'slug' => 'capped',
									'size' => 'min(1.5rem, 2vw)',
								),
							),
						),
						'color'   => array(
							'defaultPalette' => false,
							'palette'        => array(
								array(
									'name'  => 'Vivid red',
									'slug'  => 'vivid-red',
									'color' => '#aa0000',
								),
								array(
									'name'  => 'Brand',
									'slug'  => 'brand',
									'color' => '#123456',
								),
							),
						),
					),
				)
			);
		};

		add_filter( 'wp_theme_json_data_theme', $filter );
		$this->theme_json_filter = $filter;

		WP_Theme_JSON_Resolver::clean_cached_data();
		$this->reset_preset_caches();
	}

	/**
	 * Clear the converters' cached spacing and colour preset maps.
	 */
	private function reset_preset_caches(): void {
		foreach (
			array(
				\Beehiiv\Newsletter\Converters\GroupBlockConverter::class => 'spacing_preset_map',
				\Beehiiv\Newsletter\FormattedTextParser::class => 'color_preset_map',
			) as $class => $property
		) {
			$reflection = new ReflectionProperty( $class, $property );
			$reflection->setAccessible( true );
			$reflection->setValue( null, null );
		}
	}

	/**
	 * Remove the theme preset filter and the cached maps after a test.
	 */
	public function tear_down(): void {
		if ( null !== $this->theme_json_filter ) {
			remove_filter( 'wp_theme_json_data_theme', $this->theme_json_filter );
			$this->theme_json_filter = null;
		}

		WP_Theme_JSON_Resolver::clean_cached_data();
		$this->reset_preset_caches();

		parent::tear_down();
	}

	/**
	 * AC-011: a theme spacing size named in a Group's padding and margin is sent as that theme's size.
	 *
	 * The padding on the right names `50`, which this theme no longer defines, so it is left out.
	 */
	public function test_theme_spacing_sizes_are_used_by_slug(): void {
		$this->use_theme_presets();

		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'spacing' => array(
							'padding' => array(
								'top'    => 'var:preset|spacing|small',
								'bottom' => 'var:preset|spacing|large',
								'left'   => 'var:preset|spacing|40',
								'right'  => 'var:preset|spacing|50',
							),
							'margin'  => array(
								'top'    => 'var(--wp--preset--spacing--small)',
								'bottom' => 'var:preset|spacing|40',
							),
						),
					),
				)
			)
		);

		$this->assertEquals(
			array(
				'inner_spacing_top'    => 10,
				'inner_spacing_bottom' => 24,
				'inner_spacing_left'   => 32,
				'outer_spacing_top'    => 10,
				'outer_spacing_bottom' => 32,
			),
			$section['visual_settings']
		);
	}

	/**
	 * AC-011: a theme colour named in a Group's colours and border is sent as that theme's colour value.
	 */
	public function test_theme_colors_are_used_by_slug(): void {
		$this->use_theme_presets();

		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'backgroundColor' => 'brand',
					'textColor'       => 'vivid-red',
					'borderColor'     => 'vivid-red',
					'style'           => array( 'border' => array( 'width' => '1px' ) ),
				)
			)
		);

		$this->assertSame( '#123456', $section['visual_settings']['background_color'] );
		$this->assertSame( '#aa0000', $section['visual_settings']['text_color'] );
		$this->assertSame( '#aa0000', $section['visual_settings']['border_color'] );
	}

	/**
	 * AC-011: a fluid size is sent at its widest value, because a newsletter has no responsive spacing.
	 */
	public function test_fluid_sizes_are_sent_at_their_widest_value(): void {
		$cases = array(
			'clamp(30px, 5vw, 50px)' => 50,
			'clamp(1.8rem, 1.8rem + ((1vw - 0.48rem) * 2.885), 3rem)' => 48,
			'min(1.5rem, 2vw)'       => 24,
			'min(2rem, 3rem)'        => 32,
			'max(10px, 2rem)'        => 32,
			'MIN( 20px , 4vw )'      => 20,
		);

		foreach ( $cases as $value => $expected ) {
			$section = $this->convert_to_section(
				$this->styled_group( array( 'style' => array( 'spacing' => array( 'padding' => array( 'top' => $value ) ) ) ) )
			);

			$this->assertSame( array( 'inner_spacing_top' => $expected ), $section['visual_settings'], $value );
		}
	}

	/**
	 * AC-011: a size with no fixed length in it cannot be sent, so beehiiv keeps its default.
	 */
	public function test_sizes_without_a_fixed_length_are_left_out(): void {
		foreach ( array( 'calc(1rem + 2vw)', 'min(2vw, 3vw)', 'clamp(1rem, 2vw)', 'var(--custom-gap)' ) as $value ) {
			$section = $this->convert_to_section(
				$this->styled_group( array( 'style' => array( 'spacing' => array( 'padding' => array( 'top' => $value ) ) ) ) )
			);

			$this->assertSame( array( 'type', 'blocks' ), array_keys( $section ), $value );
		}
	}

	/**
	 * AC-011: a theme's fluid spacing sizes are sent at their widest value.
	 */
	public function test_theme_fluid_spacing_sizes_are_sent_at_their_widest_value(): void {
		$this->use_theme_presets();

		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'spacing' => array(
							'padding' => array(
								'top'    => 'var:preset|spacing|fluid',
								'bottom' => 'var:preset|spacing|capped',
							),
						),
					),
				)
			)
		);

		$this->assertEquals(
			array(
				'inner_spacing_top'    => 50,
				'inner_spacing_bottom' => 24,
			),
			$section['visual_settings']
		);
	}

	/**
	 * AC-015: border colour, width, style and radius become the section's border settings.
	 */
	public function test_border_becomes_visual_settings(): void {
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'border' => array(
							'color'  => '#112233',
							'width'  => '3px',
							'style'  => 'dashed',
							'radius' => '8px',
						),
					),
				)
			)
		);

		$this->assertEquals(
			array(
				'border_color'  => '#112233',
				'border_width'  => 3,
				'border_style'  => 'dashed',
				'border_radius' => 8,
			),
			$section['visual_settings']
		);
	}

	/**
	 * AC-015: a border with a width or colour but no style is sent as solid, as WordPress draws it.
	 */
	public function test_border_without_a_style_is_solid(): void {
		$section = $this->convert_to_section(
			$this->styled_group( array( 'style' => array( 'border' => array( 'width' => '2px' ) ) ) )
		);

		$this->assertEquals(
			array(
				'border_width' => 2,
				'border_style' => 'solid',
			),
			$section['visual_settings']
		);
	}

	/**
	 * AC-015: a border style beehiiv does not accept is not sent, and does not default to solid.
	 */
	public function test_unsupported_border_style_is_not_sent(): void {
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'border' => array(
							'width' => '4px',
							'style' => 'double',
						),
					),
				)
			)
		);

		$this->assertEquals( array( 'border_width' => 4 ), $section['visual_settings'] );
	}

	/**
	 * AC-015: widths set per side and radii set per corner are sent per side and corner.
	 */
	public function test_border_widths_and_radii_can_be_set_per_side_and_corner(): void {
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'border' => array(
							'top'    => array(
								'width' => '2px',
								'color' => '#445566',
								'style' => 'dotted',
							),
							'bottom' => array(
								'width' => '1rem',
								'color' => '#445566',
								'style' => 'dotted',
							),
							'radius' => array(
								'topLeft'     => '4px',
								'topRight'    => '8px',
								'bottomLeft'  => '1rem',
								'bottomRight' => '10%',
							),
						),
					),
				)
			)
		);

		$this->assertEquals(
			array(
				'border_width_top'          => 2,
				'border_width_bottom'       => 16,
				'border_color'              => '#445566',
				'border_style'              => 'dotted',
				'border_radius_top_left'    => 4,
				'border_radius_top_right'   => 8,
				'border_radius_bottom_left' => 16,
			),
			$section['visual_settings']
		);
	}

	/**
	 * AC-015: sides with different colours or styles cannot be sent, so beehiiv keeps its defaults.
	 */
	public function test_border_colors_and_styles_that_differ_by_side_are_not_sent(): void {
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'border' => array(
							'top'    => array(
								'width' => '2px',
								'color' => '#111111',
								'style' => 'solid',
							),
							'bottom' => array(
								'width' => '2px',
								'color' => '#222222',
								'style' => 'dashed',
							),
						),
					),
				)
			)
		);

		$this->assertEquals(
			array(
				'border_width_top'    => 2,
				'border_width_bottom' => 2,
				'border_style'        => 'solid',
			),
			$section['visual_settings']
		);
	}

	/**
	 * AC-015: a palette border colour is sent as its colour value, not its slug.
	 */
	public function test_palette_border_color_is_sent_as_a_color_value(): void {
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'borderColor' => 'vivid-red',
					'style'       => array( 'border' => array( 'width' => '1px' ) ),
				),
				' has-border-color has-vivid-red-border-color'
			)
		);

		$this->assertMatchesRegularExpression( '/^#[0-9a-f]{3,8}$/i', $section['visual_settings']['border_color'] );
		$this->assertSame( 'solid', $section['visual_settings']['border_style'] );
	}

	/**
	 * AC-015: a split border (a different width on each side) with palette colours sends the colour value.
	 *
	 * The editor stores palette colours on a split border as `var:preset|color|slug` on each side.
	 */
	public function test_split_border_with_palette_colors_sends_the_color_value(): void {
		$side    = static function ( string $width ): array {
			return array(
				'color' => 'var:preset|color|vivid-red',
				'width' => $width,
			);
		};
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'border' => array(
							'top'    => $side( '1px' ),
							'right'  => $side( '3px' ),
							'bottom' => $side( '5px' ),
							'left'   => $side( '7px' ),
						),
					),
				)
			)
		);

		$settings = $section['visual_settings'];

		$this->assertMatchesRegularExpression( '/^#[0-9a-f]{3,8}$/i', $settings['border_color'] );
		$this->assertSame( 1, $settings['border_width_top'] );
		$this->assertSame( 3, $settings['border_width_right'] );
		$this->assertSame( 5, $settings['border_width_bottom'] );
		$this->assertSame( 7, $settings['border_width_left'] );
		$this->assertSame( 'solid', $settings['border_style'] );
	}

	/**
	 * AC-015: a split border with the same custom colour on every side sends that colour.
	 */
	public function test_split_border_with_the_same_custom_color_sends_it(): void {
		$side    = static function ( string $width ): array {
			return array(
				'color' => '#0a0b0c',
				'width' => $width,
			);
		};
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'border' => array(
							'top'    => $side( '2px' ),
							'bottom' => $side( '6px' ),
						),
					),
				)
			)
		);

		$this->assertSame( '#0a0b0c', $section['visual_settings']['border_color'] );
		$this->assertSame( 2, $section['visual_settings']['border_width_top'] );
		$this->assertSame( 6, $section['visual_settings']['border_width_bottom'] );
	}

	/**
	 * AC-015: a palette variable on the whole border is sent as its colour value.
	 */
	public function test_palette_variable_on_the_whole_border_is_resolved(): void {
		$section = $this->convert_to_section(
			$this->styled_group(
				array(
					'style' => array(
						'border' => array(
							'color' => 'var:preset|color|vivid-red',
							'width' => '2px',
						),
					),
				)
			)
		);

		$this->assertMatchesRegularExpression( '/^#[0-9a-f]{3,8}$/i', $section['visual_settings']['border_color'] );
	}

	/**
	 * AC-015: a radius in percent cannot become pixels, so it is not sent.
	 */
	public function test_border_radius_in_percent_is_not_sent(): void {
		$section = $this->convert_to_section(
			$this->styled_group( array( 'style' => array( 'border' => array( 'radius' => '50%' ) ) ) )
		);

		$this->assertSame( array( 'type', 'blocks' ), array_keys( $section ) );
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
