<?php
/**
 * PHPUnit bootstrap for beehiiv plugin unit tests.
 *
 * These are lightweight, WordPress-free unit tests: plugin classes are
 * autoloaded through Composer and the handful of WordPress helpers they call
 * are stubbed below, so the suite runs with `composer install &&
 * vendor/bin/phpunit` without a WordPress install or a database.
 *
 * @package beehiiv
 */

defined( 'ABSPATH' ) || define( 'ABSPATH', __DIR__ . '/' );

require dirname( __DIR__, 2 ) . '/vendor/autoload.php';

if ( ! function_exists( 'wp_strip_all_tags' ) ) {
	/**
	 * Minimal stand-in for wp_strip_all_tags() for isolated unit tests.
	 *
	 * @param string $text          Text to strip.
	 * @param bool   $remove_breaks Whether to collapse whitespace.
	 * @return string
	 */
	function wp_strip_all_tags( $text, $remove_breaks = false ) {
		$text = preg_replace( '@<(script|style)[^>]*?>.*?</\\1>@si', '', (string) $text );
		$text = strip_tags( $text );

		if ( $remove_breaks ) {
			$text = preg_replace( '/[\r\n\t ]+/', ' ', $text );
		}

		return trim( $text );
	}
}
