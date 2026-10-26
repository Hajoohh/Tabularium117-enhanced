// Logic tests for the browser UI, without a browser and without a
// dependency: node --test scripts/ui.test.mjs (Node 22 or newer).
//
// The frontend has no build step and therefore no test runner either, which
// left its logic - filters, sorting, the warm-up state, which of two answers
// wins - checkable only by hand or in a full browser.
// This file gives the view modules just enough DOM to run against, so the
// parts that are decisions rather than pixels can be tested in a second.
//
// What it deliberately does not do: render, lay out, or style anything. A
// green run here says the logic holds, not that the page looks right.
// `docs/beta.md` is still what covers the looking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// --- the smallest DOM these modules need -----------------------------------

class Element extends EventTarget {
  constructor(tag = "") {
    super();
    this.tagName = tag;
    this.children = [];
    this.attributes = new Map();
    this.style = {};
    this.className = "";
    this.parent = null;
  }
  append(...items) {
    for (let node of items) {
      if (typeof node === "string") node = new Text(node);
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...items) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...items);
  }
  get firstChild() {
    return this.children[0];
  }
  get childElementCount() {
    return this.children.length;
  }
  set textContent(value) {
    this.replaceChildren(new Text(String(value)));
  }
  get textContent() {
    return this.children.map((child) => child.textContent).join("");
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  // In a browser `element.title = x` and setAttribute("title", x) are the
  // same thing. The views use the property, the tests read the attribute,
  // and a double that does not reflect it would fail them both wrongly.
  get title() {
    return this.getAttribute("title") ?? "";
  }
  set title(value) {
    this.setAttribute("title", value);
  }
  get valueAsNumber() {
    return Number(this.value);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  // Enough of a selector engine for "tag" and ".class".
  querySelectorAll(selector) {
    const matches = (node) => (selector.startsWith(".")
      ? String(node.className).split(/\s+/).includes(selector.slice(1))
      : node.tagName === selector);
    return this.children.flatMap((node) => [
      ...(matches(node) ? [node] : []),
      ...node.querySelectorAll(selector),
    ]);
  }
  focus() {
    document.activeElement = this;
  }
  click() {
    this.dispatchEvent(new Event("click"));
  }
  get classList() {
    return {
      add: (name) => {
        this.className = `${this.className} ${name}`.trim();
      },
    };
  }
}

class Text extends Element {
  constructor(value) {
    super("#text");
    this.value = value;
  }
  get textContent() {
    return this.value;
  }
  set textContent(value) {
    this.value = value;
  }
}

const document_ = new Element("document");
document_.createElement = (tag) => new Element(tag);
document_.createTextNode = (value) => new Text(value);
globalThis.document = document_;
globalThis.window = { location: { hash: "" }, matchMedia: () => ({ matches: false }) };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };

const { i18n } = await import("../web/js/i18n.js");
const { api } = await import("../web/js/api.js");
const { renderIslandDetail } = await import("../web/js/views/islands.js");
const { renderEfficiency } = await import("../web/js/views/efficiency.js");
const { renderAlerts } = await import("../web/js/views/alerts.js");
const { renderCompare } = await import("../web/js/views/compare.js");
const { renderAggregate } = await import("../web/js/views/aggregate.js");
const { createRegionGroup } = await import("../web/js/region-group.js");
const {
  createGoodsChainsLoader,
  filterGoodsByCategories,
  goodsCategoriesForRegions,
} = await import("../web/js/goods-chain-view.js");

test("the sidebar always links to warnings, even before islands load", async () => {
  const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
  assert.match(html, /<a href="#\/alerts" data-i18n="alertsHeading">Warnings<\/a>/);
  assert.match(html, /<a href="#\/total" data-i18n="totalHeading">Total<\/a>/);
});

test("the separate goods-icon map points to existing local files and catalog GUIDs", async () => {
  const config = JSON.parse(await readFile(new URL("../web/js/goods-icons.json", import.meta.url), "utf8"));
  const catalog = JSON.parse(await readFile(new URL("../internal/catalog/catalog.json", import.meta.url), "utf8"));
  const knownGuids = new Set(catalog.products.map((product) => String(product.guid)));
  assert.ok(Object.keys(config.icons).length > 50);
  for (const [guid, url] of Object.entries(config.icons)) {
    assert.match(guid, /^\d+$/);
    assert.ok(knownGuids.has(guid), `icon GUID ${guid} exists in catalog`);
    assert.match(url, /^\/production_goods\/[\w().-]+\.(?:png|webp)$/i);
    await readFile(new URL(`../web${url}`, import.meta.url));
  }
  assert.ok(!Object.values(config.icons).some((url) => /^https?:/i.test(url)));
  assert.match(config.icons["2086"], /icon_clay_0\.png$/);
  assert.match(config.icons["2069"], /icon_3d_wheat_goods_0\.png$/);
  assert.ok(!Object.values(config.icons).some((url) => /^https?:/i.test(url)));
});

