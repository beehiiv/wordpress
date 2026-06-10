/**
 * Shared notice styling for the Beehiiv post settings sidebar.
 */
import { Notice } from '@wordpress/components';

/**
 * @param {Object}                    props
 * @param {string}                    props.status   WordPress notice status.
 * @param {import('react').ReactNode} props.children Notice content.
 */
export default function PostSettingsNotice( { status, children } ) {
	return (
		<Notice
			className="beehiiv-post-settings-notice"
			status={ status }
			isDismissible={ false }
		>
			{ children }
		</Notice>
	);
}
