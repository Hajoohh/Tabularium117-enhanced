import { i18n } from "./i18n.js";

export function createIslandPicker(container, store, selected, onChange, allInitiallySelected = true) {
  const details = document.createElement("details");
  details.className = "island-picker";
  const summary = document.createElement("summary");
  const options = document.createElement("div");
  options.className = "island-picker-options";
  const actions = document.createElement("div");
  actions.className = "island-picker-actions";
  details.append(summary, actions, options);

  let includeNew = allInitiallySelected;
  let initialized = false;

  function update() {
    const islands = store.islands;
    const known = new Set(islands.map((island) => island.id));
    for (const id of selected) {
      if (!known.has(id)) selected.delete(id);
    }
    if (includeNew) {
      for (const island of islands) selected.add(island.id);
    }

    summary.textContent = i18n.t("islandSelectionSummary", {
      count: selected.size,
      total: islands.length,
    });
    options.replaceChildren();
    for (const island of islands) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(island.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selected.add(island.id);
        else selected.delete(island.id);
        includeNew = selected.size === store.islands.length;
        update();
        onChange();
      });
      label.append(checkbox, `${island.name} · ${island.sessionName}`);
      options.append(label);
    }
    actions.replaceChildren();
    for (const [key, value] of [["selectAllIslands", true], ["clearIslandSelection", false]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = i18n.t(key);
      button.addEventListener("click", () => {
        includeNew = value;
        selected.clear();
        if (value) for (const island of store.islands) selected.add(island.id);
        update();
        onChange();
      });
      actions.append(button);
    }
    if (!initialized) {
      details.open = selected.size < islands.length;
      initialized = true;
    }
  }

  container.append(details);
  update();
  return update;
}
