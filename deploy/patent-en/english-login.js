(() => {
  const $ = id => document.getElementById(id);
  const routes = window.PatentEnglish;
  const parameters = new URLSearchParams(location.search);
  const next = routes.safeDestination(parameters.get('next'));
  const wantsCurrentPortal = !parameters.has('earlier') && (!parameters.has('next') || [routes.dashboard, routes.intake].includes(next));
  const sessionCheck = $('sessionCheck');
  let challenge = null;
  const status = message => { $('loginStatus').textContent = message; };

  function showUser(user) {
    sessionCheck.hidden = true;
    $('loggedOut').classList.toggle('hidden', Boolean(user));
    $('loggedIn').classList.toggle('hidden', !user);
    if (user) {
      $('accountName').textContent = user.full_name || 'Your account';
      $('accountEmail').textContent = user.email || '';
    }
  }

  async function run(button, action) {
    if (button.disabled) return;
    button.disabled = true;
    status('');
    try { await action(); }
    catch (error) { status(error.message || 'Please try again.'); }
    finally { button.disabled = false; }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    sessionCheck.hidden = false;
    if (wantsCurrentPortal && await routes.workflowEnabled()) {
      location.replace(routes.workflow + (next === routes.intake ? '?new=1' : ''));
      return;
    }
    const user = await Patent.me();
    if (user && next) { location.replace(next); return; }
    showUser(user);

    $('requestCode').addEventListener('submit', event => {
      event.preventDefault();
      void run($('sendCode'), async () => {
        const result = await Patent.requestOtp($('email').value.trim(), 'email');
        if (!result?.challenge_id) throw new Error('Could not request a code. Please try again.');
        challenge = result.challenge_id;
        $('otp').value = '';
        $('otpWrap').classList.remove('hidden');
        $('otp').focus();
        status('Check your email for the verification code.');
      });
    });
    $('otpWrap').addEventListener('submit', event => {
      event.preventDefault();
      void run($('verifyCode'), async () => {
        if (!challenge) throw new Error('Request a verification code first.');
        await Patent.verifyOtp(challenge, $('otp').value.trim());
        const current = await Patent.me();
        if (!current) throw new Error('Could not start your session. Please sign in again.');
        location.replace(next || routes.dashboard);
      });
    });
    $('logoutBtn').addEventListener('click', async () => {
      try { await Patent.api('/api/auth/logout', { method: 'POST' }); location.replace(routes.account); }
      catch (error) { Patent.toast(error.message); }
    });
  });
})();
