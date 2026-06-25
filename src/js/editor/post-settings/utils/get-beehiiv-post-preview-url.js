/**
 * Build the beehiiv web app URL for a linked post.
 *
 * @param {string} appUrl        beehiiv app base URL (e.g. https://app.beehiiv.com).
 * @param {string} beehiivPostId Linked beehiiv post ID from post meta.
 * @return {string|null} Preview URL, or null when inputs are missing.
 */
export default function getBeehiivPostPreviewUrl( appUrl, beehiivPostId ) {
	if (
		typeof appUrl !== 'string' ||
		appUrl.length === 0 ||
		typeof beehiivPostId !== 'string' ||
		beehiivPostId.length === 0
	) {
		return null;
	}

	const base = appUrl.replace( /\/$/, '' );
	const postId = beehiivPostId.startsWith( 'post_' )
		? beehiivPostId.slice( 5 )
		: beehiivPostId;

	return `${ base }/posts/${ postId }`;
}
