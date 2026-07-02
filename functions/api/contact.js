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

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;
  const seeOther = (path) => Response.redirect(origin + path, 303);

  let form;
  try {
    form = await request.formData();
  } catch {
    return seeOther("/contact/?error=1#contact");
  }

  const name = (form.get("name") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  const message = (form.get("message") || "").toString().trim();
  const honeypot = (form.get("bot-field") || "").toString().trim();

  // Honeypot tripped → pretend success, send nothing.
  if (honeypot) return seeOther("/thanks/");

  if (!name || !email || !message) {
    return seeOther("/contact/?error=1#contact");
  }

  const to = env.CONTACT_TO;
  const from = env.CONTACT_FROM;
  if (!to || !from) {
    return new Response(
      "Contact form is not configured: set CONTACT_TO and CONTACT_FROM.",
      { status: 500 },
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
      { status: 502 },
    );
  }

  return seeOther("/thanks/");
}

// Anything other than a POST → send people to the contact page.
export async function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;
  return Response.redirect(origin + "/contact/#contact", 302);
}
