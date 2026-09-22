import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");
const auth = readFileSync("src/components/AuthViews.tsx", "utf8");
const layout = readFileSync("src/app/layout.tsx", "utf8");
const manifest = readFileSync("public/manifest.webmanifest", "utf8");
const intake = readFileSync("src/app/data-intake/page.tsx", "utf8");
const accounts = readFileSync("functions/api/accounts.js", "utf8");
const migration = readFileSync("migrations/0019_app_user_profiles.sql", "utf8");

test("sidebar presents the role-filtered business workflow in operational order", () => {
  const labels = [
    "Clients & Projects",
    "Data Intake",
    "Data Readiness",
    "Pay Runs",
    "Payment Instructions",
    "Billing & AR",
    "Reports",
    "Employees",
  ];
  let cursor = -1;
  for (const label of labels) {
    const next = sidebar.indexOf(label);
    assert.ok(next > cursor, `${label} harus berada setelah tahap sebelumnya`);
    cursor = next;
  }
  assert.match(sidebar, /NavGroup label="Overview"/);
  assert.match(sidebar, /NavGroup label="Employee Portal"/);
  assert.match(sidebar, /role === "SUPER_ADMIN"/);
});


test("supplied ProQPay logo is used in visible branding while favicon/app icons stay unchanged", () => {
  assert.match(sidebar, /\/assets\/proqpay-logo-v2\.svg/);
  assert.match(auth, /\/assets\/proqpay-logo-v2\.svg/);
  assert.doesNotMatch(sidebar, /\/assets\/proqpay-logo\.png/);
  assert.doesNotMatch(auth, /\/assets\/proqpay-logo\.png/);
  assert.match(layout, /\/favicon\.ico/);
  assert.match(layout, /\/assets\/proqpay-192\.png/);
  assert.match(manifest, /\/assets\/proqpay-192\.png/);
  assert.match(manifest, /\/assets\/proqpay-512\.png/);
});

test("data intake relies on workflow navigation without a duplicate Pay Runs back action", () => {
  assert.doesNotMatch(intake, /← Pay Runs/);
});

test("user management persists profile photo and work information separately from credentials", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS app_user_profiles/);
  assert.match(accounts, /avatar_url/);
  assert.match(accounts, /job_title/);
  assert.match(accounts, /department/);
  assert.match(accounts, /phone/);
});
