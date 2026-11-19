import { createHash } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import type { Config } from "./config.js";
import { encrypt } from "./crypto.js";
import { issueEmailCodeKeyAction, issuePasswordKeyAction, issueSignupKeyAction, startEmailLoginAction, startSignupAction, type IssuedApiKey } from "@hellotracks/ht-core/actions/index.js";
import { ApiError } from "@hellotracks/ht-core/client/api-client.js";
import { signInContext } from "./api.js";
import type { HellotracksOAuthProvider } from "./provider.js";
import type { PendingSignIn, Store } from "./store.js";

const PRIVACY_URL = "https://hellotracks.com/en/privacy-notice/";
const TERMS_URL = "https://hellotracks.com/terms-of-service";

/** The only script on these pages: puts the browser's time zone into the new-company form. */
const TIMEZONE_SCRIPT = `try{document.getElementById("timezone").value=Intl.DateTimeFormat().resolvedOptions().timeZone||""}catch(e){}`;
const TIMEZONE_SCRIPT_HASH = createHash("sha256").update(TIMEZONE_SCRIPT).digest("base64");

/** The pages between /authorize and the redirect back: email, then the emailed code. */
export function signInRouter(config: Config, store: Store, provider: HellotracksOAuthProvider): Router {
  const router = express.Router();
  router.use("/signin", express.urlencoded({ extended: false, limit: "8kb" }));
  router.use("/signin", (_req, res, next) => {
    res.set({
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${TIMEZONE_SCRIPT_HASH}'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self' https: http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'`,
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store"
    });
    next();
  });

  const pendingFor = (req: Request, res: Response): PendingSignIn | undefined => {
    const id = String(req.query.s ?? req.body?.s ?? "");
    const pending = id ? store.getPending(id) : undefined;
    if (!pending || Date.now() - pending.createdAt > 30 * 60_000) {
      res.status(400).type("html").send(page("Sign-in expired", `<p>This sign-in has expired. Start connecting again from your AI app.</p>`));
      return undefined;
    }
    if (req.method === "POST" && req.body?.csrf !== pending.csrf) {
      res.status(400).type("html").send(page("Sign-in expired", `<p>This page is out of date. Start connecting again from your AI app.</p>`));
      return undefined;
    }
    return pending;
  };

  const signIn = (req: Request) => signInContext(config, req.ip);

  const finish = (res: Response, pending: PendingSignIn, issued: IssuedApiKey, readOnly: boolean) => {
    const target = provider.completeSignIn(pending.id, {
      accountId: issued.accountId,
      username: issued.username,
      companyId: issued.companyId,
      companyName: issued.companyName,
      keySealed: encrypt(config.secret, issued.apiKey),
      keyId: issued.apiKey.split(".")[0] ?? "",
      keyExpiresAt: issued.apiKeyExpiresAt,
      readOnly
    });
    res.redirect(302, target);
  };

  const clientLabel = async (pending: PendingSignIn) => {
    const client = await provider.clientsStore.getClient(pending.clientId);
    const params = JSON.parse(pending.params) as { redirectUri: string };
    return { name: client?.client_name ?? "An AI app", host: new URL(params.redirectUri).host };
  };

  router.get("/signin", async (req, res) => {
    const pending = pendingFor(req, res);
    if (pending) {
      res.type("html").send(emailPage(pending, await clientLabel(pending)));
    }
  });

  router.post("/signin/email", async (req, res) => {
    const pending = pendingFor(req, res);
    if (!pending) {
      return;
    }
    const email = String(req.body.email ?? "").trim().toLowerCase();
    const readOnly = req.body.readOnly === "1";
    const label = await clientLabel(pending);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      res.status(400).type("html").send(emailPage(pending, label, "Enter the email address you sign in to Hellotracks with."));
      return;
    }
    const password = String(req.body.password ?? "");
    if (password) {
      try {
        const issued = await issuePasswordKeyAction(signIn(req), { email, password, keyLabel: keyLabel(label.name) });
        finish(res, pending, issued, readOnly);
      } catch (error) {
        res.status(400).type("html").send(emailPage(pending, label, friendly(error)));
      }
      return;
    }
    try {
      await startEmailLoginAction(signIn(req), { email });
    } catch (error) {
      res.status(400).type("html").send(emailPage(pending, label, friendly(error)));
      return;
    }
    store.setPendingEmail(pending.id, email);
    res.type("html").send(codePage(pending, label, email, readOnly));
  });

  router.post("/signin/code", async (req, res) => {
    const pending = pendingFor(req, res);
    if (!pending) {
      return;
    }
    const code = String(req.body.code ?? "").replace(/\D/g, "");
    const readOnly = req.body.readOnly === "1";
    const label = await clientLabel(pending);
    if (!pending.email) {
      res.status(400).type("html").send(emailPage(pending, label));
      return;
    }
    let issued: IssuedApiKey;
    try {
      issued = await issueEmailCodeKeyAction(signIn(req), { email: pending.email, code, keyLabel: keyLabel(label.name) });
    } catch (error) {
      res.status(400).type("html").send(codePage(pending, label, pending.email, readOnly, friendly(error)));
      return;
    }
    finish(res, pending, issued, readOnly);
  });

  router.get("/signin/new", async (req, res) => {
    const pending = pendingFor(req, res);
    if (pending) {
      res.type("html").send(newCompanyPage(pending, await clientLabel(pending), {}));
    }
  });

  router.post("/signin/new", async (req, res) => {
    const pending = pendingFor(req, res);
    if (!pending) {
      return;
    }
    const label = await clientLabel(pending);
    const form = newCompanyForm(req);
    const problem = !form.name ? "Enter your name."
      : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email) ? "Enter your work email."
      : !form.company ? "Enter your company's name."
      : !form.address ? "Enter your company's address, with the city."
      : !form.terms ? "Accept the terms to create the company."
      : undefined;
    if (problem) {
      res.status(400).type("html").send(newCompanyPage(pending, label, form, problem));
      return;
    }
    try {
      await startSignupAction(signIn(req), {
        email: form.email,
        name: form.name,
        acceptTerms: true,
        ...(form.timezone ? { timezone: form.timezone } : {}),
        language: language(req)
      });
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 409) {
        res.status(409).type("html").send(emailPage(pending, label,
          "You already have a Hellotracks account with this email. Sign in instead.", form.email));
        return;
      }
      res.status(400).type("html").send(newCompanyPage(pending, label, form, friendly(error)));
      return;
    }
    store.setPendingEmail(pending.id, form.email);
    res.type("html").send(newCodePage(pending, label, form.email, form.company, form.address));
  });

  router.post("/signin/new/code", async (req, res) => {
    const pending = pendingFor(req, res);
    if (!pending) {
      return;
    }
    const label = await clientLabel(pending);
    const company = String(req.body.company ?? "").trim().slice(0, 120);
    const address = String(req.body.address ?? "").trim().slice(0, 300);
    const code = String(req.body.code ?? "").replace(/\D/g, "");
    if (!pending.email || !company) {
      res.status(400).type("html").send(newCompanyPage(pending, label, {}));
      return;
    }
    let issued: IssuedApiKey;
    try {
      issued = await issueSignupKeyAction(signIn(req), {
        email: pending.email,
        code,
        company: { name: company, address },
        keyLabel: keyLabel(label.name)
      });
    } catch (error) {
      res.status(400).type("html").send(newCodePage(pending, label, pending.email, company, address, friendly(error), code));
      return;
    }
    finish(res, pending, issued, false);
  });

  router.post("/signin/cancel", (req, res) => {
    const pending = pendingFor(req, res);
    if (!pending) {
      return;
    }
    const target = provider.denySignIn(pending.id);
    if (target) {
      res.redirect(302, target);
    } else {
      res.type("html").send(page("Cancelled", "<p>Nothing was connected. You can close this tab.</p>"));
    }
  });

  return router;
}

