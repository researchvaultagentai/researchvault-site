// The English project uses its own first-party /api endpoint. The original
// Patent runtime and the original .ir deployment are not edited.
window.PATENT_API_BASE = window.location.origin;

document.addEventListener('DOMContentLoaded', () => {
  // Run after all DOMContentLoaded listeners, including the shared runtime's
  // header creation, have finished. The API origin above is available at once.
  setTimeout(() => {
    for (const link of document.querySelectorAll('.topbar a[href]')) {
      const path = link.getAttribute('href');
      if (link.classList.contains('brand') || path === '/patent/en/') {
        link.href = '/';
      } else if (path === '/patent/' || path === '/patent/admin/') {
        link.href = 'https://researchvaultagent.ir' + path;
      } else if (path === '/') {
        link.href = 'https://researchvaultagent.ir/';
      }
    }
  }, 0);
  // Existing cases keep their routes; activate new intake only when connected.
  if (typeof fetch !== 'function') return;
  const entries = document.querySelectorAll('[data-pct-workflow]');
  if (!entries.length) return;
  fetch('/api/pct/status', { credentials: 'same-origin' })
    .then(r => r.ok ? r.json() : null)
    .then(status => {
      if (!status?.enabled) return;
      for (const link of entries) link.href = '/patent/en/workflow/';
    }).catch(() => {});
});
