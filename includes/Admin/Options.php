<?php
/**
 * Settings option for beehiiv (read / sanitize / defaults).
 *
 * @package beehiiv
 */

namespace Beehiiv\Admin;

use Beehiiv\API\Cache;
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
		'publication_id'          => '',
		'post_template_id'        => '',
		'require_template_choice' => false,
		'gate_headline'           => '',
		'gate_text'               => '',
		'gate_form_id'            => '',
		'gate_cookie_days'        => '',
	];

	/**
	 * Form key that the Publication section posts when it is shown.
	 *
	 * @var string
	 */
	public const PUBLICATION_SECTION_FLAG = '_publication_section';

	/**
	 * Lowest unlock cookie lifetime, in days.
	 *
	 * @var int
	 */
	public const GATE_COOKIE_DAYS_MIN = 1;

	/**
	 * Highest unlock cookie lifetime, in days.
	 *
	 * @var int
	 */
	public const GATE_COOKIE_DAYS_MAX = 365;

	/**
	 * Built-in unlock cookie lifetime, in days.
	 *
	 * @var int
	 */
	public const GATE_COOKIE_DAYS_DEFAULT = 30;

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
	 * Gate defaults with every fallback applied.
	 *
	 * A blank headline or text stays empty, and the gate card leaves it out.
	 * An invalid cookie lifetime falls back to the default on read; the
	 * fallback is never written back to the stored option.
	 *
	 * @return array{headline: string, text: string, form_id: string, cookie_days: int}
	 * @since 1.2.0
	 */
	public static function get_gate_settings(): array {
		$settings = self::get();

		return [
			'headline'    => trim( (string) $settings['gate_headline'] ),
			'text'        => trim( (string) $settings['gate_text'] ),
			'form_id'     => trim( (string) $settings['gate_form_id'] ),
			'cookie_days' => self::resolve_gate_cookie_days( $settings['gate_cookie_days'] ),
		];
	}

	/**
	 * Resolve a stored cookie lifetime to a whole number of days from 1 to 365.
	 *
	 * Anything else (blank, text, decimal, zero, negative, over 365) becomes 30.
	 *
	 * @param mixed $value Stored or submitted value.
	 * @return int
	 * @since 1.2.0
	 */
	public static function resolve_gate_cookie_days( $value ): int {
		if ( is_int( $value ) ) {
			$value = (string) $value;
		}

		if ( ! is_string( $value ) || ! preg_match( '/^\s*\d+\s*$/', $value ) ) {
			return self::GATE_COOKIE_DAYS_DEFAULT;
		}

		$days = (int) trim( $value );

		if ( $days < self::GATE_COOKIE_DAYS_MIN || $days > self::GATE_COOKIE_DAYS_MAX ) {
			return self::GATE_COOKIE_DAYS_DEFAULT;
		}

		return $days;
	}

	/**
	 * Sanitize settings before saving.
	 *
	 * The settings form posts the Publication fields and the Subscriber gating
	 * fields together, and the Publication fields are absent when that section
	 * is hidden. Only keys present in the submission change; every other stored
	 * value is kept.
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

		// The Publication section marks itself in the submission. When it was shown,
		// a missing field means it was cleared or not offered, so it resets to blank,
		// as before. When it was hidden, the stored values stay.
		//
		// A submitted field is always applied, flag or not. WordPress runs this
		// callback twice on the first save, when no option row exists yet (once in
		// update_option() and again in add_option()). The second run receives the
		// first run's output, which has no flag. Applying present fields keeps that
		// second run from discarding them.
		$publication_section_shown = ! empty( $input[ self::PUBLICATION_SECTION_FLAG ] );

		foreach ( [ 'publication_id', 'post_template_id' ] as $key ) {
			if ( isset( $input[ $key ] ) ) {
				$current[ $key ] = sanitize_text_field( (string) $input[ $key ] );
			} elseif ( $publication_section_shown ) {
				$current[ $key ] = '';
			}
		}

		// Plain text only: tags are removed and surrounding whitespace trimmed.
		// The form ID has no built-in default: blank means no site-wide form.
		foreach ( [ 'gate_headline', 'gate_text', 'gate_form_id' ] as $key ) {
			if ( isset( $input[ $key ] ) ) {
				$current[ $key ] = trim( sanitize_text_field( (string) $input[ $key ] ) );
			}
		}

		// Stored as submitted (digits only); the 1 to 365 rule applies on read.
		if ( isset( $input['gate_cookie_days'] ) ) {
			$current['gate_cookie_days'] = sanitize_text_field( (string) $input['gate_cookie_days'] );
		}

		// An unchecked checkbox is missing from the form, so absence means off, but only
		// when the Publication section was shown. A save with that section hidden keeps it.
		if ( isset( $input['require_template_choice'] ) ) {
			$current['require_template_choice'] = ! empty( $input['require_template_choice'] );
		} elseif ( $publication_section_shown ) {
			$current['require_template_choice'] = false;
		}

		// Saving settings clears the cached template list for the selected
		// publication so the dropdown reflects any beehiiv-side changes.
		if ( '' !== $current['publication_id'] ) {
			Cache::delete_post_templates( $current['publication_id'] );
		}

		return $current;
	}
}
