<?php
/**
 * REST API route registration.
 *
 * @package beehiiv
 */

namespace Beehiiv\API;

use Beehiiv\Config;

defined( 'ABSPATH' ) || exit;

/**
 * Registers plugin REST routes on `rest_api_init`.
 */
final class Routes {

	/**
	 * Hook REST route registration.
	 */
	public static function init(): void {
		add_action( 'rest_api_init', [ self::class, 'register' ] );
	}

	/**
	 * Register REST routes (delegate to controllers in `API/Controllers/`).
	 */
	public static function register(): void {
		// Register controller routes here; use Config::REST_NAMESPACE for route base.
	}
}
