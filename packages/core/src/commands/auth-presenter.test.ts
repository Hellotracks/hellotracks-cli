import test from "node:test";
import assert from "node:assert/strict";
import { renderAuthWhoamiOverview } from "./auth-presenter.js";
import type { AuthWhoAmIResponse } from "../types.js";

const whoami: AuthWhoAmIResponse = {
  account: {
    id: "account-1",
    type: "person",
    username: "admin@example.com",
    name: "Demo Admin",
    email: "admin@example.com",
    phone: "+1 555 0100",
    role: "admin",
    teams: [1, 2],
    locale: {
      timezone: "Europe/Vienna"
    },
    location: {
      lat: 37.7955203,
      lng: -122.3937451
    }
  },
  company: {
    id: "company-1",
    type: "company",
    username: "company@example.com",
    name: "Demo Company",
    email: "ops@example.com",
    phone: "+1 555 0110",
    address: "Main Street 1",
    settings: {
      apiEnabled: true,
      workersCreateJobs: false
    },
    teamsConfig: [
      { id: 1, name: "North" },
      { id: 2, name: "South" }
    ],
    location: {
      lat: 37.7955203,
      lng: -122.3937451
    }
  },
  apiKey: {
    id: "key-1",
    legacy: false
  }
};

test("renderAuthWhoamiOverview defaults to compact identity output", () => {
  const text = renderAuthWhoamiOverview(whoami, {
    profile: "default",
    apiUrl: "https://api.hellotracks.com/v1",
    verbose: false
  });

  assert.match(text, /Authenticated/);
  assert.match(text, /profile: default/);
  assert.match(text, /Demo Admin/);
  assert.match(text, /Demo Company/);
  assert.match(text, /apiEnabled: true/);
  assert.match(text, /teamsConfig: 2 teams/);
  assert.match(text, /id: key-1/);
  assert.doesNotMatch(text, /legacy: false/);
  assert.doesNotMatch(text, /Main Street 1/);
  assert.doesNotMatch(text, /settings\.workersCreateJobs/);
});

test("renderAuthWhoamiOverview verbose output includes compact read-only details", () => {
  const text = renderAuthWhoamiOverview(whoami, {
    profile: "default",
    apiUrl: "https://api.hellotracks.com/v1",
    verbose: true
  });

  assert.match(text, /Account Details \[read-only\]/);
  assert.match(text, /id: account-1  \[read-only\]/);
  assert.match(text, /legacy: false  \[read-only\]/);
  assert.match(text, /location: 37\.79552, -122\.39375  \[read-only\]/);
  assert.match(text, /Company Details \[read-only\]/);
  assert.match(text, /address: Main Street 1  \[read-only\]/);
  assert.match(text, /settings\.workersCreateJobs: false  \[read-only\]/);
});

test("renderAuthWhoamiOverview shows legacy API keys in compact output", () => {
  const text = renderAuthWhoamiOverview({
    ...whoami,
    apiKey: {
      id: "key-1",
      legacy: true
    }
  }, {
    profile: "default",
    apiUrl: "https://api.hellotracks.com/v1",
    verbose: false
  });

  assert.match(text, /legacy: true  \[read-only\]/);
});
