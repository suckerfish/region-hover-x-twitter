function dot(ok) {
  return `<span class="dot ${ok ? 'ok' : 'no'}"></span>${ok ? 'Ready' : 'Not yet'}`;
}

chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
  if (!res) return;
  document.getElementById('tokens').innerHTML = dot(res.hasTokens);
  document.getElementById('queryid').innerHTML = dot(res.hasQueryId);
  if (!res.hasTokens) {
    document.getElementById('status-msg').textContent =
      'Browse X for a moment — tokens are captured from page activity.';
  }
});

// Cache count lives in the content script's memory, so we can't read it from
// the popup directly. Show a note instead.
document.getElementById('cache').textContent = 'in-page';

document.getElementById('clear-btn').addEventListener('click', () => {
  // Signal content scripts to clear their caches via storage flag
  chrome.storage.session.set({ clearCache: Date.now() });
  document.getElementById('status-msg').textContent = 'Cache cleared.';
});
