/**
 * Beehiiv post settings plugin sidebar.
 *
 * Registers a dedicated editor sidebar on the default `post` post type.
 */
import { __ } from '@wordpress/i18n';
import { registerPlugin } from '@wordpress/plugins';
import {
	PluginSidebar,
	PluginPrePublishPanel,
	store as editorStore,
} from '@wordpress/editor';
import { Notice, PanelBody, ToggleControl } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';

import BeehiivSidebarIcon from './icon';
import NewsletterDatePicker from './components/newsletter-date-picker';
import SendNewsletterToggle from './components/send-newsletter-toggle';
import { useBeehiivPostMeta } from './hooks/use-beehiiv-post-meta';

import './editor.scss';

const sidebarIcon = <BeehiivSidebarIcon />;

const PLUGIN_NAME = 'beehiiv-post-settings';
const SIDEBAR_NAME = 'beehiiv-post-settings';
const PRE_PUBLISH_PANEL_NAME = 'beehiiv-send-newsletter';

function BeehiivPostSettingsPanel() {
	const beehiivMeta = useBeehiivPostMeta();

	if ( ! beehiivMeta ) {
		return null;
	}

	const {
		sendToNewsletter,
		sendToNewsletterDate,
		sendToNewsletterSnippet,
		newsletterAlreadySent,
		setSendToNewsletter,
		setSendToNewsletterDate,
		setSendToNewsletterSnippet,
	} = beehiivMeta;

	return (
		<div className="beehiiv-post-settings-content">
			<PanelBody>
				<SendNewsletterToggle
					checked={ sendToNewsletter }
					onChange={ setSendToNewsletter }
					disabled={ newsletterAlreadySent }
				/>
				{ newsletterAlreadySent && (
					<Notice
						className="beehiiv-post-settings-notice"
						status="info"
						isDismissible={ false }
					>
						{ __(
							'This post was already sent to your Beehiiv newsletter.',
							'beehiiv'
						) }
					</Notice>
				) }
				{ sendToNewsletter && ! newsletterAlreadySent && (
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

function useBeehiivPostSettingsEligibility() {
	return useSelect( ( select ) => {
		const editor = select( editorStore );
		const core = select( coreStore );

		return {
			postType: editor.getCurrentPostType(),
			canPublishPosts: core.canUser( 'publish', 'posts' ),
		};
	}, [] );
}

function BeehiivPostSettingsSidebar() {
	const { postType, canPublishPosts } = useBeehiivPostSettingsEligibility();

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

function BeehiivSendNewsletterPrePublishPanel() {
	const { postType, canPublishPosts } = useBeehiivPostSettingsEligibility();
	const beehiivMeta = useBeehiivPostMeta();

	if ( postType && postType !== 'post' ) {
		return null;
	}

	if ( canPublishPosts === false ) {
		return null;
	}

	if ( ! beehiivMeta ) {
		return null;
	}

	const { sendToNewsletter, setSendToNewsletter } = beehiivMeta;

	const sendToNewsletterStatus = sendToNewsletter
		? __( 'Yes', 'beehiiv' )
		: __( 'No', 'beehiiv' );

	return (
		<PluginPrePublishPanel
			name={ PRE_PUBLISH_PANEL_NAME }
			title={
				<>
					{ __( 'Send to newsletter:', 'beehiiv' ) }
					<span className="editor-post-publish-panel__link">
						{ sendToNewsletterStatus }
					</span>
				</>
			}
			icon={ false }
		>
			<SendNewsletterToggle
				checked={ sendToNewsletter }
				onChange={ setSendToNewsletter }
			/>
		</PluginPrePublishPanel>
	);
}

function BeehiivPostSettingsPlugin() {
	return (
		<>
			<BeehiivPostSettingsSidebar />
			<BeehiivSendNewsletterPrePublishPanel />
		</>
	);
}

registerPlugin( PLUGIN_NAME, {
	icon: sidebarIcon,
	render: BeehiivPostSettingsPlugin,
} );
