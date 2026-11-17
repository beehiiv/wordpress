import { useEffect, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import {
	InspectorControls,
	MediaUpload,
	MediaUploadCheck,
	RichText,
	useBlockProps,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import {
	Button,
	Notice,
	PanelBody,
	Placeholder,
	RangeControl,
	Spinner,
	RadioControl,
	ToggleControl,
} from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';
import { postList } from '@wordpress/icons';
import { ContentPicker } from '@10up/block-components';

import metadata from './block.json';
import {
	MAX_COUNT,
	MIN_COUNT,
	MODE_AUTO,
	MODE_MANUAL,
	clampCount,
	createUid,
	escapeText,
	LAYOUT_FULL,
	LAYOUT_IMAGE_WIDTH,
	getDisplay,
	getPreviewPath,
	mergeCard,
	pruneOverrides,
	setOverride,
} from './utils';

const LAYOUT_OPTIONS = [
	{ value: LAYOUT_FULL, label: __( 'Full', 'beehiiv' ) },
	{ value: '50-50', label: '50:50' },
	{ value: '30-70', label: '30:70' },
	{ value: '70-30', label: '70:30' },
];

const PLACEMENT_OPTIONS = [
	{ value: 'left', label: __( 'Left', 'beehiiv' ) },
	{ value: 'right', label: __( 'Right', 'beehiiv' ) },
];

function OptionButtons( { label, options, value, onChange, disabled } ) {
	return (
		<div className="beehiiv-post-roundup__options">
			<span className="beehiiv-post-roundup__options-label">
				{ label }
			</span>
			<div className="beehiiv-post-roundup__options-group" role="group">
				{ options.map( ( option ) => (
					<Button
						key={ option.value }
						variant={
							value === option.value ? 'primary' : 'secondary'
						}
						aria-pressed={ value === option.value }
						disabled={ disabled }
						onClick={ () => onChange( option.value ) }
					>
						{ option.label }
					</Button>
				) ) }
			</div>
		</div>
	);
}

const DISPLAY_LABELS = {
	image: __( 'Featured image', 'beehiiv' ),
	title: __( 'Title', 'beehiiv' ),
	excerpt: __( 'Excerpt', 'beehiiv' ),
	button: __( 'Read more button', 'beehiiv' ),
};

function PostCard( {
	card,
	display,
	layout,
	imagePlacement,
	override,
	onChange,
	onReset,
} ) {
	const merged = mergeCard( card, override );

	const media = useSelect(
		( select ) =>
			merged.imageId ? select( 'core' ).getMedia( merged.imageId ) : null,
		[ merged.imageId ]
	);

	const imageUrl = media
		? media.media_details?.sizes?.large?.source_url || media.source_url
		: card.image_url;
	const imageAlt = media ? media.alt_text : card.image_alt;

	// Typing the post's own text again stores nothing, so the post stays the source.
	const store = ( field, original ) => ( value ) =>
		onChange( {
			[ field ]: value === escapeText( original ) ? '' : value,
		} );

	// A split card needs an image to sit beside the text; without one it stays full width.
	const isSplit = layout !== LAYOUT_FULL && display.image && !! imageUrl;
	const cardClass = [
		'beehiiv-post-roundup__card',
		isSplit && 'beehiiv-post-roundup__card--split',
		isSplit &&
			imagePlacement === 'right' &&
			'beehiiv-post-roundup__card--image-right',
	]
		.filter( Boolean )
		.join( ' ' );

	return (
		<article
			className={ cardClass }
			style={
				isSplit
					? {
							'--beehiiv-image-width': `${ LAYOUT_IMAGE_WIDTH[ layout ] }%`,
					  }
					: undefined
			}
		>
			{ display.image && (
				<div className="beehiiv-post-roundup__media">
					{ imageUrl && (
						<img
							className="beehiiv-post-roundup__image"
							src={ imageUrl }
							alt={ imageAlt }
						/>
					) }
					<MediaUploadCheck>
						<MediaUpload
							allowedTypes={ [ 'image' ] }
							value={ merged.imageId }
							onSelect={ ( item ) =>
								onChange( { imageId: item.id } )
							}
							render={ ( { open } ) => (
								<Button
									variant="secondary"
									size="small"
									className="beehiiv-post-roundup__image-button"
									onClick={ open }
								>
									{ imageUrl
										? __( 'Replace image', 'beehiiv' )
										: __( 'Choose image', 'beehiiv' ) }
								</Button>
							) }
						/>
					</MediaUploadCheck>
				</div>
			) }
			<div className="beehiiv-post-roundup__body">
				{ display.title && (
					<p className="beehiiv-post-roundup__title">
						<strong>
							<RichText
								tagName="a"
								href={ card.url }
								value={ escapeText( merged.title ) }
								onChange={ store( 'title', card.title ) }
								onClick={ ( event ) => event.preventDefault() }
								allowedFormats={ [] }
								disableLineBreaks
								placeholder={ escapeText( card.title ) }
								aria-label={ __( 'Title', 'beehiiv' ) }
							/>
						</strong>
					</p>
				) }
				{ display.excerpt && (
					<RichText
						tagName="p"
						className="beehiiv-post-roundup__excerpt"
						value={ escapeText( merged.excerpt ) }
						onChange={ store( 'excerpt', card.excerpt ) }
						allowedFormats={ [] }
						disableLineBreaks
						placeholder={ escapeText( card.excerpt ) }
						aria-label={ __( 'Excerpt', 'beehiiv' ) }
					/>
				) }
				{ display.button && (
					<RichText
						tagName="span"
						className="beehiiv-post-roundup__button"
						value={ escapeText( merged.buttonLabel ) }
						onChange={ store( 'buttonLabel', card.button_label ) }
						allowedFormats={ [] }
						disableLineBreaks
						placeholder={ escapeText( card.button_label ) }
						aria-label={ __( 'Button label', 'beehiiv' ) }
					/>
				) }
				{ override && (
					<Button
						variant="link"
						className="beehiiv-post-roundup__reset"
						onClick={ onReset }
					>
						{ __( 'Reset to post', 'beehiiv' ) }
					</Button>
				) }
			</div>
		</article>
	);
}

export default function Edit( { attributes, setAttributes, clientId } ) {
	const { mode, count, posts, uid, overrides, layout, imagePlacement } =
		attributes;
	const isManual = mode === MODE_MANUAL;
	const display = getDisplay( attributes );
	const showsNothing = Object.values( display ).every( ( shown ) => ! shown );

	const { postId, firstUidClientId } = useSelect(
		( select ) => {
			// Look at every block, not only the top level: the roundup can sit
			// inside layout blocks such as Columns.
			const editor = select( blockEditorStore );
			const roundups = editor
				.getClientIdsWithDescendants()
				.map( ( id ) => editor.getBlock( id ) )
				.filter( ( block ) => block?.name === metadata.name );

			return {
				postId: select( 'core/editor' )?.getCurrentPostId(),
				firstUidClientId: roundups.find(
					( block ) => block.attributes.uid === uid
				)?.clientId,
			};
		},
		[ uid ]
	);

	// Each roundup needs its own id so its frozen list is kept apart from others.
	// A duplicated block gets a new id.
	const isDuplicateUid = !! uid && firstUidClientId !== clientId;

	useEffect( () => {
		if ( ! uid || isDuplicateUid ) {
			setAttributes( { uid: createUid() } );
		}
	}, [ uid, isDuplicateUid, setAttributes ] );

	const [ cards, setCards ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( false );

	const pickedKey = ( posts || [] ).map( ( post ) => post.id ).join( ',' );

	useEffect( () => {
		if ( ! postId ) {
			return undefined;
		}

		let isCurrent = true;
		setIsLoading( true );

		apiFetch( { path: getPreviewPath( postId, attributes ) } )
			.then( ( items ) => {
				if ( isCurrent ) {
					setCards( Array.isArray( items ) ? items : [] );
				}
			} )
			.catch( () => {
				if ( isCurrent ) {
					setCards( [] );
				}
			} )
			.finally( () => {
				if ( isCurrent ) {
					setIsLoading( false );
				}
			} );

		return () => {
			isCurrent = false;
		};
		// `attributes` is summarised by the values below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ postId, mode, count, pickedKey, uid ] );

	const blockProps = useBlockProps();

	let preview;

	if ( isLoading && ! cards.length ) {
		preview = <Spinner />;
	} else if ( ! cards.length ) {
		preview = (
			<Placeholder
				icon={ postList }
				label={ __( 'Post Roundup', 'beehiiv' ) }
				instructions={
					isManual
						? __(
								'Choose posts in the block settings sidebar. Nothing is shown on the website.',
								'beehiiv'
						  )
						: __(
								'No published posts to show yet. Nothing is shown on the website.',
								'beehiiv'
						  )
				}
			/>
		);
	} else {
		preview = cards.map( ( card ) => (
			<PostCard
				key={ card.id }
				card={ card }
				display={ display }
				layout={ layout }
				imagePlacement={ imagePlacement }
				override={ overrides?.[ card.id ] }
				onChange={ ( changes ) =>
					setAttributes( {
						overrides: setOverride( overrides, card.id, changes ),
					} )
				}
				onReset={ () =>
					setAttributes( {
						overrides: pruneOverrides(
							overrides,
							cards
								.map( ( item ) => item.id )
								.filter( ( id ) => id !== card.id )
						),
					} )
				}
			/>
		) );
	}

	return (
		<>
			<InspectorControls>
				<PanelBody
					title={ __( 'Post Roundup', 'beehiiv' ) }
					initialOpen
				>
					<RadioControl
						label={ __( 'Posts', 'beehiiv' ) }
						selected={ mode }
						options={ [
							{
								value: MODE_AUTO,
								label: __( 'Automatic', 'beehiiv' ),
							},
							{
								value: MODE_MANUAL,
								label: __( 'Manual', 'beehiiv' ),
							},
						] }
						onChange={ ( value ) =>
							setAttributes( { mode: value } )
						}
					/>
					{ isManual ? (
						<div className="beehiiv-post-roundup__picker">
							<ContentPicker
								label={ __( 'Choose posts', 'beehiiv' ) }
								mode="post"
								contentTypes={ [ 'post' ] }
								content={ posts }
								onPickChange={ ( items ) =>
									setAttributes( {
										posts: items,
										overrides: pruneOverrides(
											overrides,
											items.map( ( item ) => item.id )
										),
									} )
								}
								isOrderable
								maxContentItems={ MAX_COUNT }
								uniqueContentItems
							/>
						</div>
					) : (
						<RangeControl
							label={ __( 'Number of posts', 'beehiiv' ) }
							help={ __(
								'Shows the latest published posts, newest first. The list is fixed when you send or schedule the newsletter.',
								'beehiiv'
							) }
							value={ clampCount( count ) }
							onChange={ ( value ) =>
								setAttributes( { count: clampCount( value ) } )
							}
							min={ MIN_COUNT }
							max={ MAX_COUNT }
							__nextHasNoMarginBottom
						/>
					) }
				</PanelBody>
				<PanelBody title={ __( 'Layout', 'beehiiv' ) } initialOpen>
					<OptionButtons
						label={ __( 'Table width ratio', 'beehiiv' ) }
						options={ LAYOUT_OPTIONS }
						value={ layout }
						onChange={ ( value ) =>
							setAttributes( { layout: value } )
						}
					/>
					<OptionButtons
						label={ __( 'Image placement', 'beehiiv' ) }
						options={ PLACEMENT_OPTIONS }
						value={ imagePlacement }
						disabled={ layout === LAYOUT_FULL }
						onChange={ ( value ) =>
							setAttributes( { imagePlacement: value } )
						}
					/>
				</PanelBody>
				<PanelBody title={ __( 'Display', 'beehiiv' ) } initialOpen>
					{ Object.keys( DISPLAY_LABELS ).map( ( item ) => (
						<ToggleControl
							key={ item }
							label={ DISPLAY_LABELS[ item ] }
							checked={ display[ item ] }
							onChange={ ( value ) =>
								setAttributes( {
									display: { ...display, [ item ]: value },
								} )
							}
							__nextHasNoMarginBottom
						/>
					) ) }
					{ showsNothing && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'Every item is turned off, so nothing is sent for this roundup.',
								'beehiiv'
							) }
						</Notice>
					) }
				</PanelBody>
			</InspectorControls>

			<div { ...blockProps }>{ preview }</div>
		</>
	);
}
