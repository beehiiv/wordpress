/**
 * Schedule when a queued newsletter should send (mirrors core post schedule UX).
 */
import { __, sprintf } from '@wordpress/i18n';
import { Button, DateTimePicker, Dropdown, Icon } from '@wordpress/components';
import { dateI18n, format, getSettings } from '@wordpress/date';
import { closeSmall } from '@wordpress/icons';
import { useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';

/**
 * @param {Object}                      props
 * @param {string|null}                 props.date     ISO 8601 datetime, or null to send on WP post publish.
 * @param {(date: string|null) => void} props.onChange Called when the user picks a new send time.
 */
export default function NewsletterDatePicker( { date, onChange } ) {
	const { l10n } = getSettings();

	// Get the post publish date from the editor store and use it as the "On Publish" date.
	const postPublishDate = useSelect(
		( select ) => select( editorStore ).getEditedPostAttribute( 'date' ),
		[]
	);

	const formattedPublishDate = postPublishDate
		? `${ format( 'M j, Y g:i a', postPublishDate ) } ${ dateI18n(
				'T',
				postPublishDate
		  ) }`
		: '';

	const dateLabel = date
		? `${ format( 'M j, Y g:i a', date ) } ${ dateI18n( 'T', date ) }`
		: formattedPublishDate
		? sprintf(
				/* translators: %s: WordPress post publish date and time. */
				__( 'On publish (%s)', 'beehiiv' ),
				formattedPublishDate
		  )
		: __( 'On publish', 'beehiiv' );

	return (
		<Dropdown
			className="beehiiv-newsletter-date"
			popoverProps={ { placement: 'left-start' } }
			focusOnMount
			renderToggle={ ( { isOpen, onToggle } ) => (
				<div className="beehiiv-newsletter-date__row">
					<span className="beehiiv-newsletter-date__label">
						{ __( 'Send', 'beehiiv' ) }
					</span>
					<Button
						className="beehiiv-newsletter-date__toggle edit-post-post-schedule__toggle"
						variant="tertiary"
						label={ dateLabel }
						showTooltip
						aria-expanded={ isOpen }
						aria-label={ sprintf(
							/* translators: %s: selected send date or "On publish". */
							__( 'Change newsletter send time: %s', 'beehiiv' ),
							dateLabel
						) }
						onClick={ onToggle }
					>
						{ dateLabel }
					</Button>
				</div>
			) }
			renderContent={ ( { onToggle } ) => (
				<div className="beehiiv-newsletter-date__popover">
					<div className="beehiiv-newsletter-date__popover-actions">
						<span className="beehiiv-newsletter-date__popover-label">
							{ __( 'Send', 'beehiiv' ) }
						</span>
						<div className="beehiiv-newsletter-date__popover-controls">
							<Button
								variant="tertiary"
								onClick={ () => onChange( null ) }
							>
								{ __( 'On Publish', 'beehiiv' ) }
							</Button>
							<Button
								onClick={ onToggle }
								aria-label={ __( 'Close', 'beehiiv' ) }
							>
								<Icon icon={ closeSmall } />
							</Button>
						</div>
					</div>
					<DateTimePicker
						currentDate={ date ?? postPublishDate ?? new Date() }
						onChange={ onChange }
						startOfWeek={ l10n.startOfWeek }
						dateOrder="dmy"
						is12Hour
					/>
				</div>
			) }
		/>
	);
}
