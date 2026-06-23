/**
 * Toggle whether this post is queued for beehiiv newsletter delivery.
 */
import { __ } from '@wordpress/i18n';
import { ToggleControl } from '@wordpress/components';

/**
 * @param {Object}                     props
 * @param {boolean}                    props.checked    Whether newsletter send is enabled.
 * @param {(enabled: boolean) => void} props.onChange   Called when the user toggles the setting.
 * @param {boolean}                    [props.disabled] Whether the toggle is read-only.
 */
export default function SendNewsletterToggle( {
	checked,
	onChange,
	disabled = false,
} ) {
	return (
		<ToggleControl
			className="beehiiv-send-newsletter-toggle"
			label={ __( 'Send to newsletter', 'beehiiv' ) }
			help={ __(
				'Queue this post for delivery via beehiiv when published.',
				'beehiiv'
			) }
			checked={ checked }
			disabled={ disabled }
			onChange={ onChange }
		/>
	);
}
