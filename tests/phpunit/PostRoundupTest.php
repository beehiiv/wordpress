<?php
/**
 * Unit coverage for the Post Roundup block.
 *
 * Post Roundup Block PRD AC-001 to AC-006. beehiiv HTTP is faked via `pre_http_request`;
 * the live API is never called.
 *
 * @package beehiiv
 */

use Beehiiv\API\Cache;
use Beehiiv\Config;
use Beehiiv\Editor\Meta;
use Beehiiv\Editor\PostSettings;
use Beehiiv\Newsletter\BlockConverter;
use Beehiiv\Newsletter\ContentTypes;
use Beehiiv\Newsletter\NewsletterPostType;
use Beehiiv\Newsletter\PostRoundup;
use Beehiiv\Newsletter\PostRoundupSnapshot;
use Beehiiv\Newsletter\PostSettingsBuilder;
use Beehiiv\Newsletter\Sender;
use Beehiiv\Newsletter\SupportedBlocks;
use Beehiiv\Newsletter\TestSender;
use Beehiiv\OAuth\TokenStore;
use Beehiiv\REST\PostRoundupController;

/**
 * @covers \Beehiiv\Newsletter\PostRoundup
 * @covers \Beehiiv\Newsletter\PostRoundupSnapshot
 * @covers \Beehiiv\REST\PostRoundupController
 * @covers \Beehiiv\Newsletter\BlockConverter::convert_supported_blocks
 */
class PostRoundupTest extends WP_UnitTestCase {

	/**
	 * Requests recorded by the HTTP fake.
	 *
	 * @var array<int, array{method: string, url: string, body: array}>
	 */
	private $requests = array();

	public function set_up(): void {
		parent::set_up();

		$this->requests = array();
		add_filter( 'pre_http_request', array( $this, 'fake_http' ), 10, 3 );

		NewsletterPostType::register();
		PostSettings::register_meta();
		PostRoundup::init();

		TokenStore::save_tokens(
			'client_test',
			array(
				'access_token'  => 'access_test',
				'refresh_token' => 'refresh_test',
				'expires_in'    => DAY_IN_SECONDS,
			)
		);
		update_option(
			Config::OPTION_NAME,
			array(
				'publication_id'   => 'pub_default',
				'post_template_id' => 'tpl_default',
			)
		);
		Cache::set_publications( array( array( 'id' => 'pub_default', 'name' => 'Default' ) ) );
		Cache::set_post_templates( 'pub_default', array( array( 'id' => 'tpl_default', 'name' => 'Default' ) ) );
	}

	public function tear_down(): void {
		remove_filter( 'pre_http_request', array( $this, 'fake_http' ), 10 );
		remove_filter( 'allowed_block_types_all', array( PostRoundup::class, 'filter_allowed_blocks' ), 10 );
		Cache::flush_all();
		parent::tear_down();
	}

