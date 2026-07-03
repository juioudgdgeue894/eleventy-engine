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
 *       CONTACT_FROM  — verified sender on an onboarded domain
 *                       (e.g. "Your Site <noreply@yourdomain.com>")
 *
 * The sender domain must be onboarded to Cloudflare Email Service and Email
 * Sending requires the Workers Paid plan. See:
 *   https://developers.cloudflare.com/email-service/
 *
 * No-JS friendly: on success it 303-redirects to /thanks/; the honeypot silently
 * accepts and drops bot submissions.
 */

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

  const to = env.CONTACT_TO;
  const from = env.CONTACT_FROM;
  if (!to || !from) {
    return new Response(
      "Contact form is not configured: set CONTACT_TO and CONTACT_FROM.",
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  try {
    await env.EMAIL.send({
      to,
      from,
      replyTo: { email, name },
      subject: `New enquiry from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}\n`,
      html:
        `<h2>New website enquiry</h2>` +
        `<p><strong>Name:</strong> ${escapeHtml(name)}</p>` +
        `<p><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>` +
        `<p><strong>Message:</strong></p>` +
        `<p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>`,
    });
  } catch (e) {
    return new Response(
      `Sorry, your message could not be sent right now. Please email us directly. (${e.code || ""} ${e.message || e})`,
      { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
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
