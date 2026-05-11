const CACHE = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;
const HOVER_DELAY_MS = 2000;

let tooltip = null;
let hoverTimer = null;
let currentTarget = null;

// ─── Tooltip ────────────────────────────────────────────────────────────────

function getTooltip() {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'xrh-tooltip';
    tooltip.addEventListener('mouseenter', cancelHide);
    tooltip.addEventListener('mouseleave', hideTooltip);
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function showTooltip(x, y, html) {
  const t = getTooltip();
  t.innerHTML = html;
  t.style.display = 'block';
  t.style.opacity = '0';

  // Measure then position to avoid overflow
  requestAnimationFrame(() => {
    const tw = t.offsetWidth + 16;
    const th = t.offsetHeight + 16;
    const left = x + tw > window.innerWidth ? x - tw - 120 : x + 160;
    const top = y + th > window.innerHeight ? y - th : y;
    t.style.left = `${left}px`;
    t.style.top = `${top}px`;
    t.style.opacity = '1';
  });
}

function hideTooltip() {
  if (tooltip) tooltip.style.display = 'none';
  clearTimeout(hoverTimer);
  currentTarget = null;
}

function cancelHide() {
  clearTimeout(hoverTimer);
}

// ─── DOM helpers ─────────────────────────────────────────────────────────────

// Returns username if el (or a close ancestor) is an avatar link containing a profile image.
function getAvatarUsername(el) {
  let node = el;
  for (let i = 0; i < 8; i++) {
    if (!node || node === document.body) break;

    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (/^\/[A-Za-z0-9_]{1,50}$/.test(href)) {
        // Confirm this link wraps a profile image
        const img = node.querySelector('img[src*="profile_images"]');
        if (img) return href.slice(1);
      }
    }

    // Also handle the case where the img itself is hovered
    if (node.tagName === 'IMG' && node.src?.includes('/profile_images/')) {
      let parent = node.parentElement;
      for (let j = 0; j < 12; j++) {
        if (!parent || parent === document.body) break;
        if (parent.tagName === 'A') {
          const href = parent.getAttribute('href') || '';
          if (/^\/[A-Za-z0-9_]{1,50}$/.test(href)) return href.slice(1);
        }
        parent = parent.parentElement;
      }
    }

    node = node.parentElement;
  }
  return null;
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderLoading(username) {
  return `<div class="xrh-row xrh-muted">Loading @${username}…</div>`;
}

function renderError(msg) {
  return `<div class="xrh-row xrh-error">⚠ ${msg}</div>`;
}

function renderData(data) {
  const rows = [];

  if (data.accountBasedIn) {
    const vpn = data.locationAccurate === false ? ' <span class="xrh-muted">(VPN?)</span>' : '';
    rows.push(`<div class="xrh-row"><span class="xrh-label">Based in</span><span class="xrh-value">${esc(data.accountBasedIn)}${vpn}</span></div>`);
  }
  if (data.source) {
    rows.push(`<div class="xrh-row"><span class="xrh-label">Via</span><span class="xrh-value">${esc(data.source)}</span></div>`);
  }
  if (data.location) {
    rows.push(`<div class="xrh-row"><span class="xrh-label">Location</span><span class="xrh-value">${esc(data.location)}</span></div>`);
  }
  if (!data.accountBasedIn && !data.location) {
    rows.push(`<div class="xrh-row xrh-muted">No location data</div>`);
  }
  if (data.createdAt) {
    const year = new Date(data.createdAt).getFullYear();
    rows.push(`<div class="xrh-row"><span class="xrh-label">Joined</span><span class="xrh-value">${year}</span></div>`);
  }

  const header = data.name
    ? `<div class="xrh-header">${esc(data.name)} <span class="xrh-muted">@${esc(data.username)}</span></div>`
    : '';

  return header + rows.join('');
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Main flow ───────────────────────────────────────────────────────────────

async function fetchAndShow(username, x, y) {
  showTooltip(x, y, renderLoading(username));

  const cached = CACHE.get(username);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    showTooltip(x, y, cached.error ? renderError(cached.error) : renderData(cached.data));
    return;
  }

  let data;
  try {
    data = await chrome.runtime.sendMessage({ type: 'FETCH_USER', username });
  } catch (e) {
    showTooltip(x, y, renderError('Extension disconnected — reload page'));
    return;
  }

  if (data.error) {
    CACHE.set(username, { error: data.error, ts: Date.now() });
    showTooltip(x, y, renderError(data.error));
  } else {
    CACHE.set(username, { data, ts: Date.now() });
    showTooltip(x, y, renderData(data));
  }
}

// ─── Cache-clear signal from popup ───────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.clearCache) CACHE.clear();
});

// ─── Event listeners ─────────────────────────────────────────────────────────

document.addEventListener('mouseover', (e) => {
  const username = getAvatarUsername(e.target);
  if (!username || username === currentTarget) return;

  currentTarget = username;
  clearTimeout(hoverTimer);

  const x = e.clientX;
  const y = e.clientY;

  hoverTimer = setTimeout(() => {
    fetchAndShow(username, x, y);
  }, HOVER_DELAY_MS);
});

document.addEventListener('mouseout', (e) => {
  if (!getAvatarUsername(e.target)) return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(hideTooltip, 400);
});
