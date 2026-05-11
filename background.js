// Intercept X's own requests to capture auth tokens and GraphQL query IDs.
// Tokens are stored in session storage so they survive service worker sleep cycles.

const SESSION_KEYS = {
  AUTH: 'authToken',
  CSRF: 'csrfToken',
  QUERY_ID: 'userByScreenNameQueryId',
  FEATURES: 'userByScreenNameFeatures',
};

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const updates = {};
    for (const header of details.requestHeaders || []) {
      const name = header.name.toLowerCase();
      if (name === 'authorization') updates[SESSION_KEYS.AUTH] = header.value;
      if (name === 'x-csrf-token') updates[SESSION_KEYS.CSRF] = header.value;
    }

    // Capture queryId and features from X's own UserByScreenName calls
    const match = details.url.match(/graphql\/([^/]+)\/UserByScreenName/);
    if (match) {
      updates[SESSION_KEYS.QUERY_ID] = match[1];
      try {
        const url = new URL(details.url);
        const features = url.searchParams.get('features');
        if (features) updates[SESSION_KEYS.FEATURES] = features;
      } catch (_) {}
    }

    if (Object.keys(updates).length) {
      chrome.storage.session.set(updates);
    }
  },
  { urls: ['https://x.com/i/api/*', 'https://api.x.com/*'] },
  ['requestHeaders', 'extraHeaders']
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_USER') {
    fetchUser(message.username)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: e.message }));
    return true; // keep channel open for async response
  }
  if (message.type === 'GET_STATUS') {
    chrome.storage.session.get(Object.values(SESSION_KEYS)).then((stored) => {
      sendResponse({
        hasTokens: !!(stored[SESSION_KEYS.AUTH] && stored[SESSION_KEYS.CSRF]),
        hasQueryId: !!stored[SESSION_KEYS.QUERY_ID],
      });
    });
    return true;
  }
});

async function fetchUser(username) {
  const stored = await chrome.storage.session.get(Object.values(SESSION_KEYS));
  const authToken = stored[SESSION_KEYS.AUTH];
  const csrfToken = stored[SESSION_KEYS.CSRF];

  if (!authToken || !csrfToken) {
    return { error: 'Not ready — browse X for a moment so tokens load.' };
  }

  // Use captured queryId or fall back to a known-good default
  const queryId = stored[SESSION_KEYS.QUERY_ID] || 'G3KGOASz96M-Qu0nwmGXNg';

  const variables = JSON.stringify({
    screen_name: username,
    withSafetyModeUserFields: true,
  });

  // Use captured features or fall back to minimal set
  const features =
    stored[SESSION_KEYS.FEATURES] ||
    JSON.stringify({
      hidden_profile_subscriptions_enabled: true,
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      subscriptions_verification_info_is_identity_verified_enabled: true,
      subscriptions_verification_info_verified_since_enabled: true,
      highlights_tweets_tab_ui_enabled: true,
      responsive_web_twitter_article_notes_tab_enabled: true,
      creator_subscriptions_tweet_preview_api_enabled: true,
      responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
    });

  const url =
    `https://x.com/i/api/graphql/${queryId}/UserByScreenName` +
    `?variables=${encodeURIComponent(variables)}` +
    `&features=${encodeURIComponent(features)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: authToken,
      'x-csrf-token': csrfToken,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  if (response.status === 429) return { error: 'Rate limited by X' };
  if (!response.ok) return { error: `X API error ${response.status}` };

  const data = await response.json();
  const result = data?.data?.user?.result;

  if (!result) return { error: 'User not found or suspended' };

  const legacy = result.legacy || {};

  return {
    name: legacy.name || null,
    username: legacy.screen_name || username,
    // X-determined region (shown on about page) — may live in different paths
    accountBasedIn:
      result.account_based_in ||
      result.affiliates_highlighted_label?.label?.userLabelType ||
      legacy.account_based_in ||
      null,
    // User-set location field
    location: legacy.location || null,
    verified: legacy.verified || result.is_blue_verified || false,
    createdAt: legacy.created_at || null,
  };
}
