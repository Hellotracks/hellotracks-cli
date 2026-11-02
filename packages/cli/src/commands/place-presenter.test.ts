import test from "node:test";
import assert from "node:assert/strict";
import { renderPlaceOverview } from "./place-presenter.js";

const place = {
  id: "place-1",
  type: "place",
  name: "Acme HQ",
  address: "Main Street 1",
  email: "hq@example.com",
  phone: "+15550123",
  city: "Rankweil",
  postalCode: "6830",
  state: "Vorarlberg",
  countryCode: "AT",
  color: "#dd9a3c",
  radius: 100,
  location: {
    lat: 37.7955203,
    lng: -122.3937451
  },
  teams: [1, 2],
  extendedData: {
    customerId: "CUST-1001"
  }
};

test("renderPlaceOverview focuses default output on writable place fields", () => {
  const text = renderPlaceOverview(place);
  assert.match(text, /Place/);
  assert.match(text, /name: Acme HQ  \(--name\)/);
  assert.match(text, /location: 37\.79552, -122\.39375  \(--lat, --lng\)/);
  assert.match(text, /teams: 1, 2  \(--team\)/);
  assert.match(text, /extendedData: \{"customerId":"CUST-1001"\}  \(--extended-data-json\)/);
  assert.doesNotMatch(text, /place-1/);
});

test("renderPlaceOverview verbose output includes read-only place details", () => {
  const text = renderPlaceOverview(place, { verbose: true });
  assert.match(text, /Read-only Fields/);
  assert.match(text, /id: place-1  \[read-only\]/);
  assert.match(text, /type: place  \[read-only\]/);
});
