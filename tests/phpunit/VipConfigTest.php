<?php
/**
 * Coverage for the WordPress VIP runtime config reader.
 *
 * @package beehiiv
 */

use Beehiiv\OAuth\Config;

/**
 * @covers \Beehiiv\OAuth\Config
 */
class VipConfigTest extends WP_UnitTestCase {

	/**
	 * Load a fixture file and return the array it defines.
	 *
	 * @param string $name Fixture name without the `config-` prefix.
	 *
	 * @return array
	 */
	private function fixture( string $name ): array {

		return require __DIR__ . '/fixtures/config-' . $name . '.php';
	}

	public function test_constant_name_follows_the_manifest_slug(): void {

		$this->assertSame( 'VIP_BEEHIIV_CONFIG', Config::CONSTANT_NAME );
	}

	public function test_valid_config_supplies_the_api_base_url(): void {

		$config = Config::parse_vip_config( $this->fixture( 'valid' ) );

		$this->assertSame( 'https://api.example.test/v2', Config::sanitize_vip_url( $config['api_base_url'] ) );
	}

	public function test_minimal_config_leaves_the_api_base_url_unset(): void {

		$config = Config::parse_vip_config( $this->fixture( 'minimal' ) );

		$this->assertSame( '', Config::sanitize_vip_url( $config['api_base_url'] ?? '' ) );
	}

	public function test_incomplete_config_is_treated_as_unset(): void {

		$config = Config::parse_vip_config( $this->fixture( 'incomplete' ) );

		$this->assertSame( '', Config::sanitize_vip_url( $config['api_base_url'] ) );
	}

	public function test_invalid_config_is_treated_as_unset(): void {

		$config = Config::parse_vip_config( $this->fixture( 'invalid' ) );

		$this->assertSame( '', Config::sanitize_vip_url( $config['api_base_url'] ) );
	}

	/**
	 * @dataProvider non_array_values
	 *
	 * @param mixed $raw Value the constant could hold.
	 */
	public function test_non_array_constant_value_never_fatals( $raw ): void {

		$this->assertSame( [], Config::parse_vip_config( $raw ) );
	}

	public function non_array_values(): array {

		return [
			'null'   => [ null ],
			'string' => [ 'https://example.test' ],
			'int'    => [ 1 ],
			'bool'   => [ false ],
		];
	}

	/**
	 * @dataProvider unusable_urls
	 *
	 * @param mixed $value Raw field value.
	 */
	public function test_unusable_url_values_are_ignored( $value ): void {

		$this->assertSame( '', Config::sanitize_vip_url( $value ) );
	}

	public function unusable_urls(): array {

		return [
			'null'        => [ null ],
			'array'       => [ [ 'x' ] ],
			'blank'       => [ '' ],
			'whitespace'  => [ '   ' ],
			'no scheme'   => [ 'api.example.test' ],
			'ftp scheme'  => [ 'ftp://api.example.test' ],
			'javascript'  => [ 'javascript:alert(1)' ],
		];
	}

	public function test_absent_constant_falls_back_to_the_default_api_base_url(): void {

		$this->assertFalse( defined( Config::CONSTANT_NAME ) );
		$this->assertSame( [], Config::get_vip_config() );
		$this->assertStringStartsWith( 'http', Config::get_api_base_url() );
	}
}
