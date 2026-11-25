export const MODE_AUTO = 'auto';
export const MODE_MANUAL = 'manual';
export const DEFAULT_COUNT = 3;
export const MIN_COUNT = 1;
export const MAX_COUNT = 10;

/**
 * Keep the automatic post count within the allowed range.
 *
 * @param {*} value Requested count.
 * @return {number} Whole number from MIN_COUNT to MAX_COUNT.
 */
export function clampCount( value ) {
	const number = Math.round( Number( value ) );

	if ( ! Number.isFinite( number ) ) {
		return DEFAULT_COUNT;
	}

	return Math.max( MIN_COUNT, Math.min( MAX_COUNT, number ) );
}

/**
 * Short random id that tells this block's frozen list apart from other roundups.
 *
 * @return {string} Lowercase alphanumeric id.
 */
export function createUid() {
	return Math.random().toString( 36 ).slice( 2, 10 );
}

/**
 * Build the preview request path from the block attributes.
 *
 * Mirrors the server resolver inputs, so the preview and the send agree.
 *
 * @param {number} postId     Newsletter post ID.
 * @param {Object} attributes Block attributes.
 * @return {string} REST path.
 */
export function getPreviewPath( postId, attributes ) {
	const { mode, count, posts, uid } = attributes;
	const params = new URLSearchParams( { post_id: String( postId ) } );

	params.set( 'mode', mode === MODE_MANUAL ? MODE_MANUAL : MODE_AUTO );
	params.set( 'uid', uid || '' );

	if ( mode === MODE_MANUAL ) {
		( posts || [] ).forEach( ( post ) => {
			params.append( 'ids[]', String( post.id ) );
		} );
	} else {
		params.set( 'count', String( clampCount( count ) ) );
	}

	return `/beehiiv/v1/post-roundup?${ params.toString() }`;
}

export const LAYOUT_FULL = 'full';

// Share of the card width the image takes, per layout (image to text).
export const LAYOUT_IMAGE_WIDTH = { '50-50': 50, '30-70': 30, '70-30': 70 };

export const MAX_COLUMNS = 3;

export const DISPLAY_ITEMS = [
	'image',
	'title',
	'author',
	'date',
	'excerpt',
	'button',
];

// Whether each item shows when the block stores no choice. Author and date are opt-in.
const DISPLAY_DEFAULTS = {
	image: true,
	title: true,
	author: false,
	date: false,
	excerpt: true,
	button: true,
};

/**
 * Which card items the block shows. Every item is shown unless turned off.
 *
 * @param {Object} attributes Block attributes.
 * @return {Object} Boolean flag per item.
 */
export function getDisplay( attributes ) {
	const stored = attributes?.display || {};

	return DISPLAY_ITEMS.reduce(
		( display, item ) => ( {
			...display,
			[ item ]:
				stored[ item ] === undefined
					? DISPLAY_DEFAULTS[ item ]
					: stored[ item ] !== false,
		} ),
		{}
	);
}

/**
 * A card with the author's edits applied. An empty edit keeps the post's value.
 *
 * @param {Object}      card     Card from the preview endpoint.
 * @param {Object|null} override Stored edits for the post.
 * @return {Object} Card with title, excerpt and buttonLabel to show.
 */
export function mergeCard( card, override ) {
	const edit = override || {};

	return {
		...card,
		title: edit.title || card.title,
		excerpt: edit.excerpt || card.excerpt,
		buttonLabel: edit.buttonLabel || card.button_label,
		author: edit.author || card.author,
		date: edit.date || card.date,
		caption: edit.caption || '',
		imageId: edit.imageId || 0,
	};
}

/**
 * Store one card edit, dropping empty values and empty entries.
 *
 * @param {Object} overrides Current overrides keyed by post ID.
 * @param {number} postId    Post the edit belongs to.
 * @param {Object} changes   Fields to change.
 * @return {Object} New overrides.
 */
export function setOverride( overrides, postId, changes ) {
	const next = {
		...( overrides || {} ),
		[ postId ]: { ...( overrides?.[ postId ] || {} ), ...changes },
	};

	Object.keys( next[ postId ] ).forEach( ( field ) => {
		if ( ! next[ postId ][ field ] ) {
			delete next[ postId ][ field ];
		}
	} );

	if ( ! Object.keys( next[ postId ] ).length ) {
		delete next[ postId ];
	}

	return next;
}

/**
 * Drop edits for posts that are no longer listed.
 *
 * @param {Object}   overrides Overrides keyed by post ID.
 * @param {number[]} listedIds Post IDs in the roundup now.
 * @return {Object} Overrides for listed posts only.
 */
export function pruneOverrides( overrides, listedIds ) {
	return Object.keys( overrides || {} ).reduce(
		( kept, id ) =>
			listedIds.includes( Number( id ) )
				? { ...kept, [ id ]: overrides[ id ] }
				: kept,
		{}
	);
}

/**
 * Escape plain text so it can be used as RichText content.
 *
 * @param {string} text Plain text.
 * @return {string} HTML-safe text.
 */
export function escapeText( text ) {
	return String( text || '' )
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' );
}

/**
 * How many cards sit side by side, from 1 to 3.
 *
 * @param {*} value Requested columns.
 * @return {number} Whole number from 1 to MAX_COLUMNS.
 */
export function clampColumns( value ) {
	const number = Math.round( Number( value ) );

	if ( ! Number.isFinite( number ) ) {
		return 1;
	}

	return Math.max( 1, Math.min( MAX_COLUMNS, number ) );
}

/**
 * Split cards into rows of the given size. The last row may be shorter.
 *
 * @param {Object[]} cards   Cards.
 * @param {number}   columns Cards per row.
 * @return {Object[][]} Rows of cards.
 */
export function chunkRows( cards, columns ) {
	const rows = [];

	for ( let index = 0; index < cards.length; index += columns ) {
		rows.push( cards.slice( index, index + columns ) );
	}

	return rows;
}
