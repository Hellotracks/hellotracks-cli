import test from "node:test";
import assert from "node:assert/strict";
import { reportRequest, savedReportBody, weekdayNumber } from "./requests.js";

test("reportRequest builds the API's request from ids and options", () => {
  const request = reportRequest({ report: "timesheet" }, {
    from: "2026-10-01",
    until: "2026-10-31",
    memberIds: ["m1"],
    placeIds: ["p1"],
    columns: [{ key: "hours", name: "Hours" }],
    options: { rate: "0.42" },
    compare: false
  });
  assert.deepEqual(request, {
    report: "timesheet",
    fromDay: 20261001,
    untilDay: 20261031,
    who: { kind: "people", memberUids: ["m1"] },
    places: { kind: "list", placeUids: ["p1"] },
    options: { rate: "0.42", columns: JSON.stringify([{ key: "hours", name: "Hours" }]) },
    compare: false
  });
  assert.throws(() => reportRequest({}, { period: "lastWeek", from: "2026-10-01", until: "2026-10-02" }), /not both/);
  assert.throws(() => reportRequest({}, { period: "someday" }), /Invalid period/);
  assert.throws(() => reportRequest({}, { memberIds: ["m1"], teamIds: [1] }), /members or teams/);
});

test("savedReportBody keeps what is not given and sets the schedule", () => {
  const existing = { name: "Weekly", request: { report: "jobs", period: "lastWeek" }, formats: ["xlsx"], recipients: { emails: ["a@example.com"] }, status: "active" };
  const body = savedReportBody(existing, "jobs", { every: "week", weekdays: ["mon"], at: "07:30", paused: true });
  assert.deepEqual(body, {
    name: "Weekly",
    request: { report: "jobs", period: "lastWeek" },
    formats: ["xlsx"],
    schedule: { frequency: "week", weekdays: [1], weekday: 1, hour: 7, minute: 30 },
    recipients: { emails: ["a@example.com"] },
    status: "paused"
  });
  assert.equal(weekdayNumber("Sunday"), 7);
  assert.throws(() => weekdayNumber("someday"), /Invalid weekday/);
});
