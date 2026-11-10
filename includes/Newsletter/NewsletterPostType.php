<?php
/**
 * Registers the non-public newsletter content type and its list table columns.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\Config;
use Beehiiv\Editor\Meta;
use Beehiiv\REST\NewslettersController;

defined( 'ABSPATH' ) || exit;

/**
 * Newsletters are written in the block editor and sent to beehiiv. They have no
 * public page, so they never reach the site, search, sitemaps or feeds.
 *
 * @since x.x.x
 */
final class NewsletterPostType {

	public const STATUS_NOT_SENT  = 'not_sent';
	public const STATUS_SCHEDULED = 'scheduled';
	public const STATUS_SENT      = 'sent';
	public const STATUS_FAILED    = 'failed';

	/**
	 * List table column key for the beehiiv status.
	 */
	private const STATUS_COLUMN = 'beehiiv_status';

	/**
	 * Register hooks.
	 *
	 * @return void
	 * @since x.x.x
	 */
	public static function init(): void {
		add_action( 'init', [ self::class, 'register' ] );
		add_filter( 'manage_' . ContentTypes::NEWSLETTER . '_posts_columns', [ self::class, 'columns' ] );
		add_action(
			'manage_' . ContentTypes::NEWSLETTER . '_posts_custom_column',
			[ self::class, 'render_column' ],
			10,
			2
		);
	}

	/**
	 * Register the post type as a submenu of the beehiiv menu.
	 *
	 * @return void
	 * @since x.x.x
	 */
	public static function register(): void {
		register_post_type(
			ContentTypes::NEWSLETTER,
			[
				'labels'                => [
					'name'               => __( 'Newsletters', 'beehiiv' ),
					'singular_name'      => __( 'Newsletter', 'beehiiv' ),
					'add_new'            => __( 'Add New', 'beehiiv' ),
					'add_new_item'       => __( 'Add New Newsletter', 'beehiiv' ),
					'edit_item'          => __( 'Edit Newsletter', 'beehiiv' ),
					'new_item'           => __( 'New Newsletter', 'beehiiv' ),
					'view_item'          => __( 'View Newsletter', 'beehiiv' ),
					'search_items'       => __( 'Search Newsletters', 'beehiiv' ),
					'not_found'          => __( 'No newsletters found.', 'beehiiv' ),
					'not_found_in_trash' => __( 'No newsletters found in Trash.', 'beehiiv' ),
					'all_items'          => __( 'Newsletters', 'beehiiv' ),
					'menu_name'          => __( 'Newsletters', 'beehiiv' ),
				],
				'public'                => false,
				'publicly_queryable'    => false,
				'exclude_from_search'   => true,
				'show_in_nav_menus'     => false,
				'show_in_admin_bar'     => false,
				'show_ui'               => true,
				'show_in_menu'          => Config::PLUGIN_SLUG,
				'show_in_rest'          => true,
				'rest_base'             => 'beehiiv-newsletters',
				'rest_controller_class' => NewslettersController::class,
				'has_archive'           => false,
				'rewrite'               => false,
				'query_var'             => false,
				'can_export'            => true,
				'capability_type'       => 'post',
				'map_meta_cap'          => true,
				'supports'              => [ 'title', 'editor', 'author', 'custom-fields' ],
			]
		);
	}

	/**
	 * List table columns: title, beehiiv status, author, date.
	 *
	 * @param array<string, string> $columns Default columns.
	 * @return array<string, string>
	 * @since x.x.x
	 */
	public static function columns( $columns ): array {
		return [
			'cb'                => $columns['cb'] ?? '<input type="checkbox" />',
			'title'             => __( 'Title', 'beehiiv' ),
			self::STATUS_COLUMN => __( 'beehiiv status', 'beehiiv' ),
			'author'            => __( 'Author', 'beehiiv' ),
			'date'              => __( 'Date', 'beehiiv' ),
		];
	}

	/**
	 * Render the beehiiv status cell.
	 *
	 * @param string $column  Column key.
	 * @param int    $post_id Post ID.
	 * @return void
	 * @since x.x.x
	 */
	public static function render_column( $column, $post_id ): void {
		if ( self::STATUS_COLUMN !== $column ) {
			return;
		}

		echo esc_html( self::status_label( self::get_status( (int) $post_id ) ) );
	}

	/**
	 * The beehiiv status as last recorded by WordPress (local meta only, no API call).
	 *
	 * @param int $post_id Post ID.
	 * @return string One of the STATUS_* constants.
	 * @since x.x.x
	 */
	public static function get_status( int $post_id ): string {
		$error = get_post_meta( $post_id, Meta::NEWSLETTER_ERROR, true );

		if ( is_string( $error ) && '' !== trim( $error ) ) {
			return self::STATUS_FAILED;
		}

		if ( ! Sender::has_beehiiv_post_id( $post_id ) ) {
			return self::STATUS_NOT_SENT;
		}

		if ( Sender::is_newsletter_sent( $post_id ) ) {
			return self::STATUS_SENT;
		}

		$scheduled_at = get_post_meta( $post_id, Meta::BEEHIIV_SCHEDULED_AT, true );
		$scheduled_at = is_string( $scheduled_at ) ? trim( $scheduled_at ) : '';
		$timestamp    = PostSettingsBuilder::utc_scheduled_at_to_timestamp( $scheduled_at );

		if ( null !== $timestamp && $timestamp > time() && ! Sender::is_newsletter_published( $post_id ) ) {
			return self::STATUS_SCHEDULED;
		}

		return Sender::is_newsletter_published( $post_id ) ? self::STATUS_SENT : self::STATUS_NOT_SENT;
	}

	/**
	 * Human label for a status.
	 *
	 * @param string $status STATUS_* constant.
	 * @return string
	 * @since x.x.x
	 */
	public static function status_label( string $status ): string {
		switch ( $status ) {
			case self::STATUS_FAILED:
				return __( 'Failed', 'beehiiv' );
			case self::STATUS_SCHEDULED:
				return __( 'Scheduled', 'beehiiv' );
			case self::STATUS_SENT:
				return __( 'Sent', 'beehiiv' );
			default:
				return __( 'Not sent', 'beehiiv' );
		}
	}
}