	/**
	 * Record requests and answer like beehiiv.
	 *
	 * @param false|array $preempt Short-circuit value.
	 * @param array       $args    Request args.
	 * @param string      $url     Request URL.
	 * @return array
	 */
	public function fake_http( $preempt, $args, $url ) {
		$method = isset( $args['method'] ) ? strtoupper( $args['method'] ) : 'GET';
		$body   = isset( $args['body'] ) && is_string( $args['body'] ) ? json_decode( $args['body'], true ) : array();

		$this->requests[] = array(
			'method' => $method,
			'url'    => $url,
			'body'   => is_array( $body ) ? $body : array(),
		);

		$code = 'DELETE' === $method ? 204 : 200;
		$data = 'POST' === $method ? array( 'data' => array( 'id' => 'post_new' ) ) : array( 'data' => array() );

		return array(
			'headers'  => array(),
			'body'     => wp_json_encode( $data ),
			'response' => array(
				'code'    => $code,
				'message' => '',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	}

	/**
	 * Create a published regular post, dated so the order is predictable.
	 *
	 * @param string $title Title.
	 * @param int    $age   Hours old.
	 * @param array  $args  Extra args.
	 * @return int
	 */
	private function create_article( string $title, int $age = 1, array $args = array() ): int {
		return self::factory()->post->create(
			array_merge(
				array(
					'post_title'   => $title,
					'post_excerpt' => 'Excerpt of ' . $title,
					'post_status'  => 'publish',
					'post_date'    => gmdate( 'Y-m-d H:i:s', time() - $age * HOUR_IN_SECONDS ),
				),
				$args
			)
		);
	}

	/**
	 * Create a newsletter whose content is the given blocks.
	 *
	 * @param string $content Block markup.
	 * @param array  $args    Extra args.
	 * @return int
	 */
	private function create_newsletter( string $content, array $args = array() ): int {
		return self::factory()->post->create(
			array_merge(
				array(
					'post_type'    => ContentTypes::NEWSLETTER,
					'post_status'  => 'publish',
					'post_title'   => 'Campaign',
					'post_content' => $content,
				),
				$args
			)
		);
	}

	/**
	 * Block markup for a roundup.
	 *
	 * @param array $attrs Block attributes.
	 * @return string
	 */
	private function roundup( array $attrs = array() ): string {
		return '<!-- wp:beehiiv/post-roundup ' . wp_json_encode( (object) $attrs ) . ' /-->';
	}

	/**
	 * Block markup for a paragraph.
	 *
	 * @param string $text Text.
	 * @return string
	 */
	private function paragraph( string $text ): string {
		return "<!-- wp:paragraph -->\n<p>" . $text . "</p>\n<!-- /wp:paragraph -->";
	}

	/**
	 * Converted blocks of a post.
	 *
	 * @param int $post_id Post ID.
	 * @return array
	 */
	private function convert( int $post_id ): array {
		return BlockConverter::convert_supported_blocks( get_post( $post_id ) );
	}

	/**
	 * Titles of a list of posts, in the order given.
	 *
	 * @param int[] $ids Post IDs.
	 * @return string[]
	 */
	private function titles( array $ids ): array {
		return array_map(
			static function ( $id ) {
				return get_the_title( $id );
			},
			$ids
		);
	}

	/**
	 * Types of a list of beehiiv blocks.
	 *
	 * @param array $blocks Blocks.
	 * @return string[]
	 */
	private function types( array $blocks ): array {
		return array_column( $blocks, 'type' );
	}

	/**
	 * Blocks of the last request that carried a `blocks` payload.
	 *
	 * @return array
	 */
	private function last_sent_blocks(): array {
		foreach ( array_reverse( $this->requests ) as $request ) {
			if ( isset( $request['body']['blocks'] ) ) {
				return $request['body']['blocks'];
			}
		}

		return array();
	}

	/**
	 * Position of each needle in the JSON of the blocks (false when missing).
	 *
	 * @param array    $blocks  Blocks.
	 * @param string[] $needles Needles.
	 * @return array
	 */
	private function positions( array $blocks, array $needles ): array {
		$json = wp_json_encode( $blocks );

		return array_map(
			static function ( $needle ) use ( $json ) {
				return strpos( $json, $needle );
			},
			$needles
		);
	}

	/**
	 * Attach a featured image to a post.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $file    File name.
	 */
	private function add_featured_image( int $post_id, string $file ): void {
		$attachment_id = self::factory()->attachment->create(
			array(
				'post_mime_type' => 'image/jpeg',
				'post_parent'    => $post_id,
				'file'           => $file,
			)
		);
		update_post_meta( $attachment_id, '_wp_attachment_image_alt', 'Alt of ' . $file );
		set_post_thumbnail( $post_id, $attachment_id );
	}

	/* ---------------------------------------------------------------- AC-002 resolver. */

	/**
	 * BR-001: latest published regular posts, newest first, any category.
	 */
	public function test_latest_posts_are_newest_first_from_any_category_and_limited_by_count(): void {
		$category = self::factory()->category->create();
		$old      = $this->create_article( 'Old', 30 );
		$new      = $this->create_article( 'New', 2, array( 'post_category' => array( $category ) ) );
		$mid      = $this->create_article( 'Mid', 10 );

		$this->assertSame( array( $new, $mid, $old ), PostRoundup::latest_ids( 3, 0 ) );
		$this->assertSame( array( $new, $mid ), PostRoundup::latest_ids( 2, 0 ) );
	}

	/**
	 * BR-001: drafts, private, scheduled, password-protected posts, pages and newsletters never appear.
	 */
	public function test_latest_posts_exclude_unpublished_protected_and_other_types(): void {
		$visible = $this->create_article( 'Visible', 5 );
		$this->create_article( 'Draft', 1, array( 'post_status' => 'draft' ) );
		$this->create_article( 'Private', 1, array( 'post_status' => 'private' ) );
		$this->create_article( 'Protected', 1, array( 'post_password' => 'secret' ) );
		$this->create_article( 'Page', 1, array( 'post_type' => 'page' ) );
		$this->create_newsletter( '', array( 'post_title' => 'Other newsletter' ) );

		$this->assertSame( array( $visible ), PostRoundup::latest_ids( 10, 0 ) );
	}

	/**
	 * BR-001: never lists the newsletter itself.
	 */
	public function test_latest_posts_exclude_the_post_being_sent(): void {
		$article = $this->create_article( 'Article', 5 );
		$self    = $this->create_article( 'Self', 1 );

		$this->assertSame( array( $article ), PostRoundup::latest_ids( 5, $self ) );
	}

	/**
	 * The count control accepts 1 to 10 and falls back to 3.
	 */
	public function test_count_is_clamped_to_one_to_ten_with_default_three(): void {
		$this->assertSame( 1, PostRoundup::clamp_count( 0 ) );
		$this->assertSame( 1, PostRoundup::clamp_count( -4 ) );
		$this->assertSame( 7, PostRoundup::clamp_count( '7' ) );
		$this->assertSame( 10, PostRoundup::clamp_count( 99 ) );
		$this->assertSame( 3, PostRoundup::clamp_count( 'many' ) );
		$this->assertSame( 3, PostRoundup::clamp_count( null ) );

		for ( $i = 0; $i < 12; $i++ ) {
			$this->create_article( 'A' . $i, $i + 1 );
		}

		$this->assertCount( 10, PostRoundup::latest_ids( 99, 0 ) );
	}

	/**
	 * BR-002 and the silent-skip choice: picks keep their order and unavailable ones drop out.
	 */
	public function test_manual_picks_keep_order_and_skip_unavailable_posts(): void {
		$first   = $this->create_article( 'First', 9 );
		$second  = $this->create_article( 'Second', 8 );
		$draft   = $this->create_article( 'Draft', 7, array( 'post_status' => 'draft' ) );
		$trashed = $this->create_article( 'Trashed', 6 );
		wp_trash_post( $trashed );
		$deleted = $this->create_article( 'Deleted', 5 );
		wp_delete_post( $deleted, true );
		$locked = $this->create_article( 'Locked', 4, array( 'post_password' => 'pw' ) );
		$page   = $this->create_article( 'Page', 3, array( 'post_type' => 'page' ) );
		$self   = $this->create_article( 'Self', 2 );

		$attrs = array(
			'mode'  => 'manual',
			'posts' => array(
				array( 'id' => $second ),
				array( 'id' => $draft ),
				array( 'id' => $trashed ),
				array( 'id' => $deleted ),
				array( 'id' => $locked ),
				array( 'id' => $page ),
				array( 'id' => $self ),
				array( 'id' => $first ),
				array( 'id' => $second ),
				array( 'id' => 'junk' ),
			),
		);

		$this->assertSame(
			array( $second, $first ),
			PostRoundup::resolve_ids( $attrs, $self, 'k' )
		);
	}

	/**
	 * Mode defaults to automatic; only "manual" switches it.
	 */
	public function test_mode_defaults_to_automatic(): void {
		$this->assertSame( 'auto', PostRoundup::mode( array() ) );
		$this->assertSame( 'auto', PostRoundup::mode( array( 'mode' => 'nonsense' ) ) );
		$this->assertSame( 'manual', PostRoundup::mode( array( 'mode' => 'manual' ) ) );
	}

	/* ------------------------------------------------------- AC-004 editor preview REST. */

	/**
	 * The preview route returns cards from the shared resolver and needs edit access.
	 */
	public function test_preview_route_uses_the_shared_resolver_and_requires_edit_capability(): void {
		do_action( 'rest_api_init' );
		PostRoundupController::register_routes();

		$newest   = $this->create_article( 'Newest', 1 );
		$older    = $this->create_article( 'Older', 3 );
		$post_id  = $this->create_newsletter( $this->roundup() );
		$author   = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		$admin    = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$expected = PostRoundup::cards( array( $newest, $older ) );

		$request = new WP_REST_Request( 'GET', '/beehiiv/v1/post-roundup' );
		$request->set_query_params(
			array(
				'post_id' => $post_id,
				'mode'    => 'auto',
				'count'   => 2,
			)
		);

		wp_set_current_user( $author );
		$this->assertSame( 403, rest_do_request( $request )->get_status() );

		wp_set_current_user( 0 );
		$this->assertSame( 401, rest_do_request( $request )->get_status() );

		wp_set_current_user( $admin );
		$response = rest_do_request( $request );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $expected, $response->get_data() );
		$this->assertSame( 'Newest', $response->get_data()[0]['title'] );
		$this->assertSame( get_permalink( $newest ), $response->get_data()[0]['url'] );
		$this->assertSame( 'Excerpt of Newest', $response->get_data()[0]['excerpt'] );

		$manual = new WP_REST_Request( 'GET', '/beehiiv/v1/post-roundup' );
		$manual->set_query_params(
			array(
				'post_id' => $post_id,
				'mode'    => 'manual',
				'ids'     => array( $older, $newest ),
			)
		);
		$this->assertSame( array( $older, $newest ), array_column( rest_do_request( $manual )->get_data(), 'id' ) );

		// Out-of-range counts are clamped, not rejected.
		$request->set_query_params(
			array(
				'post_id' => $post_id,
				'count'   => 500,
			)
		);
		$this->assertSame( 200, rest_do_request( $request )->get_status() );
	}

	/* ---------------------------------------------------------- AC-001 newsletter-only. */

	/**
	 * The block is offered in newsletters and removed everywhere else.
	 */
	public function test_block_is_allowed_only_when_writing_a_newsletter(): void {
		$newsletter = get_post( $this->create_newsletter( '' ) );
		$article    = get_post( self::factory()->post->create() );
		$all        = array( 'core/paragraph', PostRoundup::BLOCK );

		$this->assertSame( $all, PostRoundup::filter_allowed_blocks( $all, new WP_Block_Editor_Context( array( 'post' => $newsletter ) ) ) );
		$this->assertTrue( PostRoundup::filter_allowed_blocks( true, new WP_Block_Editor_Context( array( 'post' => $newsletter ) ) ) );

		$in_post = PostRoundup::filter_allowed_blocks( $all, new WP_Block_Editor_Context( array( 'post' => $article ) ) );
		$this->assertSame( array( 'core/paragraph' ), $in_post );

		$everything = PostRoundup::filter_allowed_blocks( true, new WP_Block_Editor_Context( array( 'post' => $article ) ) );
		$this->assertIsArray( $everything );
		$this->assertNotContains( PostRoundup::BLOCK, $everything );

		$no_post = PostRoundup::filter_allowed_blocks( $all, new WP_Block_Editor_Context( array( 'name' => 'core/edit-widgets' ) ) );
		$this->assertNotContains( PostRoundup::BLOCK, $no_post );

		// Wired through the real filter.
		$filtered = apply_filters( 'allowed_block_types_all', $all, new WP_Block_Editor_Context( array( 'post' => $article ) ) );
		$this->assertNotContains( PostRoundup::BLOCK, $filtered );
	}

	/**
	 * A roundup left in a regular post is ignored by the converter.
	 */
	public function test_roundup_in_a_regular_post_is_ignored(): void {
		$this->create_article( 'Listed', 3 );
		$post_id = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_content' => $this->paragraph( 'Intro' ) . $this->roundup() . $this->paragraph( 'Outro' ),
			)
		);

