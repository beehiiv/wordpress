/**
 * Unit tests for the Post Roundup block helpers (`src/js/blocks/post-roundup/utils.js`).
 *
 * The helpers are plain ES module functions with no imports, so the source is loaded
 * through a data URL. That works on every Node version the repo supports without a
 * bundler or a `type: module` package setting.
 */
const assert = require( 'node:assert/strict' );
const { test, before } = require( 'node:test' );
const { readFileSync } = require( 'node:fs' );
const path = require( 'node:path' );

let utils;

before( async () => {
	const source = readFileSync(
		path.resolve( __dirname, '../../src/js/blocks/post-roundup/utils.js' ),
		'utf8'
	);
	utils = await import(
		'data:text/javascript;charset=utf-8,' + encodeURIComponent( source )
	);
} );

test( 'clampCount keeps the post count between 1 and 10 and defaults to 3', () => {
	assert.equal( utils.clampCount( 0 ), 1 );
	assert.equal( utils.clampCount( 99 ), 10 );
	assert.equal( utils.clampCount( '4' ), 4 );
	assert.equal( utils.clampCount( 'many' ), 3 );
} );

test( 'clampColumns keeps the columns between 1 and 3 and defaults to 1', () => {
	assert.equal( utils.clampColumns( undefined ), 1 );
	assert.equal( utils.clampColumns( 'two' ), 1 );
	assert.equal( utils.clampColumns( 0 ), 1 );
	assert.equal( utils.clampColumns( 2 ), 2 );
	assert.equal( utils.clampColumns( 9 ), 3 );
} );

test( 'chunkRows splits cards into rows of the column count, last row shorter', () => {
	const cards = [ 1, 2, 3, 4, 5 ].map( ( id ) => ( { id } ) );

	assert.deepEqual(
		utils.chunkRows( cards, 1 ).map( ( row ) => row.length ),
		[ 1, 1, 1, 1, 1 ]
	);
	assert.deepEqual(
		utils.chunkRows( cards, 2 ).map( ( row ) => row.map( ( c ) => c.id ) ),
		[ [ 1, 2 ], [ 3, 4 ], [ 5 ] ]
	);
	assert.deepEqual(
		utils.chunkRows( cards, 3 ).map( ( row ) => row.length ),
		[ 3, 2 ]
	);
	assert.deepEqual( utils.chunkRows( [], 2 ), [] );
} );

test( 'getDisplay shows every item except author and date until the block says otherwise', () => {
	assert.deepEqual( utils.getDisplay( {} ), {
		image: true,
		title: true,
		author: false,
		date: false,
		excerpt: true,
		button: true,
	} );
	// A block saved before author and date existed stores only four items.
	assert.deepEqual(
		utils.getDisplay( {
			display: {
				image: true,
				title: true,
				excerpt: false,
				button: true,
			},
		} ),
		{
			image: true,
			title: true,
			author: false,
			date: false,
			excerpt: false,
			button: true,
		}
	);
	assert.equal(
		utils.getDisplay( { display: { author: true } } ).author,
		true
	);
} );

test( 'mergeCard prefers a non-empty edit and falls back to the post', () => {
	const card = {
		id: 7,
		title: 'Post title',
		excerpt: 'Post excerpt',
		button_label: 'Read more',
		author: 'Jane',
		date: 'March 4, 2026',
	};

	const plain = utils.mergeCard( card, undefined );
	assert.equal( plain.title, 'Post title' );
	assert.equal( plain.buttonLabel, 'Read more' );
	assert.equal( plain.author, 'Jane' );
	assert.equal( plain.caption, '' );
	assert.equal( plain.imageId, 0 );

	const edited = utils.mergeCard( card, {
		title: 'New title',
		buttonLabel: 'Read here',
		author: 'The Editors',
		date: 'This week',
		caption: 'A caption',
		imageId: 12,
	} );
	assert.equal( edited.title, 'New title' );
	assert.equal( edited.excerpt, 'Post excerpt' );
	assert.equal( edited.buttonLabel, 'Read here' );
	assert.equal( edited.author, 'The Editors' );
	assert.equal( edited.date, 'This week' );
	assert.equal( edited.caption, 'A caption' );
	assert.equal( edited.imageId, 12 );
} );

test( 'setOverride stores one edit, drops empty values and empty entries', () => {
	let overrides = utils.setOverride( {}, 5, { title: 'Hello' } );
	assert.deepEqual( overrides, { 5: { title: 'Hello' } } );

	overrides = utils.setOverride( overrides, 5, { caption: 'Cap' } );
	assert.deepEqual( overrides, { 5: { title: 'Hello', caption: 'Cap' } } );

	overrides = utils.setOverride( overrides, 5, { title: '' } );
	assert.deepEqual( overrides, { 5: { caption: 'Cap' } } );

	overrides = utils.setOverride( overrides, 5, { caption: '' } );
	assert.deepEqual( overrides, {} );

	// The input object is never changed.
	const original = { 1: { title: 'A' } };
	utils.setOverride( original, 1, { title: '' } );
	assert.deepEqual( original, { 1: { title: 'A' } } );
} );

test( 'pruneOverrides keeps edits for listed posts only', () => {
	const overrides = {
		1: { title: 'A' },
		2: { title: 'B' },
		3: { title: 'C' },
	};

	assert.deepEqual( utils.pruneOverrides( overrides, [ 1, 3 ] ), {
		1: { title: 'A' },
		3: { title: 'C' },
	} );
	assert.deepEqual( utils.pruneOverrides( undefined, [ 1 ] ), {} );
} );

test( 'escapeText makes plain text safe for RichText', () => {
	assert.equal(
		utils.escapeText( 'Fish & <b>Chips</b>' ),
		'Fish &amp; &lt;b&gt;Chips&lt;/b&gt;'
	);
	assert.equal( utils.escapeText( undefined ), '' );
} );

test( 'getPreviewPath mirrors the server resolver inputs', () => {
	const auto = utils.getPreviewPath( 9, {
		mode: 'auto',
		count: 99,
		uid: 'abc',
	} );
	assert.match( auto, /^\/beehiiv\/v1\/post-roundup\?/ );
	assert.match( auto, /post_id=9/ );
	assert.match( auto, /count=10/ );
	assert.match( auto, /uid=abc/ );

	const manual = utils.getPreviewPath( 9, {
		mode: 'manual',
		posts: [ { id: 4 }, { id: 2 } ],
		uid: 'abc',
	} );
	assert.match( manual, /mode=manual/ );
	assert.match( decodeURIComponent( manual ), /ids\[\]=4&ids\[\]=2/ );
	assert.doesNotMatch( manual, /count=/ );
} );
