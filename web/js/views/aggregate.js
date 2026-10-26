import { i18n } from "../i18n.js";
import { api } from "../api.js";
import {
  appendGoodsChainCards,
  createGoodsCategoryFilters,
  filterGoodsByCategories,
  goodsCategoriesForRegions,
  matchingGoodsChains,
  validateGoodsChains,
  validateGoodsIcons,
} from "../goods-chain-view.js";

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

export function renderAggregate(container, store, scope) {
  const heading = document.createElement("h2");
  const explain = document.createElement("p");
  explain.className = "muted";
  const message = document.createElement("p");
  message.className = "muted";
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = i18n.t("searchPlaceholder");
  searchInput.setAttribute("data-i18n-placeholder", "searchPlaceholder");
  searchInput.setAttribute("aria-label", i18n.t("searchPlaceholder"));
  const chainToggle = document.createElement("input");
  chainToggle.type = "checkbox";
  const chainLabel = document.createElement("label");
  chainLabel.className = "goods-chain-toggle";
  chainLabel.append(chainToggle, document.createTextNode(i18n.t("showGoodsChainsForSearch")));
  toolbar.append(searchInput, chainLabel);
  const chainMessage = document.createElement("p");
  chainMessage.className = "muted goods-chain-message";
  chainMessage.hidden = true;
  const chainOverview = document.createElement("div");
  chainOverview.className = "goods-chain-overview";
  chainOverview.hidden = true;
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  const tableBox = document.createElement("div");
  tableBox.className = "table-scroll";
  tableBox.append(table);
  container.append(heading, explain, toolbar, message, chainMessage, chainOverview, tableBox);

  const columns = [
    ["name", "colName", false],
    ["generation", "colGeneration", true],
    ["perfectGeneration", "colMaxProduction", true],
    ["consumption", "colConsumption", true],
    ["delta", "colDelta", true],
    ["buildings", "colBuildings", true],
  ];
  let sortKey = "delta";
  let sortAscending = true;
  let disposed = false;
  let loading = false;
  let refreshAgain = false;
  let loadPromise = null;
  let products = [];
  let errors = [];
  let search = "";
  let goodsChains = null;
  let goodsIcons = null;
  let chainLoadPromise = null;
  let iconLoadPromise = null;
  let showGoodsChains = false;
  let chainsLoading = false;
  let chainError = "";
  let iconError = "";
  let selectedChainGuid = null;
  let selectedCategories = new Set();
  const categoryFilters = createGoodsCategoryFilters((categories) => {
    selectedCategories = categories;
    void updateCategoryFilters(categories);
  });
  toolbar.append(categoryFilters.element);

  function selectedIslands() {
    return scope.total
      ? store.islands
      : store.islands.filter((island) => String(island.sessionGuid) === String(scope.sessionGuid));
  }

  function scopeName() {
    if (scope.total) return i18n.t("totalHeading");
    return selectedIslands()[0]?.sessionName || String(scope.sessionGuid);
  }

  function regionsInScope() {
    return [...new Set(selectedIslands().map((island) => island.sessionName))];
  }

  async function updateCategoryFilters(categories) {
    chainError = "";
    if (categories.size > 0 && !goodsChains) {
      chainsLoading = true;
      render();
      if (!chainLoadPromise) chainLoadPromise = api.goodsChains();
      try {
        goodsChains = validateGoodsChains(await chainLoadPromise);
      } catch (err) {
        chainLoadPromise = null;
        selectedCategories = new Set();
        categoryFilters.reset();
        chainError = err instanceof Error ? err.message : String(err);
      }
      chainsLoading = false;
    }
    render();
  }

  function localizedName(good) {
    return good.name[i18n.lang] || good.name.en || good.name.de;
  }

  function selectChainGood(good) {
    selectedChainGuid = good.guid;
    search = localizedName(good);
    searchInput.value = search;
    render();
  }

  function renderChainDetails(chains) {
    const row = document.createElement("tr");
    row.className = "goods-chain-row";
    const cell = document.createElement("td");
    cell.colSpan = columns.length;
    appendGoodsChainCards(cell, chains, goodsIcons, selectedChainGuid, selectChainGood);
    row.append(cell);
    tbody.append(row);
  }

  function render() {
    heading.textContent = i18n.t("aggregateHeading", { scope: scopeName() });
    explain.textContent = i18n.t("aggregateExplain");
    chainLabel.replaceChildren(chainToggle, document.createTextNode(i18n.t("showGoodsChainsForSearch")));
    categoryFilters.updateLabels();
    const headers = document.createElement("tr");
    for (const [key, label, numeric] of columns) {
      const th = document.createElement("th");
      if (numeric) th.className = "num";
      th.scope = "col";
      if (sortKey === key) th.setAttribute("aria-sort", sortAscending ? "ascending" : "descending");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = i18n.t(label) + (sortKey === key ? (sortAscending ? " ↑" : " ↓") : "");
      button.addEventListener("click", () => {
        if (sortKey === key) sortAscending = !sortAscending;
        else {
          sortKey = key;
          sortAscending = true;
        }
        render();
        thead.querySelectorAll("button")[columns.findIndex((column) => column[0] === key)]?.focus();
      });
      th.append(button);
      headers.append(th);
    }
    thead.replaceChildren(headers);

    tableBox.hidden = products.length === 0 || errors.length > 0;
    if (errors.length > 0) {
      message.className = "error-line";
      message.textContent = `${i18n.t("aggregateErrors")} ${errors.join("; ")}`;
    } else if (loading) {
      message.className = "muted";
      message.textContent = i18n.t("aggregateLoading");
    } else if (selectedIslands().length === 0) {
      message.className = "muted";
      message.textContent = i18n.t(scope.total ? "aggregateNoProduction" : "aggregateNoIslands");
    } else if (products.length === 0) {
      message.className = "muted";
      message.textContent = store.status?.warmingUp
        ? i18n.t("warmingUp")
        : i18n.t("aggregateNoProduction");
    } else {
      message.className = "muted";
      message.textContent = "";
    }
    chainMessage.hidden = true;
    chainMessage.className = chainError || iconError ? "error-line goods-chain-message" : "muted goods-chain-message";
    if (chainError) {
      chainMessage.textContent = `${i18n.t("goodsChainsError")} ${chainError}`;
      chainMessage.hidden = false;
    } else if (iconError) {
      chainMessage.textContent = `${i18n.t("goodsIconsError")} ${iconError}`;
      chainMessage.hidden = false;
    } else if (chainsLoading) {
      chainMessage.textContent = i18n.t("goodsChainsLoading");
      chainMessage.hidden = false;
    } else if (showGoodsChains && !search.trim()) {
      chainMessage.textContent = i18n.t("goodsChainsSearchFirst");
      chainMessage.hidden = false;
    }
    chainOverview.hidden = true;
    if (selectedChainGuid !== null && goodsChains) {
      const entries = matchingGoodsChains(goodsChains, regionsInScope(), selectedChainGuid);
      if (entries.length > 0) {
        appendGoodsChainCards(chainOverview, entries, goodsIcons, selectedChainGuid, selectChainGood);
      } else {
        chainOverview.replaceChildren();
      }
      chainOverview.hidden = entries.length === 0;
    } else {
      chainOverview.replaceChildren();
    }

    let visibleProducts = products;
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      visibleProducts = visibleProducts.filter((product) => product.name.toLowerCase().includes(needle));
    }
    if (selectedCategories.size > 0) {
      visibleProducts = goodsChains
        ? filterGoodsByCategories(
          visibleProducts,
          selectedCategories,
          goodsCategoriesForRegions(goodsChains, regionsInScope()),
        )
        : [];
    }
    const sorted = [...visibleProducts].sort((a, b) => {
      const result = sortKey === "name"
        ? a.name.localeCompare(b.name, i18n.lang)
        : a[sortKey] - b[sortKey];
      return sortAscending ? result : -result;
    });
    const fmt1 = numberFormat(1);
    const fmt0 = numberFormat(0);
    tbody.replaceChildren();
    if (products.length > 0 && visibleProducts.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = columns.length;
      cell.textContent = i18n.t("noMatches");
      row.append(cell);
      tbody.append(row);
      return;
    }
    for (const product of sorted) {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      const iconUrl = goodsIcons?.[String(product.guid)];
      if (iconUrl) {
        const icon = document.createElement("img");
        icon.className = "goods-chain-icon";
        icon.src = iconUrl;
        icon.alt = "";
        icon.setAttribute("aria-hidden", "true");
        icon.loading = "lazy";
        name.append(icon, document.createTextNode(" "));
      }
      name.append(document.createTextNode(product.name));
      row.append(name);
      for (const value of [
        fmt1.format(product.generation),
        fmt1.format(product.perfectGeneration),
        fmt1.format(product.consumption),
      ]) {
        const cell = document.createElement("td");
        cell.className = "num";
        cell.textContent = value;
        row.append(cell);
      }
      const delta = document.createElement("td");
      delta.className = `num${product.delta < 0 ? " delta-negative" : product.delta > 0 ? " delta-positive" : ""}`;
      delta.textContent = (product.delta > 0 ? "+" : "") + fmt1.format(product.delta);
      const buildings = document.createElement("td");
      buildings.className = "num";
      buildings.textContent = fmt0.format(product.buildings);
      row.append(delta, buildings);
      tbody.append(row);
      if (showGoodsChains && search.trim() && goodsChains) {
        const chains = matchingGoodsChains(goodsChains, regionsInScope(), product.guid);
        if (chains.length > 0) renderChainDetails(chains);
      }
    }
  }

  function sumProducts(results) {
    const totals = new Map();
    for (const data of results) {
      for (const product of data.products) {
        let total = totals.get(product.guid);
        if (!total) {
          total = {
            guid: product.guid,
            name: product.name,
            generation: 0,
            perfectGeneration: 0,
            consumption: 0,
            delta: 0,
            buildings: 0,
          };
          totals.set(product.guid, total);
        }
        total.generation += product.generation;
        total.perfectGeneration += product.perfectGeneration;
        total.consumption += product.consumption;
        total.delta += product.delta;
        total.buildings += product.buildings;
      }
    }
    return [...totals.values()];
  }

  searchInput.addEventListener("input", () => {
    search = searchInput.value;
    selectedChainGuid = null;
    render();
  });

  chainToggle.addEventListener("change", async () => {
    showGoodsChains = chainToggle.checked;
    chainError = "";
    if (showGoodsChains && !goodsChains) {
      chainsLoading = true;
      chainToggle.disabled = true;
      render();
      if (!chainLoadPromise) chainLoadPromise = api.goodsChains();
      try {
        goodsChains = validateGoodsChains(await chainLoadPromise);
      } catch (err) {
        chainLoadPromise = null;
        showGoodsChains = false;
        chainToggle.checked = false;
        chainError = err instanceof Error ? err.message : String(err);
      }
    }
    chainsLoading = false;
    chainToggle.disabled = false;
    render();
  });

  async function loadGoodsIcons() {
    if (goodsIcons) return;
    try {
      if (!iconLoadPromise) iconLoadPromise = api.goodsIcons();
      goodsIcons = validateGoodsIcons(await iconLoadPromise);
    } catch (err) {
      iconLoadPromise = null;
      iconError = err instanceof Error ? err.message : String(err);
    }
    if (!disposed) render();
  }

  async function loadOnce() {
    const islands = selectedIslands();
    loading = true;
    products = [];
    errors = [];
    render();
    const results = await Promise.allSettled(islands.map((island) => api.products(island.id)));
    if (disposed) return;
    errors = results.flatMap((result, index) => result.status === "rejected"
      ? [`${islands[index].name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
      : []);
    if (errors.length === 0) products = sumProducts(results.map((result) => result.value));
    loading = false;
    render();
  }

  function reload() {
    if (disposed) return;
    if (loadPromise) {
      refreshAgain = true;
      return;
    }
    loadPromise = (async () => {
      do {
        refreshAgain = false;
        await loadOnce();
      } while (refreshAgain && !disposed);
    })().finally(() => {
      loadPromise = null;
    });
  }

  let islandSignature = selectedIslands().map((island) => island.id).join("\n");
  function onSnapshot(event) {
    if (selectedIslands().some((island) => island.id === event.detail?.id)) reload();
  }
  function onIslandsChanged() {
    const next = selectedIslands().map((island) => island.id).join("\n");
    if (next !== islandSignature) {
      islandSignature = next;
      reload();
    } else {
      render();
    }
  }
  function onLang() {
    reload();
  }

  document.addEventListener("tabularium-snapshot", onSnapshot);
  document.addEventListener("tabularium-islands-changed", onIslandsChanged);
  document.addEventListener("tabularium-lang-changed", onLang);
  render();
  void loadGoodsIcons();
  reload();

  return () => {
    disposed = true;
    document.removeEventListener("tabularium-snapshot", onSnapshot);
    document.removeEventListener("tabularium-islands-changed", onIslandsChanged);
    document.removeEventListener("tabularium-lang-changed", onLang);
  };
}
