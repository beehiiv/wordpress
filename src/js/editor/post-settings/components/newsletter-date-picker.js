/**
 * Schedule when a queued newsletter should send (mirrors core post schedule UX).
 */
import { __, sprintf } from '@wordpress/i18n';
import { Button, DateTimePicker, Dropdown, Icon } from '@wordpress/components';
import {
	dateI18n,
	format,
	getDate,
	getSettings,
	isInTheFuture,
} from '@wordpress/date';
import { closeSmall } from '@wordpress/icons';
import { useMemo, useState } from '@wordpress/element';
import { useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';

import PostSettingsNotice from './post-settings-notice';

/**
 * Validate a custom newsletter send datetime against now and the post publish time.
 *
 * @param {string|null|undefined} sendDate        ISO 8601 datetime, or empty for "On publish".
 * @param {string|null|undefined} postPublishDate WordPress post publish datetime.
 * @return {{ valid: true } | { valid: false, message: string }} Validation result.
 */
export function getNewsletterSendDateValidation( sendDate, postPublishDate ) {
	if ( ! sendDate ) {
		return { valid: true };
	}

	const send = getDate( sendDate );

	if ( Number.isNaN( send.getTime() ) ) {
		return {
			valid: false,
			message: __(
				'Invalid date. Please choose a different date and time.',
				'beehiiv'
			),
		};
	}

	if ( ! isInTheFuture( sendDate ) ) {
		return {
			valid: false,
			message: __(
				'Send date has already passed. Please pick a future date and time.',
				'beehiiv'
			),
		};
	}

	const now = getDate();
	const publish = postPublishDate ? getDate( postPublishDate ) : null;

	if (
		publish &&
		! Number.isNaN( publish.getTime() ) &&
		publish > now &&
		send < publish
	) {
		return {
			valid: false,
			message: __(
				"The newsletter can't send before this post is published. Choose a later send time, or schedule the post first.",
				'beehiiv'
			),
		};
	}

	return { valid: true };
}

/**
 * Whether the newsletter sends on publish rather than at a later custom time.
 *
 * @param {string|null|undefined} sendDate        ISO 8601 datetime, or empty for "On publish".
 * @param {string|null|undefined} postPublishDate WordPress post publish datetime.
 * @return {boolean} True when send tracks the post publish time.
 */
export function isNewsletterSendOnPublish( sendDate, postPublishDate ) {
	if ( ! sendDate ) {
		return true;
	}

	const send = getDate( sendDate );

	if ( Number.isNaN( send.getTime() ) ) {
		return false;
	}

	const publish = postPublishDate ? getDate( postPublishDate ) : null;

	if ( ! publish || Number.isNaN( publish.getTime() ) ) {
		return false;
	}

	return send.getTime() <= publish.getTime();
}

/**
 * Label for the newsletter send schedule control.
 *
 * @param {string|null|undefined} sendDate        ISO 8601 datetime, or empty for "On publish".
 * @param {string|null|undefined} postPublishDate WordPress post publish datetime.
 * @return {string} Display label.
 */
export function getNewsletterSendDateLabel( sendDate, postPublishDate ) {
	if ( isNewsletterSendOnPublish( sendDate, postPublishDate ) ) {
		return __( 'On publish', 'beehiiv' );
	}

	return `${ format( 'M j, Y g:i a', sendDate ) } ${ dateI18n(
		'T',
		sendDate
	) }`;
}

/**
 * Earliest calendar day allowed for newsletter scheduling.
 *
 * @param {string|null|undefined} postPublishDate WordPress post publish datetime.
 * @return {Date} Earliest allowed calendar day for the date picker.
 */
function getMinimumSendDay( postPublishDate ) {
	const now = getDate();
	const publish = postPublishDate ? getDate( postPublishDate ) : null;

	if ( publish && ! Number.isNaN( publish.getTime() ) && publish > now ) {
		return publish;
	}

	return now;
}

/**
 * @param {Object}                      props
 * @param {string|null}                 props.date     ISO 8601 datetime, or null to send on WP post publish.
 * @param {(date: string|null) => void} props.onChange Called when the user picks a new send time.
 */
export default function NewsletterDatePicker( { date, onChange } ) {
	const { l10n } = getSettings();
	const [ pickerDate, setPickerDate ] = useState( null );

	const postPublishDate = useSelect(
		( select ) => select( editorStore ).getEditedPostAttribute( 'date' ),
		[]
	);

	const minimumSendDay = useMemo(
		() => getMinimumSendDay( postPublishDate ),
		[ postPublishDate ]
	);

	const validation = getNewsletterSendDateValidation( date, postPublishDate );
	const dateLabel = getNewsletterSendDateLabel( date, postPublishDate );

	const isInvalidDate = ( day ) => {
		const candidate = new Date( day );
		candidate.setHours( 0, 0, 0, 0 );

		const minimum = new Date( minimumSendDay );
		minimum.setHours( 0, 0, 0, 0 );

		return candidate < minimum;
	};

	const openPicker = ( onToggle ) => {
		setPickerDate( date ?? postPublishDate ?? new Date() );
		onToggle();
	};

	const closePicker = ( onToggle ) => {
		setPickerDate( null );
		onToggle();
	};

	const handlePickerChange = ( newDate ) => {
		setPickerDate( newDate );

		if ( isNewsletterSendOnPublish( newDate, postPublishDate ) ) {
			onChange( null );
			return;
		}

		onChange( newDate );
	};

	const handleOnPublishClick = () => {
		setPickerDate( postPublishDate ?? new Date() );
		onChange( null );
	};

	return (
		<>
			<Dropdown
				className="beehiiv-newsletter-date"
				popoverProps={ { placement: 'left-start' } }
				focusOnMount
				onClose={ () => setPickerDate( null ) }
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
								__(
									'Change newsletter send time: %s',
									'beehiiv'
								),
								dateLabel
							) }
							onClick={ () =>
								isOpen
									? closePicker( onToggle )
									: openPicker( onToggle )
							}
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
									onClick={ handleOnPublishClick }
								>
									{ __( 'On Publish', 'beehiiv' ) }
								</Button>
								<Button
									onClick={ () => closePicker( onToggle ) }
									aria-label={ __( 'Close', 'beehiiv' ) }
								>
									<Icon icon={ closeSmall } />
								</Button>
							</div>
						</div>
						<DateTimePicker
							currentDate={ pickerDate ?? date ?? new Date() }
							onChange={ handlePickerChange }
							startOfWeek={ l10n.startOfWeek }
							dateOrder="dmy"
							is12Hour
							isInvalidDate={ isInvalidDate }
						/>
					</div>
				) }
			/>
			{ ! validation.valid && (
				<PostSettingsNotice status="error">
					{ validation.message }
				</PostSettingsNotice>
			) }
		</>
	);
}
