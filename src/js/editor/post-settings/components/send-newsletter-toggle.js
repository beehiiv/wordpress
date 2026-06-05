/**
 * Toggle whether this post is queued for Beehiiv newsletter delivery.
 */
import { __ } from '@wordpress/i18n';
import { ToggleControl } from '@wordpress/components';

/**
 * @param {Object}                     props
 * @param {boolean}                    props.checked  Whether newsletter send is enabled.
 * @param {(enabled: boolean) => void} props.onChange Called when the user toggles the setting.
 */
export default function SendNewsletterToggle( { checked, onChange } ) {
	return (
		<ToggleControl
			label={ __( 'Send to newsletter', 'beehiiv' ) }
			help={ __(
				'Queue this post for delivery via Beehiiv when published.',
				'beehiiv'
			) }
			checked={ checked }
			onChange={ onChange }
		/>
	);
}
