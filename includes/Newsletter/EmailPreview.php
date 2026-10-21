<?php
/**
 * Builds the in-editor preview of the real beehiiv email for a saved post.
 *
 * @package beehiiv
 */

namespace Beehiiv\Newsletter;

use Beehiiv\API\Resources\Posts;
use Beehiiv\API\Resources\Workspace;
use Beehiiv\Connection\Manager;
use Beehiiv\Editor\Meta;
use WP_Error;
use WP_Post;

defined( 'ABSPATH' ) || exit;

/**
 * Brings the post's linked beehiiv draft up to date with the saved post, then fetches
 * beehiiv's rendered email. The draft lifecycle belongs to {@see Sender}; a failed
 * preview never touches the post's newsletter error, link, toggle or send date.
 *
 * @link https://developers.beehiiv.com/api-reference/posts/show
 * @since x.x.x
 */
final class EmailPreview {

	/**
	 * Sync the draft from the saved post and fetch the rendered email once.
	 *
	 * A new email can still be in preparation at beehiiv, so this never waits: when the email
	 * is not ready it returns `processing`, and the editor polls with `$fetch_only` (no new
	 * sync) until it is ready or it gives up. No PHP request is ever held open.
	 *
	 * @param int  $post_id    Post ID.
	 * @param bool $fetch_only Only fetch the email of the already linked draft; skip the sync.
	 * @return array{html: string, subject: string, preview_text: string, from_name: string}
	 *     |array{processing: bool}|WP_Error
	 * @since x.x.x
	 */
	public static function render( int $post_id, bool $fetch_only = false ) {
		if ( $fetch_only ) {
			// A sync syncs after checking eligibility itself; a fetch-only call checks it here.
			$eligibility = self::check_eligibility( $post_id );

			if ( is_wp_error( $eligibility ) ) {
				return $eligibility;
			}

			// Another request is creating or replacing the draft: ask the editor to wait.
			if ( Sender::is_preview_in_progress( $post_id ) ) {
				return [ 'processing' => true ];
			}

			if ( ! Sender::is_draft_linked( $post_id ) ) {
				return new WP_Error(
					'beehiiv_preview_failed',
					__( "Something went wrong and the preview couldn't load. Try again.", 'beehiiv' )
				);
			}

			$beehiiv_post_id = (string) get_post_meta( $post_id, Meta::BEEHIIV_POST_ID, true );
		} else {
			$synced = Sender::sync_preview_draft( $post_id );

			if ( is_wp_error( $synced ) ) {
				return self::classify_sync_error( $synced );
			}

			$beehiiv_post_id = $synced['beehiiv_post_id'];
		}

		$publication_id = PublicationResolver::get_linked_publication_id( $post_id );
		$result         = Posts::get_email_content( $publication_id, $beehiiv_post_id );

		if ( ! $result['success'] ) {
			return self::classify_api_error( (string) $result['error'], $result['status_code'] );
		}

		if ( '' === trim( $result['email_html'] ) ) {
			return [ 'processing' => true ];
		}

		return [
			'html'         => $result['email_html'],
			'subject'      => self::resolve_subject( $post_id, $result['subject'] ),
			'preview_text' => self::resolve_preview_text( $post_id, $result['preview_text'] ),
			'from_name'    => PublicationResolver::get_publication_name( $publication_id ),
		];
	}

	/**
	 * Subject line: what beehiiv holds, else the post's newsletter title, else the post title.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $fetched Subject returned by beehiiv.
	 * @return string
	 * @since x.x.x
	 */
	private static function resolve_subject( int $post_id, string $fetched ): string {
		if ( '' !== trim( $fetched ) ) {
			return $fetched;
		}

		$newsletter_title = get_post_meta( $post_id, Meta::NEWSLETTER_TITLE, true );

		if ( is_string( $newsletter_title ) && '' !== trim( $newsletter_title ) ) {
			return html_entity_decode( trim( $newsletter_title ) );
		}

		return html_entity_decode( get_the_title( $post_id ) );
	}

