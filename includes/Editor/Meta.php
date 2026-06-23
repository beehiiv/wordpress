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

	/**
	 * ISO 8601 datetime when the newsletter should send. Empty = on publish.
	 *
	 * @since 1.0.0
	 */
	public const SEND_TO_NEWSLETTER_DATE = '_beehiiv_send_to_newsletter_date';

	/**
	 * Whether to send a snippet newsletter (teaser) instead of the full post.
	 *
	 * @since 1.0.0
	 */
	public const SEND_TO_NEWSLETTER_SNIPPET = '_beehiiv_send_to_newsletter_snippet';

	/**
	 * Beehiiv post template ID for this post. Empty = use plugin default.
	 *
	 * @since 1.0.0
	 */
	public const BEEHIIV_POST_TEMPLATE_ID = '_beehiiv_post_template_id';

	/**
	 * Beehiiv post ID after the newsletter has been created via the API.
	 *
	 * @since 1.0.0
	 */
	public const BEEHIIV_POST_ID = '_beehiiv_post_id';

	/**
	 * UTC ISO 8601 datetime last synced to Beehiiv `scheduled_at` for a linked post.
	 *
	 * @since 1.0.0
	 */
	public const BEEHIIV_SCHEDULED_AT = '_beehiiv_scheduled_at';

	/**
	 * User-facing error after a failed newsletter save or send (`save` or `send`).
	 *
	 * @since 1.0.0
	 */
	public const NEWSLETTER_ERROR = '_beehiiv_newsletter_error';

	/**
	 * Error category for {@see Meta::NEWSLETTER_ERROR}: `save` or `send`.
	 *
	 * @since 1.0.0
	 */
	public const NEWSLETTER_ERROR_TYPE = '_beehiiv_newsletter_error_type';
}
