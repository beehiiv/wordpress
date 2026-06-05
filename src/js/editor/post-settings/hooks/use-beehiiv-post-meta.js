/**
 * Beehiiv post meta for the block editor.
 *
 * Uses `useEntityProp` so meta reads/writes stay in sync with the post entity
 * store (same pattern as core post fields).
 */
import { useSelect } from '@wordpress/data';
import { useEntityProp } from '@wordpress/core-data';
import { store as editorStore } from '@wordpress/editor';

import {
	META_BEEHIIV_POST_ID,
	META_SEND_TO_NEWSLETTER,
	META_SEND_TO_NEWSLETTER_DATE,
	META_SEND_TO_NEWSLETTER_SNIPPET,
} from '../../../shared/meta';

/**
 * @typedef {Object} BeehiivPostMeta
 * @property {boolean}                     sendToNewsletter           Whether this post is queued for Beehiiv.
 * @property {string|null}                 sendToNewsletterDate       ISO 8601 datetime, or null to send on WP post publish.
 * @property {boolean}                     sendToNewsletterSnippet    Whether to send a snippet instead of the full post.
 * @property {boolean}                     newsletterAlreadySent      Whether this post was already sent to Beehiiv.
 * @property {(enabled: boolean) => void}  setSendToNewsletter        Enable or disable newsletter delivery.
 * @property {(date: string|null) => void} setSendToNewsletterDate    Set scheduled send time.
 * @property {(enabled: boolean) => void}  setSendToNewsletterSnippet Enable or disable snippet delivery.
 */

/**
 * @return {BeehiivPostMeta|null} Null while the post type is still resolving.
 */
export function useBeehiivPostMeta() {
	const postType = useSelect(
		( select ) => select( editorStore ).getCurrentPostType(),
		[]
	);

	const [ meta, setMeta ] = useEntityProp( 'postType', postType, 'meta' );

	if ( ! postType ) {
		return null;
	}

	const sendToNewsletter = !! meta?.[ META_SEND_TO_NEWSLETTER ];
	const sendToNewsletterSnippet =
		!! meta?.[ META_SEND_TO_NEWSLETTER_SNIPPET ];
	const rawDate = meta?.[ META_SEND_TO_NEWSLETTER_DATE ];
	const sendToNewsletterDate =
		typeof rawDate === 'string' && rawDate.length > 0 ? rawDate : null;
	const rawBeehiivPostId = meta?.[ META_BEEHIIV_POST_ID ];
	const newsletterAlreadySent =
		typeof rawBeehiivPostId === 'string' && rawBeehiivPostId.length > 0;

	const patchMeta = ( patch ) => {
		setMeta( { ...meta, ...patch } );
	};

	return {
		sendToNewsletter,
		sendToNewsletterDate,
		sendToNewsletterSnippet,
		newsletterAlreadySent,
		setSendToNewsletter( enabled ) {
			if ( newsletterAlreadySent ) {
				return;
			}

			patchMeta( {
				[ META_SEND_TO_NEWSLETTER ]: enabled,
				...( enabled
					? {}
					: {
							[ META_SEND_TO_NEWSLETTER_DATE ]: '',
							[ META_SEND_TO_NEWSLETTER_SNIPPET ]: false,
					  } ),
			} );
		},
		setSendToNewsletterDate( date ) {
			if ( newsletterAlreadySent ) {
				return;
			}

			patchMeta( {
				[ META_SEND_TO_NEWSLETTER_DATE ]: date ?? '',
			} );
		},
		setSendToNewsletterSnippet( enabled ) {
			if ( newsletterAlreadySent ) {
				return;
			}

			patchMeta( {
				[ META_SEND_TO_NEWSLETTER_SNIPPET ]: enabled,
			} );
		},
	};
}