	/**
	 * Preview text: what beehiiv holds, else the post's newsletter subtitle, else nothing.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $fetched Preview text returned by beehiiv.
	 * @return string
	 * @since x.x.x
	 */
	private static function resolve_preview_text( int $post_id, string $fetched ): string {
		if ( '' !== trim( $fetched ) ) {
			return $fetched;
		}

		$subtitle = get_post_meta( $post_id, Meta::NEWSLETTER_SUBTITLE, true );

		return is_string( $subtitle ) ? html_entity_decode( trim( $subtitle ) ) : '';
	}

	/**
	 * Whether the saved post can be previewed right now.
	 *
	 * @param int $post_id Post ID.
	 * @return true|WP_Error
	 * @since x.x.x
	 */
	public static function check_eligibility( int $post_id ) {
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

		if ( Sender::has_beehiiv_post_id( $post_id ) && ! Sender::is_draft_linked( $post_id ) ) {
			return new WP_Error(
				'beehiiv_newsletter_confirmed',
				__( 'This newsletter is already scheduled or sent, so it can no longer be previewed.', 'beehiiv' )
			);
		}

		if ( ! rest_sanitize_boolean( get_post_meta( $post_id, Meta::SEND_TO_NEWSLETTER, true ) )
			&& ! Sender::is_draft_linked( $post_id ) ) {
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

		if ( '' === PublicationResolver::resolve_for_post( $post_id ) ) {
			return new WP_Error(
				'beehiiv_missing_publication',
				__( 'Choose a publication in <a>beehiiv settings</a>, then try again.', 'beehiiv' )
			);
		}

		$publication_id = PublicationResolver::resolve_for_post( $post_id );

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

	/**
	 * Turn a draft sync failure into a classified preview error.
	 *
	 * @param WP_Error $error Error from {@see Sender::sync_preview_draft()}.
	 * @return WP_Error
	 * @since x.x.x
	 */
	private static function classify_sync_error( WP_Error $error ): WP_Error {
		$code = $error->get_error_code();

		if ( in_array( $code, [ 'beehiiv_draft_create_failed', 'beehiiv_draft_update_failed' ], true ) ) {
			return self::classify_api_error( $error->get_error_message(), null );
		}

		if ( 0 === strpos( $code, 'beehiiv_post_' ) || 0 === strpos( $code, 'beehiiv_blocks_' )
			|| 0 === strpos( $code, 'beehiiv_advertisement_' ) ) {
			return new WP_Error( 'beehiiv_preview_content', Sender::format_save_error_message( $error ) );
		}

		return $error;
	}

	/**
	 * Classify a beehiiv API failure.
	 *
	 * @param string   $error       Error string from the API client.
	 * @param int|null $status_code HTTP status code when known.
	 * @return WP_Error
	 * @since x.x.x
	 */
	private static function classify_api_error( string $error, ?int $status_code ): WP_Error {
		if ( null === $status_code && preg_match( '/^HTTP (\d+):/i', trim( $error ), $matches ) ) {
			$status_code = (int) $matches[1];
		}

		if ( 401 === $status_code || 403 === $status_code ) {
			return new WP_Error(
				'beehiiv_preview_connection',
				__(
					// phpcs:ignore Generic.Files.LineLength.MaxExceeded,Generic.Files.LineLength.TooLong -- Single string for translators / i18n tools.
					'beehiiv refused the request. Reconnect your account in <a>beehiiv settings</a> and make sure it has access to read posts.',
					'beehiiv'
				)
			);
		}

		if ( 402 === $status_code ) {
			return new WP_Error(
				'beehiiv_preview_plan',
				__( 'Email preview needs beehiiv Send API access (Max and Enterprise plans).', 'beehiiv' )
			);
		}

		if ( preg_match( '/^HTTP (\d+):\s*(.+)$/is', trim( $error ), $matches ) && 429 !== (int) $matches[1] ) {
			return new WP_Error(
				'beehiiv_preview_failed',
				sprintf(
					/* translators: %s: error message from beehiiv. */
					__( "beehiiv couldn't prepare the preview: %s", 'beehiiv' ),
					trim( $matches[2] )
				)
			);
		}

		$mapped = Sender::format_api_error_message( $error );

		return new WP_Error(
			'beehiiv_preview_failed',
			'' !== $mapped ? $mapped : __( "Something went wrong and the preview couldn't load. Try again.", 'beehiiv' )
		);
	}
}
