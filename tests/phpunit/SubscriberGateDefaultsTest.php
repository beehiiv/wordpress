<?php
/**
 * Unit coverage for the Subscriber gating defaults.
 *
 * Subscriber Gate Defaults PRD AC-004, AC-005, AC-008 to AC-014.
 *
 * @package beehiiv
 */

use Beehiiv\Admin\Options;
use Beehiiv\Config;

/**
 * @covers \Beehiiv\Admin\Options
 */
class SubscriberGateDefaultsTest extends WP_UnitTestCase {

	/**
	 * AC-013 / AC-014: settings saved before the feature read as the built-in defaults.
	 */
	public function test_legacy_settings_read_empty_headline_and_text(): void {
		update_option(
			Config::OPTION_NAME,
			array(
				'publication_id'   => 'pub_1',
				'post_template_id' => 'tpl_1',
			)
		);

		$gate = Options::get_gate_settings();

		$this->assertSame( '', $gate['headline'] );
		$this->assertSame( '', $gate['text'] );
		$this->assertSame( 30, $gate['cookie_days'] );
		$this->assertSame( 'pub_1', Options::get()['publication_id'] );
	}

	/**
	 * AC-004: blank or whitespace-only values stay empty.
	 */
	public function test_blank_values_stay_empty(): void {
		$saved = Options::sanitize(
			array(
				'gate_headline' => '   ',
				'gate_text'     => '',
			)
		);

		$this->assertSame( '', $saved['gate_headline'] );
		$this->assertSame( '', $saved['gate_text'] );

		update_option( Config::OPTION_NAME, $saved );

		$gate = Options::get_gate_settings();
		$this->assertSame( '', $gate['headline'] );
		$this->assertSame( '', $gate['text'] );
	}

	/**
	 * AC-005: tags are removed on save.
	 */
	public function test_headline_and_text_are_plain_text(): void {
		$saved = Options::sanitize(
			array(
				'gate_headline' => '<b>Join</b> us <script>alert(1)</script>',
				'gate_text'     => '<a href="x">Read</a> on',
			)
		);

		$this->assertSame( 'Join us', $saved['gate_headline'] );
		$this->assertSame( 'Read on', $saved['gate_text'] );
	}

	/**
	 * AC-008 to AC-010: cookie lifetime accepts whole days 1 to 365, anything else is 30.
	 *
	 * @dataProvider cookie_days_provider
	 *
	 * @param mixed $input    Submitted value.
	 * @param int   $expected Resolved days.
	 */
	public function test_cookie_days_resolution( $input, int $expected ): void {
		update_option( Config::OPTION_NAME, Options::sanitize( array( 'gate_cookie_days' => $input ) ) );

		$this->assertSame( $expected, Options::get_gate_settings()['cookie_days'] );
	}

	/**
	 * @return array<string, array{0: mixed, 1: int}>
	 */
	public function cookie_days_provider(): array {
		return array(
			'one'      => array( '1', 1 ),
			'seven'    => array( '7', 7 ),
			'max'      => array( '365', 365 ),
			'blank'    => array( '', 30 ),
			'zero'     => array( '0', 30 ),
			'negative' => array( '-5', 30 ),
			'decimal'  => array( '7.5', 30 ),
			'text'     => array( 'abc', 30 ),
			'over'     => array( '366', 30 ),
			'huge'     => array( '99999999999', 30 ),
		);
	}

	/**
	 * AC-006 / AC-011: saved values are returned for the form to show again.
	 */
	public function test_saved_values_round_trip(): void {
		update_option(
			Config::OPTION_NAME,
			Options::sanitize(
				array(
					'gate_headline'    => 'Join the list',
					'gate_text'        => 'Sign up free.',
					'gate_cookie_days' => '14',
				)
			)
		);

		$settings = Options::get();
		$this->assertSame( 'Join the list', $settings['gate_headline'] );
		$this->assertSame( 'Sign up free.', $settings['gate_text'] );
		$this->assertSame( '14', $settings['gate_cookie_days'] );
		$this->assertSame( 14, Options::get_gate_settings()['cookie_days'] );
	}

	/**
	 * AC-012: saving the gate fields keeps the publication settings, and the reverse.
	 */
	public function test_each_save_keeps_the_other_sections_values(): void {
		update_option(
			Config::OPTION_NAME,
			array(
				'publication_id'   => 'pub_1',
				'post_template_id' => 'tpl_1',
				'gate_headline'    => 'Custom',
			)
		);

		$after_gate_save = Options::sanitize( array( 'gate_cookie_days' => '10' ) );
		$this->assertSame( 'pub_1', $after_gate_save['publication_id'] );
		$this->assertSame( 'tpl_1', $after_gate_save['post_template_id'] );
		$this->assertSame( 'Custom', $after_gate_save['gate_headline'] );

		$after_publication_save = Options::sanitize(
			array(
				Options::PUBLICATION_SECTION_FLAG => '1',
				'publication_id'   => 'pub_2',
				'post_template_id' => '',
			)
		);
		$this->assertSame( 'pub_2', $after_publication_save['publication_id'] );
		$this->assertSame( '', $after_publication_save['post_template_id'] );
		$this->assertSame( 'Custom', $after_publication_save['gate_headline'] );
	}

	/**
	 * A shown Publication section that posts no template clears the stored template.
	 */
	public function test_shown_publication_section_clears_missing_fields(): void {
		update_option(
			Config::OPTION_NAME,
			array(
				'publication_id'   => 'pub_1',
				'post_template_id' => 'tpl_gone',
			)
		);

		$saved = Options::sanitize(
			array(
				Options::PUBLICATION_SECTION_FLAG => '1',
				'publication_id'                  => 'pub_1',
			)
		);

		$this->assertSame( 'pub_1', $saved['publication_id'] );
		$this->assertSame( '', $saved['post_template_id'] );
		$this->assertArrayNotHasKey( Options::PUBLICATION_SECTION_FLAG, $saved );
	}

	/**
	 * The first save, with no option row yet, keeps the submitted publication fields.
	 *
	 * WordPress runs the sanitize callback twice then (update_option() and add_option()),
	 * and the second run gets the first run's output, which has no section flag.
	 */
	public function test_first_save_keeps_the_publication_fields(): void {
		// The sanitize callback only runs through update_option() once the setting is registered.
		Options::register();
		delete_option( Config::OPTION_NAME );

		update_option(
			Config::OPTION_NAME,
			array(
				Options::PUBLICATION_SECTION_FLAG => '1',
				'publication_id'                  => 'pub_1',
				'post_template_id'                => 'tpl_1',
			)
		);

		$saved = Options::get();

		$this->assertSame( 'pub_1', $saved['publication_id'] );
		$this->assertSame( 'tpl_1', $saved['post_template_id'] );
	}

	/**
	 * The default form ID is plain text, trimmed, and blank when unset.
	 */
	public function test_default_form_id_is_trimmed_plain_text(): void {
		$this->assertSame( '', Options::get_gate_settings()['form_id'] );

		update_option(
			Config::OPTION_NAME,
			Options::sanitize( array( 'gate_form_id' => '  <b>form_1</b>  ' ) )
		);

		$this->assertSame( 'form_1', Options::get_gate_settings()['form_id'] );
	}
}
