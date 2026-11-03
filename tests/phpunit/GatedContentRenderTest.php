<?php
/**
 * Server render coverage for the gated content block.
 *
 * Gated Content Block PRD AC-007 to AC-015, AC-017, AC-020, AC-022 to AC-025, AC-028.
 *
 * @package beehiiv
 */

use Beehiiv\Admin\Options;
use Beehiiv\Config;

/**
 * @covers \Beehiiv\Blocks\GatedContent
 */
class GatedContentRenderTest extends WP_UnitTestCase {

	public function set_up(): void {
		parent::set_up();
		wp_set_current_user( 0 );
		delete_option( Config::OPTION_NAME );
		$this->register_test_blocks();
	}

	public function tear_down(): void {
		foreach ( [ 'beehiiv/gated-content', 'beehiiv/gated-content-divider' ] as $name ) {
			if ( WP_Block_Type_Registry::get_instance()->is_registered( $name ) ) {
				unregister_block_type( $name );
			}
		}

		parent::tear_down();
	}

	/**
	 * Register the blocks without the build folder, which CI does not create for PHPUnit.
	 */
	private function register_test_blocks(): void {
		$registry = WP_Block_Type_Registry::get_instance();

		if ( ! $registry->is_registered( 'beehiiv/gated-content' ) ) {
			register_block_type(
				'beehiiv/gated-content',
				[
					'attributes'      => [
						'formId'              => [ 'type' => 'string', 'default' => '' ],
						'headline'            => [ 'type' => 'string', 'default' => '' ],
						'text'                => [ 'type' => 'string', 'default' => '' ],
						'cardBackgroundColor' => [ 'type' => 'string', 'default' => '' ],
						'cardTextColor'       => [ 'type' => 'string', 'default' => '' ],
					],
					'render_callback' => [ \Beehiiv\Blocks\GatedContent::class, 'render' ],
				]
			);
		}

		if ( ! $registry->is_registered( 'beehiiv/gated-content-divider' ) ) {
			register_block_type(
				'beehiiv/gated-content-divider',
				[
					'parent'          => [ 'beehiiv/gated-content' ],
					'render_callback' => '__return_empty_string',
				]
			);
		}
	}

	/**
	 * Build the block markup for a gated block and render it.
	 *
	 * @param string $inner Inner block markup.
	 * @param string $form  Form ID.
	 * @param string $attrs Extra attributes JSON fragment.
	 * @return string
	 */
	private function render_gate( string $inner, string $form = 'form_1', string $attrs = '' ): string {
		$json = '{"formId":"' . $form . '"' . $attrs . '}';

		return do_blocks( '<!-- wp:beehiiv/gated-content ' . $json . ' -->' . $inner . '<!-- /wp:beehiiv/gated-content -->' );
	}

	private function p( string $text ): string {
		return '<!-- wp:paragraph --><p>' . $text . '</p><!-- /wp:paragraph -->';
	}

	private function divider(): string {
		return '<!-- wp:beehiiv/gated-content-divider /-->';
	}

