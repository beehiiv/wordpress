const assert = require( 'node:assert/strict' );
const { test } = require( 'node:test' );
const { mkdtempSync, writeFileSync, rmSync } = require( 'node:fs' );
const { tmpdir } = require( 'node:os' );
const path = require( 'node:path' );
const { assertPhpVersion } = require( '../../scripts/check-php-version' );
const { start, stop } = require( '../../scripts/wp-env-start' );

for ( const [ series, patch ] of [
	[ '8.2', 35 ],
	[ '8.3', 36 ],
	[ '8.4', 27 ],
	[ '8.5', 12 ],
] ) {
	test( `${ series } rejects the affected patch`, () => {
		assert.throws(
			() => assertPhpVersion( `${ series }.${ patch - 1 }` ),
			/is affected/
		);
	} );
	test( `${ series } accepts the fixed patch and subsequent patches`, () => {
		assert.doesNotThrow( () =>
			assertPhpVersion( `${ series }.${ patch }` )
		);
		assert.doesNotThrow( () =>
			assertPhpVersion( `${ series }.${ patch + 1 }` )
		);
	} );
}

test( 'unsupported and unverified PHP releases are rejected', () => {
	for ( const version of [
		'7.4.33',
		'8.0.30',
		'8.1.34',
		'8.6.0',
		'8.4.27RC1',
		'8.4',
		'',
	] ) {
		assert.throws( () => assertPhpVersion( version ) );
	}
} );

function fixture( context, response = () => '8.4.27' ) {
	const directory = mkdtempSync( path.join( tmpdir(), 'php-runtime-test-' ) );
	context.after( () =>
		rmSync( directory, { recursive: true, force: true } )
	);
	const config = {
		dockerComposeConfigPath: path.join( directory, 'docker-compose.yml' ),
		testsEnvironment: true,
		env: {
			development: { phpVersion: '8.4' },
			tests: { phpVersion: '8.4' },
		},
	};
	writeFileSync( config.dockerComposeConfigPath, '' );
	const calls = [];
	const execute = ( command, args, capture ) => {
		calls.push( [ command, ...args ] );
		return response( command, args, capture );
	};
	return { config, calls, execute };
}

test( 'an affected web image blocks startup and leaves an existing project stopped', ( context ) => {
	const { config, calls, execute } = fixture( context, () => '8.4.26' );
	assert.throws( () => start( config, execute ), /is affected/ );
	assert.equal( calls[ 0 ].at( -1 ), 'stop' );
	assert.equal( calls.at( -1 ).at( -1 ), 'stop' );
	assert.equal(
		calls.some( ( call ) => call[ 0 ] === 'npx' ),
		false
	);
	assert.deepEqual(
		calls.find( ( call ) => call[ 1 ] === 'run' ).slice( 1, 7 ),
		[ 'run', '--rm', '--network', 'none', '--entrypoint', 'php' ]
	);
} );

test( 'an affected CLI image also blocks web startup', ( context ) => {
	const { config, calls, execute } = fixture( context, ( command, args ) =>
		args.includes( 'wordpress:cli-php8.4' ) ? '8.4.26' : '8.4.27'
	);
	assert.throws(
		() => start( config, execute ),
		/wordpress:cli-php8.4.*is affected/
	);
	assert.equal(
		calls.some( ( call ) => call[ 0 ] === 'npx' ),
		false
	);
} );

test( 'a registry failure cannot fall back to a cached image', ( context ) => {
	const { config, calls, execute } = fixture( context, ( command, args ) => {
		if ( args[ 0 ] === 'pull' ) {
			throw new Error( 'registry unavailable' );
		}
	} );
	assert.throws(
		() => start( config, execute, { buildPatchedImages: true } ),
		/registry unavailable/
	);
	assert.equal(
		calls.some( ( call ) => call[ 0 ] === 'node' ),
		false
	);
	assert.equal(
		calls.some( ( call ) => call[ 0 ] === 'npx' ),
		false
	);
} );

test( 'unsupported test overrides are rejected before pulling or starting', ( context ) => {
	const { config, calls, execute } = fixture( context );
	config.env.tests.phpVersion = '7.4';
	assert.throws( () => start( config, execute ), /Unsupported PHP series/ );
	assert.equal(
		calls.some(
			( call ) => call.includes( 'pull' ) || call[ 0 ] === 'npx'
		),
		false
	);
} );

test( 'phpMyAdmin cannot start an unchecked PHP web service', ( context ) => {
	const { config, calls, execute } = fixture( context );
	config.env.tests.phpmyadmin = true;
	assert.throws( () => start( config, execute ), /Disable phpmyadmin/ );
	assert.equal(
		calls.some( ( call ) => call[ 0 ] === 'npx' ),
		false
	);
} );

test( 'a disabled test environment only checks development services', ( context ) => {
	const { config, calls, execute } = fixture( context );
	config.testsEnvironment = false;
	config.env.tests.phpVersion = '7.4';
	start( config, execute );
	assert.deepEqual(
		calls
			.filter( ( call ) => call.includes( 'exec' ) )
			.map( ( call ) => call[ 6 ] ),
		[ 'wordpress', 'cli' ]
	);
} );

