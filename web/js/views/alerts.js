// views/alerts.js -- the #/alerts page: the warnings that are open now, and
// optionally the recorded history (#/alerts?all=1).

import { i18n } from "../i18n.js";
import { api, ApiError } from "../api.js";
import { isSuppressed, isWarning, ruleLabel } from "../alerts.js";
import { formatAge, formatTime, formatDateTime } from "../format.js";
import { createSources, detailRow, toggleButton } from "../sources.js";
import { createIslandPicker } from "../island-picker.js";

// renderAlerts mounts the list. The active list comes from the shared store,
// which the event stream keeps fresh; the history is fetched once, because
// nothing pushes closed warnings.
export async function renderAlerts(container, store, showHistory) {
  const heading = document.createElement("h2");
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";
  const toggle = document.createElement("a");
  toggle.className = "back-link";
  const explain = document.createElement("p");
  explain.className = "muted";
  const message = document.createElement("p");
  message.className = "muted";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);

  toolbar.append(toggle);
  // A phone screen is narrower than this table; it scrolls inside its own
  // box instead of dragging the whole page sideways.
  const tableBox = document.createElement("div");
  tableBox.className = "table-scroll";
  tableBox.append(table);

  const settingsSection = document.createElement("section");
  settingsSection.className = "alert-settings";
  const settingsHeading = document.createElement("h3");
  const settingsForm = document.createElement("form");
  const deficitLabel = document.createElement("label");
  const deficitLabelText = document.createElement("span");
  const deficitInput = document.createElement("input");
  deficitInput.id = "alert-deficit-threshold";
  deficitInput.type = "number";
  deficitInput.step = "0.1";
  deficitInput.max = "0";
  const dropLabel = document.createElement("label");
  const dropLabelText = document.createElement("span");
  const dropInput = document.createElement("input");
  dropInput.id = "alert-drop-threshold";
  dropInput.type = "number";
  dropInput.step = "0.1";
  dropInput.min = "0.1";
  const saveSettings = document.createElement("button");
  saveSettings.type = "submit";
  const settingsMessage = document.createElement("p");
  settingsMessage.className = "muted";
  deficitLabel.htmlFor = deficitInput.id;
  deficitLabel.append(deficitLabelText, deficitInput);
  dropLabel.htmlFor = dropInput.id;
  dropLabel.append(dropLabelText, dropInput);
  settingsForm.append(deficitLabel, dropLabel, saveSettings, settingsMessage);
  settingsSection.append(settingsHeading, settingsForm);

  // Goods an island consumes but does not produce are info, not warnings.
  // The active view lists them in a section of their own under the
  // warnings; the history, a list of warnings, leaves them out.
  const importsHeading = document.createElement("h3");
  const importsExplain = document.createElement("p");
  importsExplain.className = "muted";
  const importsTable = document.createElement("table");
  const importsThead = document.createElement("thead");
  const importsTbody = document.createElement("tbody");
  importsTable.append(importsThead, importsTbody);
  const importsBox = document.createElement("div");
  importsBox.className = "table-scroll";
  importsBox.append(importsTable);
  const importsSection = document.createElement("section");
  importsSection.className = "imports-section";
  importsSection.append(importsHeading, importsExplain, importsBox);

  const disabledHeading = document.createElement("h3");
  const disabledTable = document.createElement("table");
  const disabledThead = document.createElement("thead");
  const disabledTbody = document.createElement("tbody");
  disabledTable.append(disabledThead, disabledTbody);
  const disabledBox = document.createElement("div");
  disabledBox.className = "table-scroll";
  disabledBox.append(disabledTable);
  const disabledSection = document.createElement("section");
  disabledSection.className = "disabled-warnings";
  disabledSection.append(disabledHeading, disabledBox);
  importsSection.append(disabledSection);

  container.append(heading, toolbar, explain, message, settingsSection, tableBox, importsSection);

  let history = null;
  let historyError = "";
  let alertSettings = { deficitThreshold: 0, dropPercentagePoints: 20, suppressions: [] };
  let settingsError = "";
  let settingsSaved = false;
  const syncThresholdInputs = () => {
    deficitInput.value = String(alertSettings.deficitThreshold);
    dropInput.value = String(alertSettings.dropPercentagePoints);
  };
  // The possible production sources of the "import needed" entries, opened
  // under the entry like in the goods table.
  const sources = createSources(() => render());
  const selectedIslands = new Set(store.islands.map((island) => island.id));
  let sortKey = "raisedAt";
  let sortAscending = false;
  const pickerStore = {
    get islands() {
      const islands = new Map(store.islands.map((island) => [island.id, island]));
      for (const alert of history || []) {
        if (!islands.has(alert.islandId)) {
          islands.set(alert.islandId, {
            id: alert.islandId,
            name: alert.islandName || alert.islandId,
            sessionName: alert.sessionName || "",
          });
        }
      }
      return [...islands.values()];
    },
  };

  if (showHistory) {
    try {
      // Warnings only: the info alerts would fill the 200 rows up - an
      // island records one for every good it does not produce itself.
      history = await api.alerts(false, 200, false);
    } catch (err) {
      history = [];
      historyError = err instanceof ApiError ? err.message : String(err);
    }
  } else {
    try {
      alertSettings = await api.alertSettings();
    } catch (err) {
      settingsError = err instanceof Error ? err.message : String(err);
    }
  }
  syncThresholdInputs();

  function columns() {
    return showHistory
      ? [
        ["islandName", "colIsland"],
        ["productName", "colProduct"],
        ["rule", "colRule"],
        ["detail", "colDetail"],
        ["raisedAt", "colSince"],
        ["clearedAt", "colUntil"],
      ]
      : [
        ["islandName", "colIsland"],
        ["productName", "colProduct"],
        ["rule", "colRule"],
        ["detail", "colDetail"],
        ["raisedAt", "colSince"],
      ];
  }

  function headerRow(target) {
    const tr = document.createElement("tr");
    if (target === importsThead) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = i18n.t("warningDeactivated");
      tr.append(th);
    }
    for (const [field, label] of columns()) {
      const th = document.createElement("th");
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
        render();
        target.querySelectorAll("button")[columns().findIndex((column) => column[0] === field)]?.focus();
      });
      th.append(button);
      tr.append(th);
    }
    target.replaceChildren(tr);
  }

  function disabledHeader() {
    const tr = document.createElement("tr");
    for (const key of ["warningDeactivated", "colIsland", "colProduct", "colRule"]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = i18n.t(key);
      tr.append(th);
    }
    disabledThead.replaceChildren(tr);
  }

  async function updateSuppression(islandId, productGuid, rule, disabled) {
    try {
      alertSettings = await api.setAlertSuppression(islandId, productGuid, rule, disabled);
      settingsError = "";
      settingsSaved = false;
      document.dispatchEvent(new CustomEvent("tabularium-alert-settings-changed", { detail: alertSettings }));
    } catch (err) {
      settingsError = err instanceof Error ? err.message : String(err);
    }
    render();
  }

  function suppressionCheckbox(islandId, productGuid, productName, rule, disabled) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = disabled;
    checkbox.setAttribute("aria-label", i18n.t(
      disabled ? "warningEnableFor" : "warningDisableFor",
      { product: `${productName} (${islandId})` },
    ));
    checkbox.addEventListener("change", () => {
      checkbox.disabled = true;
      updateSuppression(islandId, productGuid, rule, checkbox.checked);
    });
    return checkbox;
  }

  function sortRows(rows) {
    return [...rows].sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === "islandName") {
        av = a.islandName || a.islandId;
        bv = b.islandName || b.islandId;
      } else if (sortKey === "raisedAt" || sortKey === "clearedAt") {
        av = av ? new Date(av).getTime() : null;
        bv = bv ? new Date(bv).getTime() : null;
      } else if (sortKey === "rule") {
        av = ruleLabel(av);
        bv = ruleLabel(bv);
      }
      if (av === null || bv === null) {
        if (av === bv) return 0;
        return av === null ? 1 : -1;
      }
      const result = typeof av === "string"
        ? av.localeCompare(bv, i18n.lang)
        : av - bv;
      return sortAscending ? result : -result;
    });
  }

  // row renders one alert. withSources makes the rule a button that opens
  // the possible production sources below the row.
  function row(alert, withSources = false) {
    const tr = document.createElement("tr");
    if (withSources) {
      const suppressionTd = document.createElement("td");
      suppressionTd.append(suppressionCheckbox(alert.islandId, alert.productGuid,
        alert.productName, "no_local_production",
        isSuppressed(alertSettings, alert.islandId, alert.productGuid, "no_local_production")));
      tr.append(suppressionTd);
    }

    const islandTd = document.createElement("td");
    const link = document.createElement("a");
    link.href = `#/island/${encodeURIComponent(alert.islandId)}`;
    link.textContent = alert.islandName || alert.islandId;
    islandTd.append(link);

    const productTd = document.createElement("td");
    const productLink = document.createElement("a");
    productLink.href = `#/island/${encodeURIComponent(alert.islandId)}/product/${encodeURIComponent(alert.productGuid)}`;
    productLink.textContent = alert.productName;
    productTd.append(productLink);

    const ruleTd = document.createElement("td");
    if (withSources) {
      const expanded = sources.isOpen(alert.islandId, alert.productGuid);
      const key = sources.keyOf(alert.islandId, alert.productGuid);
      const button = toggleButton(ruleLabel(alert.rule), expanded,
        () => sources.toggle(alert.islandId, alert.productGuid));
      button.setAttribute("data-key", key);
      ruleTd.append(button);
    } else {
      ruleTd.textContent = ruleLabel(alert.rule);
    }

    const detailTd = document.createElement("td");
    detailTd.textContent = alert.detail;

    const sinceTd = document.createElement("td");
    sinceTd.textContent = i18n.t("alertSince", { age: formatAge(Date.now() - new Date(alert.raisedAt).getTime()) });
    sinceTd.title = formatDateTime(alert.raisedAt);

    tr.append(islandTd, productTd, ruleTd, detailTd, sinceTd);

    if (showHistory) {
      const untilTd = document.createElement("td");
      if (alert.clearedAt) {
        untilTd.textContent = formatTime(alert.clearedAt);
        untilTd.title = formatDateTime(alert.clearedAt);
      } else {
        untilTd.textContent = i18n.t("alertActive");
        untilTd.className = "delta-negative";
      }
      tr.append(untilTd);
    }
    return tr;
  }

  function render() {
    heading.textContent = showHistory ? i18n.t("alertsHistoryHeading") : i18n.t("alertsHeading");
    toggle.href = showHistory ? "#/alerts" : "#/alerts?all=1";
    toggle.textContent = showHistory ? i18n.t("alertsShowActive") : i18n.t("alertsShowHistory");
    explain.textContent = i18n.t("alertsExplain");
    settingsSection.hidden = showHistory;
    settingsHeading.textContent = i18n.t("alertSettingsHeading");
    deficitLabelText.textContent = i18n.t("deficitThresholdLabel");
    dropLabelText.textContent = i18n.t("dropThresholdLabel");
    saveSettings.textContent = i18n.t("saveAlertSettings");
    settingsMessage.textContent = settingsError
      ? `${i18n.t("alertSettingsError")} ${settingsError}`
      : settingsSaved ? i18n.t("alertSettingsSaved") : "";
    settingsMessage.className = settingsError ? "error-line" : "muted";

    const rows = sortRows(
      (showHistory ? history : store.alerts.filter(isWarning))
        .filter((alert) => selectedIslands.has(alert.islandId)),
    );
    headerRow(thead);
    tbody.replaceChildren();
    for (const alert of rows) tbody.append(row(alert));

    const imports = sortRows(showHistory ? [] : store.alerts.filter((a) =>
      !isWarning(a) && selectedIslands.has(a.islandId)));
    importsSection.hidden = imports.length === 0 && alertSettings.suppressions.length === 0;
    importsHeading.textContent = `${i18n.t("importsHeading")} (${imports.length})`;
    importsExplain.textContent = i18n.t("importsExplain");
    headerRow(importsThead);
    // Opening an entry re-renders, and so does its answer: the focus goes
    // back to the button that had it (as in the goods table).
    const focused = document.activeElement?.className?.includes?.("sources-toggle")
      ? document.activeElement.getAttribute("data-key") : null;
    importsTbody.replaceChildren();
    sources.closeAllBut(new Set(imports.map((a) => sources.keyOf(a.islandId, a.productGuid))));
    for (const alert of imports) {
      importsTbody.append(row(alert, true));
      if (sources.isOpen(alert.islandId, alert.productGuid)) {
        importsTbody.append(detailRow(sources.panel(alert.islandId, alert.productGuid), columns().length + 1));
      }
    }
    disabledSection.hidden = showHistory;
    disabledHeading.textContent = i18n.t("disabledWarningsHeading");
    disabledHeader();
    disabledTbody.replaceChildren();
    for (const suppression of alertSettings.suppressions) {
      const tr = document.createElement("tr");
      const checkboxTd = document.createElement("td");
      checkboxTd.append(suppressionCheckbox(
        suppression.islandId,
        suppression.productGuid,
        suppression.productName,
        suppression.rule,
        true,
      ));
      const islandTd = document.createElement("td");
      islandTd.textContent = suppression.islandName || suppression.islandId;
      const productTd = document.createElement("td");
      productTd.textContent = suppression.productName;
      const ruleTd = document.createElement("td");
      ruleTd.textContent = ruleLabel(suppression.rule);
      tr.append(checkboxTd, islandTd, productTd, ruleTd);
      disabledTbody.append(tr);
    }
    disabledSection.hidden = showHistory || alertSettings.suppressions.length === 0;
    // Without preventScroll the browser scrolls the rebuilt button into
    // view, which drags a wide table sideways under the thumb that tapped it.
    if (focused !== null) {
      [...importsTbody.querySelectorAll(".sources-toggle")]
        .find((b) => b.getAttribute("data-key") === focused)?.focus({ preventScroll: true });
    }

    if (historyError) {
      message.textContent = `${i18n.t("errorPrefix")} ${historyError}`;
      message.className = "error-line";
    } else if (selectedIslands.size === 0) {
      message.textContent = i18n.t("noIslandsSelected");
      message.className = "muted";
    } else if (rows.length === 0) {
      message.textContent = showHistory ? i18n.t("alertsHistoryEmpty") : i18n.t("alertsNone");
      message.className = "muted";
    } else {
      message.textContent = "";
    }
    table.hidden = rows.length === 0;
  }

  const updatePicker = createIslandPicker(toolbar, pickerStore, selectedIslands, render);
  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const deficit = deficitInput.valueAsNumber;
    const drop = dropInput.valueAsNumber;
    if (!Number.isFinite(deficit) || deficit > 0 || !Number.isFinite(drop) || drop <= 0) {
      settingsError = i18n.t("alertSettingsInvalid");
      settingsSaved = false;
      render();
      return;
    }
    try {
      alertSettings = await api.setAlertThresholds(deficit, drop);
      settingsError = "";
      settingsSaved = true;
      document.dispatchEvent(new CustomEvent("tabularium-alert-settings-changed", { detail: alertSettings }));
    } catch (err) {
      settingsError = err instanceof Error ? err.message : String(err);
      settingsSaved = false;
    }
    render();
  });
  render();

  const onAlerts = () => {
    if (!showHistory) render();
  };
  const onLang = () => {
    render();
    updatePicker();
    sources.refresh();
  };
  const onAlertSettings = (event) => {
    const thresholdsChanged = event.detail.deficitThreshold !== alertSettings.deficitThreshold
      || event.detail.dropPercentagePoints !== alertSettings.dropPercentagePoints;
    alertSettings = event.detail;
    if (thresholdsChanged) syncThresholdInputs();
    render();
  };
  const onIslandsChanged = () => {
    updatePicker();
    render();
  };
  // Any island's snapshot may complete the tick the sources come from.
  const onSnapshot = () => sources.refresh();
  document.addEventListener("tabularium-alerts-changed", onAlerts);
  document.addEventListener("tabularium-islands-changed", onIslandsChanged);
  document.addEventListener("tabularium-lang-changed", onLang);
  document.addEventListener("tabularium-alert-settings-changed", onAlertSettings);
  document.addEventListener("tabularium-snapshot", onSnapshot);

  return () => {
    sources.dispose();
    document.removeEventListener("tabularium-alerts-changed", onAlerts);
    document.removeEventListener("tabularium-islands-changed", onIslandsChanged);
    document.removeEventListener("tabularium-lang-changed", onLang);
    document.removeEventListener("tabularium-alert-settings-changed", onAlertSettings);
    document.removeEventListener("tabularium-snapshot", onSnapshot);
  };
}
