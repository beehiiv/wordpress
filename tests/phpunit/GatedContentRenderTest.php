<?php
/**
 * Server render coverage for the gated content block.
 *
 * Gated Content Block PRD AC-007 to AC-015, AC-017, AC-020, AC-022 to AC-025, AC-028.
 *
 * @package beehiiv
 */

use Beehiiv\Admin\Options;
use Beehiiv\Blocks\GatedContent;
use Beehiiv\Config;

/**
 * @covers \Beehiiv\Blocks\GatedContent
 */
class GatedContentRenderTest extends WP_UnitTestCase {

	public function set_up(): void {
		parent::set_up();
		GatedContent::reset();
		wp_set_current_user( 0 );
		delete_option( Config::OPTION_NAME );
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
	 * AC-007: with no divider, the first inner block is the preview.
	 */
	public function test_first_block_is_preview_without_divider(): void {
		$html = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ) . $this->p( 'THREE' ) );

		$this->assertMatchesRegularExpression( '/ONE.*beehiiv-gated-content__gate/s', $html );
		$this->assertMatchesRegularExpression( '/beehiiv-gated-content__locked[^>]*>.*TWO.*THREE/s', $html );
		$this->assertDoesNotMatchRegularExpression( '/beehiiv-gated-content__locked[^>]*>[^<]*<p>ONE/s', $html );
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
		$this->assertStringContainsString( 'data-beehiiv-form="form_1"', $html );
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
	 * AC-025: only the first gated block counts.
	 */
	public function test_only_first_gate_counts(): void {
		$first  = $this->render_gate( $this->p( 'A1' ) . $this->p( 'A2' ) );
		$second = $this->render_gate( $this->p( 'B1' ) . $this->p( 'B2' ), 'form_2' );

		$this->assertStringContainsString( 'beehiiv-gated-content__gate', $first );
		$this->assertStringNotContainsString( 'beehiiv-gated-content__gate', $second );
		$this->assertStringContainsString( 'B2', $second );
	}

	/**
	 * AC-015 / edge cases: empty form ID or nothing to gate renders content ungated.
	 */
	public function test_no_gate_without_form_id_or_gated_content(): void {
		$no_form = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ), '' );
		$this->assertStringNotContainsString( 'beehiiv-gated-content__gate', $no_form );

		GatedContent::reset();
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

		GatedContent::reset();
		$html = $this->render_gate(
			$this->p( 'ONE' ) . $this->p( 'TWO' ),
			'form_1',
			',"cardBackgroundColor":"red;x:y","cardTextColor":"javascript:1"'
		);

		$this->assertStringNotContainsString( 'style="', explode( 'beehiiv-gated-content__card', $html )[1] ?? '' );
	}

	/**
	 * A repeat render of the same post (SEO, excerpt) must not consume the one-gate slot.
	 */
	public function test_repeat_render_of_same_gate_still_gates(): void {
		$inner = $this->p( 'ONE' ) . $this->p( 'TWO' );

		$first  = $this->render_gate( $inner );
		$second = $this->render_gate( $inner );

		$this->assertStringContainsString( 'data-beehiiv-gate', $first );
		$this->assertStringContainsString( 'data-beehiiv-gate', $second );
	}

	/**
	 * A block with no form ID of its own uses the default form ID from settings.
	 */
	public function test_blank_form_id_uses_settings_default(): void {
		update_option( Config::OPTION_NAME, Options::sanitize( array( 'gate_form_id' => 'default_form' ) ) );

		$html = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ), '' );

		$this->assertStringContainsString( 'data-form-id="default_form"', $html );

		GatedContent::reset();
		$html = $this->render_gate( $this->p( 'ONE' ) . $this->p( 'TWO' ), 'own_form' );

		$this->assertStringContainsString( 'data-form-id="own_form"', $html );
	}
}
