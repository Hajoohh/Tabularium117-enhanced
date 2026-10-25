import { i18n } from "../i18n.js";
import { api } from "../api.js";

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
  toolbar.append(searchInput);
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  const tableBox = document.createElement("div");
  tableBox.className = "table-scroll";
  tableBox.append(table);
  container.append(heading, explain, toolbar, message, tableBox);

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

  function selectedIslands() {
    return scope.total
      ? store.islands
      : store.islands.filter((island) => String(island.sessionGuid) === String(scope.sessionGuid));
  }

  function scopeName() {
    if (scope.total) return i18n.t("totalHeading");
    return selectedIslands()[0]?.sessionName || String(scope.sessionGuid);
  }

  function render() {
    heading.textContent = i18n.t("aggregateHeading", { scope: scopeName() });
    explain.textContent = i18n.t("aggregateExplain");
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

    let visibleProducts = products;
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      visibleProducts = visibleProducts.filter((product) => product.name.toLowerCase().includes(needle));
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
      name.textContent = product.name;
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
    render();
  });

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
  reload();

  return () => {
    disposed = true;
    document.removeEventListener("tabularium-snapshot", onSnapshot);
    document.removeEventListener("tabularium-islands-changed", onIslandsChanged);
    document.removeEventListener("tabularium-lang-changed", onLang);
  };
}
