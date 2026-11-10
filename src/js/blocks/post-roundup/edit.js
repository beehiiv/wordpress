import { useEffect, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import {
	InspectorControls,
	useBlockProps,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import {
	PanelBody,
	Placeholder,
	RangeControl,
	Spinner,
	RadioControl,
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
	getPreviewPath,
} from './utils';

function PostCard( { card } ) {
	return (
		<article className="beehiiv-post-roundup__card">
			{ card.image_url && (
				<img
					className="beehiiv-post-roundup__image"
					src={ card.image_url }
					alt={ card.image_alt }
				/>
			) }
			<p className="beehiiv-post-roundup__title">
				<strong>
					<a
						href={ card.url }
						onClick={ ( event ) => event.preventDefault() }
					>
						{ card.title }
					</a>
				</strong>
			</p>
			{ card.excerpt && (
				<p className="beehiiv-post-roundup__excerpt">
					{ card.excerpt }
				</p>
			) }
			<span className="beehiiv-post-roundup__button">
				{ __( 'Read more', 'beehiiv' ) }
			</span>
		</article>
	);
}

export default function Edit( { attributes, setAttributes, clientId } ) {
	const { mode, count, posts, uid } = attributes;
	const isManual = mode === MODE_MANUAL;

	const { postId, firstUidClientId } = useSelect(
		( select ) => {
			const roundups = select( blockEditorStore )
				.getBlocks()
				.filter( ( block ) => block.name === metadata.name );

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
			<PostCard key={ card.id } card={ card } />
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
									setAttributes( { posts: items } )
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
			</InspectorControls>

			<div { ...blockProps }>{ preview }</div>
		</>
	);
}
