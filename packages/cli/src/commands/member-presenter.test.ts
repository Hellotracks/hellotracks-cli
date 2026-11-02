import test from "node:test";
import assert from "node:assert/strict";
import { renderMemberOverview } from "./member-presenter.js";

const member = {
  id: "member-1",
  type: "worker",
  companyId: "company-1",
  username: "alice@example.com",
  name: "Alice Field",
  email: "alice@example.com",
  phone: "+15550123",
  role: "worker",
  color: "#0088ff",
  statusLabel: "Ready",
  activeStatus: "online",
  teams: [1, 2],
  location: {
    lat: 37.7955203,
    lng: -122.3937451
  },
  units: {
    distance: "km",
    time: "24h",
    date: "yyyy-mm-dd"
  },
  locale: {
    language: "en",
    timezone: "Europe/Vienna"
  },
  states: {
    tracking: true
  },
  timestamps: {
    updatedAt: "2026-05-20T10:00:00Z"
  }
};

test("renderMemberOverview focuses default output on writable member fields", () => {
  const text = renderMemberOverview(member);
  assert.match(text, /Member/);
  assert.match(text, /name: Alice Field  \(--name\)/);
  assert.match(text, /username: alice@example.com  \(--username\)/);
  assert.match(text, /teams: 1, 2  \(--team\)/);
  assert.match(text, /timezone: Europe\/Vienna  \(--timezone\)/);
  assert.match(text, /routeStartLat: -  \(--route-start-lat\)/);
  assert.doesNotMatch(text, /member-1/);
  assert.doesNotMatch(text, /online/);
  assert.doesNotMatch(text, /tracking/);
});

test("renderMemberOverview verbose output includes read-only member details", () => {
  const text = renderMemberOverview(member, { verbose: true });
  assert.match(text, /Read-only Fields/);
  assert.match(text, /id: member-1  \[read-only\]/);
  assert.match(text, /activeStatus: online  \[read-only\]/);
  assert.match(text, /location: 37\.79552, -122\.39375  \[read-only\]/);
  assert.match(text, /states: \{"tracking":true\}  \[read-only\]/);
});
