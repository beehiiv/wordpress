/**
 * Beehiiv post settings plugin sidebar.
 *
 * Registers a dedicated editor sidebar on the default `post` post type.
 */
import { __ } from '@wordpress/i18n';
import { registerPlugin } from '@wordpress/plugins';
import { PluginSidebar, store as editorStore } from '@wordpress/editor';
import { Notice, PanelBody, ToggleControl } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';

import BeehiivSidebarIcon from './icon';
import NewsletterDatePicker from './components/newsletter-date-picker';
import { useBeehiivPostMeta } from './hooks/use-beehiiv-post-meta';

import './editor.scss';

const sidebarIcon = <BeehiivSidebarIcon />;

const PLUGIN_NAME = 'beehiiv-post-settings';
const SIDEBAR_NAME = 'beehiiv-post-settings';

function BeehiivPostSettingsPanel() {
	const beehiivMeta = useBeehiivPostMeta();

	if ( ! beehiivMeta ) {
		return null;
	}

	const {
		sendToNewsletter,
		sendToNewsletterDate,
		sendToNewsletterSnippet,
		setSendToNewsletter,
		setSendToNewsletterDate,
		setSendToNewsletterSnippet,
	} = beehiivMeta;

	return (
		<div className="beehiiv-post-settings-content">
			<PanelBody>
				<ToggleControl
					label={ __( 'Send to newsletter', 'beehiiv' ) }
					help={ __(
						'Queue this post for delivery via Beehiiv when published.',
						'beehiiv'
					) }
					checked={ sendToNewsletter }
					onChange={ setSendToNewsletter }
				/>
				{ sendToNewsletter && (
					<>
						<Notice
							className="beehiiv-post-settings-notice"
							status="warning"
							isDismissible={ false }
						>
							{ __(
								'The newsletter can only be sent once and cannot be undone.',
								'beehiiv'
							) }
						</Notice>

						<NewsletterDatePicker
							date={ sendToNewsletterDate }
							onChange={ setSendToNewsletterDate }
						/>

						<ToggleControl
							className="beehiiv-post-settings-snippet"
							label={ __( 'Snippet newsletter', 'beehiiv' ) }
							help={
								sendToNewsletterSnippet ? (
									<>
										{ __(
											'Send a snippet newsletter with a "Read More" button to the full post.',
											'beehiiv'
										) }
										<br />
										<br />
										{ __(
											'Insert the "More" block in your post to mark where the snippet ends.',
											'beehiiv'
										) }
									</>
								) : (
									__(
										'Send a snippet newsletter with a "Read More" button to the full post.',
										'beehiiv'
									)
								)
							}
							checked={ sendToNewsletterSnippet }
							onChange={ setSendToNewsletterSnippet }
						/>
					</>
				) }
			</PanelBody>
		</div>
	);
}

function BeehiivPostSettingsSidebar() {
	const { postType, canPublishPosts } = useSelect( ( select ) => {
		const editor = select( editorStore );
		const core = select( coreStore );

		return {
			postType: editor.getCurrentPostType(),
			canPublishPosts: core.canUser( 'publish', 'posts' ),
		};
	}, [] );

	// Only on the `post` post type. `canUser` is undefined while resolving — do not
	// treat that as denied or the sidebar icon never registers.
	if ( postType && postType !== 'post' ) {
		return null;
	}

	if ( canPublishPosts === false ) {
		return null;
	}

	return (
		<PluginSidebar
			name={ SIDEBAR_NAME }
			title={ __( 'Beehiiv', 'beehiiv' ) }
			icon={ sidebarIcon }
			className="beehiiv-post-settings"
		>
			<BeehiivPostSettingsPanel />
		</PluginSidebar>
	);
}

registerPlugin( PLUGIN_NAME, {
	icon: sidebarIcon,
	render: BeehiivPostSettingsSidebar,
} );
