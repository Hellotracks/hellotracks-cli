import test from "node:test";
import assert from "node:assert/strict";
import { renderCompanyOverview } from "./company-presenter.js";

const company = {
  id: "company-1",
  type: "company",
  username: "admin@example.com",
  name: "Acme Field Ops",
  email: "ops@example.com",
  address: "Main Street 1",
  location: {
    lat: 37.7955203,
    lng: -122.3937451
  },
  settings: {
    apiEnabled: true,
    workersCreateJobs: false,
    workersEditJob: true
  },
  teamsConfig: [
    {
      id: 7,
      name: "North",
      route: {
        start_lat: 37.7955203,
        start_lng: -122.3937451
      },
      working_hours: {
        monday: { start: 800, end: 1800 },
        tuesday: { start: 800, end: 1800 },
        wednesday: { start: 800, end: 1800 },
        thursday: { start: 800, end: 1800 },
        friday: { start: 800, end: 1800 },
        saturday: { start: 0, end: 0 },
        sunday: { start: 0, end: 0 }
      }
    }
  ]
};

test("renderCompanyOverview focuses default output on writable settings", () => {
  const text = renderCompanyOverview(company);
  assert.match(text, /Company/);
  assert.match(text, /name: Acme Field Ops  \(--name\)/);
  assert.match(text, /apiEnabled: true  \(\--api-enabled\)/);
  assert.doesNotMatch(text, /workersCreateJobs: false  \(\--workers-create-jobs\)/);
  assert.match(text, /disabled\/unset settings: \d+ hidden/);
  assert.match(text, /teamsConfig: 1 team \[read-only\]/);
  assert.doesNotMatch(text, /start_lat/);
  assert.doesNotMatch(text, /working_hours/);
  assert.doesNotMatch(text, /admin@example.com/);
});

test("renderCompanyOverview verbose output includes read-only fields and compact team rows", () => {
  const text = renderCompanyOverview(company, { verbose: true });
  assert.match(text, /Read-only Fields/);
  assert.match(text, /id: company-1  \[read-only\]/);
  assert.match(text, /username: admin@example.com  \[read-only\]/);
  assert.match(text, /workersCreateJobs: false  \(\--workers-create-jobs\)/);
  assert.match(text, /Teams \[read-only\]/);
  assert.match(text, /North/);
  assert.match(text, /37\.79552, -122\.39375/);
  assert.match(text, /Mon-Fri 08:00-18:00; Sat-Sun off/);
  assert.doesNotMatch(text, /working_hours/);
});
