// English translation of the Iranian service page. Keep the Iranian account
// and case workflow; the separate international PCT site keeps its own routes.
document.addEventListener('DOMContentLoaded', () => {
    const navigation = document.querySelector('.topbar .nav');
    if (!navigation) return;
    for (const link of navigation.querySelectorAll('a[href]')) {
      const target = link.getAttribute('href');
      if (target === '/patent/en/') {
        link.textContent = 'Patent Services';
        const guide = document.createElement('a');
        guide.href = '/patent/en/wizard.html';
        guide.textContent = 'PCT Guide';
        link.after(guide);
      } else if (target === '/patent/en/account/') {
        link.href = '/patent/account/';
      } else if (target === '/patent/en/account/?next=/patent/en/intake/') {
        link.href = '/patent/account/?next=/patent/intake/';
      } else if (target === '/patent/en/dashboard/') {
        link.href = '/patent/dashboard/';
      }
    }
    const footer = document.querySelector('.footer .wrap');
    if (footer) footer.textContent = 'ResearchVault Patent · Patent cases are managed confidentially and independently of the research-paper service.';
});