test( 'different development and test PHP series are independently verified', ( context ) => {
	const { config, calls, execute } = fixture( context, ( command, args ) =>
		args.some(
			( argument ) =>
				argument.includes( '8.3' ) || argument.startsWith( 'tests-' )
		)
			? '8.3.36'
			: '8.4.27'
	);
	config.env.tests.phpVersion = '8.3';
	start( config, execute );
	assert.deepEqual(
		calls
			.filter( ( call ) => call[ 1 ] === 'pull' )
			.map( ( call ) => call[ 2 ] ),
		[
			'wordpress:php8.4',
			'wordpress:cli-php8.4',
			'wordpress:php8.3',
			'wordpress:cli-php8.3',
		]
	);
} );

test( 'verified bases replace project images without deleting volumes and all services are checked', ( context ) => {
	const { config, calls, execute } = fixture( context );
	start( config, execute );
	const refreshIndex = calls.findIndex( ( call ) => call.includes( 'down' ) );
	assert.deepEqual( calls[ refreshIndex ].slice( -3 ), [
		'down',
		'--rmi',
		'local',
	] );
	assert.equal( calls[ refreshIndex + 1 ][ 0 ], 'npx' );
	assert.equal(
		calls.some(
			( call ) =>
				call.includes( '--volumes' ) || call.includes( '--update' )
		),
		false
	);
	assert.deepEqual(
		calls
			.filter( ( call ) => call.includes( 'exec' ) )
			.map( ( call ) => call[ 6 ] ),
		[ 'wordpress', 'cli', 'tests-wordpress', 'tests-cli' ]
	);
} );

test( 'an unexpected running PHP version stops the project', ( context ) => {
	const { config, calls, execute } = fixture( context, ( command, args ) =>
		args.includes( 'exec' ) ? '8.4.26' : '8.4.27'
	);
	assert.throws( () => start( config, execute ), /is affected/ );
	assert.equal( calls.at( -1 ).at( -1 ), 'stop' );
} );

test( 'a failed wp-env startup stops partially started services', ( context ) => {
	const { config, calls, execute } = fixture( context, ( command ) => {
		if ( command === 'npx' ) {
			throw new Error( 'afterStart failed' );
		}
		return '8.4.27';
	} );
	assert.throws( () => start( config, execute ), /afterStart failed/ );
	assert.equal( calls.at( -1 ).at( -1 ), 'stop' );
} );

test( 'the CI fallback rebuilds affected bases and verifies them before startup', ( context ) => {
	const rebuilt = new Set();
	const { config, calls, execute } = fixture( context, ( command, args ) => {
		if ( command === 'node' ) {
			rebuilt.add( args[ 1 ] );
		}
		if ( args[ 0 ] === 'run' && ! rebuilt.has( args[ 6 ] ) ) {
			return '8.4.26';
		}
		return '8.4.27';
	} );
	start( config, execute, { buildPatchedImages: true } );
	assert.deepEqual(
		[ ...rebuilt ],
		[ 'wordpress:php8.4', 'wordpress:cli-php8.4' ]
	);
	assert.equal( calls.filter( ( call ) => call[ 1 ] === 'run' ).length, 4 );
	assert.equal(
		calls.filter( ( call ) => call.includes( 'exec' ) ).length,
		4
	);
	const startupIndex = calls.findIndex( ( call ) => call[ 0 ] === 'npx' );
	assert.ok(
		startupIndex > calls.findLastIndex( ( call ) => call[ 1 ] === 'run' )
	);
} );

test( 'patched upstream images do not invoke the CI fallback', ( context ) => {
	const { config, calls, execute } = fixture( context );
	start( config, execute, { buildPatchedImages: true } );
	assert.equal(
		calls.some( ( call ) => call[ 0 ] === 'node' ),
		false
	);
} );

test( 'unverified or mismatched PHP does not invoke the CI fallback', ( context ) => {
	for ( const version of [ '8.4.27RC1', '8.3.36', '' ] ) {
		const { config, calls, execute } = fixture( context, () => version );
		assert.throws( () =>
			start( config, execute, { buildPatchedImages: true } )
		);
		assert.equal(
			calls.some( ( call ) => call[ 0 ] === 'node' ),
			false
		);
		assert.equal(
			calls.some( ( call ) => call[ 0 ] === 'npx' ),
			false
		);
	}
} );

test( 'an affected rebuilt image still blocks startup', ( context ) => {
	const { config, calls, execute } = fixture( context, () => '8.4.26' );
	assert.throws(
		() => start( config, execute, { buildPatchedImages: true } ),
		/is affected/
	);
	assert.equal( calls.filter( ( call ) => call[ 0 ] === 'node' ).length, 1 );
	assert.equal(
		calls.some( ( call ) => call[ 0 ] === 'npx' ),
		false
	);
	assert.equal( calls.at( -1 ).at( -1 ), 'stop' );
} );

test( 'a failed CI image build leaves the project stopped', ( context ) => {
	const { config, calls, execute } = fixture( context, ( command ) => {
		if ( command === 'node' ) {
			throw new Error( 'image build failed' );
		}
		return '8.4.26';
	} );
	assert.throws(
		() => start( config, execute, { buildPatchedImages: true } ),
		/image build failed/
	);
	assert.equal(
		calls.some( ( call ) => call[ 0 ] === 'npx' ),
		false
	);
	assert.equal( calls.at( -1 ).at( -1 ), 'stop' );
} );

test( 'cleanup succeeds before wp-env has initialized', ( context ) => {
	const { config, calls, execute } = fixture( context );
	rmSync( config.dockerComposeConfigPath );
	stop( config, execute );
	assert.deepEqual( calls, [] );
} );
