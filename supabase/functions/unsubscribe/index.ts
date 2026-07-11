// unsubscribe — public opt-out endpoint for the engagement emails.
//
// The footer of every notify email links here with the player's unsubscribe_token. Opting out only
// ever happens on a POST — the one-click POST that mail clients send for `List-Unsubscribe`, or the
// confirm button on the GET page. A bare GET (including corporate mail-scanner link prefetching)
// only renders a confirmation page and never mutates, so engaged users aren't unsubscribed behind
// their backs. No login required, and the token can only opt a player out.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL = Deno.env.get('APP_URL') ?? 'https://elshabab.alyelazab.com';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title></head>
<body style="margin:0;background:#141122;color:#f4f1ff;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:420px;margin:14vh auto 0;padding:0 24px;text-align:center">
    <div style="font-size:22px;font-weight:800;letter-spacing:.02em">El Shabab <span style="color:#ff5a4d">League</span></div>
    ${inner}
    <a href="${APP_URL}" style="display:inline-block;margin-top:22px;color:#ff5a4d;font-weight:700;text-decoration:none">Back to the app →</a>
  </div>
</body></html>`;
}

const message = (title: string, msg: string) =>
  shell(title, `<h1 style="font-size:26px;margin:28px 0 12px">${title}</h1>
    <p style="color:#9d97bd;font-size:15px;line-height:1.6">${msg}</p>`);

// GET renders a confirm button that POSTs back to the same URL — nothing mutates on GET.
const confirmPage = (token: string) =>
  shell('Unsubscribe?', `<h1 style="font-size:26px;margin:28px 0 12px">Stop match emails?</h1>
    <p style="color:#9d97bd;font-size:15px;line-height:1.6">You'll no longer get reminders or recaps from El Shabab League. You can still play anytime.</p>
    <form method="POST" action="?token=${token}" style="margin-top:22px">
      <button type="submit" style="background:#ff5a4d;color:#fff;border:none;padding:13px 22px;border-radius:10px;font-weight:700;font-size:15px;cursor:pointer">Yes, unsubscribe me</button>
    </form>`);

Deno.serve(async (req) => {
  const html = (body: string, status = 200) =>
    new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!UUID.test(token)) {
    return html(message('Invalid link', 'This unsubscribe link looks broken. You can manage emails from inside the app.'), 400);
  }

  // A bare GET never mutates — just show the confirm button.
  if (req.method !== 'POST') return html(confirmPage(token));

  try {
    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    // The token lives in email_prefs now (migration 0010), not on profiles. Resolve it to a user_id,
    // then flip email_opt_out — which still lives on profiles.
    const { data: pref } = await db
      .from('email_prefs')
      .select('user_id')
      .eq('unsubscribe_token', token)
      .maybeSingle();

    if (!pref) {
      return html(message('Already sorted', "We couldn't match that link, so you may already be unsubscribed. No more emails either way."));
    }

    await db.from('profiles').update({ email_opt_out: true }).eq('id', pref.user_id);
    return html(message("You're unsubscribed", "You won't get any more match emails from El Shabab League. You can still play anytime."));
  } catch {
    return html(message('Something went wrong', 'Please try the link again in a moment.'), 500);
  }
});
