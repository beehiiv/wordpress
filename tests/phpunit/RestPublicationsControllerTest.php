<?php
/**
 * Unit coverage for the publications REST route used by the Refresh publications
 * buttons on the settings screen and in the editor.
 *
 * Post-Level Publication Selector PRD AC-021, AC-022. beehiiv HTTP is mocked via `pre_http_request`.
 *
 * @package beehiiv
 */

use Beehiiv\API\Cache;
use Beehiiv\OAuth\TokenStore;

/**
 * @covers \Beehiiv\REST\PublicationsController
 * @covers \Beehiiv\API\Cache::delete_publications
 */
class RestPublicationsControllerTest extends WP_UnitTestCase {

	/**
	 * Number of beehiiv HTTP requests made during the test.
	 *
	 * @var int
	 */
	private $http_calls = 0;

	public function set_up(): void {
		parent::set_up();

		$this->http_calls = 0;

		TokenStore::save_tokens(
			'client_test',
			array(
				'access_token'  => 'access_test',
				'refresh_token' => 'refresh_test',
				'expires_in'    => DAY_IN_SECONDS,
			)
		);

		Cache::set_publications(
			array(
				array(
					'id'   => 'pub_cached',
					'name' => 'Cached Weekly',
				),
			)
		);

		add_filter( 'pre_http_request', array( $this, 'mock_http' ), 10, 3 );
		rest_get_server();
	}

	public function tear_down(): void {
		remove_filter( 'pre_http_request', array( $this, 'mock_http' ), 10 );
		Cache::flush_all();
		parent::tear_down();
	}

	/**
	 * Answer the publications list request as beehiiv would.
	 *
	 * @param false|array $preempt Short-circuit value.
	 * @param array       $args    Request args.
	 * @param string      $url     Request URL.
	 * @return array
	 */
	public function mock_http( $preempt, $args, $url ) {
		++$this->http_calls;

		return array(
			'headers'  => array(),
			'body'     => wp_json_encode(
				array(
					'data' => array(
						array(
							'id'   => 'pub_cached',
							'name' => 'Cached Weekly',
						),
						array(
							'id'   => 'pub_new',
							'name' => 'New Daily',
						),
					),
				)
			),
			'response' => array(
				'code'    => 200,
				'message' => '',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	}

	/**
	 * Run the route as the given role.
	 *
	 * @param string $role    User role.
	 * @param bool   $refresh Whether to request a refresh.
	 * @return WP_REST_Response
	 */
	private function request_as( string $role, bool $refresh ) {
		wp_set_current_user( self::factory()->user->create( array( 'role' => $role ) ) );

		$request = new WP_REST_Request( 'GET', '/beehiiv/v1/publications' );

		if ( $refresh ) {
			$request->set_param( 'refresh', true );
		}

		return rest_do_request( $request );
	}

	/**
	 * AC-021: refresh bypasses the cache and returns beehiiv's current list.
	 */
	public function test_refresh_pulls_latest_publications(): void {
		$response = $this->request_as( 'administrator', true );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 1, $this->http_calls );
		$this->assertSame( array( 'pub_cached', 'pub_new' ), wp_list_pluck( $response->get_data(), 'id' ) );
		$this->assertSame( array( 'pub_cached', 'pub_new' ), wp_list_pluck( Cache::get_publications(), 'id' ) );
	}

	/**
	 * Without refresh, the cached list is served.
	 */
	public function test_without_refresh_serves_cache(): void {
		$response = $this->request_as( 'administrator', false );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 0, $this->http_calls );
		$this->assertSame( array( 'pub_cached' ), wp_list_pluck( $response->get_data(), 'id' ) );
	}

	/**
	 * AC-022: users who can publish posts can refresh publications from the editor.
	 */
	public function test_editor_can_refresh_publications(): void {
		$response = $this->request_as( 'editor', true );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 1, $this->http_calls );
	}

	/**
	 * Users who cannot publish posts cannot refresh publications.
	 */
	public function test_contributor_cannot_refresh_publications(): void {
		$response = $this->request_as( 'contributor', true );

		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( 0, $this->http_calls );
	}
}
