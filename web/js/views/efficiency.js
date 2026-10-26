// views/efficiency.js -- the efficiency view (KONZEPT.md section 2.3).

import { i18n } from "../i18n.js";
import { api } from "../api.js";
import { isSuppressed } from "../alerts.js";
import { renderIslandHeader } from "./island-header.js";
import {
  createGoodsCategoryFilters,
  filterGoodsByCategories,
  goodsCategoriesForRegions,
  validateGoodsChains,
} from "../goods-chain-view.js";

function locale() {
  return i18n.lang === "de" ? "de-DE" : "en-US";
}

// The reason for zero output must be visible on a phone and to a screen
// reader, not hidden in a hover-only title attribute.
function valueWithNote(value, note) {
  const wrapper = document.createElement("span");
  wrapper.append(document.createTextNode(value));
  const label = document.createElement("span");
  label.className = "cell-note";
  label.textContent = note;
  wrapper.append(label);
  return wrapper;
}

export async function renderEfficiency(container, islandId, store) {
  // Same reason as in views/islands.js: an answer that was overtaken must
  // not paint over the newer one.
  let disposed = false;
  let request = 0;
  let alertSettings = null;
  let settingsError = "";
  let sortKey = "wasted";
  let sortAscending = false;
  let currentDTO = null;
  let goodsChains = null;
  let chainLoadPromise = null;
  let categoryLoading = false;
  let categoryError = "";

  // The heading, the island switch and the way back to the goods table are
  // the shared header's job (views/island-header.js).
  const header = renderIslandHeader(container, islandId, store, "efficiency");

  const intro = document.createElement("p");
  intro.className = "muted efficiency-intro";
  intro.textContent = i18n.t("efficiencyIntro");
  const details = document.createElement("details");
  details.className = "efficiency-explainer";
  const summary = document.createElement("summary");
  summary.textContent = i18n.t("efficiencyDetails");
  const meanings = document.createElement("dl");
  for (const [term, meaning] of [
    ["colEfficiency", "efficiencyMeaning"],
    ["colProductivity", "productivityMeaning"],
    ["colWasted", "unusedMeaning"],
    ["productivityIdleNote", "productivityIdleMeaning"],
    ["productivityNoBuildingsNote", "productivityNoBuildingsMeaning"],
    ["productivityNoPotentialNote", "productivityNoPotentialMeaning"],
  ]) {
    const dt = document.createElement("dt");
    dt.textContent = i18n.t(term);
    const dd = document.createElement("dd");
    dd.textContent = i18n.t(meaning);
    meanings.append(dt, dd);
  }
  details.append(summary, meanings);

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
  const categoryMessage = document.createElement("p");
  categoryMessage.className = "muted goods-chain-message";
  categoryMessage.hidden = true;
  const categoryFilters = createGoodsCategoryFilters((categories) => {
    void updateCategoryFilters(categories);
  });
  container.append(intro, details, settingsMessage, categoryFilters.element, categoryMessage, tableBox);

  const columns = [
    ["name", "colName", false],
    ["generation", "colGeneration", true],
    ["perfectGeneration", "colPerfect", true],
    ["efficiency", "colEfficiency", true],
    ["avgProductivity", "colProductivity", true],
    ["wasted", "colWasted", true],
  ];

  async function updateCategoryFilters(categories) {
    categoryError = "";
    if (categories.size > 0 && !goodsChains) {
      categoryLoading = true;
      if (currentDTO) render(currentDTO);
      if (!chainLoadPromise) chainLoadPromise = api.goodsChains();
      try {
        goodsChains = validateGoodsChains(await chainLoadPromise);
      } catch (err) {
        chainLoadPromise = null;
        categoryError = err instanceof Error ? err.message : String(err);
        categoryFilters.reset();
      }
      categoryLoading = false;
    }
    if (currentDTO) render(currentDTO);
  }

  function render(dto) {
    currentDTO = dto;
    header.update(dto.island);
    categoryFilters.updateLabels();
    settingsMessage.hidden = !settingsError;
    settingsMessage.textContent = settingsError ? `${i18n.t("alertSettingsError")} ${settingsError}` : "";
    categoryMessage.hidden = !categoryLoading && !categoryError;
    categoryMessage.className = categoryError ? "error-line goods-chain-message" : "muted goods-chain-message";
    categoryMessage.textContent = categoryError
      ? `${i18n.t("goodsChainsError")} ${categoryError}`
      : i18n.t("loadingGoodsCategories");
    const headRow = document.createElement("tr");
    const suppressionHeader = document.createElement("th");
    suppressionHeader.scope = "col";
    suppressionHeader.textContent = i18n.t("warningDeactivated");
    headRow.append(suppressionHeader);
    for (const [field, label, numeric] of columns) {
      const th = document.createElement("th");
      if (numeric) th.className = "num";
      th.scope = "col";
      if (sortKey === field) th.setAttribute("aria-sort", sortAscending ? "ascending" : "descending");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = i18n.t(label) + (sortKey === field ? (sortAscending ? " ↑" : " ↓") : "");
      button.addEventListener("click", () => {
        if (sortKey === field) sortAscending = !sortAscending;
        else {
          sortKey = field;
          sortAscending = true;
        }
        render(dto);
        thead.querySelectorAll("button")[columns.findIndex((column) => column[0] === field)]?.focus();
      });
      th.append(button);
      headRow.append(th);
    }
    thead.replaceChildren(headRow);

    tbody.replaceChildren();
    let visibleProducts = dto.products;
    const selectedCategories = categoryFilters.selected();
    if (selectedCategories.size > 0) {
      visibleProducts = goodsChains
        ? filterGoodsByCategories(
          visibleProducts,
          selectedCategories,
          goodsCategoriesForRegions(goodsChains, [dto.island.sessionName]),
        )
        : [];
    }
    if (visibleProducts.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = columns.length + 1;
      td.textContent = dto.products.length > 0 ? i18n.t("noMatches") : i18n.t("noEfficiencyData");
      tr.append(td);
      tbody.append(tr);
      return;
    }
    const fmt1 = new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const pct = new Intl.NumberFormat(locale(), { style: "percent", maximumFractionDigits: 0 });
    // avgProductivity arrives already in percent (SummedProductivity /
    // AmountOfBuildings x 100, KONZEPT.md section 12), so it goes back to a
    // ratio before it is formatted. Writing the sign by hand instead put a
    // space in front of it in English, where the two percentages in this
    // table then disagreed with each other ("49%" beside "220 %").
    const percent = (valueInPercent) => pct.format(valueInPercent / 100);

    const sorted = [...visibleProducts].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === "efficiency" && (av === null || bv === null)) {
        if (av === bv) return 0;
        return av === null ? 1 : -1;
      }
      const result = typeof av === "string"
        ? av.localeCompare(bv, i18n.lang)
        : av - bv;
      return sortAscending ? result : -result;
    });

    for (const p of sorted) {
      const tr = document.createElement("tr");
      if (p.efficiency === null) tr.className = "no-data";

      const suppressionTd = document.createElement("td");
      const suppression = document.createElement("input");
      suppression.type = "checkbox";
      suppression.checked = isSuppressed(alertSettings, islandId, p.guid, "productivity_drop");
      suppression.setAttribute("aria-label", i18n.t(
        suppression.checked ? "warningEnableFor" : "warningDisableFor",
        { product: p.name },
      ));
      suppression.addEventListener("change", async () => {
        const disabled = suppression.checked;
        suppression.disabled = true;
        try {
          alertSettings = await api.setAlertSuppression(islandId, p.guid, "productivity_drop", disabled);
          settingsError = "";
          document.dispatchEvent(new CustomEvent("tabularium-alert-settings-changed", { detail: alertSettings }));
          render(dto);
        } catch (err) {
          suppression.checked = !disabled;
          settingsError = err instanceof Error ? err.message : String(err);
          render(dto);
        }
      });
      suppressionTd.append(suppression);
      tr.append(suppressionTd);

      const nameTd = document.createElement("td");
      nameTd.textContent = p.name;
      const genTd = document.createElement("td");
      genTd.className = "num";
      genTd.textContent = fmt1.format(p.generation);
      const perfectTd = document.createElement("td");
      perfectTd.className = "num";
      perfectTd.textContent = fmt1.format(p.perfectGeneration);

      const effTd = document.createElement("td");
      effTd.className = "num";
      if (p.efficiency === null) {
        effTd.textContent = "-";
      } else {
        // Bar and number share one line, bar first: the bars line up into a
        // column that can be read top to bottom, which is the whole point of
        // drawing them at all.
        const cell = document.createElement("div");
        cell.className = "efficiency-cell";
        const bar = document.createElement("div");
        bar.className = "efficiency-bar";
        const fill = document.createElement("span");
        const ratio = Math.max(0, Math.min(1, p.efficiency));
        fill.style.width = `${(ratio * 100).toFixed(0)}%`;
        bar.append(fill);
        const value = document.createElement("span");
        value.textContent = pct.format(p.efficiency);
        cell.append(bar, value);
        effTd.append(cell);
      }

      // Productivity is a different question from efficiency: how hard the
      // buildings run, rather than how the output compares with its optimum
      // (KONZEPT.md section 2.3). Without buildings there is nothing to
      // average, and the field is then a zero that means "not applicable".
      //
      // The row itself explains the two ways of producing nothing. Longer
      // explanations are available in the details above the table.
      const productivityTd = document.createElement("td");
      productivityTd.className = "num";
      if (p.perfectGeneration === 0 && p.buildings === 0) {
        productivityTd.append(valueWithNote("–", i18n.t("productivityNoBuildingsNote")));
      } else if (p.perfectGeneration === 0) {
        productivityTd.append(valueWithNote(percent(p.avgProductivity), i18n.t("productivityNoPotentialNote")));
      } else if (p.generation === 0 && p.perfectGeneration > 0) {
        productivityTd.append(valueWithNote(percent(p.avgProductivity), i18n.t("productivityIdleNote")));
      } else {
        productivityTd.textContent = percent(p.avgProductivity);
      }

      const wastedTd = document.createElement("td");
      wastedTd.className = "num";
      wastedTd.textContent = fmt1.format(p.wasted);

      tr.append(nameTd, genTd, perfectTd, effTd, productivityTd, wastedTd);
      tbody.append(tr);
    }
  }

  async function load() {
    const current = ++request;
    const [dto, settings] = await Promise.all([api.efficiency(islandId), api.alertSettings()]);
    if (disposed || current !== request) return;
    alertSettings = settings;
    render(dto);
  }

  await load();

  const onSnapshot = (e) => {
    if (e.detail && e.detail.id === islandId) {
      load().catch((err) => console.error("tabularium117: cannot refresh efficiency", err));
    }
  };
  document.addEventListener("tabularium-snapshot", onSnapshot);
  const onLang = () => load();
  document.addEventListener("tabularium-lang-changed", onLang);
  const onAlertSettings = (event) => {
    alertSettings = event.detail;
    load().catch((err) => console.error("tabularium117: cannot refresh efficiency", err));
  };
  document.addEventListener("tabularium-alert-settings-changed", onAlertSettings);

  return () => {
    disposed = true;
    document.removeEventListener("tabularium-snapshot", onSnapshot);
    document.removeEventListener("tabularium-lang-changed", onLang);
    document.removeEventListener("tabularium-alert-settings-changed", onAlertSettings);
  };
}