	/**
	 * AC-007: with no divider, the whole block is gated and there is no preview.
	 */
	public function test_whole_block_is_gated_without_divider(): void {
		$html = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ) . $this->p( 'THREE' ) );

		$this->assertMatchesRegularExpression( '/beehiiv-gated-content__locked[^>]*>.*ONE.*TWO.*THREE/s', $html );
		$this->assertDoesNotMatchRegularExpression( '/ONE.*beehiiv-gated-content__gate/s', $html );
	}

	/**
	 * AC-009 / AC-014: a divider splits preview and gated content; gated content stays in the source.
	 */
	public function test_divider_splits_preview_and_locked(): void {
		$html = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ) . $this->divider() . $this->p( 'THREE' ) );

		$this->assertMatchesRegularExpression( '/ONE.*TWO.*beehiiv-gated-content__gate/s', $html );
		$this->assertMatchesRegularExpression( '/beehiiv-gated-content__locked[^>]*>.*THREE/s', $html );
		$this->assertStringNotContainsString( 'beehiiv-gate-divider', $html );
	}

	/**
	 * AC-012 / AC-013 / AC-026 to AC-028: gate card, locked container, inert and hidden from AT.
	 */
	public function test_markup_locks_content_and_carries_form_and_copy(): void {
		$html = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ) );

		$this->assertStringContainsString( 'data-form-id="form_1"', $html );
		// The inline boot script opens the gate for returning readers and starts the form loader.
		$this->assertStringContainsString( 'loader.js', $html );
		$this->assertStringContainsString( 'data-cookie-name="beehiiv_gate_unlocked"', $html );
		$this->assertStringContainsString( 'data-form-id="form_1"', $html );
		$this->assertStringContainsString( 'data-unlocked-message', $html );
		$this->assertStringContainsString( 'aria-hidden="true" inert', $html );
		$this->assertStringContainsString( 'data-cookie-days="30"', $html );
	}

	/**
	 * Blank headline and text leave no empty heading or paragraph in the card.
	 */
	public function test_blank_headline_and_text_are_not_rendered(): void {
		$html = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ) );

		$this->assertStringNotContainsString( 'beehiiv-gated-content__headline', $html );
		$this->assertStringNotContainsString( 'beehiiv-gated-content__text', $html );
		$this->assertStringContainsString( 'beehiiv-gated-content__card', $html );
	}

	/**
	 * AC-004 / AC-020: block copy overrides defaults; cookie lifetime comes from the settings.
	 */
	public function test_block_copy_and_site_defaults(): void {
		update_option(
			Config::OPTION_NAME,
			Options::sanitize(
				array(
					'gate_headline'    => 'Site headline',
					'gate_cookie_days' => '14',
				)
			)
		);

		$html = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ), 'form_1', ',"text":"Block text"' );

		$this->assertStringContainsString( 'Site headline', $html );
		$this->assertStringContainsString( 'Block text', $html );
		$this->assertStringContainsString( 'data-cookie-days="14"', $html );
	}

	/**
	 * AC-022: logged-in users see the content with no gate.
	 */
	public function test_logged_in_user_sees_no_gate(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );

		$html = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ) );

		$this->assertStringContainsString( 'TWO', $html );
		$this->assertStringNotContainsString( 'beehiiv-gated-content__gate', $html );
		$this->assertStringNotContainsString( 'inert', $html );
	}

	/**
	 * AC-025: every gated block on a page renders its own gate and form.
	 */
	public function test_each_gated_block_renders_its_own_gate(): void {
		$first  = $this->render_gate( $this->p( 'A1' ) . $this->p( 'A2' ) );
		$second = $this->render_gate( $this->p( 'B1' ) . $this->p( 'B2' ), 'form_2' );

		$this->assertStringContainsString( 'data-form-id="form_1"', $first );
		$this->assertStringContainsString( 'data-form-id="form_2"', $second );
		$this->assertStringContainsString( 'beehiiv-gated-content__gate', $second );
	}

	/**
	 * AC-015 / edge cases: empty form ID or nothing to gate renders content ungated.
	 */
	public function test_no_gate_without_form_id_or_gated_content(): void {
		$no_form = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ), '' );
		$this->assertStringNotContainsString( 'beehiiv-gated-content__gate', $no_form );

		$only_preview = $this->render_gate( $this->p( 'ONE' ) );
		$this->assertStringNotContainsString( 'beehiiv-gated-content__gate', $only_preview );
	}

	/**
	 * AC-008: a divider outside a gated block prints nothing.
	 */
	public function test_stray_divider_prints_nothing(): void {
		$this->assertSame( '', trim( do_blocks( $this->divider() ) ) );
	}

	/**
	 * AC-030 / AC-031: the card takes optional hex colors. Anything else is dropped.
	 */
	public function test_card_colors_are_applied_and_sanitized(): void {
		$html = $this->render_gate(
			$this->p( 'ONE' ) . $this->p( 'TWO' ),
			'form_1',
			',"cardBackgroundColor":"#112233","cardTextColor":"#ffffff"'
		);

		$this->assertStringContainsString( 'background-color:#112233', $html );
		$this->assertStringContainsString( 'color:#ffffff', $html );

		$html = $this->render_gate(
			$this->p( 'ONE' ) . $this->p( 'TWO' ),
			'form_1',
			',"cardBackgroundColor":"red;x:y","cardTextColor":"javascript:1"'
		);

		$this->assertStringNotContainsString( 'style="', explode( 'beehiiv-gated-content__card', $html )[1] ?? '' );
	}

	/**
	 * The headline is a styled paragraph, not a heading.
	 */
	public function test_headline_is_a_paragraph(): void {
		update_option( Config::OPTION_NAME, Options::sanitize( array( 'gate_headline' => 'Join' ) ) );

		$html = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ) );

		$this->assertStringContainsString( '<p class="beehiiv-gated-content__headline">Join</p>', $html );
		$this->assertStringNotContainsString( '<h2', $html );
	}

	/**
	 * Only the first divider splits the content; later dividers print nothing and change nothing.
	 */
	public function test_second_divider_is_ignored(): void {
		$html = $this->render_gate(
			$this->p( 'ONE' ) . $this->divider() . $this->p( 'TWO' ) . $this->divider() . $this->p( 'THREE' )
		);

		$this->assertMatchesRegularExpression( '/ONE.*beehiiv-gated-content__gate/s', $html );
		$this->assertMatchesRegularExpression( '/beehiiv-gated-content__locked[^>]*>.*TWO.*THREE/s', $html );
	}

	/**
	 * Two gated blocks with different forms each keep their own form ID.
	 */
	public function test_gates_with_different_forms_keep_their_own_form_id(): void {
		$first  = $this->render_gate( $this->p( 'A1' ) . $this->p( 'A2' ), 'form_1' );
		$second = $this->render_gate( $this->p( 'B1' ) . $this->p( 'B2' ), 'form_2' );

		$this->assertStringContainsString( 'data-form-id="form_1"', $first );
		$this->assertStringNotContainsString( 'data-form-id="form_2"', $first );
		$this->assertStringContainsString( 'data-form-id="form_2"', $second );
	}

	/**
	 * A block with no form ID of its own uses the default form ID from settings.
	 */
	public function test_blank_form_id_uses_settings_default(): void {
		update_option( Config::OPTION_NAME, Options::sanitize( array( 'gate_form_id' => 'default_form' ) ) );

		$html = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ), '' );

		$this->assertStringContainsString( 'data-form-id="default_form"', $html );

		$html = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ), 'own_form' );

		$this->assertStringContainsString( 'data-form-id="own_form"', $html );
	}
}
