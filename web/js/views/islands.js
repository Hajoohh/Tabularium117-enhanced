// views/islands.js -- the product table for one island (KONZEPT.md section 2.1/2.2).

import { i18n } from "../i18n.js";
import { api } from "../api.js";
import { byProduct, isSuppressed, isWarning, ruleLabel } from "../alerts.js";
import { renderIslandHeader } from "./island-header.js";
import { createSources, detailRow, toggleButton } from "../sources.js";
import {
  appendGoodsChainCards,
  matchingGoodsChains,
  validateGoodsChains,
  validateGoodsIcons,
} from "../goods-chain-view.js";

const numberFormatCache = new Map();

function numberFormat(fractionDigits) {
  const locale = i18n.lang === "de" ? "de-DE" : "en-US";
  const key = `${locale}:${fractionDigits}`;
  if (!numberFormatCache.has(key)) {
    numberFormatCache.set(
      key,
      new Intl.NumberFormat(locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }),
    );
  }
  return numberFormatCache.get(key);
}

const columns = [
  { key: "name", label: "colName", numeric: false },
  { key: "generation", label: "colGeneration", numeric: true },
  { key: "perfectGeneration", label: "colMaxProduction", numeric: true },
  { key: "consumption", label: "colConsumption", numeric: true },
  { key: "delta", label: "colDelta", numeric: true },
  { key: "buildings", label: "colBuildings", numeric: true },
];

