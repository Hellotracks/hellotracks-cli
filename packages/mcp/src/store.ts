import { DatabaseSync } from "node:sqlite";

/** One connection: a person in a company who allowed one client, holding the company API key it got. */
export interface Grant {
  id: string;
  clientId: string;
  accountId: string;
  username: string;
  companyId: string;
  companyName: string;
  keySealed: string;
  keyId: string;
  keyExpiresAt: number;
  readOnly: boolean;
  createdAt: number;
}

/** A sign-in started at /authorize and finished on our sign-in pages. */
export interface PendingSignIn {
  id: string;
  clientId: string;
  params: string;
  csrf: string;
  email: string;
  createdAt: number;
}

export interface CodeRecord {
  grantId: string;
  clientId: string;
  challenge: string;
  redirectUri: string;
  resource: string;
  expiresAt: number;
}

export interface TokenRecord {
  grantId: string;
  kind: "access" | "refresh";
  expiresAt: number;
}

type Row = Record<string, string | number | null>;

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS clients (client_id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pending (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, params TEXT NOT NULL,
        csrf TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS codes (hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, client_id TEXT NOT NULL,
        challenge TEXT NOT NULL, redirect_uri TEXT NOT NULL, resource TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, account_id TEXT NOT NULL,
        username TEXT NOT NULL, company_id TEXT NOT NULL, company_name TEXT NOT NULL, key_sealed TEXT NOT NULL,
        key_id TEXT NOT NULL, key_expires_at INTEGER NOT NULL, read_only INTEGER NOT NULL, created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, kind TEXT NOT NULL,
        expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS tokens_grant ON tokens (grant_id);
    `);
  }

  getClient(clientId: string): { json: string; createdAt: number } | undefined {
    const row = this.db.prepare("SELECT json, created_at FROM clients WHERE client_id = ?").get(clientId) as Row | undefined;
    return row ? { json: String(row.json), createdAt: Number(row.created_at) } : undefined;
  }

  putClient(clientId: string, json: string, now = Date.now()): void {
    this.db.prepare("INSERT OR REPLACE INTO clients (client_id, json, created_at) VALUES (?, ?, ?)").run(clientId, json, now);
  }

  putPending(pending: PendingSignIn): void {
    this.db.prepare("INSERT INTO pending (id, client_id, params, csrf, email, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(pending.id, pending.clientId, pending.params, pending.csrf, pending.email, pending.createdAt);
  }

  getPending(id: string): PendingSignIn | undefined {
    const row = this.db.prepare("SELECT * FROM pending WHERE id = ?").get(id) as Row | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: String(row.id),
      clientId: String(row.client_id),
      params: String(row.params),
      csrf: String(row.csrf),
      email: String(row.email),
      createdAt: Number(row.created_at)
    };
  }

  setPendingEmail(id: string, email: string): void {
    this.db.prepare("UPDATE pending SET email = ? WHERE id = ?").run(email, id);
  }

  deletePending(id: string): void {
    this.db.prepare("DELETE FROM pending WHERE id = ?").run(id);
  }

  putCode(hash: string, code: CodeRecord): void {
    this.db.prepare("INSERT INTO codes (hash, grant_id, client_id, challenge, redirect_uri, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(hash, code.grantId, code.clientId, code.challenge, code.redirectUri, code.resource, code.expiresAt);
  }

  getCode(hash: string): CodeRecord | undefined {
    const row = this.db.prepare("SELECT * FROM codes WHERE hash = ?").get(hash) as Row | undefined;
    if (!row) {
      return undefined;
    }
    return {
      grantId: String(row.grant_id),
      clientId: String(row.client_id),
      challenge: String(row.challenge),
      redirectUri: String(row.redirect_uri),
      resource: String(row.resource),
      expiresAt: Number(row.expires_at)
    };
  }

  /** Codes are single use: true only for the first caller. */
  takeCode(hash: string): boolean {
    return Number(this.db.prepare("DELETE FROM codes WHERE hash = ?").run(hash).changes) === 1;
  }

  putGrant(grant: Grant): void {
    this.db.prepare(`INSERT INTO grants (id, client_id, account_id, username, company_id, company_name, key_sealed, key_id,
      key_expires_at, read_only, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(grant.id, grant.clientId, grant.accountId, grant.username, grant.companyId, grant.companyName, grant.keySealed,
        grant.keyId, grant.keyExpiresAt, grant.readOnly ? 1 : 0, grant.createdAt);
  }

  getGrant(id: string): Grant | undefined {
    const row = this.db.prepare("SELECT * FROM grants WHERE id = ?").get(id) as Row | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: String(row.id),
      clientId: String(row.client_id),
      accountId: String(row.account_id),
      username: String(row.username),
      companyId: String(row.company_id),
      companyName: String(row.company_name),
      keySealed: String(row.key_sealed),
      keyId: String(row.key_id),
      keyExpiresAt: Number(row.key_expires_at),
      readOnly: Number(row.read_only) === 1,
      createdAt: Number(row.created_at)
    };
  }

  touchGrant(id: string, now = Date.now()): void {
    this.db.prepare("UPDATE grants SET last_used_at = ? WHERE id = ?").run(now, id);
  }

  deleteGrant(id: string): void {
    this.db.prepare("DELETE FROM tokens WHERE grant_id = ?").run(id);
    this.db.prepare("DELETE FROM grants WHERE id = ?").run(id);
  }

  putToken(hash: string, token: TokenRecord): void {
    this.db.prepare("INSERT INTO tokens (hash, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)")
      .run(hash, token.grantId, token.kind, token.expiresAt);
  }

  getToken(hash: string): TokenRecord | undefined {
    const row = this.db.prepare("SELECT * FROM tokens WHERE hash = ?").get(hash) as Row | undefined;
    if (!row) {
      return undefined;
    }
    return { grantId: String(row.grant_id), kind: String(row.kind) as TokenRecord["kind"], expiresAt: Number(row.expires_at) };
  }

  /** Refresh tokens rotate: true only for the first caller. */
  takeToken(hash: string): boolean {
    return Number(this.db.prepare("DELETE FROM tokens WHERE hash = ?").run(hash).changes) === 1;
  }

  /** Drops what has expired; sign-ins left unfinished for an hour, and connections whose key ran out. */
  sweep(now = Date.now()): void {
    this.db.prepare("DELETE FROM pending WHERE created_at < ?").run(now - 60 * 60_000);
    this.db.prepare("DELETE FROM codes WHERE expires_at < ?").run(now);
    this.db.prepare("DELETE FROM tokens WHERE expires_at < ?").run(now);
    this.db.prepare("DELETE FROM tokens WHERE grant_id IN (SELECT id FROM grants WHERE key_expires_at < ?)").run(now);
    this.db.prepare("DELETE FROM grants WHERE key_expires_at < ?").run(now);
  }

  close(): void {
    this.db.close();
  }
}
