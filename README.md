# CL Power Search

A browser extension for Chrome, Edge, Brave, and other Chromium-based browsers for persistent Craigslist searchers. Dismiss listings so they stay hidden (even when sellers repost), build complex Boolean searches visually, and auto-split queries that would silently fail.

> **Beta** -- not yet on the Chrome Web Store. Install via developer mode (takes about 30 seconds).

## Features

### Dismiss Button

Every listing gets a dismiss button. Dismissed listings stay hidden across sessions, and even when sellers repost them. Unlike Craigslist's built-in "hide" (which uses the listing ID), CL Power Search fingerprints listings by title + price + neighborhood using SHA-256, so reposts are caught automatically.

Works in gallery, list, and thumbnail views. Also works on individual listing pages.

### Boolean Query Builder

A floating panel that lets you build complex searches visually:

- **OR terms** -- find listings matching any of these (e.g., "house OR cottage OR cabin")
- **AND terms** -- all of these must appear
- **NOT terms** -- exclude listings containing these (e.g., "-apartment -studio")
- **Phrase toggle** -- mark individual terms as exact phrases

Craigslist natively supports Boolean syntax (`(term1|term2) -exclude "exact phrase"`), but there's no UI for it. The builder generates the correct syntax for you.

### Auto-Split

Craigslist silently returns a 400 error when a query has 15 or more OR terms. No warning, no message -- just a broken search. CL Power Search automatically splits long queries into groups of 14 and runs them as separate sub-queries.

### Saved Searches & CSV Export

Save your search configurations and export/import them as CSV files.

### Popup Dashboard

- See how many listings you've dismissed
- Export/import your dismissed listings as JSON (back up your data or move between computers)
- Clear all dismissed listings

## Install

1. Download this repo (click the green **Code** button above, then **Download ZIP**) and unzip it
2. Open your browser (Chrome, Edge, Brave, Opera, etc.) and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the unzipped folder (the one containing `manifest.json`)

The CL Power Search icon will appear in your toolbar. Navigate to any Craigslist search page to see dismiss buttons and the query builder.

## How It Works

- All data stays in your browser's local storage. Nothing is sent anywhere.
- No background scripts, no network requests, no analytics.
- Listing fingerprints are SHA-256 hashes of `title|price|neighborhood`, stored locally.
- The extension only runs on `*.craigslist.org` pages.

## Feedback

This is a beta. If you run into bugs, have feature requests, or want to tell me it's useless, please [open an issue](../../issues) or reach out. I'm especially interested in:

- Which features you actually use (dismiss? builder? both?)
- Anything confusing about the install process
- Listings that should have been caught as reposts but weren't

## License

MIT