function keyLabel(clientName: string): string {
  return `${clientName} (AI connector)`.slice(0, 80);
}

interface NewCompanyForm {
  name?: string; email?: string; company?: string; address?: string; timezone?: string; terms?: boolean;
}

function newCompanyForm(req: Request): Required<NewCompanyForm> {
  const field = (name: string, max: number) => String(req.body?.[name] ?? "").trim().slice(0, max);
  const timezone = field("timezone", 64);
  return {
    name: field("name", 120),
    email: field("email", 254).toLowerCase(),
    company: field("company", 120),
    address: field("address", 300),
    timezone: /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(timezone) ? timezone : "",
    terms: req.body?.terms === "1"
  };
}

/** The browser's first language, two letters, for the welcome texts and units; English otherwise. */
function language(req: Request): string {
  const first = (req.acceptsLanguages()[0] ?? "en").slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(first) ? first : "en";
}

function friendly(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.statusCode === 429) {
      return "Too many tries. Wait a few minutes, then try again.";
    }
    if (error.message.includes("company.address")) {
      return "We couldn't find that address on the map. Add the street, city and country.";
    }
    return error.message;
  }
  return "Something went wrong. Try again.";
}

function hidden(pending: PendingSignIn, readOnly?: boolean): string {
  return `<input type="hidden" name="s" value="${escape(pending.id)}"><input type="hidden" name="csrf" value="${escape(pending.csrf)}">`
    + (readOnly === undefined ? "" : `<input type="hidden" name="readOnly" value="${readOnly ? "1" : "0"}">`);
}

