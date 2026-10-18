// The English project uses its own first-party /api endpoint. The original
// Patent runtime and the original .ir deployment are not edited.
window.PATENT_API_BASE = window.location.origin;

document.addEventListener('DOMContentLoaded', () => {
  // patent.js creates its header synchronously in its DOMContentLoaded handler.
  queueMicrotask(() => {
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
  });
});
