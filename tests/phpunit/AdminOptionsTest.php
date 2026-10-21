<?php
/**
 * Unit coverage for the plugin settings option.
 *
 * Publication and Template Configuration PRD AC-015, AC-016, AC-019.
 *
 * @package beehiiv
 */

use Beehiiv\Admin\Options;
use Beehiiv\Admin\Registrar;
use Beehiiv\Config;

/**
 * @covers \Beehiiv\Admin\Options
 * @covers \Beehiiv\Admin\Registrar
 */
class AdminOptionsTest extends WP_UnitTestCase {

	public function tear_down(): void {
		delete_option( Config::OPTION_NAME );
		parent::tear_down();
	}

	/**
	 * AC-015: a site that never saved the setting reads it as off.
	 */
	public function test_require_template_choice_defaults_to_off(): void {
		delete_option( Config::OPTION_NAME );

		$this->assertFalse( Options::get()['require_template_choice'] );
	}

	/**
	 * AC-015: a saved option without the new key still reads as off.
	 */
	public function test_saved_option_without_key_reads_as_off(): void {
		update_option(
			Config::OPTION_NAME,
			array(
				'publication_id'   => 'pub_1',
				'post_template_id' => 'tpl_1',
			)
		);

		$this->assertFalse( Options::get()['require_template_choice'] );
	}

	/**
	 * AC-016: checking the box saves the setting as on.
	 */
	public function test_sanitize_saves_checked_box_as_on(): void {
		$saved = Options::sanitize(
			array(
				'publication_id'          => 'pub_1',
				'post_template_id'        => 'tpl_1',
				'require_template_choice' => '1',
			)
		);

		$this->assertTrue( $saved['require_template_choice'] );
	}

	/**
	 * AC-016: an unchecked box (hidden 0, or missing) saves as off.
	 */
	public function test_sanitize_saves_unchecked_box_as_off(): void {
		$with_zero = Options::sanitize(
			array(
				'publication_id'          => 'pub_1',
				'require_template_choice' => '0',
			)
		);
		$missing   = Options::sanitize( array( 'publication_id' => 'pub_1' ) );

		$this->assertFalse( $with_zero['require_template_choice'] );
		$this->assertFalse( $missing['require_template_choice'] );
	}

	/**
	 * AC-016: the saved value persists through the option.
	 */
	public function test_saved_value_persists(): void {
		update_option(
			Config::OPTION_NAME,
			Options::sanitize( array( 'require_template_choice' => '1' ) )
		);

		$this->assertTrue( Options::get()['require_template_choice'] );
	}

	/**
	 * AC-019: toggling the setting leaves publication and template untouched.
	 */
	public function test_toggle_does_not_change_other_selections(): void {
		$on  = Options::sanitize(
			array(
				'publication_id'          => 'pub_1',
				'post_template_id'        => 'tpl_1',
				'require_template_choice' => '1',
			)
		);
		$off = Options::sanitize(
			array(
				'publication_id'          => 'pub_1',
				'post_template_id'        => 'tpl_1',
				'require_template_choice' => '0',
			)
		);

		$this->assertSame( 'pub_1', $on['publication_id'] );
		$this->assertSame( 'tpl_1', $on['post_template_id'] );
		$this->assertSame( 'pub_1', $off['publication_id'] );
		$this->assertSame( 'tpl_1', $off['post_template_id'] );
	}

	/**
	 * AC-014, AC-017: the field shows the toggle label and the help text.
	 */
	public function test_field_renders_label_and_help_text(): void {
		ob_start();
		Registrar::render_require_template_choice_field();
		$html = (string) ob_get_clean();

		$this->assertStringContainsString( 'Require editors to choose a post template', $html );
		$this->assertStringContainsString( 'editors must pick a template for each new post', $html );
		$this->assertStringContainsString( 'default template is not applied automatically', $html );
		$this->assertStringContainsString( 'sending is blocked until a template is chosen', $html );
		$this->assertStringNotContainsString( 'checked', $html );
	}

	/**
	 * AC-016: a saved on state shows the box checked.
	 */
	public function test_field_renders_checked_when_on(): void {
		update_option(
			Config::OPTION_NAME,
			Options::sanitize( array( 'require_template_choice' => '1' ) )
		);

		ob_start();
		Registrar::render_require_template_choice_field();
		$html = (string) ob_get_clean();

		$this->assertStringContainsString( "checked='checked'", $html );
	}
}
