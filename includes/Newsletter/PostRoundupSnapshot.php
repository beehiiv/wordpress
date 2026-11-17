<?php
/**
 * Freezes the posts of automatic Post Roundup blocks at the first send or schedule.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\Editor\Meta;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Stores the resolved post IDs of each automatic roundup in post meta. Every sync
 * path (save, scheduled release, update, test email) converts blocks through
 * {@see PostRoundup::resolve_ids()}, which reads this snapshot instead of querying
 * again, so a scheduled newsletter goes out with the list the author scheduled.
 *
 * Shape: `[ block key => [ 'count' => int, 'ids' => int[] ] ]`.
 *
 * @since x.x.x
 */
final class PostRoundupSnapshot {

	/**
	 * Freeze automatic roundups that have no matching snapshot yet.
	 *
	 * Entries that still match their block's count are kept, so repeated syncs never
	 * refresh them. A changed count, or a new roundup, is frozen again; entries of
	 * removed roundups are dropped.
	 *
	 * @param WP_Post $post Newsletter post.
	 * @return void
	 * @since x.x.x
	 */
	public static function freeze( WP_Post $post ): void {
		if ( ! ContentTypes::is_newsletter( $post->post_type ) ) {
			return;
		}

		$existing = self::get( $post->ID );
		$next     = [];

		foreach ( self::find_roundups( parse_blocks( $post->post_content ) ) as $roundup ) {
			$attrs = $roundup['attrs'];
			$key   = $roundup['key'];

			if ( PostRoundup::MODE_AUTO !== PostRoundup::mode( $attrs ) ) {
				continue;
			}

			$count = PostRoundup::clamp_count( $attrs['count'] ?? PostRoundup::DEFAULT_COUNT );

			$next[ $key ] = null !== self::ids_from( $existing, $key, $count )
				? $existing[ $key ]
				: [
					'count' => $count,
					'ids'   => PostRoundup::latest_ids( $count, $post->ID ),
				];
		}

		if ( empty( $next ) ) {
			self::clear( $post->ID );
			return;
		}

		update_post_meta( $post->ID, Meta::ROUNDUP_SNAPSHOT, $next );
	}

	/**
	 * Every roundup in the blocks, including those inside layout blocks, with its key.
	 *
	 * Top-level roundups are keyed like the converter keys them, by position when they
	 * have no stored id. Nested roundups are keyed by stored id or by their settings.
	 *
	 * @param array<int, array<string, mixed>> $blocks   Parsed blocks.
	 * @param bool                             $is_nested Whether the blocks sit inside another block.
	 * @return array<int, array{attrs: array<string, mixed>, key: string}>
	 */
	private static function find_roundups( array $blocks, bool $is_nested = false ): array {
		$found   = [];
		$ordinal = 0;

		foreach ( $blocks as $block ) {
			if ( PostRoundup::BLOCK === ( $block['blockName'] ?? '' ) ) {
				$attrs   = (array) ( $block['attrs'] ?? [] );
				$found[] = [
					'attrs' => $attrs,
					'key'   => PostRoundup::block_key( $attrs, $is_nested ? null : $ordinal++ ),
				];
				continue;
			}

			if ( ! empty( $block['innerBlocks'] ) ) {
				$found = array_merge( $found, self::find_roundups( (array) $block['innerBlocks'], true ) );
			}
		}

		return $found;
	}

	/**
	 * Frozen post IDs for a block, when one exists for the given count.
	 *
	 * @param int    $post_id Newsletter post ID.
	 * @param string $key     Block key.
	 * @param int    $count   Count the block currently asks for.
	 * @return int[]|null Null when nothing is frozen for the block.
	 * @since x.x.x
	 */
	public static function ids_for( int $post_id, string $key, int $count ): ?array {
		return self::ids_from( self::get( $post_id ), $key, $count );
	}

	/**
	 * Forget the frozen lists, so the next send freezes them again.
	 *
	 * @param int $post_id Newsletter post ID.
	 * @return void
	 * @since x.x.x
	 */
	public static function clear( int $post_id ): void {
		delete_post_meta( $post_id, Meta::ROUNDUP_SNAPSHOT );
	}

	/**
	 * Stored snapshot of a post.
	 *
	 * @param int $post_id Newsletter post ID.
	 * @return array<string, array{count: int, ids: int[]}>
	 */
	private static function get( int $post_id ): array {
		$stored = get_post_meta( $post_id, Meta::ROUNDUP_SNAPSHOT, true );

		return is_array( $stored ) ? $stored : [];
	}

	/**
	 * Frozen IDs of one entry in a snapshot, when its count still matches.
	 *
	 * @param array<string, mixed> $snapshot Snapshot.
	 * @param string               $key      Block key.
	 * @param int                  $count    Current block count.
	 * @return int[]|null
	 */
	private static function ids_from( array $snapshot, string $key, int $count ): ?array {
		$entry = $snapshot[ $key ] ?? null;

		if ( ! is_array( $entry ) || ! isset( $entry['ids'], $entry['count'] ) || (int) $entry['count'] !== $count ) {
			return null;
		}

		return array_map( 'intval', (array) $entry['ids'] );
	}
}