// renderIslandDetail fetches the island's products and mounts the table. It
// returns an unmount function that stops listening for live updates.
export async function renderIslandDetail(container, islandId, store) {
  let sortKey = "delta";
  let sortAsc = true; // deficits (most negative delta) first by default
  let search = "";
  let filter = "all";
  // A request that was overtaken must not paint over the newer one: switching
  // island quickly, or a snapshot arriving during a reload, can land two
  // answers out of order, and the older one would win by arriving last.
  let disposed = false;
  let request = 0;
  let alertSettings = null;
  let settingsError = "";

  // The island's name, the island switch and the tab to the efficiency view
  // all live in the shared header now, so this view only owns its table.
  const header = renderIslandHeader(container, islandId, store, "products");

  const wrapper = document.createElement("div");
  const summaryLine = document.createElement("p");
  summaryLine.className = "muted summary-line";

  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const search_input = document.createElement("input");
  search_input.type = "search";
  search_input.placeholder = i18n.t("searchPlaceholder");
  search_input.setAttribute("data-i18n-placeholder", "searchPlaceholder");
  search_input.setAttribute("aria-label", i18n.t("searchPlaceholder"));

  const chainToggle = document.createElement("input");
  chainToggle.type = "checkbox";
  const chainLabel = document.createElement("label");
  chainLabel.className = "goods-chain-toggle";
  chainLabel.append(chainToggle, document.createTextNode(i18n.t("showGoodsChains")));

  // Search answers "where is X"; the filters answer "what needs me now",
  // which is the question a deficit or a warning raises. They intersect.
  const filters = document.createElement("div");
  filters.className = "filter-buttons";
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", i18n.t("filtersLabel"));
  const filterButtons = [];
  for (const [value, key] of [["all", "allGoods"], ["deficits", "onlyDeficits"], ["warnings", "onlyWarnings"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = i18n.t(key);
    button.setAttribute("aria-pressed", String(value === filter));
    button.addEventListener("click", () => {
      filter = value;
      for (const [other, otherValue] of filterButtons) {
        other.setAttribute("aria-pressed", String(otherValue === filter));
      }
      renderTable();
    });
    filterButtons.push([button, value]);
    filters.append(button);
  }
  toolbar.append(search_input, chainLabel, filters);

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);

  // A phone screen is narrower than this table; it scrolls inside its own
  // box instead of dragging the whole page sideways.
  const tableBox = document.createElement("div");
  tableBox.className = "table-scroll";
  tableBox.append(table);
  const settingsMessage = document.createElement("p");
  settingsMessage.className = "error-line";
  settingsMessage.hidden = true;
  const chainMessage = document.createElement("p");
  chainMessage.className = "muted goods-chain-message";
  chainMessage.hidden = true;
  const chainOverview = document.createElement("div");
  chainOverview.className = "goods-chain-overview";
  chainOverview.hidden = true;
  wrapper.append(summaryLine, toolbar, settingsMessage, chainMessage, chainOverview, tableBox);
  container.append(wrapper);

  let productsDTO = null;
  let goodsChains = null;
  let goodsIcons = null;
  let chainLoadPromise = null;
  let iconLoadPromise = null;
  let showGoodsChains = false;
  let selectedChainGuid = null;
  let chainError = "";
  let iconError = "";
  let chainsLoading = false;
  // The possible production sources of the "import needed" rows, each opened
  // under its own row.
  const sources = createSources(() => renderTable());

  function headerRow() {
    const tr = document.createElement("tr");
    const suppressionHeader = document.createElement("th");
    suppressionHeader.scope = "col";
    suppressionHeader.textContent = i18n.t("warningDeactivated");
    tr.append(suppressionHeader);
    for (const col of columns) {
      const th = document.createElement("th");
      if (col.numeric) th.className = "num";
      th.scope = "col";
      // A screen reader has no arrow to look at, so the sorted column says
      // so itself.
      if (sortKey === col.key) th.setAttribute("aria-sort", sortAsc ? "ascending" : "descending");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = i18n.t(col.label) + (sortKey === col.key ? (sortAsc ? " ↑" : " ↓") : "");
      btn.addEventListener("click", () => {
        if (sortKey === col.key) sortAsc = !sortAsc;
        else { sortKey = col.key; sortAsc = true; }
        renderTable();
        // renderTable replaces the header, and with it the button that was
        // just clicked: without this, sorting by keyboard drops the focus
        // back to the top of the page on every press.
        thead.querySelectorAll("button")[columns.indexOf(col)]?.focus();
      });
      th.append(btn);
      tr.append(th);
    }
    thead.replaceChildren(tr);
  }

  function deltaClass(delta) {
    if (delta < 0) return "delta-negative";
    if (delta > 0) return "delta-positive";
    return "";
  }

  function renderTable() {
    if (!productsDTO) return;
    headerRow();
    const island = productsDTO.island;
    const alertCount = store.alerts.filter((a) => a.islandId === islandId && isWarning(a)).length;
    // The name and the session are in the header; repeating them here only
    // made the line long enough to be skipped. What is left are the counts.
    header.update(island);
    settingsMessage.hidden = !settingsError;
    settingsMessage.textContent = settingsError ? `${i18n.t("alertSettingsError")} ${settingsError}` : "";
    chainMessage.hidden = true;
    chainMessage.className = chainError ? "error-line goods-chain-message" : "muted goods-chain-message";
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
      const entries = matchingGoodsChains(goodsChains, [island.sessionName], selectedChainGuid);
      if (entries.length > 0) {
        appendGoodsChainCards(chainOverview, entries, goodsIcons, selectedChainGuid, selectChainGood);
      } else {
        chainOverview.replaceChildren();
      }
      chainOverview.hidden = entries.length === 0;
    } else {
      chainOverview.replaceChildren();
    }
    summaryLine.textContent = `${island.products} ${i18n.t("products")} · `
      + `${island.deficits} ${i18n.t("deficits")}`
      + (alertCount > 0 ? ` · ${alertCount} ${i18n.t("alertsHeading")}` : "");

    // Warnings are per (island, product); a row carries a marker when the
    // rule engine has one open for it. A good the island does not produce
    // itself is info, not a warning: it gets a quiet tag of its own and stays
    // out of the warnings filter.
    const alerted = byProduct(store.alerts.filter(isWarning), islandId);
    const imports = byProduct(store.alerts.filter((a) => !isWarning(a)), islandId);
    sources.closeAllBut(new Set([...imports.keys()].map((guid) => sources.keyOf(islandId, guid))));
    const localizedName = (good) => good.name[i18n.lang] || good.name.en || good.name.de;
    const goodIcon = (guid) => {
      const src = goodsIcons?.[String(guid)];
      if (!src) return null;
      const icon = document.createElement("img");
      icon.className = "goods-chain-icon";
      icon.src = src;
      icon.alt = "";
      icon.setAttribute("aria-hidden", "true");
      icon.loading = "lazy";
      return icon;
    };
    const matchingChains = (guid) => {
      if (!showGoodsChains || !search.trim() || !goodsChains) return [];
      return matchingGoodsChains(goodsChains, [island.sessionName], guid);
    };

    function appendChainDetails(product, chains) {
      const tr = document.createElement("tr");
      tr.className = "goods-chain-row";
      const td = document.createElement("td");
      td.colSpan = columns.length + 1;
      appendGoodsChainCards(td, chains, goodsIcons, selectedChainGuid, selectChainGood);
      tr.append(td);
      tbody.append(tr);
    }

    function selectChainGood(good) {
      selectedChainGuid = good.guid;
      search = localizedName(good);
      search_input.value = search;
      renderTable();
    }

    let rows = productsDTO.products;
    if (filter === "deficits") rows = rows.filter((p) => p.delta < 0);
    if (filter === "warnings") rows = rows.filter((p) => alerted.has(String(p.guid)));
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      rows = rows.filter((p) => p.name.toLowerCase().includes(needle));
    }
    rows = [...rows].sort((a, b) => {
      let cmp;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      else cmp = a[sortKey] - b[sortKey];
      return sortAsc ? cmp : -cmp;
    });

    // Opening a row rebuilds the table, and so does its answer arriving a
    // moment later: each time, the button that had the keyboard is replaced
    // by a new one, which has to get the focus back.
    const focused = document.activeElement?.className?.includes?.("sources-toggle")
      ? document.activeElement.getAttribute("data-guid") : null;
    tbody.replaceChildren();
    if (rows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = columns.length + 1;
      if (productsDTO.products.length === 0) {
        // An empty island right after a savegame is loaded is not an island
        // without production - it is one whose first statistics tick has not
        // arrived yet (docs/protocol.md). Saying "no production" there would
        // be wrong for up to two minutes.
        td.textContent = store.status?.warmingUp ? i18n.t("warmingUp") : i18n.t("noProduction");
        if (store.status?.warmingUp) tr.className = "no-data";
      } else {
        // The island has goods, the filter or the search has none. Saying so
        // is the difference between "nothing here" and a table that looks
        // broken.
        td.textContent = i18n.t("noMatches");
      }
      tr.append(td);
      tbody.append(tr);
      return;
    }
    const fmt1 = numberFormat(1);
    const fmt0 = numberFormat(0);
    for (const p of rows) {
      const tr = document.createElement("tr");
      tr.className = "product-row";

      const suppressionTd = document.createElement("td");
      const suppression = document.createElement("input");
      suppression.type = "checkbox";
      suppression.checked = isSuppressed(alertSettings, islandId, p.guid, "deficit");
      suppression.setAttribute("aria-label", i18n.t(
        suppression.checked ? "warningEnableFor" : "warningDisableFor",
        { product: p.name },
      ));
      suppression.addEventListener("change", async () => {
        const disabled = suppression.checked;
        suppression.disabled = true;
        try {
          alertSettings = await api.setAlertSuppression(islandId, p.guid, "deficit", disabled);
          settingsError = "";
          document.dispatchEvent(new CustomEvent("tabularium-alert-settings-changed", { detail: alertSettings }));
          renderTable();
        } catch (err) {
          suppression.checked = !disabled;
          settingsError = err instanceof Error ? err.message : String(err);
          renderTable();
        }
      });
      suppressionTd.append(suppression);
      tr.append(suppressionTd);

      const nameTd = document.createElement("td");
      const warnings = alerted.get(String(p.guid));
      if (warnings) {
        const marker = document.createElement("span");
        marker.className = "alert-marker";
        marker.textContent = "\u26A0";
        marker.title = `${i18n.t("alertMarker")}: ${warnings.map((a) => `${ruleLabel(a.rule)} (${a.detail})`).join(", ")}`;
        marker.setAttribute("aria-label", i18n.t("alertMarker"));
        nameTd.append(marker, document.createTextNode(` ${p.name}`));
      } else {
        nameTd.textContent = p.name;
      }
      // The way into the history is a link, not a row that listens for
      // clicks and for Enter. A link is what a keyboard, a screen reader and
      // "open in a new tab" all already know how to use; the row only
      // highlights.
      const historyLink = document.createElement("a");
      historyLink.className = "product-link";
      historyLink.href = `#/island/${encodeURIComponent(islandId)}/product/${encodeURIComponent(p.guid)}`;
      historyLink.title = i18n.t("openHistory");
      historyLink.setAttribute("aria-label", `${p.name}: ${i18n.t("openHistory")}`);
      const icon = goodIcon(p.guid);
      if (icon) historyLink.append(icon, document.createTextNode(" "));
      while (nameTd.firstChild) historyLink.append(nameTd.firstChild);
      const hint = document.createElement("span");
      hint.className = "history-hint";
      hint.textContent = "↗";
      hint.setAttribute("aria-hidden", "true");
      historyLink.append(hint);
      nameTd.append(historyLink);
      // Outside the link: the tag explains the row, it is not a way into the
      // history. It opens the row's possible production sources.
      const needed = imports.has(String(p.guid));
      if (needed) {
        const expanded = sources.isOpen(islandId, p.guid);
        const tag = toggleButton(i18n.t("importTag"), expanded,
          () => sources.toggle(islandId, p.guid), i18n.t("importTagTitle"));
        tag.setAttribute("data-guid", String(p.guid));
        nameTd.append(" ", tag);
      }

      const genTd = document.createElement("td");
      genTd.className = "num";
      genTd.textContent = fmt1.format(p.generation);
      const maxProductionTd = document.createElement("td");
      maxProductionTd.className = "num";
      maxProductionTd.textContent = fmt1.format(p.perfectGeneration);
      const consTd = document.createElement("td");
      consTd.className = "num";
      consTd.textContent = fmt1.format(p.consumption);
      const deltaTd = document.createElement("td");
      deltaTd.className = `num ${deltaClass(p.delta)}`;
      // A column holding -4.0 and 2.0 reads better as -4.0 and +2.0: the
      // sign is the whole message of this column.
      deltaTd.textContent = (p.delta > 0 ? "+" : "") + fmt1.format(p.delta);
      const buildingsTd = document.createElement("td");
      buildingsTd.className = "num";
      buildingsTd.textContent = fmt0.format(p.buildings);

      tr.append(nameTd, genTd, maxProductionTd, consTd, deltaTd, buildingsTd);
      tbody.append(tr);
      const chains = matchingChains(p.guid);
      if (chains.length > 0) {
        appendChainDetails(p, chains);
      } else if (showGoodsChains && search.trim()) {
        const noChain = document.createElement("tr");
        noChain.className = "goods-chain-row";
        const cell = document.createElement("td");
        cell.colSpan = columns.length + 1;
        cell.textContent = i18n.t("noGoodsChains", { product: p.name, region: island.sessionName });
        noChain.append(cell);
        tbody.append(noChain);
      }
      if (needed && sources.isOpen(islandId, p.guid)) {
        tbody.append(detailRow(sources.panel(islandId, p.guid), columns.length + 1));
      }
    }
    // Without preventScroll the browser scrolls the rebuilt button into
    // view, which drags a wide table sideways under the thumb that tapped it.
    if (focused !== null) {
      [...tbody.querySelectorAll(".sources-toggle")]
        .find((b) => b.getAttribute("data-guid") === focused)?.focus({ preventScroll: true });
    }
  }

  search_input.addEventListener("input", () => {
    search = search_input.value;
    selectedChainGuid = null;
    renderTable();
  });

  chainToggle.addEventListener("change", async () => {
    showGoodsChains = chainToggle.checked;
    chainError = "";
    if (showGoodsChains && !goodsChains) {
      chainsLoading = true;
      chainToggle.disabled = true;
      renderTable();
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
    renderTable();
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
    if (!disposed) renderTable();
  }

  async function load() {
    const current = ++request;
    const [dto, settings] = await Promise.all([api.products(islandId), api.alertSettings()]);
    if (disposed || current !== request) return;
    productsDTO = dto;
    alertSettings = settings;
    renderTable();
  }

  void loadGoodsIcons();
  await load();

  const onSnapshot = (e) => {
    if (e.detail && e.detail.id === islandId) {
      load().catch((err) => console.error("tabularium117: cannot refresh products", err));
    }
    // Any island's snapshot may complete the tick the sources come from.
    sources.refresh();
  };
  document.addEventListener("tabularium-snapshot", onSnapshot);

  const onLang = () => {
    chainLabel.replaceChildren(chainToggle, document.createTextNode(i18n.t("showGoodsChains")));
    renderTable();
    sources.refresh();
  };
  document.addEventListener("tabularium-lang-changed", onLang);

  const onAlerts = () => renderTable();
  document.addEventListener("tabularium-alerts-changed", onAlerts);
  const onAlertSettings = (event) => {
    alertSettings = event.detail;
    renderTable();
  };
  document.addEventListener("tabularium-alert-settings-changed", onAlertSettings);

  return () => {
    disposed = true;
    sources.dispose();
    document.removeEventListener("tabularium-snapshot", onSnapshot);
    document.removeEventListener("tabularium-lang-changed", onLang);
    document.removeEventListener("tabularium-alerts-changed", onAlerts);
    document.removeEventListener("tabularium-alert-settings-changed", onAlertSettings);
  };
}
