/**
 * Per-post beehiiv publication state for the block editor.
 *
 * Mirrors the server's `PublicationResolver`: an empty choice uses the site-wide
 * default publication, and a choice that is no longer connected falls back to it.
 */
import { useBeehiivEditorConfig } from './use-beehiiv-editor-config';
import { useEditorPublications } from './use-editor-publications';

/**
 * @typedef {Object} PostPublication
 * @property {Array<{id: string, name: string}>} publications           Connected publications.
 * @property {string}                            defaultPublicationId   Site-wide default publication ID.
 * @property {string}                            storedPublicationId    Publication saved on the post, or empty.
 * @property {string}                            effectivePublicationId Publication the newsletter will use, or empty.
 * @property {boolean}                           isDefaultPublication   Whether the effective publication is the default.
 * @property {boolean}                           isFallback             Whether the saved publication is no longer connected.
 * @property {boolean}                           missingPublication     Whether no publication can be used yet.
 * @property {boolean}                           requireChoice          Whether an editor must choose this post's template.
 * @property {boolean}                           missingTemplate        Whether the post still needs a template.
 * @property {boolean}                           isPostReady            Whether the post has a publication and a template.
 */

/**
 * @param {import('./use-beehiiv-post-meta').BeehiivPostMeta|null} beehiivMeta Post meta.
 * @return {PostPublication} Per-post publication state.
 */
export function usePostPublication( beehiivMeta ) {
	const {
		defaultPublicationId,
		defaultPostTemplateId,
		requireTemplateChoice,
	} = useBeehiivEditorConfig();
	const publications = useEditorPublications().filter( ( item ) => item?.id );
	const storedPublicationId = beehiivMeta?.beehiivPublicationId || '';
	const templateId = beehiivMeta?.beehiivPostTemplateId || '';

	const isFallback =
		!! storedPublicationId &&
		storedPublicationId !== defaultPublicationId &&
		!! defaultPublicationId &&
		publications.length > 0 &&
		! publications.some( ( item ) => item.id === storedPublicationId );

	const effectivePublicationId = isFallback
		? defaultPublicationId
		: storedPublicationId || defaultPublicationId || '';
	const isDefaultPublication =
		!! effectivePublicationId &&
		effectivePublicationId === defaultPublicationId;

	// With the required-template setting on, a never-sent post has no automatic template.
	const requireChoice =
		requireTemplateChoice && ! beehiivMeta?.newsletterAlreadySent;

	// On fallback the server uses the default template only.
	let hasTemplate;
	if ( requireChoice ) {
		hasTemplate = ! isFallback && !! templateId;
	} else if ( isFallback ) {
		hasTemplate = !! defaultPostTemplateId;
	} else {
		hasTemplate =
			!! templateId ||
			( isDefaultPublication && !! defaultPostTemplateId );
	}

	return {
		publications,
		defaultPublicationId: defaultPublicationId || '',
		storedPublicationId,
		effectivePublicationId,
		isDefaultPublication,
		isFallback,
		requireChoice,
		missingPublication: ! effectivePublicationId,
		missingTemplate: !! effectivePublicationId && ! hasTemplate,
		isPostReady: !! effectivePublicationId && hasTemplate,
	};
}