test("region island lists can be collapsed and expanded accessibly", () => {
  i18n.lang = "en";
  const changes = [];
  const group = createRegionGroup(3245, "Latium", false, (collapsed) => changes.push(collapsed));
  const islandRow = new Element("li");
  group.islands.append(islandRow);
  const toggle = nodes(group.item, ".region-toggle")[0];
  const link = nodes(group.item, "a")[0];

  assert.equal(group.islands.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(link.href, "#/region/3245");
  toggle.click();
  assert.equal(group.islands.hidden, true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-label"), "Expand Latium islands");
  toggle.click();
  assert.equal(group.islands.hidden, false);
  assert.deepEqual(changes, [true, false]);
});

// --- fixtures --------------------------------------------------------------

let fakeAlertSettings = { deficitThreshold: 0, dropPercentagePoints: 20, suppressions: [] };
api.alertSettings = async () => ({
  ...fakeAlertSettings,
  suppressions: [...fakeAlertSettings.suppressions],
});
api.setAlertThresholds = async (deficitThreshold, dropPercentagePoints) => {
  fakeAlertSettings = { ...fakeAlertSettings, deficitThreshold, dropPercentagePoints };
  return api.alertSettings();
};
api.setAlertSuppression = async (islandId, productGuid, rule, disabled) => {
  const suppressions = fakeAlertSettings.suppressions.filter((entry) =>
    !(entry.islandId === islandId && String(entry.productGuid) === String(productGuid) && entry.rule === rule));
  if (disabled) suppressions.push({ islandId, islandName: island.name, productGuid, productName: "Bread", rule });
  fakeAlertSettings = { ...fakeAlertSettings, suppressions };
  return api.alertSettings();
};

const island = { id: "3245-1", name: "Juliana", sessionName: "Latium", products: 3, deficits: 1 };
const secondIsland = { id: "6627-2", name: "Argantum", sessionName: "Albion", products: 3, deficits: 1 };

const products = [
  { guid: 1, name: "Bread", generation: 5, perfectGeneration: 8, consumption: 3, delta: 2, buildings: 2 },
  { guid: 2, name: "Wheat", generation: 3, perfectGeneration: 6, consumption: 7, delta: -4, buildings: 3 },
  { guid: 3, name: "Fish", generation: 1, perfectGeneration: 2, consumption: 1, delta: 0, buildings: 1 },
];

// One warning, on Bread, so that "warnings" and "deficits" select different
// rows - a filter that happened to select the same rows as another would
// prove nothing.
const storeWith = (...alerts) => ({
  islands: [island],
  alerts: [{ islandId: island.id, productGuid: 1, rule: "productivity_drop", detail: "test" }, ...alerts],
  status: {},
});

const nodes = (root, selector) => root.querySelectorAll(selector);
const rowText = (root) => nodes(root, "tbody")[0].textContent;
const button = (root, label) => nodes(root, "button").find((node) => node.textContent === label);

test("the filters intersect with the search, and an empty result says why", async () => {
  i18n.lang = "en";
  api.products = async () => ({ island, products });
  const root = new Element();
  // A warning on another island must not leak into this one's filter.
  const store = storeWith({ islandId: "9999-9", productGuid: 2, rule: "deficit", detail: "elsewhere" });
  const cleanup = await renderIslandDetail(root, island.id, store);

  assert.match(rowText(root), /Bread/);
  assert.match(nodes(root, "thead")[0].textContent, /Potential \(100%\)\/min/);
  assert.match(rowText(root), /Bread.*5\.0.*8\.0/);
  button(root, "Deficits").click();
  assert.match(rowText(root), /Wheat/);
  assert.doesNotMatch(rowText(root), /Bread/);

  button(root, "Warnings").click();
  assert.match(rowText(root), /Bread/);
  assert.doesNotMatch(rowText(root), /Wheat/, "the warning on the other island must not select its row here");

  const search = nodes(root, "input")[0];
  search.value = "wheat";
  search.dispatchEvent(new Event("input"));
  assert.match(rowText(root), /No matching goods/, "a filter and a search that exclude each other must explain the empty table");

  button(root, "All").click();
  assert.match(rowText(root), /Wheat/);
  cleanup();
});

test("the goods-chain toggle shows every matching multistage chain for this region", async () => {
  i18n.lang = "en";
  api.products = async () => ({
    island,
    products: [
      { guid: 2086, name: "Clay", generation: 0, perfectGeneration: 0, consumption: 0, delta: 0, buildings: 0 },
      { guid: 13810, name: "Armour", generation: 0, perfectGeneration: 0, consumption: 0, delta: 0, buildings: 0 },
    ],
  });
  api.goodsChains = async () => ({
    regions: {
      Latium: [{
        product: { guid: 12, name: { en: "Tools", de: "Werkzeuge" } },
        stages: [
          { inputs: [{ guid: 2086, name: { en: "Clay", de: "Lehm" } }], output: { guid: 11, name: { en: "Metal", de: "Metall" } } },
          { inputs: [{ guid: 11, name: { en: "Metal", de: "Metall" } }, { guid: 2, name: { en: "Wheat", de: "Weizen" } }], output: { guid: 12, name: { en: "Tools", de: "Werkzeuge" } } },
        ],
      }, {
        product: { guid: 13810, name: { en: "Armour", de: "Rüstung" } },
        stages: [
          { inputs: [{ guid: 2080, name: { en: "Iron Ore", de: "Eisenerz" } }], output: { guid: 2115, name: { en: "Iron", de: "Eisen" } } },
        ],
      }],
      Albion: [{
        stages: [
          { inputs: [{ guid: 2, name: { en: "Wheat", de: "Weizen" } }], output: { guid: 13, name: { en: "Bread", de: "Brot" } } },
        ],
      }],
    },
  });
  let iconLoads = 0;
  api.goodsIcons = async () => {
    iconLoads++;
    return { icons: { "2086": "/production_goods/icon_clay_0.png" } };
  };
  const root = new Element();
  const cleanup = await renderIslandDetail(root, island.id, storeWith());
  await settle();
  assert.equal(iconLoads, 1, "the icon map loads when the goods view opens");
  const search = nodes(root, "input").find((input) => input.type === "search");
  search.value = "Clay";
  search.dispatchEvent(new Event("input"));
  assert.equal(nodes(root, ".goods-chain-icon").length, 1, "the matched good has an icon before chains are enabled");
  assert.equal(nodes(root, ".product-link")[0].children[0].tagName, "img",
    "the good icon appears before its name");
  const toggle = nodes(root, ".goods-chain-toggle")[0].querySelector("input");
  toggle.checked = true;
  toggle.dispatchEvent(new Event("change"));
  await settle();

  const text = rowText(root);
  assert.match(text, /Goods chain for Tools/);
  assert.match(text, /Clay.*Metal.*Metal \+ Wheat.*Tools/);
  assert.doesNotMatch(text, /Bread/, "chains for a different region are not shown");
  const icons = nodes(root, ".goods-chain-icon");
  assert.ok(icons.length >= 2, "an icon appears both beside the searched good and in the recipe");
  assert.equal(icons[0].src, "/production_goods/icon_clay_0.png");
  nodes(root, ".goods-chain-good").find((good) => good.textContent.includes("Metal")).click();
  assert.match(nodes(root, ".goods-chain-overview")[0].textContent, /Goods chain for Tools/,
    "clicking a good opens the overview of chains that include it");

  search.value = "Armour";
  search.dispatchEvent(new Event("input"));
  assert.match(rowText(root), /Goods chain for Armour/);
  assert.match(rowText(root), /Iron Ore.*Iron/);
  cleanup();
});

test("the goods-chain toggle reports a missing configuration", async () => {
  i18n.lang = "en";
  api.products = async () => ({ island, products });
  api.goodsChains = async () => { throw new Error("configuration unavailable"); };
  api.goodsIcons = async () => ({ icons: {} });
  const root = new Element();
  const cleanup = await renderIslandDetail(root, island.id, storeWith());
  const toggle = nodes(root, ".goods-chain-toggle")[0].querySelector("input");
  toggle.checked = true;
  toggle.dispatchEvent(new Event("change"));
  await settle();

  assert.equal(toggle.checked, false, "the option is reset when loading fails");
  assert.match(nodes(root, ".goods-chain-message")[0].textContent, /configuration unavailable/);
  cleanup();
});

test("the local goods-chain toggle shows chains with end-product buildings on the selected island", async () => {
  i18n.lang = "de";
  api.products = async () => ({
    island,
    products: [
      { guid: 1, name: "Timber", generation: 2, perfectGeneration: 2, consumption: 0, delta: 2, buildings: 1 },
      { guid: 3, name: "Tiles", generation: 0, perfectGeneration: 0, consumption: 0, delta: 0, buildings: 0 },
      { guid: 4, name: "Clay Products", generation: 1, perfectGeneration: 1, consumption: 0, delta: 1, buildings: 1 },
    ],
  });
  api.goodsChains = async () => ({
    regions: {
      Latium: [{
        product: { guid: 1, name: { en: "Timber", de: "Bretter" } },
        stages: [{ inputs: [{ guid: 2, name: { en: "Wood", de: "Holz" } }], output: { guid: 1, name: { en: "Timber", de: "Bretter" } } }],
      }, {
        product: { guid: 3, name: { en: "Tiles", de: "Ziegel" } },
        stages: [
          { inputs: [{ guid: 5, name: { en: "Raw Clay", de: "Rohlehm" } }], output: { guid: 4, name: { en: "Clay Products", de: "Lehmprodukte" } } },
          { inputs: [{ guid: 4, name: { en: "Clay Products", de: "Lehmprodukte" } }], output: { guid: 3, name: { en: "Tiles", de: "Ziegel" } } },
        ],
      }],
      Albion: [{
        product: { guid: 5, name: { en: "Bread", de: "Brot" } },
        stages: [{ inputs: [{ guid: 6, name: { en: "Wheat", de: "Weizen" } }], output: { guid: 5, name: { en: "Bread", de: "Brot" } } }],
      }],
    },
  });
  api.goodsIcons = async () => ({ icons: {} });
  const root = new Element();
  const cleanup = await renderIslandDetail(root, island.id, storeWith());
  const labels = nodes(root, ".goods-chain-toggle");
  assert.equal(labels[0].textContent, "Warenketten zur gesuchten Ware anzeigen");
  assert.equal(labels[1].textContent, "Lokale Warenketten anzeigen");

  const localToggle = labels[1].querySelector("input");
  localToggle.checked = true;
  localToggle.dispatchEvent(new Event("change"));
  await settle();

  const localChains = nodes(root, ".goods-chain-overview").find((overview) => overview.textContent.includes("Bretter"));
  assert.match(localChains.textContent, /Bretter/);
  assert.doesNotMatch(localChains.textContent, /Ziegel/,
    "a configured regional chain is omitted unless its end-product buildings exist on this island");
  assert.doesNotMatch(localChains.textContent, /Lehmprodukte/,
    "buildings for an intermediate product do not activate the end-product chain");
  assert.doesNotMatch(localChains.textContent, /Brot/, "chains from other regions must not appear");
  cleanup();
});

test("goods categories are exclusive, and no category selection keeps every product", () => {
  const config = {
    regions: {
      Latium: [{
        product: { guid: 3 },
        stages: [
          { inputs: [{ guid: 1 }], output: { guid: 2 } },
          { inputs: [{ guid: 2 }], output: { guid: 3 } },
        ],
      }],
    },
  };
  const categories = goodsCategoriesForRegions(config, ["Latium"]);
  const goods = [{ guid: 1 }, { guid: 2 }, { guid: 3 }, { guid: 4 }];

  assert.equal(categories.get("1"), undefined, "unproduced goods are raw materials");
  assert.equal(categories.get("2"), "intermediate");
  assert.equal(categories.get("3"), "end");
  assert.deepEqual(filterGoodsByCategories(goods, new Set(), categories), goods);
  assert.deepEqual(filterGoodsByCategories(goods, new Set(["raw"]), categories), [goods[0], goods[3]]);
  assert.deepEqual(filterGoodsByCategories(goods, new Set(["intermediate", "end"]), categories), [goods[1], goods[2]]);
});

test("goods-chain loader shares concurrent requests, validates config, and retries failures", async () => {
  let requests = 0;
  const config = { regions: {} };
  const loader = createGoodsChainsLoader(async () => {
    requests++;
    return config;
  });

  const [first, second] = await Promise.all([loader.load(), loader.load()]);
  assert.equal(first, config);
  assert.equal(second, config);
  assert.equal(requests, 1, "concurrent callers share one validated request");
  assert.equal(await loader.load(), config);
  assert.equal(requests, 1, "a successful configuration is cached");

  let attempts = 0;
  const retryingLoader = createGoodsChainsLoader(async () => {
    attempts++;
    if (attempts === 1) throw new Error("temporary failure");
    return config;
  });
  await assert.rejects(retryingLoader.load(), /temporary failure/);
  assert.equal(await retryingLoader.load(), config, "failed requests can be retried");
  assert.equal(attempts, 2);
});

test("island goods categories filter rows and leave all visible when unchecked", async () => {
  i18n.lang = "de";
  api.products = async () => ({
    island,
    products: [
      { guid: 1, name: "Holz", generation: 1, perfectGeneration: 1, consumption: 0, delta: 1, buildings: 1 },
      { guid: 2, name: "Bretter", generation: 1, perfectGeneration: 1, consumption: 0, delta: 1, buildings: 1 },
      { guid: 3, name: "Mosaike", generation: 1, perfectGeneration: 1, consumption: 0, delta: 1, buildings: 1 },
    ],
  });
  api.goodsChains = async () => ({
    regions: {
      Latium: [{
        product: { guid: 3, name: { de: "Mosaike", en: "Mosaics" } },
        stages: [
          { inputs: [{ guid: 1, name: { de: "Holz", en: "Wood" } }], output: { guid: 2, name: { de: "Bretter", en: "Timber" } } },
          { inputs: [{ guid: 2, name: { de: "Bretter", en: "Timber" } }], output: { guid: 3, name: { de: "Mosaike", en: "Mosaics" } } },
        ],
      }],
    },
  });
  api.goodsIcons = async () => ({ icons: {} });
  const root = new Element();
  const cleanup = await renderIslandDetail(root, island.id, storeWith());
  const toggles = nodes(root, ".goods-category-toggle").map((label) => label.querySelector("input"));
  assert.match(rowText(root), /Holz.*Bretter.*Mosaike/);

  toggles[0].checked = true;
  toggles[0].dispatchEvent(new Event("change"));
  await settle();
  assert.match(rowText(root), /Holz/);
  assert.doesNotMatch(rowText(root), /Bretter|Mosaike/);

  toggles[0].checked = false;
  toggles[0].dispatchEvent(new Event("change"));
  toggles[1].checked = true;
  toggles[1].dispatchEvent(new Event("change"));
  assert.match(rowText(root), /Bretter/);
  assert.doesNotMatch(rowText(root), /Holz|Mosaike/);
  cleanup();
});

test("sorting says which way it sorted and keeps the keyboard focus", async () => {
  i18n.lang = "en";
  api.products = async () => ({ island, products });
  const root = new Element();
  const cleanup = await renderIslandDetail(root, island.id, storeWith());

  // The default is the deficit first: that is what the table is for.
  assert.match(nodes(root, "tbody")[0].children[0].textContent, /Wheat/);
  assert.equal(nodes(root, "th")[5].getAttribute("aria-sort"), "ascending");

  const deltaHeader = nodes(root, "thead")[0].querySelectorAll("button")[4];
  deltaHeader.click();
  assert.match(nodes(root, "tbody")[0].children[0].textContent, /Bread/, "a second click reverses the order");
  assert.equal(nodes(root, "th")[5].getAttribute("aria-sort"), "descending");
  assert.equal(
    document.activeElement,
    nodes(root, "thead")[0].querySelectorAll("button")[4],
    "sorting replaces the header row, and the focus has to survive it",
  );
  cleanup();
});

test("the goods table disables a deficit warning for its island-product pair", async () => {
  i18n.lang = "en";
  fakeAlertSettings = { deficitThreshold: 0, dropPercentagePoints: 20, suppressions: [] };
  api.products = async () => ({ island, products });
  const root = new Element();
  const cleanup = await renderIslandDetail(root, island.id, storeWith());

  assert.match(nodes(root, "thead")[0].textContent, /^Warning deactivated/);
  const checkbox = nodes(root, "tbody")[0].children[0].querySelector("input");
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  await settle();
  assert.equal(fakeAlertSettings.suppressions.length, 1);
  assert.equal(fakeAlertSettings.suppressions[0].rule, "deficit");
  assert.equal(fakeAlertSettings.suppressions[0].islandId, island.id);
  assert.equal(nodes(root, "tbody")[0].children[0].querySelector("input").checked, true);
  cleanup();
});

test("a surplus carries its sign, and the name is a link into the history", async () => {
  i18n.lang = "en";
  api.products = async () => ({ island, products });
  const root = new Element();
  const cleanup = await renderIslandDetail(root, island.id, storeWith());

  assert.match(rowText(root), /\+2\.0/, "a positive balance is written +2.0, not 2.0");
  assert.match(rowText(root), /-4\.0/);

  // The table opens on the deficit, so the first link is Wheat's; Bread is
  // the row with the surplus this test is about.
  const link = nodes(root, ".product-link").find((node) => node.textContent.includes("Bread"));
  assert.equal(link.href, `#/island/${island.id}/product/1`);
  assert.match(link.getAttribute("aria-label"), /Open history/);
  cleanup();
});

test("an answer that was overtaken does not paint over the newer one", async () => {
  i18n.lang = "en";
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const row = (name) => ({
    guid: 9, name, generation: 0, perfectGeneration: 0, consumption: 0, delta: 0, buildings: 0,
  });

  api.products = async () => ({ island, products });
  const root = new Element();
  const cleanup = await renderIslandDetail(root, island.id, storeWith());

  // A snapshot starts a load that then hangs: this is the answer the user
  // has already stopped waiting for.
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  api.products = async () => { await slow; return { island, products: [row("Stale")] }; };
  document.dispatchEvent(new CustomEvent("tabularium-snapshot", { detail: { id: island.id } }));
  await tick();

  // The next snapshot answers immediately, and is the current picture.
  api.products = async () => ({ island, products: [row("Fresh")] });
  document.dispatchEvent(new CustomEvent("tabularium-snapshot", { detail: { id: island.id } }));
  await tick();
  assert.match(rowText(root), /Fresh/);

  release();
  await tick();
  assert.match(rowText(root), /Fresh/, "the newer answer stays");
  assert.doesNotMatch(rowText(root), /Stale/, "the overtaken answer must not win by arriving last");
  cleanup();
});

test("the efficiency view separates the two ways of producing nothing", async () => {
  i18n.lang = "en";
  api.efficiency = async () => ({
    island,
    products: [
      // Buildings that stand still: there is a potential, nothing comes out.
      { guid: 1, name: "Timber", generation: 0, perfectGeneration: 10, buildings: 2, efficiency: 0, wasted: 10, avgProductivity: 0 },
      // No buildings at all: nothing to compare against.
      { guid: 2, name: "Amphorae", generation: 0, perfectGeneration: 0, buildings: 0, efficiency: null, wasted: 0, avgProductivity: 0 },
      // A zero perfect value alone does not prove there are no buildings.
      { guid: 3, name: "Silica", generation: 0, perfectGeneration: 0, buildings: 2, efficiency: null, wasted: 0, avgProductivity: 0 },
      { guid: 4, name: "Sheep", generation: 13.7, perfectGeneration: 28.1, buildings: 4, efficiency: 0.49, wasted: 14.4, avgProductivity: 220 },
    ],
  });

  const root = new Element();
  const cleanup = await renderEfficiency(root, island.id, { islands: [island], alerts: [], status: {} });

  const notes = nodes(root, ".cell-note");
  assert.equal(notes.length, 3, "zero output and missing potential explain themselves in the table");
  assert.ok(notes.some((node) => node.textContent === "not producing"));
  assert.ok(notes.some((node) => node.textContent === "no buildings"));
  assert.ok(notes.some((node) => node.textContent === "no potential"));
  const explainer = nodes(root, "details")[0].textContent;
  assert.match(explainer, /full storage/, "a full storage is named as a common reason for idle buildings");
  assert.match(explainer, /the data does not say which/,
    "the expanded explanation names candidates but does not pretend to know which one it is");
  assert.match(rowText(root), /220%/, "productivity above 100 % is shown as it is");
  cleanup();
});

test("the efficiency table sorts every column and keeps efficiency-without-potential last", async () => {
  i18n.lang = "en";
  api.efficiency = async () => ({
    island,
    products: [
      { guid: 1, name: "Timber", generation: 0, perfectGeneration: 10, buildings: 2, efficiency: 0, wasted: 10, avgProductivity: 0 },
      { guid: 2, name: "Amphorae", generation: 0, perfectGeneration: 0, buildings: 0, efficiency: null, wasted: 0, avgProductivity: 0 },
      { guid: 4, name: "Sheep", generation: 13.7, perfectGeneration: 28.1, buildings: 4, efficiency: 0.49, wasted: 14.4, avgProductivity: 220 },
    ],
  });
  const root = new Element();
  const cleanup = await renderEfficiency(root, island.id, { islands: [island], alerts: [], status: {} });
  const headerButtons = nodes(root, "thead")[0].querySelectorAll("button");

  assert.equal(headerButtons.length, 6, "all efficiency columns have sorting controls");
  assert.match(nodes(root, "tbody")[0].children[0].textContent, /Sheep/, "largest unused potential stays first by default");
  headerButtons[0].click();
  assert.match(nodes(root, "tbody")[0].children[0].textContent, /Amphorae/, "the name column sorts alphabetically");
  assert.equal(document.activeElement, nodes(root, "thead")[0].querySelectorAll("button")[0],
    "sorting keeps keyboard focus on the selected column");

  nodes(root, "thead")[0].querySelectorAll("button")[3].click();
  const efficiencyRows = nodes(root, "tbody")[0].children;
  assert.match(efficiencyRows[efficiencyRows.length - 1].textContent, /Amphorae/,
    "goods without a comparable efficiency remain at the bottom");
  cleanup();
});

test("the efficiency table supports the same region-specific goods categories", async () => {
  i18n.lang = "en";
  api.efficiency = async () => ({
    island,
    products: [10, 11, 12].map((guid) => ({
      guid,
      name: `Good ${guid}`,
      generation: 1,
      perfectGeneration: 2,
      buildings: 1,
      efficiency: 0.5,
      wasted: 1,
      avgProductivity: 100,
    })),
  });
  api.goodsChains = async () => ({
    regions: {
      Latium: [{
        product: { guid: 12, name: { en: "Good 12", de: "Ware 12" } },
        stages: [
          { inputs: [{ guid: 10, name: { en: "Good 10", de: "Ware 10" } }], output: { guid: 11, name: { en: "Good 11", de: "Ware 11" } } },
          { inputs: [{ guid: 11, name: { en: "Good 11", de: "Ware 11" } }], output: { guid: 12, name: { en: "Good 12", de: "Ware 12" } } },
        ],
      }],
    },
  });
  const root = new Element();
  const cleanup = await renderEfficiency(root, island.id, { islands: [island], alerts: [], status: {} });
  const endFilter = nodes(root, ".goods-category-toggle")[2].querySelector("input");
  endFilter.checked = true;
  endFilter.dispatchEvent(new Event("change"));
  await settle();

  assert.match(rowText(root), /Good 12/);
  assert.doesNotMatch(rowText(root), /Good 10|Good 11/);
  cleanup();
});

test("the efficiency table disables productivity-drop warnings separately", async () => {
  i18n.lang = "en";
  fakeAlertSettings = { deficitThreshold: 0, dropPercentagePoints: 20, suppressions: [] };
  api.efficiency = async () => ({
    island,
    products: [{ guid: 1, name: "Timber", generation: 0, perfectGeneration: 10,
      buildings: 2, efficiency: 0, wasted: 10, avgProductivity: 0 }],
  });
  const root = new Element();
  const cleanup = await renderEfficiency(root, island.id, { islands: [island], alerts: [], status: {} });

  assert.match(nodes(root, "thead")[0].textContent, /^Warning deactivated/);
  const checkbox = nodes(root, "tbody")[0].children[0].querySelector("input");
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change"));
  await settle();
  assert.equal(fakeAlertSettings.suppressions.length, 1);
  assert.equal(fakeAlertSettings.suppressions[0].rule, "productivity_drop");
  cleanup();
});

test("a good without local production is marked quietly and is not a warning", async () => {
  i18n.lang = "en";
  api.products = async () => ({ island, products });
  const root = new Element();
  // Wheat is short on this island, but the island has no building for it:
  // the engine reports no local production (severity info), not a deficit.
  const store = {
    islands: [island],
    alerts: [
      { islandId: island.id, productGuid: 1, rule: "productivity_drop", severity: "warning", detail: "test" },
      { islandId: island.id, productGuid: 2, rule: "no_local_production", severity: "info", detail: "delta -4.0 for 3 samples" },
    ],
    status: {},
  };
  const cleanup = await renderIslandDetail(root, island.id, store);

  assert.equal(nodes(root, ".import-tag").length, 1, "exactly the imported good carries the tag");
  // The tag sits in the button that opens the possible sources (below),
  // which carries the explanation.
  const tags = nodes(root, ".sources-toggle");
  assert.equal(tags.length, 1);
  assert.match(tags[0].parent.textContent, /Wheat/);
  assert.match(tags[0].textContent, /import needed/);
  assert.match(tags[0].getAttribute("title"), /cannot see whether or how the good is actually delivered/,
    "the tag does not claim a delivery the data cannot show");
  assert.match(tags[0].getAttribute("title"), /Not counted as a warning/);
  assert.equal(nodes(root, ".alert-marker").length, 1, "only the real warning gets the warning marker");
  assert.match(root.textContent, /1 Warnings/, "the summary counts the warning, not the import");

  button(root, "Warnings").click();
  assert.match(rowText(root), /Bread/);
  assert.doesNotMatch(rowText(root), /Wheat/, "the warnings filter leaves it out");
  cleanup();
});

test("German is a full translation, not a fallback", async () => {
  i18n.lang = "de";
  api.products = async () => ({ island, products });
  const root = new Element();
  const cleanup = await renderIslandDetail(root, island.id, storeWith());

  assert.ok(button(root, "Defizite"), "the filters are translated");
  assert.match(nodes(root, "thead")[0].textContent, /Produktion\/min/);
  assert.match(rowText(root), /\+2,0/, "German writes 2,0 - the number format follows the language");
  cleanup();
  i18n.lang = "en";
});

// --- possible production sources ---------------------------------------------

const settle = () => new Promise((resolve) => setImmediate(resolve));

// An island that consumes Wheat (guid 2) without producing it, and the store
// saying so the way the rule engine does.
const importStore = () => ({
  islands: [island],
  alerts: [{ islandId: island.id, productGuid: 2, rule: "no_local_production", severity: "info", detail: "delta -4.0 for 3 samples" }],
  status: {},
});

// receivedAt is 13:49:01 local time, today - so the panel shows the time
// alone - unless a test says otherwise.
const today = (h, m, s) => { const d = new Date(); d.setHours(h, m, s, 0); return d.toISOString(); };
const sourcesAnswer = (groups, ready = true, receivedAt = today(13, 49, 1)) => ({
  island,
  product: { guid: 2, name: "Wheat" },
  ready,
  tick: ready ? 152525000 : null,
  receivedAt: ready ? receivedAt : null,
  groups,
});

const twoProvinces = sourcesAnswer([
  { sessionGuid: 3245, sessionName: "Latium", own: true, sources: [
    { id: "3245-3", islandId: 3, name: "Megaron", delta: 3.5 },
    { id: "3245-2", islandId: 2, name: "Agathea", delta: 2 },
  ] },
  { sessionGuid: 6627, sessionName: "Albion", own: false, sources: [
    { id: "6627-1", islandId: 1, name: "Argantum", delta: 4.25 },
    { id: "6627-2", islandId: 2, name: "Eboracum", delta: 0.03 },
    { id: "6627-3", islandId: 3, name: "Gwynford", delta: 0.004 },
  ] },
]);

// Words that would claim more than the game data shows: a delivery, a route,
// a supplier, or advice the data cannot back.
const overclaims = /supplier|supplies|delivers|is delivered|trade route to|must import|need to build|Lieferant|liefert|muss importieren|musst .* bauen/i;

test("possible production sources open under the row, grouped by province", async () => {
  i18n.lang = "en";
  api.products = async () => ({ island, products });
  const asked = [];
  api.sources = async (islandId, guid) => { asked.push(`${islandId}/${guid}`); return twoProvinces; };
  const root = new Element();
  const cleanup = await renderIslandDetail(root, island.id, importStore());

  const toggle = nodes(root, ".sources-toggle")[0];
  assert.equal(toggle.tagName, "button", "the tag is a real button: keyboard, screen reader and touch know it");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.match(toggle.getAttribute("title"), /cannot see whether or how the good is actually delivered/,
    "the tag keeps its explanation");
  assert.equal(nodes(root, ".sources-row").length, 0, "closed rows cost nothing: no block, no request");
  assert.deepEqual(asked, []);

  // As from the keyboard: the button has the focus, Enter clicks it.
  toggle.focus();
  toggle.click();
  assert.equal(nodes(root, ".sources-row").length, 1, "the row opens at once");
  assert.match(nodes(root, ".sources-row")[0].textContent, /Loading/);
  await settle();

  assert.deepEqual(asked, [`${island.id}/2`], "asked once, for this island and this good");
  const rows = nodes(root, "tbody")[0].children;
  const wheat = rows.findIndex((row) => row.textContent.includes("Wheat"));
  assert.equal(rows[wheat + 1].className, "sources-row", "the sources sit directly under their good");
  const detail = rows[wheat + 1].children[0];
  assert.equal(detail.colSpan, 7, "one cell across the whole table, which the phone layout leaves unpinned");

  const text = detail.textContent;
  assert.match(text, /Possible production sources/);
  assert.match(text, /Latium.*Megaron.*Local balance \+3\.5\/min.*Agathea.*\+2\.0\/min.*Albion.*Argantum.*\+4\.3\/min/,
    "the server's order, which is own province first and highest balance first");
  assert.match(text, /Eboracum.*Local balance \+0\.03\/min/, "a small positive balance is not written as +0.0");
  assert.match(text, /Gwynford.*Local balance < \+0\.01\/min/, "nor one below what two decimals show as +0.00");
  assert.match(text, /As of the last complete statistics tick, received at 1:49:01\sPM\./,
    "the panel says which numbers these are, and when they arrived");
  assert.match(text, /Possible sources only\. Trade routes and actual deliveries are not available in the game data\./);
  assert.doesNotMatch(text, overclaims);
  const link = nodes(detail, "a").find((a) => a.textContent === "Argantum");
  assert.equal(link.href, "#/island/6627-1", "a source is a way to its island");
  assert.equal(nodes(root, ".sources-toggle")[0].getAttribute("aria-expanded"), "true");
  assert.match(nodes(root, ".sources-toggle")[0].getAttribute("aria-label"), /import needed: Hide possible production sources/,
    "open, a press hides them, and the name says so");
  assert.equal(document.activeElement, nodes(root, ".sources-toggle")[0],
    "the table is rebuilt on the click and again on the answer, and the focus has to survive both");

  // Another island's snapshot asks again. The same answer leaves the table
  // alone - a tick has ten snapshots, and none of them should rebuild it.
  const before = nodes(root, ".sources-row")[0];
  document.dispatchEvent(new CustomEvent("tabularium-snapshot", { detail: { id: "6627-1" } }));
  await settle();
  assert.equal(asked.length, 2, "asked again after the snapshot");
  assert.equal(nodes(root, ".sources-row")[0], before, "an unchanged answer does not rebuild the table");

  nodes(root, ".sources-toggle")[0].click();
  assert.equal(nodes(root, ".sources-row").length, 0, "a second click closes it");
  cleanup();
});

test("possible production sources say what is not known and what was not found", async () => {
  i18n.lang = "en";
  api.products = async () => ({ island, products });
  let answer = sourcesAnswer([], false);
  api.sources = async () => answer;
  const root = new Element();
  const store = importStore();
  const cleanup = await renderIslandDetail(root, island.id, store);
  nodes(root, ".sources-toggle")[0].click();
  await settle();
  assert.match(nodes(root, ".sources-row")[0].textContent, /Waiting for a complete statistics tick/,
    "right after connecting nothing is known yet, which is not the same as none");
  assert.match(nodes(root, ".sources-row")[0].textContent, /about two minutes/,
    "the first tick waits for the next one: the wait is named, so it does not look stuck");
  assert.doesNotMatch(nodes(root, ".sources-row")[0].textContent, /As of/, "no time for numbers there are none of");

  // A snapshot of any island may complete the tick: the open row asks again.
  answer = sourcesAnswer([]);
  document.dispatchEvent(new CustomEvent("tabularium-snapshot", { detail: { id: "6627-1" } }));
  await settle();
  const text = nodes(root, ".sources-row")[0].textContent;
  assert.match(text, /No island with a positive local balance found in the last complete statistics tick\./,
    "none is a statement about the tick that was looked at");
  assert.match(text, /As of the last complete statistics tick/);
  assert.doesNotMatch(text, /no supplier|not being delivered|need to build/i,
    "none found is not a statement about deliveries or about what to build");

  // Only another province: shown as it is, nothing more.
  answer = sourcesAnswer([{ sessionGuid: 6627, sessionName: "Albion", own: false, sources: [
    { id: "6627-1", islandId: 1, name: "Argantum", delta: 4.3 },
  ] }]);
  document.dispatchEvent(new CustomEvent("tabularium-snapshot", { detail: { id: "6627-1" } }));
  await settle();
  assert.match(nodes(root, ".sources-row")[0].textContent, /Albion.*Argantum.*\+4\.3\/min/);

  // A failed request says so, and the next answer - the same as before the
  // failure - replaces the error again.
  api.sources = async () => { throw new Error("connection refused"); };
  document.dispatchEvent(new CustomEvent("tabularium-snapshot", { detail: { id: "6627-1" } }));
  await settle();
  assert.match(nodes(root, ".sources-row")[0].textContent, /Error: connection refused/);
  api.sources = async () => answer;
  document.dispatchEvent(new CustomEvent("tabularium-snapshot", { detail: { id: "6627-1" } }));
  await settle();
  assert.doesNotMatch(nodes(root, ".sources-row")[0].textContent, /connection refused/);
  assert.match(nodes(root, ".sources-row")[0].textContent, /Argantum/);

  // The good stops being "import needed": the control and the open row go.
  const alert = store.alerts.pop();
  document.dispatchEvent(new CustomEvent("tabularium-alerts-changed"));
  assert.equal(nodes(root, ".sources-toggle").length, 0, "only goods marked import needed get the control");
  assert.equal(nodes(root, ".sources-row").length, 0);
  // When it comes back, it comes back closed.
  store.alerts.push(alert);
  document.dispatchEvent(new CustomEvent("tabularium-alerts-changed"));
  assert.equal(nodes(root, ".sources-toggle")[0].getAttribute("aria-expanded"), "false");
  assert.equal(nodes(root, ".sources-row").length, 0);
  cleanup();
});

test("possible production sources in German", async () => {
  i18n.lang = "de";
  api.products = async () => ({ island, products });
  let answer = twoProvinces;
  api.sources = async () => answer;
  const root = new Element();
  const cleanup = await renderIslandDetail(root, island.id, importStore());
  nodes(root, ".sources-toggle")[0].click();
  await settle();
  const text = nodes(root, ".sources-row")[0].textContent;
  assert.match(text, /Mögliche Produktionsquellen/);
  assert.match(text, /Lokale Bilanz \+3,5\/min/, "German writes 3,5");
  assert.match(text, /Nur mögliche Quellen\. Handelsrouten und tatsächliche Lieferungen sind in den Spieldaten nicht verfügbar\./);
  assert.match(text, /Stand: letzter vollständiger Statistik-Tick, empfangen um 13:49:01\./);
  assert.doesNotMatch(text, overclaims);
  assert.match(nodes(root, ".sources-toggle")[0].getAttribute("aria-label"), /Importbedarf: Mögliche Produktionsquellen ausblenden/);

  // Numbers from another day - a recording, or a PC left running - carry
  // their date.
  answer = sourcesAnswer(twoProvinces.groups, true, new Date(2026, 8, 23, 13, 49, 1).toISOString());
  document.dispatchEvent(new CustomEvent("tabularium-snapshot", { detail: { id: island.id } }));
  await settle();
  assert.match(nodes(root, ".sources-row")[0].textContent, /empfangen um 23\.9\.2026, 13:49:01\./);

  answer = sourcesAnswer([]);
  document.dispatchEvent(new CustomEvent("tabularium-snapshot", { detail: { id: island.id } }));
  await settle();
  assert.match(nodes(root, ".sources-row")[0].textContent,
    /Keine Insel mit positivem lokalem Saldo im letzten vollständigen Statistik-Tick gefunden\./);
  cleanup();
  i18n.lang = "en";
});

test("the warnings page opens the same sources for each import needed entry", async () => {
  i18n.lang = "en";
  const asked = [];
  api.sources = async (islandId, guid) => { asked.push(`${islandId}/${guid}`); return twoProvinces; };
  const store = importStore();
  store.alerts.push(
    { islandId: island.id, productGuid: 1, productName: "Bread", islandName: "Juliana", rule: "deficit", severity: "warning", detail: "x", raisedAt: new Date().toISOString() },
  );
  store.alerts[0].productName = "Wheat";
  store.alerts[0].islandName = "Juliana";
  store.alerts[0].raisedAt = new Date().toISOString();
  const root = new Element();
  const cleanup = await renderAlerts(root, store, false);

  const toggles = nodes(root, ".sources-toggle");
  assert.equal(toggles.length, 1, "the import needed entry has the control, the warning does not");
  assert.match(toggles[0].textContent, /Import needed/);
  toggles[0].click();
  await settle();
  assert.deepEqual(asked, [`${island.id}/2`]);
  const detail = nodes(root, ".sources-row")[0].children[0];
  assert.equal(detail.colSpan, 6);
  assert.match(detail.textContent, /Possible production sources.*Megaron.*Local balance \+3\.5\/min/);
  assert.match(detail.textContent, /Possible sources only/);
  cleanup();
});

test("the warnings page filters warnings to multiple selected islands", async () => {
  i18n.lang = "en";
  const store = {
    islands: [island, secondIsland],
    alerts: [
      { islandId: island.id, islandName: island.name, productGuid: 1, productName: "Bread", rule: "deficit", severity: "warning", detail: "first", raisedAt: new Date().toISOString() },
      { islandId: secondIsland.id, islandName: secondIsland.name, productGuid: 2, productName: "Wheat", rule: "deficit", severity: "warning", detail: "second", raisedAt: new Date().toISOString() },
    ],
    status: {},
  };
  const root = new Element();
  const cleanup = await renderAlerts(root, store, false);
  assert.equal(nodes(root, "tbody")[0].children.length, 2);

  const boxes = nodes(root, "input");
  boxes[1].checked = false;
  boxes[1].dispatchEvent(new Event("change"));
  assert.equal(nodes(root, "tbody")[0].children.length, 1);
  assert.match(nodes(root, "tbody")[0].textContent, /Bread/);
  assert.doesNotMatch(nodes(root, "tbody")[0].textContent, /Wheat/);

  boxes[0].checked = false;
  boxes[0].dispatchEvent(new Event("change"));
  assert.match(nodes(root, "p")[1].textContent, /Select at least one island/);
  cleanup();
});

test("warning settings save thresholds and let import suppressions be reactivated", async () => {
  i18n.lang = "en";
  fakeAlertSettings = { deficitThreshold: 0, dropPercentagePoints: 20, suppressions: [] };
  const store = {
    islands: [island],
    alerts: [
      { islandId: island.id, islandName: island.name, productGuid: 2, productName: "Wheat",
        rule: "no_local_production", severity: "info", detail: "x", raisedAt: new Date().toISOString() },
      { islandId: island.id, islandName: island.name, productGuid: 1, productName: "Bread",
        rule: "deficit", severity: "warning", detail: "y", raisedAt: new Date().toISOString() },
    ],
    status: {},
  };
  const root = new Element();
  const cleanup = await renderAlerts(root, store, false);
  const numberInputs = nodes(root, "input").filter((input) => input.type === "number");
  assert.equal(numberInputs.length, 2);
  assert.equal(numberInputs[0].value, "0", "the deficit default preserves the previous any-negative rule");
  assert.equal(numberInputs[1].value, "20");

  numberInputs[0].value = "-1.5";
  numberInputs[1].value = "25";
  nodes(root, "form")[0].dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
  assert.equal(fakeAlertSettings.deficitThreshold, -1.5);
  assert.equal(fakeAlertSettings.dropPercentagePoints, 25);

  const importCheckbox = nodes(root, "tbody")[1].children[0].querySelector("input");
  importCheckbox.checked = true;
  importCheckbox.dispatchEvent(new Event("change"));
  await settle();
  assert.equal(fakeAlertSettings.suppressions[0].rule, "no_local_production");
  assert.match(root.textContent, /Deactivated warnings/);
  assert.equal(nodes(root, "tbody")[2].children.length, 1);
  const restore = nodes(root, "tbody")[2].children[0].querySelector("input");
  assert.equal(restore.checked, true);
  restore.checked = false;
  restore.dispatchEvent(new Event("change"));
  await settle();
  assert.equal(fakeAlertSettings.suppressions.length, 0);
  assert.equal(nodes(root, "tbody")[2].children.length, 0);
  cleanup();

  fakeAlertSettings = {
    deficitThreshold: 0,
    dropPercentagePoints: 20,
    suppressions: [{
      islandId: island.id,
      islandName: island.name,
      productGuid: 2,
      productName: "Wheat",
      rule: "no_local_production",
    }],
  };
  const disabledRoot = new Element();
  const cleanupDisabled = await renderAlerts(disabledRoot, {
    islands: [island],
    alerts: [],
    status: {},
  }, false);
  assert.equal(nodes(disabledRoot, "section")[1].hidden, false,
    "disabled rules stay visible when there are no active imports");
  assert.equal(nodes(disabledRoot, "tbody")[2].children.length, 1);
  cleanupDisabled();
});

test("warning settings are available before any islands or warnings are loaded", async () => {
  i18n.lang = "en";
  fakeAlertSettings = { deficitThreshold: 0, dropPercentagePoints: 20, suppressions: [] };
  const root = new Element();
  const cleanup = await renderAlerts(root, {
    islands: [],
    alerts: [],
    status: {},
  }, false);

  assert.match(root.textContent, /No islands have been loaded yet/);
  const numberInputs = nodes(root, "input").filter((input) => input.type === "number");
  assert.equal(numberInputs.length, 2);
  numberInputs[0].value = "-2";
  numberInputs[1].value = "30";
  nodes(root, "form")[0].dispatchEvent(new Event("submit", { cancelable: true }));
  await settle();
  assert.equal(fakeAlertSettings.deficitThreshold, -2);
  assert.equal(fakeAlertSettings.dropPercentagePoints, 30);
  cleanup();
});

test("the warnings table sorts every column", async () => {
  i18n.lang = "en";
  const store = {
    islands: [island],
    alerts: [
      { islandId: island.id, islandName: island.name, productGuid: 2, productName: "Wheat", rule: "deficit", severity: "warning", detail: "second", raisedAt: "2026-10-22T13:00:00Z" },
      { islandId: island.id, islandName: island.name, productGuid: 1, productName: "Bread", rule: "productivity_drop", severity: "warning", detail: "first", raisedAt: "2026-10-22T12:00:00Z" },
    ],
    status: {},
  };
  const root = new Element();
  const cleanup = await renderAlerts(root, store, false);
  const headerButtons = nodes(root, "thead")[0].querySelectorAll("button");

  assert.equal(headerButtons.length, 5, "every active-warning column has a sorting control");
  assert.match(nodes(root, "tbody")[0].children[0].textContent, /Wheat/, "newest warning is first by default");
  headerButtons[1].click();
  assert.match(nodes(root, "tbody")[0].children[0].textContent, /Bread/, "products sort alphabetically");
  assert.equal(nodes(root, "thead")[0].querySelectorAll("th")[1].getAttribute("aria-sort"), "ascending");
  assert.equal(document.activeElement, nodes(root, "thead")[0].querySelectorAll("button")[1],
    "sorting keeps keyboard focus on the selected column");
  cleanup();
});

test("the comparison view loads goods for multiple selected islands", async () => {
  i18n.lang = "en";
  const store = { islands: [island, secondIsland] };
  const requested = [];
  const efficiencyRequested = [];
  api.products = async (islandId) => {
    requested.push(islandId);
    return {
      island: islandId === island.id ? island : secondIsland,
      products: [{ guid: islandId === island.id ? 1 : 2, name: islandId === island.id ? "Bread" : "Wheat",
        generation: 5, perfectGeneration: 10, consumption: 3, delta: 2, buildings: 2 }],
    };
  };
  api.efficiency = async (islandId) => {
    efficiencyRequested.push(islandId);
    return {
      island: islandId === island.id ? island : secondIsland,
      products: [{ guid: islandId === island.id ? 1 : 2, name: islandId === island.id ? "Bread" : "Wheat",
        generation: 5, perfectGeneration: 10, efficiency: 0.5, avgProductivity: 100, wasted: 5 }],
    };
  };
  api.goodsChains = async () => ({
    regions: {
      Latium: [{
        product: { guid: 1, name: { en: "Bread", de: "Brot" } },
        stages: [{ inputs: [{ guid: 2, name: { en: "Wheat", de: "Weizen" } }], output: { guid: 1, name: { en: "Bread", de: "Brot" } } }],
      }],
      Albion: [{
        product: { guid: 1, name: { en: "Bread", de: "Brot" } },
        stages: [{ inputs: [{ guid: 2, name: { en: "Wheat", de: "Weizen" } }], output: { guid: 1, name: { en: "Bread", de: "Brot" } } }],
      }],
    },
  });
  const root = new Element();
  const cleanup = renderCompare(root, store);
  const boxes = nodes(root, "input");
  boxes[0].checked = true;
  boxes[0].dispatchEvent(new Event("change"));
  const updatedBoxes = nodes(root, "input");
  updatedBoxes[1].checked = true;
  updatedBoxes[1].dispatchEvent(new Event("change"));
  await settle();

  assert.deepEqual(requested, [island.id, secondIsland.id]);
  assert.deepEqual(efficiencyRequested, [island.id, secondIsland.id]);
  assert.equal(nodes(root, "tbody")[0].children.length, 2);
  assert.match(nodes(root, "tbody")[0].textContent, /Juliana.*Bread/);
  assert.match(nodes(root, "tbody")[0].textContent, /Argantum.*Wheat/);
  assert.equal(nodes(root, "tbody")[1].children.length, 2, "comparison also shows the efficiency rows");
  assert.match(nodes(root, "tbody")[1].textContent, /Juliana.*Bread/);
  const search = nodes(root, "input").find((input) => input.type === "search");
  search.value = "bread";
  search.dispatchEvent(new Event("input"));
  assert.match(nodes(root, "tbody")[0].textContent, /Juliana.*Bread/);
  assert.doesNotMatch(nodes(root, "tbody")[0].textContent, /Argantum.*Wheat/);
  assert.match(nodes(root, "tbody")[1].textContent, /Juliana.*Bread/);
  search.value = "";
  search.dispatchEvent(new Event("input"));
  const categoryEnd = nodes(root, ".goods-category-toggle")[2].querySelector("input");
  categoryEnd.checked = true;
  categoryEnd.dispatchEvent(new Event("change"));
  await settle();
  assert.match(nodes(root, "tbody")[0].textContent, /Juliana.*Bread/);
  assert.doesNotMatch(nodes(root, "tbody")[0].textContent, /Argantum.*Wheat/,
    "each island uses the chain categories for its own region");
  assert.match(nodes(root, "tbody")[1].textContent, /Juliana.*Bread/);
  categoryEnd.checked = false;
  categoryEnd.dispatchEvent(new Event("change"));
  assert.equal(nodes(root, "thead")[0].querySelectorAll("button").length, 7, "every goods column can be sorted");
  assert.match(nodes(root, "tbody")[0].textContent, /Juliana.*Bread.*5\.0.*10\.0/);
  assert.equal(nodes(root, "thead")[1].querySelectorAll("button").length, 7, "every efficiency column can be sorted");

  nodes(root, "thead")[0].querySelectorAll("button")[5].click();
  assert.match(nodes(root, "tbody")[0].children[0].textContent, /Juliana.*Bread/);
  nodes(root, "thead")[1].querySelectorAll("button")[6].click();
  assert.equal(nodes(root, "thead")[1].querySelectorAll("th")[6].getAttribute("aria-sort"), "ascending");
  cleanup();
});

test("comparison island picker selects and clears islands by region", async () => {
  i18n.lang = "en";
  const secondLatium = { ...secondIsland, id: "3245-2", sessionGuid: 3245, sessionName: "Latium", name: "Argantum" };
  const store = { islands: [island, secondLatium, { ...island, id: "7777-3", sessionGuid: 7777, sessionName: "Albion", name: "North" }] };
  const requests = [];
  api.products = async (id) => {
    requests.push(id);
    return { island: store.islands.find((entry) => entry.id === id), products: products.slice(0, 1) };
  };
  api.efficiency = async (id) => ({
    island: store.islands.find((entry) => entry.id === id),
    products: [],
  });
  const root = new Element();
  const cleanup = renderCompare(root, store);
  const regionActions = nodes(root, ".island-picker-region-actions");
  regionActions[0].querySelectorAll("button")[0].click();
  await settle();
  assert.deepEqual(requests, [island.id, secondLatium.id]);
  const clearLatium = nodes(root, ".island-picker-region-actions")[0]
    .querySelectorAll("button")[1];
  clearLatium.click();
  await settle();
  assert.match(nodes(root, ".island-picker")[0].textContent, /Islands: 0 of 3/);
  cleanup();
});

test("region and total views sum each good into one row", async () => {
  i18n.lang = "en";
  const regionIsland = { ...island, sessionGuid: 3245 };
  const sameRegionIsland = { ...secondIsland, sessionGuid: 3245, sessionName: "Latium" };
  const otherRegionIsland = { id: "7777-3", name: "North", sessionGuid: 7777, sessionName: "Albion" };
  const store = { islands: [regionIsland, sameRegionIsland, otherRegionIsland], status: {} };
  const fixtures = new Map([
    [regionIsland.id, [
      { guid: 1, name: "Bread", generation: 5, perfectGeneration: 8, consumption: 2, delta: 3, buildings: 2 },
      { guid: 2, name: "Wheat", generation: 1, perfectGeneration: 2, consumption: 4, delta: -3, buildings: 1 },
    ]],
    [sameRegionIsland.id, [
      { guid: 1, name: "Bread", generation: 7, perfectGeneration: 10, consumption: 3, delta: 4, buildings: 3 },
    ]],
    [otherRegionIsland.id, [
      { guid: 1, name: "Bread", generation: 100, perfectGeneration: 120, consumption: 20, delta: 80, buildings: 9 },
      { guid: 3, name: "Fish", generation: 2, perfectGeneration: 3, consumption: 1, delta: 1, buildings: 1 },
    ]],
  ]);
  api.products = async (islandId) => ({ island: store.islands.find((entry) => entry.id === islandId), products: fixtures.get(islandId) });
  api.goodsIcons = async () => ({ icons: { "1": "/production_goods/icon_3d_bread_goods_0.png" } });
  api.goodsChains = async () => ({
    regions: {
      Latium: [{
        product: { guid: 1, name: { en: "Bread", de: "Brot" } },
        stages: [
          { inputs: [{ guid: 2, name: { en: "Wheat", de: "Weizen" } }], output: { guid: 1, name: { en: "Bread", de: "Brot" } } },
        ],
      }],
      Albion: [{
        product: { guid: 1, name: { en: "Bread", de: "Brot" } },
        stages: [
          { inputs: [{ guid: 3, name: { en: "Fish", de: "Fisch" } }], output: { guid: 1, name: { en: "Bread", de: "Brot" } } },
        ],
      }],
    },
  });

  const regionRoot = new Element();
  const cleanupRegion = renderAggregate(regionRoot, store, { sessionGuid: 3245 });
  await settle();
  assert.equal(nodes(regionRoot, "tbody")[0].children.length, 2, "shared goods have one row, and unshared goods remain one row");
  assert.match(nodes(regionRoot, "tbody")[0].textContent, /Bread.*12\.0.*18\.0.*5\.0.*\+7\.0.*5/);
  assert.match(nodes(regionRoot, "tbody")[0].textContent, /Wheat.*1\.0.*2\.0.*4\.0.*-3\.0.*1/);
  assert.doesNotMatch(nodes(regionRoot, "tbody")[0].textContent, /Fish|100\.0/);
  assert.equal(nodes(regionRoot, ".goods-chain-icon").length, 1, "aggregate goods use the eagerly loaded icons");
  const regionSearch = nodes(regionRoot, "input")[0];
  assert.equal(regionSearch.type, "search");
  regionSearch.value = "Bread";
  regionSearch.dispatchEvent(new Event("input"));
  const regionChainToggle = nodes(regionRoot, ".goods-chain-toggle")[0].querySelector("input");
  regionChainToggle.checked = true;
  regionChainToggle.dispatchEvent(new Event("change"));
  await settle();
  assert.match(nodes(regionRoot, "tbody")[0].textContent, /Goods chain for Bread/);
  nodes(regionRoot, ".goods-chain-good").find((good) => good.textContent.includes("Wheat")).click();
  assert.match(nodes(regionRoot, ".goods-chain-overview")[0].textContent, /Goods chain for Bread/);
  regionSearch.value = "wHeAt";
  regionSearch.dispatchEvent(new Event("input"));
  assert.equal(nodes(regionRoot, "tbody")[0].children.length, 2,
    "the filtered good row is followed by its matching goods chain");
  assert.match(nodes(regionRoot, "tbody")[0].textContent, /Wheat/);
  regionSearch.value = "missing good";
  regionSearch.dispatchEvent(new Event("input"));
  assert.match(nodes(regionRoot, "tbody")[0].textContent, /No matching goods/);
  regionSearch.value = "";
  regionSearch.dispatchEvent(new Event("input"));
  const rawFilter = nodes(regionRoot, ".goods-category-toggle")[0].querySelector("input");
  rawFilter.checked = true;
  rawFilter.dispatchEvent(new Event("change"));
  await settle();
  assert.match(nodes(regionRoot, "tbody")[0].textContent, /Wheat/);
  assert.doesNotMatch(nodes(regionRoot, "tbody")[0].textContent, /Bread/);
  cleanupRegion();

  const totalRoot = new Element();
  const cleanupTotal = renderAggregate(totalRoot, store, { total: true });
  await settle();
  assert.equal(nodes(totalRoot, "tbody")[0].children.length, 3);
  assert.match(nodes(totalRoot, "tbody")[0].textContent, /Bread.*112\.0.*138\.0.*25\.0.*\+87\.0.*14/);
  const totalChainToggle = nodes(totalRoot, ".goods-chain-toggle")[0].querySelector("input");
  totalChainToggle.checked = true;
  totalChainToggle.dispatchEvent(new Event("change"));
  await settle();
  const totalSearch = nodes(totalRoot, "input")[0];
  totalSearch.value = "fish";
  totalSearch.dispatchEvent(new Event("input"));
  assert.equal(nodes(totalRoot, "tbody")[0].children.length, 2,
    "the total view shows the matching regional chain under the good");
  assert.match(nodes(totalRoot, "tbody")[0].textContent, /Fish.*Goods chain for Bread/);
  totalSearch.value = "Bread";
  totalSearch.dispatchEvent(new Event("input"));
  assert.match(nodes(totalRoot, "tbody")[0].textContent, /Latium|Albion/,
    "the total view includes chains from all regions");
  nodes(totalRoot, ".goods-chain-good").find((good) => good.textContent.includes("Bread")).click();
  const totalOverview = nodes(totalRoot, ".goods-chain-overview")[0].textContent;
  assert.match(totalOverview, /Latium/);
  assert.match(totalOverview, /Albion/, "clicking a good shows its chains across the total view");
  cleanupTotal();
});

test("a slow answer is not asked for again ten times a tick", async () => {
  i18n.lang = "en";
  api.products = async () => ({ island, products });
  // Every request hangs until the test answers it, like a slow phone.
  const pending = [];
  api.sources = () => new Promise((resolve) => pending.push(resolve));
  const root = new Element();
  const cleanup = await renderIslandDetail(root, island.id, importStore());
  nodes(root, ".sources-toggle")[0].click();
  await settle();
  assert.equal(pending.length, 1);

  // A tick arrives: ten snapshots, one per island, while the first request
  // still hangs.
  for (let i = 0; i < 10; i++) {
    document.dispatchEvent(new CustomEvent("tabularium-snapshot", { detail: { id: `6627-${i}` } }));
  }
  await settle();
  assert.equal(pending.length, 1, "one request in flight per row, not eleven");
  assert.match(nodes(root, ".sources-row")[0].textContent, /Loading/);

  // The first answer is shown at once - it is not thrown away for being
  // overtaken - and the snapshots that came meanwhile cost one request more.
  pending[0](sourcesAnswer([{ sessionGuid: 6627, sessionName: "Albion", own: false, sources: [
    { id: "6627-1", islandId: 1, name: "Argantum", delta: 1 },
  ] }]));
  await settle();
  assert.match(nodes(root, ".sources-row")[0].textContent, /Argantum.*\+1\.0\/min/);
  assert.equal(pending.length, 2, "asked once more for what the snapshots may have changed");

  pending[1](sourcesAnswer([{ sessionGuid: 6627, sessionName: "Albion", own: false, sources: [
    { id: "6627-1", islandId: 1, name: "Argantum", delta: 2 },
  ] }]));
  await settle();
  assert.match(nodes(root, ".sources-row")[0].textContent, /Argantum.*\+2\.0\/min/);
  assert.equal(pending.length, 2, "and then it rests");

  // An answer for a row that was closed in the meantime is dropped - with
  // the follow-up it had been asked for - and reopening asks afresh.
  document.dispatchEvent(new CustomEvent("tabularium-snapshot", { detail: { id: "6627-1" } }));
  await settle();
  assert.equal(pending.length, 3);
  document.dispatchEvent(new CustomEvent("tabularium-snapshot", { detail: { id: "6627-2" } }));
  nodes(root, ".sources-toggle")[0].click();
  assert.equal(nodes(root, ".sources-row").length, 0, "closed");
  nodes(root, ".sources-toggle")[0].click();
  await settle();
  assert.equal(pending.length, 4, "the reopened row asks for itself");
  pending[2](sourcesAnswer([]));
  await settle();
  assert.match(nodes(root, ".sources-row")[0].textContent, /Loading/, "the old row's answer is not the new row's");
  pending[3](sourcesAnswer([]));
  await settle();
  assert.match(nodes(root, ".sources-row")[0].textContent, /No island/);
  assert.equal(pending.length, 4, "nor does the old row's follow-up become the new row's");
  cleanup();
});