		$blocks = $this->convert( $post_id );

		$this->assertSame( array( 'paragraph', 'paragraph' ), $this->types( $blocks ) );
		$this->assertStringNotContainsString( 'Listed', wp_json_encode( $blocks ) );
	}

	/**
	 * The editor warning and the converter agree: the block is on the supported list.
	 */
	public function test_block_is_in_the_supported_blocks_list(): void {
		$this->assertContains( PostRoundup::BLOCK, SupportedBlocks::BLOCKS );
		$this->assertContains( PostRoundup::BLOCK, SupportedBlocks::get_editor_config()['supported'] );
		$this->assertTrue( SupportedBlocks::is_supported( PostRoundup::BLOCK, false ) );
	}

	/* ------------------------------------------------------------ AC-005 expansion. */

	/**
	 * Per post: image, bold linked title, excerpt, Read more; a separator between cards; order kept.
	 */
	public function test_roundup_expands_into_cards_in_order(): void {
		$one = $this->create_article( 'Alpha story', 1 );
		$two = $this->create_article( 'Beta story', 2 );
		$this->add_featured_image( $one, 'alpha.jpg' );

		$newsletter = $this->create_newsletter( $this->roundup( array( 'count' => 2 ) ) );
		$blocks     = $this->convert( $newsletter );

		$this->assertSame(
			array( 'image', 'paragraph', 'paragraph', 'button', 'content_break', 'paragraph', 'paragraph', 'button' ),
			$this->types( $blocks )
		);

		// Image with the featured image and a link to the post.
		$this->assertStringContainsString( 'alpha.jpg', $blocks[0]['imageUrl'] );
		$this->assertSame( 'Alt of alpha.jpg', $blocks[0]['alt_text'] );
		$this->assertSame( get_permalink( $one ), $blocks[0]['url'] );

		// Title is a bold paragraph carrying the link.
		$title = wp_json_encode( $blocks[1] );
		$this->assertStringContainsString( 'Alpha story', $title );
		$this->assertSame( array( 'bold' ), $blocks[1]['formattedText'][0]['styling'] );
		$this->assertSame( get_permalink( $one ), $blocks[1]['formattedText'][0]['link']['href'] );
		$this->assertArrayNotHasKey( 'level', $blocks[1] );

		// Excerpt and Read more.
		$this->assertSame( 'Excerpt of Alpha story', $blocks[2]['plaintext'] );
		$this->assertSame( 'button', $blocks[3]['type'] );
		$this->assertSame( 'Read more', $blocks[3]['text'] );
		$this->assertSame( get_permalink( $one ), $blocks[3]['href'] );

		// Second card follows, with no image of its own.
		$this->assertSame( 'Excerpt of Beta story', $blocks[6]['plaintext'] );
		$this->assertSame( get_permalink( $two ), $blocks[7]['href'] );
	}

	/**
	 * Manual picks are sent in the order the author chose.
	 */
	public function test_manual_roundup_is_sent_in_the_picked_order(): void {
		$a = $this->create_article( 'Story A', 1 );
		$b = $this->create_article( 'Story B', 2 );
		$c = $this->create_article( 'Story C', 3 );

		$newsletter = $this->create_newsletter(
			$this->roundup(
				array(
					'mode'  => 'manual',
					'posts' => array(
						array( 'id' => $c ),
						array( 'id' => $a ),
						array( 'id' => $b ),
					),
				)
			)
		);

		$positions = $this->positions( $this->convert( $newsletter ), array( 'Story C', 'Story A', 'Story B' ) );

		$this->assertNotContains( false, $positions );
		$sorted = $positions;
		sort( $sorted );
		$this->assertSame( $sorted, $positions );
	}

	/**
	 * A post without a featured image still shows its text.
	 */
	public function test_post_without_featured_image_has_no_image_block(): void {
		$this->create_article( 'Plain', 1 );
		$blocks = $this->convert( $this->create_newsletter( $this->roundup( array( 'count' => 1 ) ) ) );

		$this->assertSame( array( 'paragraph', 'paragraph', 'button' ), $this->types( $blocks ) );
	}

	/**
	 * The card image uses an existing registered image size.
	 */
	public function test_card_image_size_is_a_registered_size(): void {
		$this->assertContains( PostRoundup::IMAGE_SIZE, get_intermediate_image_sizes() );
	}

	/**
	 * A roundup keeps its place between other blocks.
	 */
	public function test_roundup_keeps_its_position_between_other_content(): void {
		$this->create_article( 'Middle story', 1 );
		$blocks = $this->convert(
			$this->create_newsletter(
				$this->paragraph( 'Intro text' ) . $this->roundup( array( 'count' => 1 ) ) . $this->paragraph( 'Outro text' )
			)
		);

		$this->assertSame( array( 'paragraph', 'paragraph', 'paragraph', 'button', 'paragraph' ), $this->types( $blocks ) );
		$positions = $this->positions( $blocks, array( 'Intro text', 'Middle story', 'Outro text' ) );
		$this->assertSame( $positions, array_values( array_unique( $positions ) ) );
		$sorted = $positions;
		sort( $sorted );
		$this->assertSame( $sorted, $positions );
	}

	/**
	 * Two roundups in one newsletter both expand.
	 */
	public function test_more_than_one_roundup_is_allowed(): void {
		$this->create_article( 'Only story', 1 );
		$blocks = $this->convert(
			$this->create_newsletter( $this->roundup( array( 'count' => 1 ) ) . $this->roundup( array( 'count' => 1 ) ) )
		);

		$this->assertSame( 2, count( array_filter( $this->types( $blocks ), static fn( $t ) => 'button' === $t ) ) );
	}

	/**
	 * Unavailable picks are skipped and the rest are sent.
	 */
	public function test_unavailable_manual_pick_is_skipped_at_send(): void {
		$kept  = $this->create_article( 'Kept', 1 );
		$draft = $this->create_article( 'Gone', 2, array( 'post_status' => 'draft' ) );

		$blocks = $this->convert(
			$this->create_newsletter(
				$this->roundup(
					array(
						'mode'  => 'manual',
						'posts' => array( array( 'id' => $draft ), array( 'id' => $kept ) ),
					)
				)
			)
		);

		$this->assertSame( array( 'paragraph', 'paragraph', 'button' ), $this->types( $blocks ) );
		$this->assertStringNotContainsString( 'Gone', wp_json_encode( $blocks ) );
	}

	/**
	 * A roundup with no posts alone in a newsletter gives the existing "no content" error.
	 */
	public function test_empty_roundup_alone_triggers_the_no_content_error(): void {
		$newsletter = $this->create_newsletter( $this->roundup() );

		$result = PostSettingsBuilder::get_post_settings( $newsletter, false, 'pub_default' );

		$this->assertWPError( $result );
		$this->assertSame( 'beehiiv_blocks_empty', $result->get_error_code() );
	}

	/**
	 * A roundup with no posts between other content is skipped.
	 */
	public function test_empty_roundup_between_content_is_skipped(): void {
		$newsletter = $this->create_newsletter(
			$this->paragraph( 'Intro text' ) . $this->roundup( array( 'mode' => 'manual' ) ) . $this->paragraph( 'Outro text' )
		);

		$this->assertSame( array( 'paragraph', 'paragraph' ), $this->types( $this->convert( $newsletter ) ) );

		$settings = PostSettingsBuilder::get_post_settings( $newsletter, false, 'pub_default' );
		$this->assertIsArray( $settings );
		$this->assertCount( 2, $settings['blocks'] );
	}

	/**
	 * In snippet mode a roundup after the first More block is left out; newsletters never use snippet mode.
	 */
	public function test_roundup_after_more_block_is_left_out_in_snippet_mode(): void {
		$this->create_article( 'Listed', 1 );
		$content = $this->paragraph( 'Intro' ) . "<!-- wp:more -->\n<!--more-->\n<!-- /wp:more -->" . $this->roundup( array( 'count' => 1 ) );

		// A newsletter ignores snippet mode, so the roundup after More is still sent.
		$newsletter = $this->create_newsletter( $content );
		update_post_meta( $newsletter, Meta::SEND_TO_NEWSLETTER_SNIPPET, true );
		$this->assertStringContainsString( 'Listed', wp_json_encode( $this->convert( $newsletter ) ) );

		// Existing snippet behavior on a regular post stops at More.
		$post_id = self::factory()->post->create(
			array(
				'post_status'  => 'publish',
				'post_content' => $content,
			)
		);
		update_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER_SNIPPET, true );
		$this->assertStringNotContainsString( 'Listed', wp_json_encode( $this->convert( $post_id ) ) );
	}

	/* ------------------------------------------------------------ AC-006 freeze. */

	/**
	 * Sending freezes the list, and every later sync reads it instead of re-querying.
	 */
	public function test_send_freezes_the_list_for_every_later_sync(): void {
		$old = $this->create_article( 'Frozen one', 3 );
		$mid = $this->create_article( 'Frozen two', 2 );
		$new = $this->create_article( 'Frozen three', 1 );

		$newsletter = $this->create_newsletter( $this->roundup( array( 'uid' => 'abc', 'count' => 2 ) ) );

		// Before sending: live, nothing stored.
		$this->assertSame( '', get_post_meta( $newsletter, Meta::ROUNDUP_SNAPSHOT, true ) );

		Sender::send( $newsletter );

		$this->assertSame( 'post_new', get_post_meta( $newsletter, Meta::BEEHIIV_POST_ID, true ) );
		$sent = $this->last_sent_blocks();
		$this->assertStringContainsString( 'Frozen three', wp_json_encode( $sent ) );
		$this->assertStringContainsString( 'Frozen two', wp_json_encode( $sent ) );
		$this->assertStringNotContainsString( 'Frozen one', wp_json_encode( $sent ) );
		$this->assertSame( array( $new, $mid ), get_post_meta( $newsletter, Meta::ROUNDUP_SNAPSHOT, true )['abc']['ids'] );

		// A newer post is published afterwards.
		$newest = $this->create_article( 'Frozen newest', 0 );
		$this->assertSame( array( $newest, $new ), PostRoundup::latest_ids( 2, $newsletter ) );

		// Save / update path.
		$this->requests = array();
		Sender::maybe_update_post_newsletter( get_post( $newsletter ) );
		$blocks = $this->last_sent_blocks();
		$this->assertNotEmpty( $blocks );
		$this->assertStringContainsString( 'Frozen two', wp_json_encode( $blocks ) );
		$this->assertStringNotContainsString( 'Frozen newest', wp_json_encode( $blocks ) );

		// Scheduled release.
		update_post_meta( $newsletter, Meta::BEEHIIV_SCHEDULED_AT, gmdate( 'Y-m-d\TH:i:s\Z', time() + DAY_IN_SECONDS ) );
		$this->requests = array();
		Sender::on_future_to_publish( get_post( $newsletter ) );
		$released = wp_json_encode( $this->last_sent_blocks() );
		$this->assertStringContainsString( 'Frozen two', $released );
		$this->assertStringNotContainsString( 'Frozen newest', $released );

		// Update payload and test email draft build.
		$update = PostSettingsBuilder::build_update( $newsletter );
		$this->assertStringNotContainsString( 'Frozen newest', wp_json_encode( $update['payload']['blocks'] ) );
		$draft = TestSender::build_temporary_draft_payload( $newsletter, 'pub_default' );
		$this->assertStringNotContainsString( 'Frozen newest', wp_json_encode( $draft['blocks'] ) );
		$this->assertStringContainsString( 'Frozen three', wp_json_encode( $draft['blocks'] ) );

		// The editor preview shows the frozen list too.
		$this->assertSame(
			array( $new, $mid ),
			PostRoundup::resolve_ids( array( 'count' => 2 ), $newsletter, 'abc' )
		);
		$this->assertNotContains( $old, get_post_meta( $newsletter, Meta::ROUNDUP_SNAPSHOT, true )['abc']['ids'] );
	}

	/**
	 * Before sending, saves and test emails show live results.
	 */
	public function test_before_send_the_list_is_live(): void {
		$this->create_article( 'First', 2 );
		$newsletter = $this->create_newsletter( $this->roundup( array( 'uid' => 'abc', 'count' => 1 ) ), array( 'post_status' => 'draft' ) );

		$this->assertStringContainsString( 'First', wp_json_encode( $this->convert( $newsletter ) ) );

		$this->create_article( 'Fresher', 0 );
		$draft = TestSender::build_temporary_draft_payload( $newsletter, 'pub_default' );
		$this->assertStringContainsString( 'Fresher', wp_json_encode( $draft['blocks'] ) );
		$this->assertSame( '', get_post_meta( $newsletter, Meta::ROUNDUP_SNAPSHOT, true ) );
	}

	/**
	 * Changing the count after sending freezes that roundup again; unchanged ones stay frozen.
	 */
	public function test_changed_count_refreezes_while_unchanged_roundups_stay_frozen(): void {
		$this->create_article( 'Story 1', 1 );
		$this->create_article( 'Story 2', 2 );

		$newsletter = $this->create_newsletter(
			$this->roundup( array( 'uid' => 'one', 'count' => 1 ) ) . $this->roundup( array( 'uid' => 'two', 'count' => 2 ) )
		);
		PostRoundupSnapshot::freeze( get_post( $newsletter ) );
		$stored = get_post_meta( $newsletter, Meta::ROUNDUP_SNAPSHOT, true );

		$this->create_article( 'Story 0', 0 );

		wp_update_post(
			array(
				'ID'           => $newsletter,
				'post_content' => $this->roundup( array( 'uid' => 'one', 'count' => 1 ) ) . $this->roundup( array( 'uid' => 'two', 'count' => 3 ) ),
			)
		);
		PostRoundupSnapshot::freeze( get_post( $newsletter ) );
		$after = get_post_meta( $newsletter, Meta::ROUNDUP_SNAPSHOT, true );

		$this->assertSame( $stored['one'], $after['one'], 'Unchanged roundup keeps its frozen list.' );
		$this->assertCount( 3, $after['two']['ids'], 'Changed count freezes again.' );
	}

	/**
	 * Manual roundups are not frozen; they are fixed by the author's picks. No roundup clears the snapshot.
	 */
	public function test_snapshot_skips_manual_roundups_and_clears_when_none_remain(): void {
		$article = $this->create_article( 'Story', 1 );
		$content = $this->roundup( array( 'mode' => 'manual', 'posts' => array( array( 'id' => $article ) ) ) );

		$newsletter = $this->create_newsletter( $content );
		PostRoundupSnapshot::freeze( get_post( $newsletter ) );
		$this->assertSame( '', get_post_meta( $newsletter, Meta::ROUNDUP_SNAPSHOT, true ) );

		update_post_meta( $newsletter, Meta::ROUNDUP_SNAPSHOT, array( 'x' => array( 'count' => 1, 'ids' => array( 1 ) ) ) );
		PostRoundupSnapshot::freeze( get_post( $newsletter ) );
		$this->assertSame( '', get_post_meta( $newsletter, Meta::ROUNDUP_SNAPSHOT, true ) );
	}

	/**
	 * A frozen post that later becomes unavailable is skipped silently.
	 */
	public function test_frozen_post_that_becomes_unavailable_is_skipped(): void {
		$keep = $this->create_article( 'Stays', 1 );
		$gone = $this->create_article( 'Leaves', 2 );

		$newsletter = $this->create_newsletter( $this->roundup( array( 'uid' => 'abc', 'count' => 2 ) ) );
		PostRoundupSnapshot::freeze( get_post( $newsletter ) );
		wp_trash_post( $gone );

		$this->assertSame( array( $keep ), PostRoundup::resolve_ids( array( 'count' => 2 ), $newsletter, 'abc' ) );
	}

	/**
	 * A failed first send forgets the freeze, so the retry freezes the current list.
	 */
	public function test_failed_send_does_not_keep_the_freeze(): void {
		$this->create_article( 'Story', 1 );
		$newsletter = $this->create_newsletter( $this->roundup( array( 'uid' => 'abc', 'count' => 1 ) ) );

		add_filter(
			'pre_http_request',
			static function ( $preempt, $args ) {
				if ( 'POST' === ( $args['method'] ?? '' ) ) {
					return array(
						'headers'  => array(),
						'body'     => wp_json_encode( array( 'message' => 'nope' ) ),
						'response' => array(
							'code'    => 500,
							'message' => '',
						),
						'cookies'  => array(),
						'filename' => null,
					);
				}

				return $preempt;
			},
			20,
			2
		);

		Sender::send( $newsletter );

		$this->assertSame( '', get_post_meta( $newsletter, Meta::BEEHIIV_POST_ID, true ) );
		$this->assertSame( '', get_post_meta( $newsletter, Meta::ROUNDUP_SNAPSHOT, true ) );
	}

	/**
	 * Cancelling a scheduled newsletter forgets the freeze so it freezes again when re-sent.
	 */
	public function test_cancelling_a_scheduled_newsletter_clears_the_freeze(): void {
		$this->create_article( 'Story', 1 );
		$newsletter = $this->create_newsletter( $this->roundup( array( 'uid' => 'abc', 'count' => 1 ) ) );

		Sender::send( $newsletter );
		$this->assertNotEmpty( get_post_meta( $newsletter, Meta::ROUNDUP_SNAPSHOT, true ) );

		Sender::cancel_scheduled_newsletter( $newsletter );
		$this->assertSame( '', get_post_meta( $newsletter, Meta::ROUNDUP_SNAPSHOT, true ) );
	}

	/**
	 * Roundups without a stored id are keyed by their position.
	 */
	public function test_block_key_uses_the_stored_id_or_the_position(): void {
		$this->assertSame( 'abc12', PostRoundup::block_key( array( 'uid' => 'abc12' ), 4 ) );
		$this->assertSame( 'n4', PostRoundup::block_key( array(), 4 ) );
		$this->assertSame( 'n0', PostRoundup::block_key( array( 'uid' => '' ), 0 ) );
	}

	/* ----------------------------------------------- AC-008 and AC-009 display and edits. */

	/**
	 * Every card item is shown when the block stores no display choice.
	 */
	public function test_every_item_is_shown_by_default(): void {
		$this->assertSame(
			array(
				'image'   => true,
				'title'   => true,
				'excerpt' => true,
				'button'  => true,
			),
			PostRoundup::display( array() )
		);
		$this->assertFalse( PostRoundup::display( array( 'display' => array( 'excerpt' => false ) ) )['excerpt'] );
		$this->assertTrue( PostRoundup::display( array( 'display' => array( 'excerpt' => false ) ) )['title'] );
	}

	/**
	 * Turned-off items are not sent, and the others still are, in order.
	 */
	public function test_turned_off_items_are_left_out_of_the_send(): void {
		$one = $this->create_article( 'Alpha story', 1 );
		$this->add_featured_image( $one, 'alpha.jpg' );

		$attrs = array( 'count' => 1 );

		$cases = array(
			'image'   => array( 'paragraph', 'paragraph', 'button' ),
			'title'   => array( 'image', 'paragraph', 'button' ),
			'excerpt' => array( 'image', 'paragraph', 'button' ),
			'button'  => array( 'image', 'paragraph', 'paragraph' ),
		);

		foreach ( $cases as $item => $expected ) {
			$blocks = $this->convert(
				$this->create_newsletter(
					$this->roundup( array_merge( $attrs, array( 'display' => array( $item => false ) ) ) )
				)
			);

			$this->assertSame( $expected, $this->types( $blocks ), 'Turning off ' . $item );
		}

		$titleless = $this->convert(
			$this->create_newsletter(
				$this->roundup( array_merge( $attrs, array( 'display' => array( 'title' => false ) ) ) )
			)
		);
		$this->assertSame( 'Excerpt of Alpha story', $titleless[1]['plaintext'] );
		$this->assertArrayNotHasKey( 'formattedText', $titleless[1] );
	}

	/**
	 * A roundup with every item off sends nothing, and no stray separators.
	 */
	public function test_every_item_off_sends_nothing_for_the_roundup(): void {
		$this->create_article( 'Alpha story', 1 );
		$this->create_article( 'Beta story', 2 );

		$display = array(
			'image'   => false,
			'title'   => false,
			'excerpt' => false,
			'button'  => false,
		);

		$blocks = $this->convert(
			$this->create_newsletter(
				$this->paragraph( 'Intro' ) . $this->roundup( array( 'count' => 2, 'display' => $display ) )
			)
		);

		$this->assertSame( array( 'paragraph' ), $this->types( $blocks ) );
	}

	/**
	 * Edited title, excerpt and button label reach beehiiv, the link stays the post's own,
	 * and the source post is untouched.
	 */
	public function test_card_edits_replace_the_posts_text_and_never_change_the_post(): void {
		$one = $this->create_article( 'Alpha story', 1 );
		$two = $this->create_article( 'Beta story', 2 );

		$overrides = array(
			(string) $one => array(
				'title'       => 'A better headline',
				'excerpt'     => 'A shorter summary.',
				'buttonLabel' => 'Keep reading',
			),
		);

		$blocks = $this->convert(
			$this->create_newsletter( $this->roundup( array( 'count' => 2, 'overrides' => $overrides ) ) )
		);

		$this->assertSame( 'A better headline', $blocks[0]['formattedText'][0]['text'] ?? wp_json_encode( $blocks[0] ) );
		$this->assertStringContainsString( 'A better headline', wp_json_encode( $blocks[0] ) );
		$this->assertSame( get_permalink( $one ), $blocks[0]['formattedText'][0]['link']['href'] );
		$this->assertSame( 'A shorter summary.', $blocks[1]['plaintext'] );
		$this->assertSame( 'Keep reading', $blocks[2]['text'] );
		$this->assertSame( get_permalink( $one ), $blocks[2]['href'] );

		// The second post keeps its own values.
		$this->assertStringContainsString( 'Beta story', wp_json_encode( $blocks[4] ) );
		$this->assertSame( 'Read more', $blocks[6]['text'] );

		// The source post is unchanged.
		$this->assertSame( 'Alpha story', get_the_title( $one ) );
		$this->assertSame( 'Excerpt of Alpha story', get_post( $one )->post_excerpt );
		$this->assertSame( 'Beta story', get_the_title( $two ) );
	}

	/**
	 * A cleared edit falls back to the post's own value.
	 */
	public function test_empty_edits_fall_back_to_the_post(): void {
		$one = $this->create_article( 'Alpha story', 1 );

		$overrides = array(
			(string) $one => array(
				'title'       => '   ',
				'excerpt'     => '',
				'buttonLabel' => ' ',
			),
		);

		$blocks = $this->convert(
			$this->create_newsletter( $this->roundup( array( 'count' => 1, 'overrides' => $overrides ) ) )
		);

		$this->assertStringContainsString( 'Alpha story', wp_json_encode( $blocks[0] ) );
		$this->assertSame( 'Excerpt of Alpha story', $blocks[1]['plaintext'] );
		$this->assertSame( 'Read more', $blocks[2]['text'] );
	}

	/**
	 * Edits are plain text: markup is stripped and entities are decoded.
	 */
	public function test_edits_are_sanitized_to_plain_text(): void {
		$one = $this->create_article( 'Alpha story', 1 );

		$overrides = PostRoundup::overrides(
			array(
				'overrides' => array(
					(string) $one => array(
						'title'       => '<script>alert(1)</script>Fish &amp; <em>Chips</em>',
						'excerpt'     => '<p onclick="x()">Tidy</p>',
						'buttonLabel' => 'Go <br>now',
						'imageId'     => 'abc',
					),
					'0'           => array( 'title' => 'Ignored' ),
					'bad'         => array( 'title' => 'Ignored' ),
				),
			)
		);

		$this->assertSame( array( $one ), array_keys( $overrides ) );
		$this->assertSame( 'Fish & Chips', $overrides[ $one ]['title'] );
		$this->assertSame( 'Tidy', $overrides[ $one ]['excerpt'] );
		$this->assertSame( 'Go now', $overrides[ $one ]['button_label'] );
		$this->assertSame( 0, $overrides[ $one ]['image_id'] );
	}

	/**
	 * An edited image replaces the featured image; an invalid or deleted one falls back to it.
	 */
	public function test_edited_image_replaces_the_featured_image_and_invalid_ids_fall_back(): void {
		$one = $this->create_article( 'Alpha story', 1 );
		$this->add_featured_image( $one, 'alpha.jpg' );

		$chosen = self::factory()->attachment->create(
			array(
				'post_mime_type' => 'image/jpeg',
				'file'           => 'chosen.jpg',
			)
		);
		update_post_meta( $chosen, '_wp_attachment_image_alt', 'Alt of chosen' );

		$blocks = $this->convert(
			$this->create_newsletter(
				$this->roundup( array( 'count' => 1, 'overrides' => array( (string) $one => array( 'imageId' => $chosen ) ) ) )
			)
		);
		$this->assertStringContainsString( 'chosen.jpg', $blocks[0]['imageUrl'] );
		$this->assertSame( 'Alt of chosen', $blocks[0]['alt_text'] );
		$this->assertSame( get_permalink( $one ), $blocks[0]['url'] );

		// A post ID is not an image attachment, so the featured image stays.
		$not_image = $this->create_article( 'Not an image', 5 );
		$blocks    = $this->convert(
			$this->create_newsletter(
				$this->roundup( array( 'count' => 1, 'overrides' => array( (string) $one => array( 'imageId' => $not_image ) ) ) )
			)
		);
		$this->assertStringContainsString( 'alpha.jpg', $blocks[0]['imageUrl'] );

		// A deleted attachment also falls back.
		wp_delete_attachment( $chosen, true );
		$blocks = $this->convert(
			$this->create_newsletter(
				$this->roundup( array( 'count' => 1, 'overrides' => array( (string) $one => array( 'imageId' => $chosen ) ) ) )
			)
		);
		$this->assertStringContainsString( 'alpha.jpg', $blocks[0]['imageUrl'] );
	}

	/**
	 * A card with no featured image can still get an edited image.
	 */
	public function test_edited_image_is_added_to_a_post_without_a_featured_image(): void {
		$one    = $this->create_article( 'Alpha story', 1 );
		$chosen = self::factory()->attachment->create(
			array(
				'post_mime_type' => 'image/jpeg',
				'file'           => 'chosen.jpg',
			)
		);

		$blocks = $this->convert(
			$this->create_newsletter(
				$this->roundup( array( 'count' => 1, 'overrides' => array( (string) $one => array( 'imageId' => $chosen ) ) ) )
			)
		);

		$this->assertSame( 'image', $blocks[0]['type'] );
		$this->assertStringContainsString( 'chosen.jpg', $blocks[0]['imageUrl'] );
	}

	/**
	 * Edits follow the post, not its position, and work in manual mode.
	 */
	public function test_edits_follow_the_post_in_manual_mode(): void {
		$one = $this->create_article( 'Alpha story', 1 );
		$two = $this->create_article( 'Beta story', 2 );

		$blocks = $this->convert(
			$this->create_newsletter(
				$this->roundup(
					array(
						'mode'      => 'manual',
						'posts'     => array( array( 'id' => $two ), array( 'id' => $one ) ),
						'overrides' => array( (string) $one => array( 'buttonLabel' => 'Open it' ) ),
					)
				)
			)
		);

		// Order is Beta then Alpha; only Alpha's button changed.
		$this->assertSame( 'Read more', $blocks[2]['text'] );
		$this->assertSame( 'Open it', $blocks[6]['text'] );
	}

	/**
	 * The preview data carries the default button label for the editor to show.
	 */
	public function test_cards_carry_the_default_button_label(): void {
		$one = $this->create_article( 'Alpha story', 1 );

		$this->assertSame( 'Read more', PostRoundup::cards( array( $one ) )[0]['button_label'] );
	}

	/* ------------------------------------------------------------ AC-010 card layout. */

	/**
	 * Layout defaults to full width and image placement to the left.
	 */
	public function test_layout_defaults_to_full_and_placement_to_left(): void {
		$this->assertSame( 'full', PostRoundup::layout( array() ) );
		$this->assertSame( 'full', PostRoundup::layout( array( 'layout' => '40-60' ) ) );
		$this->assertSame( '30-70', PostRoundup::layout( array( 'layout' => '30-70' ) ) );
		$this->assertSame( 'left', PostRoundup::image_placement( array() ) );
		$this->assertSame( 'left', PostRoundup::image_placement( array( 'imagePlacement' => 'up' ) ) );
		$this->assertSame( 'right', PostRoundup::image_placement( array( 'imagePlacement' => 'right' ) ) );
	}

	/**
	 * Full keeps the image above the text, as before.
	 */
	public function test_full_layout_keeps_the_image_above_the_text(): void {
		$one = $this->create_article( 'Alpha story', 1 );
		$this->add_featured_image( $one, 'alpha.jpg' );

		$blocks = $this->convert(
			$this->create_newsletter( $this->roundup( array( 'count' => 1, 'layout' => 'full', 'imagePlacement' => 'right' ) ) )
		);

		$this->assertSame( array( 'image', 'paragraph', 'paragraph', 'button' ), $this->types( $blocks ) );
	}

	/**
	 * A split layout sends the image and the text as two columns with the ratio as widths.
	 */
	public function test_split_layouts_send_two_columns_at_the_ratio(): void {
		$one = $this->create_article( 'Alpha story', 1 );
		$this->add_featured_image( $one, 'alpha.jpg' );

		$cases = array(
			'50-50' => array( 50, 50 ),
			'30-70' => array( 30, 70 ),
			'70-30' => array( 70, 30 ),
		);

		foreach ( $cases as $layout => $widths ) {
			foreach ( array( 'left', 'right' ) as $placement ) {
				$blocks = $this->convert(
					$this->create_newsletter(
						$this->roundup( array( 'count' => 1, 'layout' => $layout, 'imagePlacement' => $placement ) )
					)
				);

				$this->assertSame( array( 'columns' ), $this->types( $blocks ), "$layout $placement" );
				$this->assertTrue( $blocks[0]['stackOnMobile'] );
				$this->assertSame( array( 'top', 'top' ), array_column( $blocks[0]['columns'], 'verticalAlign' ) );

				$columns = $blocks[0]['columns'];
				$this->assertCount( 2, $columns );

				$image_at = 'left' === $placement ? 0 : 1;
				$text_at  = 1 - $image_at;

				$this->assertSame( array( 'image' ), array_column( $columns[ $image_at ]['blocks'], 'type' ) );
				$this->assertSame( $widths[0], $columns[ $image_at ]['width'], "$layout $placement image width" );
				$this->assertSame(
					array( 'paragraph', 'paragraph', 'button' ),
					array_column( $columns[ $text_at ]['blocks'], 'type' )
				);
				$this->assertSame( $widths[1], $columns[ $text_at ]['width'], "$layout $placement text width" );
				$this->assertStringContainsString( 'alpha.jpg', $columns[ $image_at ]['blocks'][0]['imageUrl'] );
				$this->assertArrayNotHasKey( 'imageAlignment', $columns[ $image_at ]['blocks'][0] );
			}
		}
	}

	/**
	 * A card with no image stays full width, and cards are separated as before.
	 */
	public function test_split_layout_falls_back_for_cards_without_an_image(): void {
		$one = $this->create_article( 'Alpha story', 1 );
		$two = $this->create_article( 'Beta story', 2 );
		$this->add_featured_image( $one, 'alpha.jpg' );

		$blocks = $this->convert(
			$this->create_newsletter( $this->roundup( array( 'count' => 2, 'layout' => '30-70' ) ) )
		);

		$this->assertSame(
			array( 'columns', 'content_break', 'paragraph', 'paragraph', 'button' ),
			$this->types( $blocks )
		);
		$this->assertSame( get_permalink( $two ), $blocks[4]['href'] );
	}

	/**
	 * Hidden items and a hidden image leave the card full width.
	 */
	public function test_split_layout_respects_the_display_choices(): void {
		$one = $this->create_article( 'Alpha story', 1 );
		$this->add_featured_image( $one, 'alpha.jpg' );

		$without_image = $this->convert(
			$this->create_newsletter(
				$this->roundup( array( 'count' => 1, 'layout' => '50-50', 'display' => array( 'image' => false ) ) )
			)
		);
		$this->assertSame( array( 'paragraph', 'paragraph', 'button' ), $this->types( $without_image ) );

		$image_only = $this->convert(
			$this->create_newsletter(
				$this->roundup(
					array(
						'count'   => 1,
						'layout'  => '50-50',
						'display' => array(
							'title'   => false,
							'excerpt' => false,
							'button'  => false,
						),
					)
				)
			)
		);
		$this->assertSame( array( 'image' ), $this->types( $image_only ) );

		$no_button = $this->convert(
			$this->create_newsletter(
				$this->roundup( array( 'count' => 1, 'layout' => '70-30', 'display' => array( 'button' => false ) ) )
			)
		);
		$this->assertSame( array( 'columns' ), $this->types( $no_button ) );
		$this->assertSame(
			array( 'paragraph', 'paragraph' ),
			array_column( $no_button[0]['columns'][1]['blocks'], 'type' )
		);
	}
}
