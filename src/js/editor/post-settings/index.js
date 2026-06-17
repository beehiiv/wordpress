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
import { PanelBody, ToggleControl } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';

import BeehiivSidebarIcon from './icon';
import NewsletterDatePicker, {
	getNewsletterSendDateValidation,
} from './components/newsletter-date-picker';
import NewsletterStatusNotices from './components/newsletter-status-notices';
import PostSettingsNotice from './components/post-settings-notice';
import SendNewsletterToggle from './components/send-newsletter-toggle';
import { OmittedBlocksNoticeMessage } from './components/omitted-blocks-notice';
import { useBeehiivEditorConfig } from './hooks/use-beehiiv-editor-config';
import { useBeehiivPostMeta } from './hooks/use-beehiiv-post-meta';

import './filters/with-omitted-block-indicator';
import './editor.scss';

const sidebarIcon = <BeehiivSidebarIcon />;

const PLUGIN_NAME = 'beehiiv-post-settings';
const SIDEBAR_NAME = 'beehiiv-post-settings';
const PRE_PUBLISH_PANEL_NAME = 'beehiiv-send-newsletter';

function usePostPublishDate() {
	return useSelect(
		( select ) => select( editorStore ).getEditedPostAttribute( 'date' ),
		[]
	);
}

function BeehiivPostSettingsPanel() {
	const beehiivMeta = useBeehiivPostMeta();
	const { isConnected, hasPublication, hasEmailTemplate } =
		useBeehiivEditorConfig();

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

	const isNewsletterReady = isConnected && hasPublication && hasEmailTemplate;

	return (
		<div className="beehiiv-post-settings-content">
			<PanelBody>
				<SendNewsletterToggle
					checked={ sendToNewsletter }
					onChange={ setSendToNewsletter }
					disabled={ newsletterAlreadySent || ! isNewsletterReady }
				/>

				<NewsletterStatusNotices beehiivMeta={ beehiivMeta } />

				{ newsletterAlreadySent && (
					<PostSettingsNotice status="success">
						{ __(
							'This post was sent to your Beehiiv newsletter.',
							'beehiiv'
						) }
					</PostSettingsNotice>
				) }
				{ sendToNewsletter && ! newsletterAlreadySent && (
					<>
						<PostSettingsNotice status="warning">
							<p className="beehiiv-post-settings-notice__text">
								{ __(
									'The newsletter can only be sent once and cannot be undone.',
									'beehiiv'
								) }
							</p>

							<OmittedBlocksNoticeMessage />
						</PostSettingsNotice>

						<NewsletterDatePicker
							date={ sendToNewsletterDate }
							onChange={ setSendToNewsletterDate }
						/>

						<ToggleControl
							className="beehiiv-post-settings-snippet"
							label={ __( 'Snippet newsletter', 'beehiiv' ) }
							help={
								<>
									{ __(
										'Send a snippet newsletter with a "Read More" button to the full post.',
										'beehiiv'
									) }
									{ sendToNewsletterSnippet && (
										<>
											<br />
											<br />
											{ __(
												'Insert the "More" block in your post to mark where the snippet ends.',
												'beehiiv'
											) }
										</>
									) }
								</>
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
	const postPublishDate = usePostPublishDate();
	const { isConnected, hasPublication, hasEmailTemplate } =
		useBeehiivEditorConfig();

	if ( postType && postType !== 'post' ) {
		return null;
	}

	if ( canPublishPosts === false ) {
		return null;
	}

	if ( ! beehiivMeta ) {
		return null;
	}

	const {
		sendToNewsletter,
		sendToNewsletterDate,
		setSendToNewsletter,
		newsletterAlreadySent,
	} = beehiivMeta;
	const isNewsletterReady = isConnected && hasPublication && hasEmailTemplate;
	const sendDateValidation = getNewsletterSendDateValidation(
		sendToNewsletterDate,
		postPublishDate
	);

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
				disabled={ newsletterAlreadySent || ! isNewsletterReady }
			/>
			{ sendToNewsletter &&
				! newsletterAlreadySent &&
				! sendDateValidation.valid && (
					<PostSettingsNotice status="error">
						{ sendDateValidation.message }
					</PostSettingsNotice>
				) }
		</PluginPrePublishPanel>
	);
}

function BeehiivPostSettingsPlugin() {
	const { canPublishPosts } = useBeehiivPostSettingsEligibility();

	if ( canPublishPosts === false ) {
		return null;
	}

	return (
		<>
			<BeehiivPostSettingsSidebar />
			<BeehiivSendNewsletterPrePublishPanel />
		</>
	);
}

if (
	typeof window !== 'undefined' &&
	window.beehiivPostSettings?.canPublishPosts
) {
	registerPlugin( PLUGIN_NAME, {
		icon: sidebarIcon,
		render: BeehiivPostSettingsPlugin,
	} );
}
