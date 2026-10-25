import { i18n } from "./i18n.js";

export function createRegionGroup(sessionGuid, sessionName, collapsed, onToggle) {
  const item = document.createElement("li");
  item.className = "session-group";
  const heading = document.createElement("h3");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "region-toggle";
  const link = document.createElement("a");
  link.href = `#/region/${encodeURIComponent(sessionGuid)}`;
  link.textContent = sessionName;
  const islands = document.createElement("ul");
  islands.className = "region-islands";
  item.append(heading, islands);
  heading.append(toggle, link);

  let isCollapsed = collapsed;
  function update() {
    islands.hidden = isCollapsed;
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
    toggle.setAttribute(
      "aria-label",
      i18n.t(isCollapsed ? "expandRegion" : "collapseRegion", { region: sessionName }),
    );
  }
  toggle.addEventListener("click", () => {
    isCollapsed = !isCollapsed;
    update();
    onToggle(isCollapsed);
  });
  update();
  return { item, islands };
}
