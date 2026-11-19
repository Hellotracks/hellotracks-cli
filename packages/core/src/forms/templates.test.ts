import test from "node:test";
import assert from "node:assert/strict";
import { FORM_TEMPLATE_EXAMPLE, validateFormTemplate } from "./templates.js";

test("validateFormTemplate accepts the example and refuses unclear fields", () => {
  assert.equal(validateFormTemplate(FORM_TEMPLATE_EXAMPLE).template.title, "Safety check");
  assert.throws(() => validateFormTemplate({ title: "X", content: [{ type: "text" }] }), /stable name/);
  assert.throws(() => validateFormTemplate({ title: "X", content: [{ type: "radio", name: "a" }] }), /options array/);
  assert.throws(() => validateFormTemplate({ title: "X", content: [{ type: "text", name: "a" }, { type: "number", name: "A" }] }), /duplicated/);
  assert.throws(() => validateFormTemplate({ title: "X", content: [{ type: "video", name: "a" }] }), /unsupported type/);
});
