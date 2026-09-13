const form = document.getElementById('sign-in'), notice = document.getElementById('notice');
form.onsubmit = async event => {
  event.preventDefault(); const button = document.getElementById('submit'); button.disabled = true;
  notice.textContent = 'Signing in…'; notice.className = '';
  try {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'Sign-in failed.');
    document.getElementById('password').value = '';
    location.replace('/');
  } catch (error) { notice.textContent = error.message; notice.className = 'error'; button.disabled = false; }
};
