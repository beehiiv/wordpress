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
