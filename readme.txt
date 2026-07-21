=== beehiiv - Publish WordPress posts as newsletters and grow your audience ===
Contributors: beehiiv
Tags: newsletter, email, publishing, beehiiv, subscribe
Requires at least: 6.8
Tested up to: 7.0
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Publish WordPress posts as newsletters, grow your email subscriber lists, add signup forms, and send email marketing to your audience with beehiiv.


== Description ==

&#128312; **The beehiiv integration is available to publications on the Max and Enterprise plans. [Learn more about plans](https://www.beehiiv.com/pricing).**

The official [beehiiv](https://www.beehiiv.com/) plugin connects your WordPress site to your beehiiv account so you can create posts in the block editor and send posts to your newsletter subscribers.

Write once in WordPress, publish to your site, and queue the same post for delivery through beehiiv, without copying content between platforms or creating new content for your newsletters.

= Features =

* Connect your beehiiv account to WordPress
* Create posts in WordPress and publish or schedule them as newsletters through beehiiv
* Manage newsletter settings from the block editor
* Add a newsletter signup form to your website
* Include sponsored content in your newsletters

= What is beehiiv? =

[beehiiv](https://www.beehiiv.com/) is an all-in-one newsletter platform built for creators, writers, and publishers.

It brings together everything you need to write, grow, and monetize an email newsletter in one place.

With beehiiv you can:

* Write and send professional newsletters with a drag-and-drop editor
* Build a website and landing pages for your publication
* Grow your audience with referrals, recommendations, and other built-in growth tools
* Monetize through paid subscriptions, sponsorships, and beehiiv's native ad network
* Track performance with built-in analytics

beehiiv is designed for people who treat their newsletter as a core part of their business, not just another email blast.

You will need an active beehiiv account to use this plugin.

If you do not have one yet, you can [sign up at beehiiv.com](https://www.beehiiv.com/).


== Installation ==

= Requirements =

* WordPress 6.5 or later
* PHP 7.4 or later
* An active [beehiiv](https://www.beehiiv.com/) account on the Max or Enterprise plan ([learn more about plans](https://www.beehiiv.com/pricing))

= Setup =

1. Install and activate the plugin through the WordPress **Plugins** screen, or upload the plugin files to `/wp-content/plugins/beehiiv/` and activate it.
2. Go to **beehiiv** in the WordPress admin sidebar to open the plugin settings.
3. Click **Connect to beehiiv** and sign in with your beehiiv account to authorize the connection via OAuth.
4. After connecting, select your **Publication** and **Default post template**, then save your settings.
5. Create or edit a post in the block editor, open the **beehiiv** panel in the editor sidebar, and turn on **Send to newsletter** before you publish.

Once connected and configured, any post with "Send to newsletter" enabled will be queued for delivery through beehiiv when you publish (or on the scheduled date you choose).


== External services ==

This plugin connects to beehiiv services hosted at [beehiiv.com](https://www.beehiiv.com).
It is used to authenticate your account, sync publication settings, publish WordPress posts as newsletters, and embed beehiiv subscribe forms on your site.

When you connect your account, the plugin exchanges OAuth credentials with beehiiv. When you send a post as a newsletter, post content and related newsletter settings are sent to the beehiiv API. The subscribe form loads beehiiv’s form script so visitors can join your publication.

Terms of Use: [beehiiv.com/tou](https://www.beehiiv.com/tou)
Privacy Policy: [beehiiv.com/privacy](https://www.beehiiv.com/privacy)


== Getting Started ==

Plugin settings and the block editor panel include clear, contextual hints and usage notes.

The beehiiv WordPress GitHub repository includes the uncompressed source files: [github.com/beehiiv/wordpress](https://github.com/beehiiv/wordpress).


== Frequently Asked Questions ==

= Does this require a beehiiv account? =

Yes. You need an active beehiiv account on the Max or Enterprise plan to connect the plugin and send newsletters. [Learn more about plans](https://www.beehiiv.com/pricing).

You can create a free account at [beehiiv.com](https://www.beehiiv.com/).

= How do I connect my beehiiv account? =

Go to **beehiiv** in the WordPress admin sidebar and click **Connect to beehiiv**. You will be redirected to beehiiv to sign in and authorize the connection.

When you return to WordPress, your account will be connected.

= Which WordPress blocks are supported in newsletters? =

The plugin converts common content blocks including headings, paragraphs, images, lists, tables, quotes, pull quotes, embeds, media & text, buttons, and separators. More blocks coming soon.

The editor will warn you about any unsupported blocks before you publish.

= Can I send only a teaser instead of the full post? =

Yes.

Enable snippet mode in the beehiiv post settings panel to send a teaser with a link to the full post on your website.

= Does the Advertisement block appear on my website? =

No. The beehiiv Advertisement block is for newsletter content only.

It is visible in the editor but does not render on the front end of your site.


== Changelog ==

= 1.0.0 =
* Initial release.