function emailPage(pending: PendingSignIn, client: { name: string; host: string }, error?: string, email = ""): string {
  return page("Connect to Hellotracks", `
    <p class="lead"><strong>${escape(client.name)}</strong> wants to work with your Hellotracks company:
    see your team, jobs, places and routes, and, if you allow it, create and change jobs and routes for you.</p>
    <p class="muted">After signing in you go back to <strong>${escape(client.host)}</strong>.</p>
    ${error ? `<p class="error">${escape(error)}</p>` : ""}
    <form method="post" action="/signin/email">
      ${hidden(pending)}
      <label for="email">Your work email</label>
      <input id="email" name="email" type="email" autocomplete="email" value="${escape(email)}" required autofocus>
      <label for="password">Password <span class="muted">(or leave it empty and get a code by email)</span></label>
      <input id="password" name="password" type="password" autocomplete="current-password">
      <label class="check"><input type="checkbox" name="readOnly" value="1"> Read only: it can look, but not change anything</label>
      <button type="submit">Continue</button>
    </form>
    <form method="post" action="/signin/cancel">${hidden(pending)}<button class="link" type="submit">Cancel</button></form>
    <p class="divider">New to Hellotracks?</p>
    <a class="button secondary" href="/signin/new?s=${encodeURIComponent(pending.id)}">Create your company, free for 30 days</a>
    <p class="muted small">Company admins can connect. <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy</a></p>`);
}

function newCompanyPage(pending: PendingSignIn, client: { name: string; host: string }, form: NewCompanyForm, error?: string): string {
  return page("Create your Hellotracks company", `
    <p class="lead">Free for 30 days. Then <strong>${escape(client.name)}</strong> can set it up with you:
    invite your team, add jobs and plan their routes.</p>
    ${error ? `<p class="error">${escape(error)}</p>` : ""}
    <form method="post" action="/signin/new">
      ${hidden(pending)}
      <input type="hidden" id="timezone" name="timezone" value="${escape(form.timezone ?? "")}">
      <label for="name">Your name</label>
      <input id="name" name="name" type="text" autocomplete="name" maxlength="120" value="${escape(form.name ?? "")}" required autofocus>
      <label for="email">Your work email</label>
      <input id="email" name="email" type="email" autocomplete="email" value="${escape(form.email ?? "")}" required>
      <label for="company">Company name</label>
      <input id="company" name="company" type="text" autocomplete="organization" maxlength="120" value="${escape(form.company ?? "")}" required>
      <label for="address">Company address <span class="muted">(where the day starts)</span></label>
      <input id="address" name="address" type="text" autocomplete="street-address" maxlength="300" value="${escape(form.address ?? "")}" required>
      <label class="check"><input type="checkbox" name="terms" value="1"${form.terms ? " checked" : ""} required> I accept the&nbsp;<a href="${TERMS_URL}" target="_blank" rel="noopener">terms of service</a></label>
      <button type="submit">Continue</button>
    </form>
    <a class="button link" href="/signin?s=${encodeURIComponent(pending.id)}">I already have an account</a>
    <p class="muted small">We send a code to your email to confirm it. <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy</a></p>
    <script>${TIMEZONE_SCRIPT}</script>`);
}

