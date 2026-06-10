<?php
/**
 * PKCE helpers for OAuth public clients.
 *
 * @package beehiiv
 */

namespace Beehiiv\OAuth;

defined( 'ABSPATH' ) || exit;

/**
 * Generates RFC 7636 PKCE verifier and S256 challenge.
 *
 * @since 1.0.0
 */
final class Pkce {

	/**
	 * Generate a PKCE verifier/challenge pair.
	 *
	 * @since 1.0.0
	 *
	 * @return array{code_verifier: string, code_challenge: string}
	 */
	public static function generate(): array {

		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- RFC 7636 PKCE.
		$code_verifier = rtrim( strtr( base64_encode( random_bytes( 32 ) ), '+/', '-_' ), '=' );
		$code_challenge = rtrim(
			// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- RFC 7636 PKCE.
			strtr( base64_encode( hash( 'sha256', $code_verifier, true ) ), '+/', '-_' ),
			'='
		);

		return [
			'code_verifier'  => $code_verifier,
			'code_challenge' => $code_challenge,
		];
	}
}
