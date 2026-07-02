/**
 * Cloudflare Worker entry — static assets + contact-form API.
 *
 * For sites deployed as a **Worker with static assets** (the git-connected
 * default on Cloudflare's Workers & Pages). Static assets are served ahead of
 * this script, so `fetch` only runs for non-asset paths. We route
 * `POST /api/contact` to the shared Email Sending handler and let the ASSETS
 * binding serve everything else (including the branded 404 page).
 *
 * The site supplies a `wrangler.jsonc` that sets:
 *   • main = "worker/index.js"
 *   • assets = { directory: "./_site", binding: "ASSETS", not_found_handling: "404-page" }
 *   • send_email = [{ name: "EMAIL" }]
 *   • vars = { CONTACT_TO, CONTACT_FROM }
 *
 * The /api/contact logic lives once in functions/api/contact.js (also used by
 * sites on Cloudflare Pages), and is reused here.
 */
import { onRequestPost, onRequestGet } from "../functions/api/contact.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/contact") {
      return request.method === "POST"
        ? onRequestPost({ request, env })
        : onRequestGet({ request, env });
    }

    // Assets are served before the Worker; a request reaching here didn't match
    // one, so hand back to ASSETS (serves the configured 404 page).
    return env.ASSETS.fetch(request);
  },
};
