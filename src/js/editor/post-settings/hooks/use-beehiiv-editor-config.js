/**
 * Site-wide beehiiv editor settings from PHP (`beehiivPostSettings`).
 */

const DEFAULT_CONFIG = {
	isConnected: false,
	appUrl: '',
	settingsUrl: '',
	hasPublication: false,
	hasPostTemplate: false,
	publicationId: '',
	defaultPostTemplateId: '',
	canPublishPosts: false,
};

/**
 * @return {typeof DEFAULT_CONFIG} Site-wide beehiiv connection and settings state.
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
