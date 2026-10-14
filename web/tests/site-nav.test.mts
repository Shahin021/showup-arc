import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SHOWUP_NETWORK = "mainnet";
process.env.NEXT_PUBLIC_SHOWUP_CHAIN_ID = "5042";
process.env.NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS = "0x6108613878E4FA3531f3CB478D12AC49147d7366";

const nav = await import("../src/lib/site-nav");

test("mainnet header: event links kept, Infrastructure removed, Bridge/Swap/Add Funds each have their own route", () => {
  const items = nav.primaryNavItems();
  const labels = items.map((item) => item.label);
  assert.deepEqual(labels, ["How it works", "Explore", "Bridge", "Swap", "Add Funds"]);
  assert.ok(!labels.includes("Infrastructure"));
  const funding = nav.fundingAction();
  assert.equal(funding.label, "Add Funds");
  const hrefs = items.map((item) => item.href);
  assert.equal(hrefs.filter((href) => href === funding.href).length, 1);
  assert.equal(new Set(hrefs).size, hrefs.length, "no two items share a destination");
  assert.equal(nav.WALLET_TOOL_ROUTES.bridge, "/wallet-tools/bridge");
  assert.equal(nav.WALLET_TOOL_ROUTES.swap, "/wallet-tools/swap");
  assert.equal(nav.WALLET_TOOL_ROUTES.addFunds, "/wallet-tools/add-funds");
});

test("the active item follows the current route", () => {
  const items = Object.fromEntries(nav.primaryNavItems().map((item) => [item.label, item.activePrefixes]));
  assert.equal(nav.isActivePath("/wallet-tools/bridge", items.Bridge), true);
  assert.equal(nav.isActivePath("/wallet-tools/swap", items.Bridge), false);
  assert.equal(nav.isActivePath("/wallet-tools/add-funds", items["Add Funds"]), true);
  assert.equal(nav.isActivePath("/events/42", items.Explore), true);
  assert.equal(nav.isActivePath("/eventsx", items.Explore), false);
  assert.equal(nav.isActivePath("/", items["How it works"]), false);
  assert.equal(nav.isActivePath(null, items.Swap), false);
});
