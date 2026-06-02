<?php
/**
 * Beehiiv settings option (read / sanitize / defaults).
 *
 * @package beehiiv
 */

namespace Beehiiv\Admin;

use Beehiiv\Config;

defined( 'ABSPATH' ) || exit;

/**
 * Persists plugin settings in a single WordPress option.
 *
 * @since 1.0.0
 */
final class Options {

	/**
	 * Default option values.
	 *
	 * @var array<string, mixed>
	 */
	private const DEFAULTS = [
		'publication_id'      => '',
		'post_template_id'    => '',
		'oauth_connected'     => false,
	];

	/**
	 * Register the option with the Settings API.
	 *
	 * @since 1.0.0
	 */
	public static function register(): void {
		register_setting(
			Config::SETTINGS_GROUP,
			Config::OPTION_NAME,
			[
				'type'              => 'array',
				'sanitize_callback' => [ self::class, 'sanitize' ],
				'default'           => self::DEFAULTS,
			]
		);
	}

	/**
	 * Merge saved values with defaults.
	 *
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function get(): array {
		$saved = get_option( Config::OPTION_NAME, [] );

		if ( ! is_array( $saved ) ) {
			$saved = [];
		}

		return wp_parse_args( $saved, self::DEFAULTS );
	}

	/**
	 * Sanitize settings before saving.
	 *
	 * @param mixed $input Raw option value from the form.
	 * @return array<string, mixed>
	 * @since 1.0.0
	 */
	public static function sanitize( $input ): array {
		$current = self::get();

		if ( ! is_array( $input ) ) {
			return $current;
		}

		$publication_id = isset( $input['publication_id'] )
			? sanitize_text_field( (string) $input['publication_id'] )
			: '';
		$post_template_id = isset( $input['post_template_id'] )
			? sanitize_text_field( (string) $input['post_template_id'] )
			: '';

		return [
			'publication_id'      => $publication_id,
			'post_template_id'    => $post_template_id,
			'oauth_connected'     => $current['oauth_connected'],
		];
	}
}
