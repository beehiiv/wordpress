/**
 * Site-wide Beehiiv editor settings from PHP (`beehiivPostSettings`).
 */

const DEFAULT_CONFIG = {
	isConnected: false,
	settingsUrl: '',
	hasPublication: false,
	hasEmailTemplate: false,
	canPublishPosts: false,
};

/**
 * @return {typeof DEFAULT_CONFIG} Site-wide Beehiiv connection and settings state.
 */
export function useBeehiivEditorConfig() {
	if (
		typeof window !== 'undefined' &&
		window.beehiivPostSettings &&
		typeof window.beehiivPostSettings === 'object'
	) {
		return {
			...DEFAULT_CONFIG,
			...window.beehiivPostSettings,
		};
	}

	return DEFAULT_CONFIG;
}
