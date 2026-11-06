// This adapter is loaded only by the international Pages build.
(() => {
  const root = '/patent/en/';
  const account = `${root}account/`;
  const dashboard = `${root}dashboard/`;
  const intake = `${root}intake/`;
  const payments = `${root}payments/`;
  const workflow = `${root}workflow/`;
  const destinations = new Set([dashboard, intake, payments]);
  const signIn = (next = dashboard, earlier = false) => `${account}?next=${encodeURIComponent(next)}${earlier ? '&earlier=1' : ''}`;
  let readiness;
  function workflowEnabled() {
    if (typeof fetch !== 'function') return Promise.resolve(false);
    return readiness ||= fetch('/api/pct/status', { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(3000) })
      .then(r => r.ok ? r.json() : null).then(status => status?.enabled === true).catch(() => false);
  }

  function safeDestination(next) {
    if (typeof next !== 'string' || !next.startsWith(root) || next.length > 300) return null;
    try {
      const url = new URL(next, window.location.origin);
      if (url.origin !== window.location.origin || !destinations.has(url.pathname) || url.hash) return null;
      if (!url.search) return url.pathname;
      const entries = [...url.searchParams];
      if (![dashboard, payments].includes(url.pathname) || entries.length !== 1 || entries[0][0] !== 'case' ||
          !/^[a-zA-Z0-9_-]{1,128}$/.test(entries[0][1])) return null;
      return `${url.pathname}?case=${encodeURIComponent(entries[0][1])}`;
    } catch { return null; }
  }

  function applySession(user) {
    const target = user ? dashboard : signIn();
    const portals = document.querySelectorAll('[data-pct-client-portal]');
    const starts = document.querySelectorAll('[data-pct-workflow="start"]');
    for (const link of portals) link.href = target;
    if (portals.length || starts.length) void workflowEnabled().then(enabled => {
      if (!enabled) return;
      for (const link of portals) link.href = workflow;
      for (const link of starts) link.href = `${workflow}?new=1`;
      for (const element of document.querySelectorAll('[data-pct-enabled-copy]')) element.textContent = element.dataset.pctEnabledCopy;
    });
  }

  window.PATENT_API_BASE = window.location.origin;
  window.PatentEnglish = Object.freeze({ account, dashboard, intake, payments, workflow, workflowEnabled, signIn, safeDestination, applySession });
})();
