/**
 * Beehiiv post settings plugin sidebar.
 *
 * Registers a dedicated editor sidebar on the default `post` post type.
 */
import { __ } from '@wordpress/i18n';
import { registerPlugin } from '@wordpress/plugins';
import { PluginSidebar, store as editorStore } from '@wordpress/editor';
import { Notice, PanelBody, ToggleControl } from '@wordpress/components';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';

import { META_SEND_TO_NEWSLETTER } from '../../shared/meta';
import BeehiivSidebarIcon from './icon';

import './editor.scss';

const sidebarIcon = <BeehiivSidebarIcon />;

const PLUGIN_NAME = 'beehiiv-post-settings';
const SIDEBAR_NAME = 'beehiiv-post-settings';

function BeehiivPostSettingsPanel() {
	const meta = useSelect(
		( select ) =>
			select( editorStore ).getEditedPostAttribute( 'meta' ) || {},
		[]
	);

	const { editPost } = useDispatch( editorStore );

	const sendToNewsletter = !! meta[ META_SEND_TO_NEWSLETTER ];

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
					onChange={ ( value ) =>
						editPost( {
							meta: { [ META_SEND_TO_NEWSLETTER ]: value },
						} )
					}
				/>
				{ sendToNewsletter && (
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
