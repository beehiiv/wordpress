<?php
/**
 * Encrypts and decrypts sensitive plugin data at rest.
 *
 * @package beehiiv
 */

namespace Beehiiv\Security;

defined( 'ABSPATH' ) || exit;

/**
 * AES-256-CTR encryption using WordPress salts.
 *
 * @since 1.0.0
 */
final class DataEncryption {

	/**
	 * Encryption key.
	 *
	 * @var string
	 */
	private $key;

	/**
	 * Encryption salt suffix.
	 *
	 * @var string
	 */
	private $salt;

	/**
	 * Constructor.
	 *
	 * @since 1.0.0
	 */
	public function __construct() {

		$this->key  = $this->get_default_key();
		$this->salt = $this->get_default_salt();
	}

	/**
	 * Encrypt a string value.
	 *
	 * @since 1.0.0
	 *
	 * @param string $value Plaintext value.
	 *
	 * @return string|bool Encrypted value, or false on failure.
	 */
	public function encrypt( string $value ) {

		if ( ! extension_loaded( 'openssl' ) ) {
			return $value;
		}

		$method = 'aes-256-ctr';
		$ivlen  = openssl_cipher_iv_length( $method );
		$iv     = openssl_random_pseudo_bytes( $ivlen );

		$raw_value = openssl_encrypt( $value . $this->salt, $method, $this->key, 0, $iv );
		if ( ! $raw_value ) {
			return false;
		}

		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
		return base64_encode( $iv . $raw_value );
	}

	/**
	 * Decrypt a string value.
	 *
	 * @since 1.0.0
	 *
	 * @param string $raw_value Encrypted value.
	 *
	 * @return string|bool Decrypted value, or false on failure.
	 */
	public function decrypt( string $raw_value ) {

		if ( ! extension_loaded( 'openssl' ) || ! is_string( $raw_value ) ) {
			return $raw_value;
		}

		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		$decoded_value = base64_decode( $raw_value, true );

		if ( false === $decoded_value ) {
			return $raw_value;
		}

		$method = 'aes-256-ctr';
		$ivlen  = openssl_cipher_iv_length( $method );
		$iv     = substr( $decoded_value, 0, $ivlen );

		$decoded_value = substr( $decoded_value, $ivlen );

		$value = openssl_decrypt( $decoded_value, $method, $this->key, 0, $iv );
		if ( ! $value || substr( $value, - strlen( $this->salt ) ) !== $this->salt ) {
			return false;
		}

		return substr( $value, 0, - strlen( $this->salt ) );
	}

	/**
	 * Default encryption key from wp-config.php.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	private function get_default_key(): string {

		if ( defined( 'LOGGED_IN_KEY' ) && '' !== LOGGED_IN_KEY ) {
			return LOGGED_IN_KEY;
		}

		return 'k^i8jUDD@t|$_*EKQDki)M.$ih!}/,Fjw;%}it-PJJ5vrL0/i/ET ;cyo7 ($TmS';
	}

	/**
	 * Default encryption salt from wp-config.php.
	 *
	 * @since 1.0.0
	 *
	 * @return string
	 */
	private function get_default_salt(): string {

		if ( defined( 'LOGGED_IN_SALT' ) && '' !== LOGGED_IN_SALT ) {
			return LOGGED_IN_SALT;
		}

		return ';qVb7r9{)d$]`25MSlY8NgzCwu&QQ8S+y:?H;$&o+I2@;3cmA>C,&HC^$ezwVw|r';
	}
}
