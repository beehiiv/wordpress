<?php
/**
 * Decides whether a saved post can be previewed as a beehiiv email.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\API\Resources\Workspace;
use Beehiiv\Connection\Manager;
use Beehiiv\Editor\Meta;
use WP_Error;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * The single definition of "can this post be previewed", shared by the draft sync in
 * {@see Sender} and the preview in {@see EmailPreview}. It reads post meta directly so it
 * depends on neither class.
 *
 * @since x.x.x
 */
final class PreviewEligibility {

	/**
	 * Whether the saved post can be previewed right now.
	 *
	 * @param int $post_id Post ID.
	 * @return true|WP_Error True when eligible, or an error with an editor-facing message.
	 * @since x.x.x
	 */
	public static function check( int $post_id ) {
		$post = get_post( $post_id );

		if ( ! $post instanceof WP_Post || 'post' !== $post->post_type ) {
			return new WP_Error(
				'beehiiv_post_not_found',
				__( 'This post no longer exists. Save or reload the editor and try again.', 'beehiiv' )
			);
		}

		if ( ! current_user_can( 'publish_posts', $post_id ) ) {
			return new WP_Error(
				'beehiiv_preview_forbidden',
				__( "You don't have permission to preview this newsletter.", 'beehiiv' )
			);
		}

		$is_linked       = '' !== trim( (string) get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true ) );
		$is_draft_linked = $is_linked && 'draft' === get_post_meta( $post_id, Meta::BEEHIIV_POST_STATE, true );

		if ( $is_linked && ! $is_draft_linked ) {
			return new WP_Error(
				'beehiiv_newsletter_confirmed',
				__( 'This newsletter is already scheduled or sent, so it can no longer be previewed.', 'beehiiv' )
			);
		}

		$is_opted_in = rest_sanitize_boolean( get_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, true ) );

		if ( ! $is_opted_in && ! $is_draft_linked ) {
			return new WP_Error(
				'beehiiv_preview_not_opted_in',
				__( 'Turn on "Send to newsletter" to preview this email.', 'beehiiv' )
			);
		}

		if ( ! Manager::is_connected() ) {
			return new WP_Error(
				'beehiiv_not_connected',
				__( 'Connect your beehiiv account in <a>beehiiv settings</a> to preview.', 'beehiiv' )
			);
		}

		$publication_id = PublicationResolver::resolve_for_post( $post_id );

		if ( '' === $publication_id ) {
			return new WP_Error(
				'beehiiv_missing_publication',
				__( 'Choose a publication in <a>beehiiv settings</a>, then try again.', 'beehiiv' )
			);
		}

		if ( '' === PostSettingsBuilder::resolve_post_template_id( $post_id, $publication_id ) ) {
			return new WP_Error(
				'beehiiv_missing_post_template',
				__( 'Choose a default post template in <a>beehiiv settings</a> to preview.', 'beehiiv' )
			);
		}

		if ( ! Workspace::can_write_posts() ) {
			return new WP_Error(
				'beehiiv_preview_plan',
				__( 'Email preview needs beehiiv Send API access (Max and Enterprise plans).', 'beehiiv' )
			);
		}

		return true;
	}
}
