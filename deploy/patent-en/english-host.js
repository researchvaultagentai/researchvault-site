// This adapter is loaded only by the international Pages build.
(() => {
  const root = '/patent/en/';
  const account = `${root}account/`;
  const dashboard = `${root}dashboard/`;
  const intake = `${root}intake/`;
  const payments = `${root}payments/`;
  const destinations = new Set([dashboard, intake, payments]);
  const signIn = (next = dashboard) => `${account}?next=${encodeURIComponent(next)}`;

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
    for (const link of document.querySelectorAll('[data-pct-client-portal]')) link.href = target;
  }

  window.PATENT_API_BASE = window.location.origin;
  window.PatentEnglish = Object.freeze({ account, dashboard, intake, payments, signIn, safeDestination, applySession });
})();
