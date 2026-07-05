/**
 * Cloudflare Pages Function — contact form handler.
 *
 * Receives the POST from the site's contact form and sends the enquiry with
 * Cloudflare Email Sending (`env.EMAIL.send`, the Email Service Beta).
 *
 * Required Pages configuration (set per project in the Cloudflare dashboard):
 *   • Binding:  a "send_email" binding named  EMAIL
 *   • Variables:
 *       CONTACT_TO    — where enquiries are delivered (e.g. hello@yourdomain.com)
 *       CONTACT_ARCHIVE — optional archive recipient; receives a separate copy
 *                       of every enquiry with the site domain prefixed to the
 *                       subject (for backup + per-site lead counting). A
 *                       separate send rather than BCC: a BCC copy is
 *                       byte-identical, so mailboxes that receive both (e.g.
 *                       catch-all routing into one inbox) dedupe it away.
 *       CONTACT_FROM  — verified sender on an onboarded domain
 *                       (e.g. "Your Site <noreply@yourdomain.com>")
 *       TURNSTILE_SECRET_KEY — optional; when set, submissions must carry a
 *                       valid Cloudflare Turnstile token. Pair with
 *                       business.forms.turnstile_site_key in the site's
 *                       business.json (renders the widget) — setting the
 *                       secret without the site key rejects every human.
 *       CONTACT_ALLOW_LINKS — optional; set to any value to disable the
 *                       link-spam filter for sites whose customers genuinely
 *                       paste URLs into enquiries.
 *
 * The sender domain must be onboarded to Cloudflare Email Service and Email
 * Sending requires the Workers Paid plan. See:
 *   https://developers.cloudflare.com/email-service/
 *
 * No-JS friendly: on success it 303-redirects to /thanks/; the honeypot and the
 * link-spam filter silently accept and drop bot submissions.
 */

// Form spam is overwhelmingly link delivery — legit enquiries to a local
// business almost never contain a URL. Full URLs (with protocol or www.) and
// protocol-less link-shortener paths both count; either anywhere in the name
// or message drops the submission.
const URL_RE = /(?:https?:\/\/|www\.)\S+/i;
const SHORTENER_RE =
  /\b(?:tinyurl\.com|bit\.ly|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|tiny\.cc|shorturl\.at|t\.ly|ow\.ly|buff\.ly|rebrand\.ly)\/\S+/i;
const containsLink = (value) => URL_RE.test(value) || SHORTENER_RE.test(value);

// Verify a Turnstile token with Cloudflare's siteverify endpoint. Fails open
// on network errors — a siteverify blip must not cost the client a real lead.
const turnstilePasses = async (secret, token, remoteip) => {
  if (!token) return false;
  try {
    const resp = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: new URLSearchParams({ secret, response: token, remoteip }),
      },
    );
    const outcome = await resp.json();
    return outcome.success === true;
  } catch {
    return true;
  }
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

// Redirect with an explicit Content-Type and a tiny HTML fallback body.
// Response.redirect() emits a header-only response with no Content-Type;
// if a client ever fails to follow it, browsers save that shape as a
// 0-byte download named after the URL. The text/html meta-refresh body
// means the worst case is a visible "Redirecting…" page instead.
// NOTE: sites deployed as a Worker with static assets must also set
// assets.run_worker_first: ["/api/*"] in wrangler.jsonc — without it the
// asset layer answers browser form posts (Sec-Fetch-Mode: navigate) with
// an empty 405 before this handler ever runs.
const redirectTo = (origin, path, status) => {
  const url = origin + path;
  const safe = escapeHtml(url);
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
      `<meta http-equiv="refresh" content="0;url=${safe}">` +
      `<title>Redirecting…</title></head>` +
      `<body><p>Redirecting to <a href="${safe}">${safe}</a>…</p></body></html>`,
    {
      status,
      headers: {
        Location: url,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
};

// Where validation failures land: the contact page (CONTACT_PAGE, default
// home-page anchor) with ?error=1 inserted ahead of any #fragment.
const errorTarget = (page) => {
  const [path, hash] = page.split("#");
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}error=1${hash ? `#${hash}` : ""}`;
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;
  const contactPage = env.CONTACT_PAGE || "/#contact";
  const seeOther = (path) => redirectTo(origin, path, 303);

  let form;
  try {
    form = await request.formData();
  } catch {
    return seeOther(errorTarget(contactPage));
  }

  const name = (form.get("name") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  const message = (form.get("message") || "").toString().trim();
  const honeypot = (form.get("bot-field") || "").toString().trim();

  // Honeypot tripped → pretend success, send nothing.
  if (honeypot) return seeOther("/thanks/");

  if (!name || !email || !message) {
    return seeOther(errorTarget(contactPage));
  }

  // Link in the name or message → almost certainly spam. Pretend success like
  // the honeypot (an error page would just invite retries); log for the
  // dashboard's real-time logs so drops stay observable.
  if (!env.CONTACT_ALLOW_LINKS && (containsLink(message) || containsLink(name))) {
    console.log(`contact: dropped link-spam submission from "${name}" <${email}>`);
    return seeOther("/thanks/");
  }

  // Turnstile (only when the site has opted in by configuring the secret).
  // A missing or invalid token → error redirect, so a human whose challenge
  // expired can simply resubmit.
  if (env.TURNSTILE_SECRET_KEY) {
    const token = (form.get("cf-turnstile-response") || "").toString();
    const remoteip = request.headers.get("CF-Connecting-IP") || "";
    if (!(await turnstilePasses(env.TURNSTILE_SECRET_KEY, token, remoteip))) {
      return seeOther(errorTarget(contactPage));
    }
  }

  const to = env.CONTACT_TO;
  const from = env.CONTACT_FROM;
  if (!to || !from) {
    return new Response(
      "Contact form is not configured: set CONTACT_TO and CONTACT_FROM.",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const text = `Name: ${name}\nEmail: ${email}\n\n${message}\n`;
  const html =
    `<h2>New website enquiry</h2>` +
    `<p><strong>Name:</strong> ${escapeHtml(name)}</p>` +
    `<p><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>` +
    `<p><strong>Message:</strong></p>` +
    `<p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`;

  try {
    await env.EMAIL.send({
      to,
      from,
      replyTo: { email, name },
      subject: `New enquiry from ${name}`,
      text,
      html,
    });
  } catch (e) {
    return new Response(
      `Sorry, your message could not be sent right now. Please email us directly. (${e.code || ""} ${e.message || e})`,
      { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  // Best-effort archive copy — its own send (see CONTACT_ARCHIVE note above),
  // with the site domain in the subject for per-site lead counting. Never
  // fails the visitor's submission.
  if (env.CONTACT_ARCHIVE) {
    try {
      await env.EMAIL.send({
        to: env.CONTACT_ARCHIVE,
        from,
        replyTo: { email, name },
        subject: `[${new URL(request.url).hostname}] New enquiry from ${name}`,
        text,
        html,
      });
    } catch {
      // archive delivery must not affect the visitor
    }
  }

  return seeOther("/thanks/");
}

// Anything other than a POST → send people to the contact section/page.
// Defaults to the home-page contact anchor; sites with a dedicated contact page
// can override by setting the CONTACT_PAGE var (e.g. "/contact/#contact").
export async function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  const target = context.env.CONTACT_PAGE || "/#contact";
  return redirectTo(origin, target, 302);
}
