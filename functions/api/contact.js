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
 *       CONTACT_TEST_SECRET — optional; enables the Jack HQ daily synthetic
 *                       form check. A request whose X-Contact-Test header
 *                       matches runs the real pipeline but delivers to
 *                       CONTACT_TEST_TO (default form@jacklamond.co.uk —
 *                       NEVER the client) and answers JSON instead of a
 *                       redirect. See "Synthetic test mode" below.
 *       CONTACT_TEST_TO — optional; overrides the synthetic-test recipient.
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

// Verify a Turnstile token with Cloudflare's siteverify endpoint.
// Returns "pass" | "fail" | "error" (error = siteverify unreachable).
const turnstileVerify = async (secret, token, remoteip) => {
  if (!token) return "fail";
  try {
    const resp = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: new URLSearchParams({ secret, response: token, remoteip }),
      },
    );
    const outcome = await resp.json();
    return outcome.success === true ? "pass" : "fail";
  } catch {
    return "error";
  }
};

// ── Synthetic test mode (Jack HQ daily form check) ──────────────────────────
// The monitor authenticates with the X-Contact-Test header. Test requests run
// the real pipeline but can never reach the client: delivery is forced to the
// test recipient and the Turnstile-enforcement probe never sends at all. A GET
// with the header answers a capability check, so the monitor never POSTs to a
// site that hasn't deployed test mode (where the POST would be a real enquiry).
const TEST_FALLBACK_TO = "form@jacklamond.co.uk";

const isTestRequest = (request, env) =>
  Boolean(env.CONTACT_TEST_SECRET) &&
  request.headers.get("X-Contact-Test") === env.CONTACT_TEST_SECRET;

const testJson = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

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

  const isTest = isTestRequest(request, env);
  const testMode = isTest
    ? request.headers.get("X-Contact-Test-Mode") || "delivery"
    : null;

  let form;
  try {
    form = await request.formData();
  } catch {
    if (isTest) return testJson({ ok: false, error: "unreadable form body" }, 400);
    return seeOther(errorTarget(contactPage));
  }

  const name = (form.get("name") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  const message = (form.get("message") || "").toString().trim();
  const honeypot = (form.get("bot-field") || "").toString().trim();

  // Honeypot tripped → pretend success, send nothing.
  if (honeypot) {
    if (isTest) return testJson({ ok: false, error: "honeypot tripped" }, 400);
    return seeOther("/thanks/");
  }

  if (!name || !email || !message) {
    if (isTest) return testJson({ ok: false, error: "missing fields" }, 400);
    return seeOther(errorTarget(contactPage));
  }

  // Link in the name or message → almost certainly spam. Pretend success like
  // the honeypot (an error page would just invite retries); log for the
  // dashboard's real-time logs so drops stay observable.
  if (!env.CONTACT_ALLOW_LINKS && (containsLink(message) || containsLink(name))) {
    console.log(`contact: dropped link-spam submission from "${name}" <${email}>`);
    return seeOther("/thanks/");
  }

  // Turnstile-enforcement probe: verify the (deliberately invalid) token for
  // real and report the outcome — never sends an email in any branch.
  // "enforced" (gate rejected it) and "unreachable" (siteverify down; the
  // handler fails open by design) are healthy; "not-configured" while the page
  // renders the widget, or "not-enforced", mean the gate is broken.
  if (isTest && testMode === "turnstile") {
    if (!env.TURNSTILE_SECRET_KEY) {
      return testJson({ ok: false, mode: "turnstile", turnstile: "not-configured" });
    }
    const token = (form.get("cf-turnstile-response") || "").toString();
    const remoteip = request.headers.get("CF-Connecting-IP") || "";
    const outcome = await turnstileVerify(env.TURNSTILE_SECRET_KEY, token, remoteip);
    if (outcome === "fail") {
      return testJson({ ok: true, mode: "turnstile", turnstile: "enforced" });
    }
    if (outcome === "error") {
      return testJson({ ok: true, mode: "turnstile", turnstile: "unreachable" });
    }
    return testJson({ ok: false, mode: "turnstile", turnstile: "not-enforced" });
  }

  // Turnstile (only when the site has opted in by configuring the secret).
  // A missing or invalid token → error redirect, so a human whose challenge
  // expired can simply resubmit. Fails open on siteverify network errors — a
  // Cloudflare blip must not cost the client a real lead. Skipped for the
  // delivery probe: the monitor is a bot by definition; the shared secret is
  // its authentication instead.
  if (env.TURNSTILE_SECRET_KEY && !isTest) {
    const token = (form.get("cf-turnstile-response") || "").toString();
    const remoteip = request.headers.get("CF-Connecting-IP") || "";
    if ((await turnstileVerify(env.TURNSTILE_SECRET_KEY, token, remoteip)) === "fail") {
      return seeOther(errorTarget(contactPage));
    }
  }

  // Test delivery is forced to the test recipient — never the client.
  const to = isTest ? env.CONTACT_TEST_TO || TEST_FALLBACK_TO : env.CONTACT_TO;
  const from = env.CONTACT_FROM;
  if (!to || !from) {
    if (isTest) return testJson({ ok: false, error: "CONTACT_TO / CONTACT_FROM not configured" }, 500);
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

  const hostname = new URL(request.url).hostname;
  try {
    await env.EMAIL.send({
      to,
      from,
      replyTo: { email, name },
      subject: isTest
        ? `[TEST ${hostname}] Synthetic form check`
        : `New enquiry from ${name}`,
      text,
      html,
    });
  } catch (e) {
    if (isTest) return testJson({ ok: false, mode: "delivery", error: `send failed: ${e.code || ""} ${e.message || e}` }, 502);
    return new Response(
      `Sorry, your message could not be sent right now. Please email us directly. (${e.code || ""} ${e.message || e})`,
      { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  // Delivery probe done: the send above proved the binding, verified sender
  // and pipeline. No archive copy for tests — one email per probe is enough.
  if (isTest) {
    return testJson({
      ok: true,
      mode: "delivery",
      sent: true,
      turnstile: env.TURNSTILE_SECRET_KEY ? "skipped" : "not-configured",
    });
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
        subject: `[${hostname}] New enquiry from ${name}`,
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
//
// Exception: a GET carrying a valid X-Contact-Test header is the monitor's
// capability check — it proves this deployment supports test mode (and that
// the secret matches) before any POST is made. Sites on an older engine, or
// without CONTACT_TEST_SECRET set, answer with the normal redirect, which
// tells the monitor NOT to probe (a probe POST would land as a real enquiry).
export async function onRequestGet(context) {
  const { request, env } = context;
  if (isTestRequest(request, env)) {
    return testJson({
      test: true,
      turnstile: Boolean(env.TURNSTILE_SECRET_KEY),
    });
  }
  const origin = new URL(request.url).origin;
  const target = env.CONTACT_PAGE || "/#contact";
  return redirectTo(origin, target, 302);
}
