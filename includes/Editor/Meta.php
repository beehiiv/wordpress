<?php
/**
 * Post meta keys exposed to the block editor.
 *
 * @package beehiiv
 */

namespace Beehiiv\Editor;

defined( 'ABSPATH' ) || exit;

/**
 * Canonical meta key strings (keep in sync with `src/js/shared/meta.js`).
 *
 * @since 1.0.0
 */
final class Meta {

	/**
	 * Whether the post should be sent to the Beehiiv newsletter on publish.
	 *
	 * @since 1.0.0
	 */
	public const SEND_TO_NEWSLETTER = '_beehiiv_send_to_newsletter';
}
