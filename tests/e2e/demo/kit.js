/**
 * Shared helpers for intake demo scripts: on-screen captions, a visible
 * cursor, paced clicks, and wp-cli seeding through the plugin's own E2E utils.
 * A demo script (tests/e2e/demo/<intake-hash>.demo.js) requires this file.
 */
const { test, expect } = require( '@playwright/test' );
const { loginAsAdmin } = require( '../utils/auth' );
const { openPostEditor } = require( '../utils/editor' );
const wp = require( '../utils/wp-cli' );

const OVERLAY_JS = `
( () => {
	if ( window !== window.top ) { return; }
	const boot = () => {
		if ( document.getElementById( '__demo_caption' ) ) { return; }
		const cap = document.createElement( 'div' );
		cap.id = '__demo_caption';
		cap.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:880px;padding:14px 22px;border-radius:10px;background:rgba(17,17,17,.92);color:#fff;font:600 20px/1.35 system-ui,sans-serif;z-index:2147483647;text-align:center;pointer-events:none;display:none';
		const dot = document.createElement( 'div' );
		dot.id = '__demo_cursor';
		dot.style.cssText = 'position:fixed;left:-30px;top:-30px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,80,40,.55);border:2px solid #fff;box-shadow:0 0 0 2px rgba(255,80,40,.9);z-index:2147483647;pointer-events:none;transition:left .05s linear,top .05s linear';
		document.documentElement.append( cap, dot );
		window.addEventListener( 'mousemove', ( e ) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true );
	};
	if ( document.documentElement ) { boot(); } else { document.addEventListener( 'DOMContentLoaded', boot ); }
	document.addEventListener( 'DOMContentLoaded', boot );
} )();
`;

/**
 * Call once per page before navigating.
 * @param {import('@playwright/test').Page} page
 */
async function installOverlay( page ) {
	await page.addInitScript( OVERLAY_JS );
}

/**
 * Shows a caption (empty text hides it) and holds for `hold` ms.
 * @param {import('@playwright/test').Page} page
 * @param {string}                          text
 * @param {number}                          hold
 */
async function caption( page, text, hold = 2500 ) {
	await page.evaluate( ( t ) => {
		const el = document.getElementById( '__demo_caption' );
		if ( ! el ) {
			return;
		}
		el.textContent = t;
		el.style.display = t ? 'block' : 'none';
	}, text );
	if ( hold ) {
		await page.waitForTimeout( hold );
	}
}

/**
 * Moves the visible cursor to the element, then clicks it.
 * @param {import('@playwright/test').Page}    page
 * @param {import('@playwright/test').Locator} locator
 */
async function glideClick( page, locator ) {
	await locator.scrollIntoViewIfNeeded();
	const box = await locator.boundingBox();
	await page.mouse.move( box.x + box.width / 2, box.y + box.height / 2, {
		steps: 25,
	} );
	await page.waitForTimeout( 400 );
	await locator.click();
}

/**
 * Moves the cursor onto an element and pauses, to point at it.
 * @param {import('@playwright/test').Page}    page
 * @param {import('@playwright/test').Locator} locator
 * @param {number}                             hold
 */
async function point( page, locator, hold = 1500 ) {
	await locator.scrollIntoViewIfNeeded();
	const box = await locator.boundingBox();
	await page.mouse.move( box.x + box.width / 2, box.y + box.height / 2, {
		steps: 25,
	} );
	await page.waitForTimeout( hold );
}

module.exports = {
	test,
	expect,
	loginAsAdmin,
	openPostEditor,
	wp,
	installOverlay,
	caption,
	glideClick,
	point,
};