function newCodePage(pending: PendingSignIn, client: { name: string; host: string }, email: string, company: string, address: string,
  error?: string, code = ""): string {
  return page("Check your email", `
    <p class="lead">We sent a 6-digit code to <strong>${escape(email)}</strong>. Enter it to create
    <strong>${escape(company)}</strong> and connect ${escape(client.name)}.</p>
    ${error ? `<p class="error">${escape(error)}</p>` : ""}
    <form method="post" action="/signin/new/code">
      ${hidden(pending)}
      <input type="hidden" name="company" value="${escape(company)}">
      <label for="code">Code</label>
      <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" value="${escape(code)}" required autofocus>
      <label for="address">Company address</label>
      <input id="address" name="address" type="text" autocomplete="street-address" maxlength="300" value="${escape(address)}" required>
      <button type="submit">Create company and connect</button>
    </form>
    <form method="post" action="/signin/cancel">${hidden(pending)}<button class="link" type="submit">Cancel</button></form>`);
}

function codePage(pending: PendingSignIn, client: { name: string; host: string }, email: string, readOnly: boolean, error?: string): string {
  return page("Check your email", `
    <p class="lead">We sent a 6-digit code to <strong>${escape(email)}</strong>.</p>
    ${error ? `<p class="error">${escape(error)}</p>` : ""}
    <form method="post" action="/signin/code">
      ${hidden(pending, readOnly)}
      <label for="code">Code</label>
      <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" required autofocus>
      <button type="submit">Connect ${escape(client.name)}${readOnly ? " (read only)" : ""}</button>
    </form>
    <form method="post" action="/signin/cancel">${hidden(pending)}<button class="link" type="submit">Cancel</button></form>`);
}

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · Hellotracks</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--text:#1a1f36;--muted:#5b6478;--line:#dfe3ea;--accent:#0b66e4;--error:#c0362c}
@media (prefers-color-scheme:dark){:root{--bg:#0f1218;--card:#171b23;--text:#e8ebf1;--muted:#9aa3b5;--line:#2a303c;--accent:#4c93ff;--error:#ff7a6e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:420px;margin:48px auto;padding:0 16px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:28px}
.brand{font-weight:600;letter-spacing:-.01em;margin-bottom:20px}h1{font-size:20px;margin:0 0 12px}p{margin:0 0 14px}.lead{font-size:15px}
.muted{color:var(--muted)}.small{font-size:13px;margin-top:18px}.error{color:var(--error)}
label{display:block;font-weight:500;margin:14px 0 6px}label.check{font-weight:400;display:flex;gap:8px;align-items:center;color:var(--muted)}
input[type=email],input[type=password],input[type=text],input[inputmode]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--text);font-size:15px}
button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:6px;background:var(--accent);color:#fff;font-size:15px;font-weight:500;cursor:pointer}
button.link,a.button.link{background:none;color:var(--muted);margin-top:8px;padding:6px}a{color:var(--accent)}
a.button{display:block;text-align:center;text-decoration:none;margin-top:10px;width:100%;padding:11px;border-radius:6px;font-weight:500}
a.button.secondary{border:1px solid var(--line);color:var(--text)}
.divider{margin:24px 0 0;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
</style></head><body><main><div class="card"><div class="brand">Hellotracks</div><h1>${escape(title)}</h1>${body}</div></main></body></html>`;
}

export function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
