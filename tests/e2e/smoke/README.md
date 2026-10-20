# Post-launch smoke tests

Automated equivalent of the manual QA sheet "beehiiv v1.1.0 | Post-launch Manual Smoke Tests" (SM-01 to SM-16).

```bash
npm run env:start     # once, if wp-env is not running
npm run test:smoke    # all 16 cases
npm run test:smoke -- -g "SM-10"   # one case
npm run test:smoke:ui # Playwright UI mode
```

It uses its own config (`playwright.smoke.config.js`), so `npm run test:e2e` does not run it. It runs in the wp-env tests environment, never contacts beehiiv, and sends no email. The test-only mu-plugin `tests/e2e/plugins/beehiiv-options.php` answers every beehiiv call and logs it. Each test asserts on the exact request the plugin sent.

## What cannot be automated

Each test carries a `manual-only` annotation with its reason. Still do these by hand on a real test site and publication.

| Case | Still manual |
| --- | --- |
| SM-01 | Upgrading from an older release on a real site. A real OAuth connection. (The test checks the installed version, a fatal-free settings page, and that settings persist.) |
| SM-03 | The email arriving in a real test inbox, and its rendered content. |
| SM-04 | The subject, subtitle and body in the beehiiv editor and the received email. |
| SM-06 | How the received email looks with the title and subtitle on or off, and that no byline appears. |
| SM-07 | The mapped fields in the real beehiiv dashboard, and that nothing leaks into the email body or Read Online page. |
| SM-08 | Clicking Read More in a received email. (The test checks the button URL and that it returns 200.) |
| SM-09 | That beehiiv sends at the scheduled time, only once. This can only be confirmed after the send time. |
| SM-10 | A test email actually arriving in an inbox. |
| SM-11 | Real delivery to QA-controlled addresses. |
| SM-12 | That the temporary draft is really gone in the beehiiv account. |
| SM-13 | That the already-sent newsletter is unchanged in the real beehiiv account. |
| SM-14 | A real signup landing in the right publication, and how the live beehiiv form looks on a phone. (The test checks the block output, the loader script and form ID, and page overflow at 1280 and 375 px.) |
| SM-15 | A real claimed ad. The ad appearing in the received email. (The test mocks one active ad.) |
| SM-16 | That the chosen template visibly changes the email design. |

SM-02 and SM-05 are fully covered by the automated test.

## Behaviors checked by design

- Notes on SM-12: the "unsaved or saving" state is checked through the editor button, and the "hostile filter forces confirmed" case reuses the `beehiiv_e2e_force_settings_status` seam.
- The suite activates the `twentytwentyfive` theme if none is active. A fresh tests environment can come back with no valid theme, which breaks the editor and every frontend page.
