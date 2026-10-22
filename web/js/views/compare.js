import { i18n } from "../i18n.js";
import { api } from "../api.js";
import { createIslandPicker } from "../island-picker.js";

const numberFormatCache = new Map();

function numberFormat(digits) {
  const locale = i18n.lang === "de" ? "de-DE" : "en-US";
  const key = `${locale}:${digits}`;
  if (!numberFormatCache.has(key)) {
    numberFormatCache.set(key, new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }));
  }
  return numberFormatCache.get(key);
}

export function renderCompare(container, store) {
  const heading = document.createElement("h2");
  const explain = document.createElement("p");
  explain.className = "muted";
  const picker = document.createElement("div");
  const message = document.createElement("p");
  message.className = "muted";
  const goodsHeading = document.createElement("h3");
  const goodsTable = document.createElement("table");
  const goodsThead = document.createElement("thead");
  const goodsTbody = document.createElement("tbody");
  goodsTable.append(goodsThead, goodsTbody);
  const goodsBox = document.createElement("div");
  goodsBox.className = "table-scroll";
  goodsBox.append(goodsTable);
  const efficiencyHeading = document.createElement("h3");
  const efficiencyTable = document.createElement("table");
  const efficiencyThead = document.createElement("thead");
  const efficiencyTbody = document.createElement("tbody");
  efficiencyTable.append(efficiencyThead, efficiencyTbody);
  const efficiencyBox = document.createElement("div");
  efficiencyBox.className = "table-scroll";
  efficiencyBox.append(efficiencyTable);
  container.append(heading, explain, picker, message, goodsHeading, goodsBox, efficiencyHeading, efficiencyBox);

  const selected = new Set();
  const productsByIsland = new Map();
  const efficiencyByIsland = new Map();
  const errors = new Map();
  const requests = new Map();
  const inFlight = new Set();
  let disposed = false;
  const sorts = {
    goods: { key: "island", ascending: true },
    efficiency: { key: "island", ascending: true },
  };
  const goodsColumns = [
    ["island", "colIsland", false],
    ["name", "colProduct", false],
    ["generation", "colGeneration", true],
    ["consumption", "colConsumption", true],
    ["delta", "colDelta", true],
    ["buildings", "colBuildings", true],
  ];
  const efficiencyColumns = [
    ["island", "colIsland", false],
    ["name", "colProduct", false],
    ["generation", "colGeneration", true],
    ["perfectGeneration", "colPerfect", true],
    ["efficiency", "colEfficiency", true],
    ["avgProductivity", "colProductivity", true],
    ["wasted", "colWasted", true],
  ];
  const fmt0 = numberFormat(0);
  const fmt1 = numberFormat(1);

  function sortRows(rows, view) {
    const { key, ascending } = sorts[view];
    return [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (key === "efficiency" && (av === null || bv === null)) {
        if (av === bv) return 0;
        return av === null ? 1 : -1;
      }
      const result = typeof av === "string"
        ? av.localeCompare(bv, i18n.lang)
        : av - bv;
      return ascending ? result : -result;
    });
  }

  function headerRow(target, columns, view) {
    const header = document.createElement("tr");
    for (const [field, label, numeric] of columns) {
      const th = document.createElement("th");
      if (numeric) th.className = "num";
      th.scope = "col";
      const sort = sorts[view];
      if (sort.key === field) th.setAttribute("aria-sort", sort.ascending ? "ascending" : "descending");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = i18n.t(label) + (sort.key === field ? (sort.ascending ? " ↑" : " ↓") : "");
      button.addEventListener("click", () => {
        if (sort.key === field) sort.ascending = !sort.ascending;
        else {
          sort.key = field;
          sort.ascending = true;
        }
        render();
        target.querySelectorAll("button")[columns.findIndex((column) => column[0] === field)]?.focus();
      });
      th.append(button);
      header.append(th);
    }
    target.replaceChildren(header);
  }

  function render() {
    heading.textContent = i18n.t("compareHeading");
    explain.textContent = i18n.t("compareExplain");
    goodsHeading.textContent = i18n.t("compareGoodsHeading");
    efficiencyHeading.textContent = i18n.t("compareEfficiencyHeading");
    headerRow(goodsThead, goodsColumns, "goods");
    headerRow(efficiencyThead, efficiencyColumns, "efficiency");
    const islands = store.islands.filter((island) => selected.has(island.id));
    const goodsRows = [];
    const efficiencyRows = [];
    for (const island of islands) {
      for (const product of productsByIsland.get(island.id)?.products || []) {
        goodsRows.push({ island: island.name, ...product, islandId: island.id });
      }
      for (const product of efficiencyByIsland.get(island.id)?.products || []) {
        efficiencyRows.push({ island: island.name, ...product, islandId: island.id });
      }
    }
    goodsTbody.replaceChildren();
    for (const product of sortRows(goodsRows, "goods")) {
      const tr = document.createElement("tr");
      const islandCell = document.createElement("td");
      islandCell.textContent = product.island;
      const productCell = document.createElement("td");
      const link = document.createElement("a");
      link.href = `#/island/${encodeURIComponent(product.islandId)}/product/${encodeURIComponent(product.guid)}`;
      link.textContent = product.name;
      productCell.append(link);
      tr.append(islandCell, productCell);
      for (const value of [fmt1.format(product.generation), fmt1.format(product.consumption)]) {
        const td = document.createElement("td");
        td.className = "num";
        td.textContent = value;
        tr.append(td);
      }
      const delta = document.createElement("td");
      delta.className = `num${product.delta < 0 ? " delta-negative" : product.delta > 0 ? " delta-positive" : ""}`;
      delta.textContent = (product.delta > 0 ? "+" : "") + fmt1.format(product.delta);
      const buildings = document.createElement("td");
      buildings.className = "num";
      buildings.textContent = fmt0.format(product.buildings);
      tr.append(delta, buildings);
      goodsTbody.append(tr);
    }

    efficiencyTbody.replaceChildren();
    const pct = new Intl.NumberFormat(i18n.lang === "de" ? "de-DE" : "en-US", {
      style: "percent",
      maximumFractionDigits: 0,
    });
    for (const product of sortRows(efficiencyRows, "efficiency")) {
      const tr = document.createElement("tr");
      if (product.efficiency === null) tr.className = "no-data";
      const islandCell = document.createElement("td");
      islandCell.textContent = product.island;
      const productCell = document.createElement("td");
      productCell.textContent = product.name;
      tr.append(islandCell, productCell);
      for (const value of [
        fmt1.format(product.generation),
        fmt1.format(product.perfectGeneration),
        product.efficiency === null ? "-" : pct.format(product.efficiency),
        pct.format(product.avgProductivity / 100),
        fmt1.format(product.wasted),
      ]) {
        const td = document.createElement("td");
        td.className = "num";
        td.textContent = value;
        tr.append(td);
      }
      efficiencyTbody.append(tr);
    }

    const failures = islands.flatMap((island) =>
      ["products", "efficiency"].flatMap((type) => {
        const error = errors.get(`${type}:${island.id}`);
        return error ? [`${island.name}: ${error}`] : [];
      }));
    if (islands.length === 0) {
      message.textContent = i18n.t("compareSelectIslands");
      message.className = "muted";
    } else if (failures.length > 0) {
      message.textContent = `${i18n.t("errorPrefix")} ${failures.join("; ")}`;
      message.className = "error-line";
    } else if (goodsRows.length === 0 || efficiencyRows.length === 0) {
      message.textContent = i18n.t("compareLoading");
      message.className = "muted";
    } else {
      message.textContent = `${goodsRows.length} ${i18n.t("compareRows")}`;
      message.className = "muted";
    }
    goodsHeading.hidden = goodsRows.length === 0;
    goodsBox.hidden = goodsRows.length === 0;
    efficiencyHeading.hidden = efficiencyRows.length === 0;
    efficiencyBox.hidden = efficiencyRows.length === 0;
  }

  async function loadIsland(islandId, type, refresh = false) {
    const key = `${type}:${islandId}`;
    if (inFlight.has(key) && !refresh) return;
    inFlight.add(key);
    const request = (requests.get(key) || 0) + 1;
    requests.set(key, request);
    try {
      const data = await api[type](islandId);
      if (disposed || !selected.has(islandId) || requests.get(key) !== request) return;
      (type === "products" ? productsByIsland : efficiencyByIsland).set(islandId, data);
      errors.delete(key);
    } catch (err) {
      if (disposed || !selected.has(islandId) || requests.get(key) !== request) return;
      errors.set(key, err instanceof Error ? err.message : String(err));
    } finally {
      if (requests.get(key) === request) inFlight.delete(key);
    }
    if (!disposed && selected.has(islandId) && requests.get(key) === request) render();
  }

  function selectionChanged() {
    const active = new Set(selected);
    for (const key of inFlight) {
      const id = key.slice(key.indexOf(":") + 1);
      if (!active.has(id)) {
        requests.set(key, (requests.get(key) || 0) + 1);
        inFlight.delete(key);
      }
    }
    for (const cache of [productsByIsland, efficiencyByIsland]) {
      for (const id of cache.keys()) {
        if (!active.has(id)) cache.delete(id);
      }
    }
    for (const id of errors.keys()) {
      if (!active.has(id.slice(id.indexOf(":") + 1))) errors.delete(id);
    }
    render();
    for (const id of active) {
      if (!productsByIsland.has(id)) loadIsland(id, "products");
      if (!efficiencyByIsland.has(id)) loadIsland(id, "efficiency");
    }
  }

  const updatePicker = createIslandPicker(picker, store, selected, selectionChanged, false);

  function onSnapshot(event) {
    if (event.detail?.id && selected.has(event.detail.id)) {
      loadIsland(event.detail.id, "products", true);
      loadIsland(event.detail.id, "efficiency", true);
    }
  }
  function onIslandsChanged() {
    const previous = [...selected];
    updatePicker();
    if (previous.length !== selected.size || previous.some((id) => !selected.has(id))) selectionChanged();
    else render();
  }
  function onLang() {
    render();
    updatePicker();
  }
  document.addEventListener("tabularium-snapshot", onSnapshot);
  document.addEventListener("tabularium-islands-changed", onIslandsChanged);
  document.addEventListener("tabularium-lang-changed", onLang);
  render();

  return () => {
    disposed = true;
    document.removeEventListener("tabularium-snapshot", onSnapshot);
    document.removeEventListener("tabularium-islands-changed", onIslandsChanged);
    document.removeEventListener("tabularium-lang-changed", onLang);
  };
}
