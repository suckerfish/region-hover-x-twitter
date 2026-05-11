# X Region Hover

A Chrome extension that shows a profile's **X-determined region**, App Store source, user-set location, and join year when you hover over a profile picture on X (twitter.com / x.com).

Unlike always-on alternatives (like X-Posed), this extension **only makes an API call when you actually hover** — no background polling, no rate limit issues, no account risk from bulk scraping.

---

## What it shows

| Field | Source | Notes |
|---|---|---|
| **Based in** | X-determined (IP/device) | What's shown on the `/about` page |
| **Via** | X-determined | App Store region or web client |
| **Location** | User-set free text | Can say anything, often fake |
| **Joined** | Account metadata | Year only |
| **(VPN?)** | X's `location_accurate` flag | Shown next to "Based in" when X suspects a proxy |

---

## Installation

1. Clone or download this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the `chrome-extension/` folder
5. Navigate to x.com — the extension auto-captures auth tokens from page activity within a few seconds

The popup (click the extension icon) shows whether tokens are ready and lets you clear the cache.

---

## How it works

### Auth token capture
X's web app sends a `Bearer` token and CSRF token (`ct0` cookie) with every API request. The extension's background service worker listens to outgoing requests via `chrome.webRequest.onBeforeSendHeaders` and captures these headers. They're stored in `chrome.storage.session` so they survive the MV3 service worker's sleep cycles.

### GraphQL query ID capture
X's internal GraphQL API uses opaque query IDs in URLs (e.g. `/graphql/zUnx-DLN9dkwOkNhTLySjg/AboutAccountQuery`). These IDs change with X deployments. The extension intercepts X's own requests and extracts the IDs dynamically, falling back to known-good hardcoded values if they haven't been seen yet.

### On-demand fetching
When you hover a profile picture for 400ms, the extension:
1. Walks up the DOM from the hovered element to find a `<a href="/username">` that wraps a profile image
2. Checks the 30-minute in-memory cache
3. If not cached, fires two parallel GraphQL requests:
   - **`AboutAccountQuery`** → `account_based_in`, `source`, `location_accurate`
   - **`UserByScreenName`** → user-set `location`, display name, join date
4. Renders a tooltip near the cursor

Results are cached per-username for 30 minutes so repeated hovers never re-fetch.

---

## File structure

```
chrome-extension/
├── manifest.json      — MV3 manifest, permissions, content script registration
├── background.js      — Service worker: token capture, GraphQL fetch logic
├── content.js         — Content script: hover detection, cache, tooltip rendering
├── styles.css         — Tooltip styles
├── popup.html/js      — Extension popup: status indicators, clear cache button
└── icons/             — Extension icons (add your own PNGs)
```

---

## Lessons learned

### 1. X overlays `<div>` and `<a>` elements on top of profile images
The actual `<img>` element is never the top element when you hover a profile picture — X puts a transparent `<a>` or `<div>` on top for click handling. Checking `e.target.tagName === 'IMG'` will always fail. The fix: on `mouseover`, walk up the ancestor chain looking for a `<a href="/username">` that *contains* a `img[src*="profile_images"]` child.

### 2. `UserByScreenName` does not contain the "based in" field
The `UserByScreenName` GraphQL query — the one used for profile hover cards — only returns the user-set `location` free-text field. The X-determined `account_based_in` field lives in a separate query: **`AboutAccountQuery`**, which is only called when loading the `/about` tab of a profile. You have to make this second call explicitly.

### 3. `AboutAccountQuery` response path is non-obvious
The response is nested under `data.user_result_by_screen_name.result.about_profile`, not `data.user.result` like most other queries. Key fields:
- `about_profile.account_based_in` — the country X has determined
- `about_profile.source` — which App Store or client the account registered/operates through
- `about_profile.location_accurate` — `false` when X suspects VPN/proxy use

### 4. GraphQL query IDs change with X deployments
Hardcoding query IDs is fragile. The extension captures them dynamically by intercepting X's own outgoing requests, only falling back to hardcoded values as a bootstrap until the first live request is seen.

### 5. MV3 service workers go to sleep — use `chrome.storage.session`
In Manifest V3, background service workers are terminated when idle. In-memory variables don't survive. Auth tokens must be stored in `chrome.storage.session` (ephemeral, clears on browser close, persists through sleep cycles).

### 6. On-demand hover beats always-on scraping
Alternatives like X-Posed fire an API request for every visible tweet on page load, burning through X's rate limits within minutes and potentially flagging the account. Firing only on explicit hover with caching reduces typical session API calls from hundreds to single digits.

### 7. The `mouseout` timing matters
`mouseout` fires before `mouseover` fires on the next element. A hide delay shorter than the show delay (400ms) causes the tooltip to never appear — the hide timer clears the pending show timer. Setting the hide delay to match the show delay (400ms) prevents this race.

---

## Known limitations

- **No `account_based_in` for all accounts** — X only sets this field for some accounts. Many users will only show the user-set location field.
- **VPN defeats region detection** — X acknowledges this with `location_accurate: false`.
- **Query IDs may break** — If X deploys a new version before your browser has intercepted a live request, the hardcoded fallback IDs may be stale. Visiting any X profile page refreshes them.
- **Requires active X session** — The extension piggybacks on your login. It does not work logged out.

---

## Privacy

All data is processed locally. No information is sent to any third party. The cache lives in the page's memory and is cleared on tab close or via the popup's "Clear cache" button.

---

## License

MIT
