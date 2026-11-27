#!/usr/bin/env node
/**
 * google-oauth - one-off sign-in that lets scripts use Google APIs as google@jacklamond.co.uk
 * (Business Profile needs a real user; API keys and the service account are refused).
 *
 * Reads the OAuth Desktop client from jacklamond-sites-oauth-client.json (gitignored),
 * prints a sign-in link, waits on a local port for Google's redirect, then stores the
 * refresh token in .env as GOOGLE_OAUTH_REFRESH_TOKEN. Never prints a secret.
 *
 *   node bin/google-oauth.mjs
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = Object.values(JSON.parse(fs.readFileSync(path.join(root, "jacklamond-sites-oauth-client.json"), "utf8")))[0];
const SCOPES = ["https://www.googleapis.com/auth/business.manage"];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const code = url.searchParams.get("code");
  if (!code) { res.end(url.searchParams.get("error") || "waiting"); return; }
  const redirect = `http://localhost:${server.address().port}`;
  const tok = await (await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: redirect, grant_type: "authorization_code" }),
  })).json();
  if (!tok.refresh_token) {
    res.end("Sign-in failed - go back to Claude.");
    console.log("FAILED:", tok.error || "no refresh token", tok.error_description || "");
    process.exit(1);
  }
  const envPath = path.join(root, ".env");
  let env = fs.readFileSync(envPath, "utf8").split("\n").filter((l) => !l.startsWith("GOOGLE_OAUTH_REFRESH_TOKEN="));
  env.push(`GOOGLE_OAUTH_REFRESH_TOKEN=${tok.refresh_token}`);
  fs.writeFileSync(envPath, env.join("\n").replace(/\n+$/, "") + "\n");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end("<p style='font:18px system-ui;margin:40px'>Done - Jack HQ can now manage your Business Profiles. You can close this tab.</p>");
  console.log("OK: refresh token stored in .env (scope: " + (tok.scope || SCOPES.join(" ")) + ")");
  server.close();
  process.exit(0);
});

server.listen(0, "127.0.0.1", () => {
  const redirect = `http://localhost:${server.address().port}`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", login_hint: "google@jacklamond.co.uk" });
  console.log("OPEN: " + auth);
});
setTimeout(() => { console.log("TIMEOUT: no sign-in within 15 minutes"); process.exit(1); }, 15 * 60 * 1000);
