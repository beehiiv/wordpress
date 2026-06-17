/**
 * Beehiiv post meta for the block editor.
 *
 * Uses `useEntityProp` so meta reads/writes stay in sync with the post entity
 * store (same pattern as core post fields).
 */
import { useEffect, useRef } from '@wordpress/element';
import { useRegistry, useSelect } from '@wordpress/data';
import { useEntityProp, store as coreStore } from '@wordpress/core-data';
import { store as editorStore } from '@wordpress/editor';

import {
	META_BEEHIIV_POST_ID,
	META_NEWSLETTER_ERROR,
	META_NEWSLETTER_ERROR_TYPE,
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
 * @property {string|null}                 newsletterError            User-facing save or send error from the server.
 * @property {string|null}                 newsletterErrorType        `save` or `send` when {@link newsletterError} is set.
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
	const registry = useRegistry();

	const postPublishDate = useSelect(
		( select ) => select( editorStore ).getEditedPostAttribute( 'date' ),
		[]
	);

	const { postId, isSavingPost, didPostSaveRequestSucceed } = useSelect(
		( select ) => {
			const editor = select( editorStore );

			return {
				postId: editor.getCurrentPostId(),
				isSavingPost: editor.isSavingPost(),
				didPostSaveRequestSucceed: editor.didPostSaveRequestSucceed(),
			};
		},
		[]
	);

	const wasSavingPostRef = useRef( false );

	useEffect( () => {
		const wasSavingPost = wasSavingPostRef.current;
		wasSavingPostRef.current = isSavingPost;

		if (
			! wasSavingPost ||
			isSavingPost ||
			! didPostSaveRequestSucceed ||
			! postType ||
			! postId
		) {
			return;
		}

		const serverMeta = registry
			.select( coreStore )
			.getEntityRecord( 'postType', postType, postId )?.meta;

		if ( ! serverMeta ) {
			return;
		}

		const editedMeta = registry
			.select( coreStore )
			.getEditedEntityRecord( 'postType', postType, postId )?.meta;

		if ( ! editedMeta ) {
			return;
		}

		setMeta( {
			...editedMeta,
			[ META_BEEHIIV_POST_ID ]: serverMeta[ META_BEEHIIV_POST_ID ] ?? '',
			[ META_SEND_TO_NEWSLETTER ]:
				!! serverMeta[ META_SEND_TO_NEWSLETTER ],
			[ META_NEWSLETTER_ERROR ]:
				serverMeta[ META_NEWSLETTER_ERROR ] ?? '',
			[ META_NEWSLETTER_ERROR_TYPE ]:
				serverMeta[ META_NEWSLETTER_ERROR_TYPE ] ?? '',
		} );
	}, [
		didPostSaveRequestSucceed,
		isSavingPost,
		postId,
		postType,
		registry,
		setMeta,
	] );

	// When the post is rescheduled later than a custom newsletter send time, bump the
	// send time to match. Shorter post schedules leave an explicit later send time alone.
	useEffect( () => {
		if ( ! postType ) {
			return;
		}

		const rawDate = meta?.[ META_SEND_TO_NEWSLETTER_DATE ];
		const customDate =
			typeof rawDate === 'string' && rawDate.length > 0 ? rawDate : null;
		const rawBeehiivPostId = meta?.[ META_BEEHIIV_POST_ID ];
		const alreadySent =
			typeof rawBeehiivPostId === 'string' && rawBeehiivPostId.length > 0;

		if ( ! customDate || alreadySent ) {
			return;
		}

		const publish = postPublishDate ? new Date( postPublishDate ) : null;
		const send = new Date( customDate );

		if (
			! publish ||
			Number.isNaN( publish.getTime() ) ||
			Number.isNaN( send.getTime() )
		) {
			return;
		}

		if ( publish > send ) {
			setMeta( {
				...meta,
				[ META_SEND_TO_NEWSLETTER_DATE ]: '',
			} );
		}
		// Only run when the WordPress publish schedule changes.
		// eslint-disable-next-line react-hooks/exhaustive-deps -- meta read on post date change only.
	}, [ postPublishDate, postType, setMeta ] );

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
	const rawNewsletterError = meta?.[ META_NEWSLETTER_ERROR ];
	const newsletterError =
		typeof rawNewsletterError === 'string' && rawNewsletterError.length > 0
			? rawNewsletterError
			: null;
	const rawNewsletterErrorType = meta?.[ META_NEWSLETTER_ERROR_TYPE ];
	const newsletterErrorType =
		typeof rawNewsletterErrorType === 'string' &&
		rawNewsletterErrorType.length > 0
			? rawNewsletterErrorType
			: null;

	const patchMeta = ( patch ) => {
		setMeta( { ...meta, ...patch } );
	};

	return {
		sendToNewsletter,
		sendToNewsletterDate,
		sendToNewsletterSnippet,
		newsletterAlreadySent,
		newsletterError,
		newsletterErrorType,
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
