// Intercept X's own requests to capture auth tokens and GraphQL query IDs.
// Tokens are stored in session storage so they survive service worker sleep cycles.

const SESSION_KEYS = {
  AUTH: 'authToken',
  CSRF: 'csrfToken',
  SCREEN_NAME_QUERY_ID: 'userByScreenNameQueryId',
  SCREEN_NAME_FEATURES: 'userByScreenNameFeatures',
  ABOUT_QUERY_ID: 'aboutAccountQueryId',
};

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const updates = {};
    for (const header of details.requestHeaders || []) {
      const name = header.name.toLowerCase();
      if (name === 'authorization') updates[SESSION_KEYS.AUTH] = header.value;
      if (name === 'x-csrf-token') updates[SESSION_KEYS.CSRF] = header.value;
    }

    const aboutMatch = details.url.match(/graphql\/([^/]+)\/AboutAccountQuery/);
    if (aboutMatch) updates[SESSION_KEYS.ABOUT_QUERY_ID] = aboutMatch[1];

    const screenNameMatch = details.url.match(/graphql\/([^/]+)\/UserByScreenName/);
    if (screenNameMatch) {
      updates[SESSION_KEYS.SCREEN_NAME_QUERY_ID] = screenNameMatch[1];
      try {
        const features = new URL(details.url).searchParams.get('features');
        if (features) updates[SESSION_KEYS.SCREEN_NAME_FEATURES] = features;
      } catch (_) {}
    }

    if (Object.keys(updates).length) chrome.storage.session.set(updates);
  },
  { urls: ['https://x.com/i/api/*', 'https://api.x.com/*'] },
  ['requestHeaders', 'extraHeaders']
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_USER') {
    fetchUser(message.username)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (message.type === 'GET_STATUS') {
    chrome.storage.session.get(Object.values(SESSION_KEYS)).then((stored) => {
      sendResponse({
        hasTokens: !!(stored[SESSION_KEYS.AUTH] && stored[SESSION_KEYS.CSRF]),
        hasQueryId: !!stored[SESSION_KEYS.ABOUT_QUERY_ID] || !!stored[SESSION_KEYS.SCREEN_NAME_QUERY_ID],
      });
    });
    return true;
  }
});

async function getTokens() {
  const stored = await chrome.storage.session.get(Object.values(SESSION_KEYS));
  return stored;
}

async function fetchUser(username) {
  const stored = await getTokens();
  const authToken = stored[SESSION_KEYS.AUTH];
  const csrfToken = stored[SESSION_KEYS.CSRF];

  if (!authToken || !csrfToken) {
    return { error: 'Not ready — browse X for a moment so tokens load.' };
  }

  const headers = {
    Authorization: authToken,
    'x-csrf-token': csrfToken,
  };

  // Run both queries in parallel
  const [aboutData, legacyData] = await Promise.all([
    fetchAbout(username, stored, headers),
    fetchLegacy(username, stored, headers),
  ]);

  if (aboutData.error && legacyData.error) {
    return { error: aboutData.error };
  }

  return {
    name: aboutData.name || legacyData.name || null,
    username: aboutData.username || legacyData.username || username,
    accountBasedIn: aboutData.accountBasedIn || null,
    source: aboutData.source || null,
    locationAccurate: aboutData.locationAccurate ?? null,
    location: legacyData.location || null,
    createdAt: aboutData.createdAt || legacyData.createdAt || null,
    verified: legacyData.verified || false,
  };
}

async function fetchAbout(username, stored, headers) {
  const queryId = stored[SESSION_KEYS.ABOUT_QUERY_ID] || 'zUnx-DLN9dkwOkNhTLySjg';
  const url =
    `https://x.com/i/api/graphql/${queryId}/AboutAccountQuery` +
    `?variables=${encodeURIComponent(JSON.stringify({ screenName: username }))}`;

  try {
    const response = await fetch(url, { headers, credentials: 'include' });
    if (response.status === 429) return { error: 'Rate limited by X' };
    if (!response.ok) return { error: `AboutAccountQuery HTTP ${response.status}` };

    const data = await response.json();
    const result = data?.data?.user_result_by_screen_name?.result;
    if (!result) return { error: 'User not found' };

    const about = result.about_profile || {};
    const core = result.core || {};

    return {
      name: core.name || null,
      username: core.screen_name || username,
      accountBasedIn: about.account_based_in || null,
      source: about.source || null,
      locationAccurate: about.location_accurate ?? null,
      createdAt: core.created_at || null,
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function fetchLegacy(username, stored, headers) {
  const queryId = stored[SESSION_KEYS.SCREEN_NAME_QUERY_ID] || 'G3KGOASz96M-Qu0nwmGXNg';
  const features =
    stored[SESSION_KEYS.SCREEN_NAME_FEATURES] ||
    JSON.stringify({
      hidden_profile_subscriptions_enabled: true,
      rweb_tipjar_consumption_enabled: true,
      responsive_web_graphql_exclude_directive_enabled: true,
      verified_phone_label_enabled: false,
      responsive_web_graphql_timeline_navigation_enabled: true,
    });

  const url =
    `https://x.com/i/api/graphql/${queryId}/UserByScreenName` +
    `?variables=${encodeURIComponent(JSON.stringify({ screen_name: username, withSafetyModeUserFields: true }))}` +
    `&features=${encodeURIComponent(features)}`;

  try {
    const response = await fetch(url, { headers, credentials: 'include' });
    if (!response.ok) return { error: `UserByScreenName HTTP ${response.status}` };

    const data = await response.json();
    const legacy = data?.data?.user?.result?.legacy || {};

    return {
      name: legacy.name || null,
      username: legacy.screen_name || username,
      location: legacy.location || null,
      verified: legacy.verified || data?.data?.user?.result?.is_blue_verified || false,
      createdAt: legacy.created_at || null,
    };
  } catch (e) {
    return { error: e.message };
  }
}
