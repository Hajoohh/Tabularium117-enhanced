import { i18n } from "./i18n.js";

export function validateGoodsChains(config) {
  const invalid = (path) => new Error(`Invalid goods-chain configuration at ${path}`);
  if (!config || typeof config !== "object" || !config.regions || typeof config.regions !== "object"
      || Array.isArray(config.regions)) {
    throw invalid("regions");
  }
  for (const [region, chains] of Object.entries(config.regions)) {
    if (!Array.isArray(chains)) throw invalid(`regions.${region}`);
    for (const [chainIndex, chain] of chains.entries()) {
      const path = `regions.${region}[${chainIndex}]`;
      if (!chain || typeof chain !== "object" || !Array.isArray(chain.stages) || chain.stages.length === 0) {
        throw invalid(`${path}.stages`);
      }
      if (chain.product) {
        const good = chain.product;
        if (!good || typeof good !== "object" || !Number.isInteger(good.guid)
            || !good.name || typeof good.name !== "object"
            || !(good.name.en || good.name.de)) {
          throw invalid(`${path}.product`);
        }
      }
      for (const [stageIndex, stage] of chain.stages.entries()) {
        const stagePath = `${path}.stages[${stageIndex}]`;
        if (!stage || typeof stage !== "object" || !Array.isArray(stage.inputs)
            || stage.inputs.length === 0 || !stage.output) {
          throw invalid(stagePath);
        }
        for (const good of [...stage.inputs, stage.output]) {
          if (!good || typeof good !== "object" || !Number.isInteger(good.guid)
              || !good.name || typeof good.name !== "object"
              || !(good.name.en || good.name.de)) {
            throw invalid(`${stagePath}.goods`);
          }
        }
      }
    }
  }
  return config;
}

export function validateGoodsIcons(config) {
  if (!config || typeof config !== "object" || !config.icons || typeof config.icons !== "object"
      || Array.isArray(config.icons)) {
    throw new Error("Invalid goods-icon configuration at icons");
  }
  for (const [guid, url] of Object.entries(config.icons)) {
    if (!/^\d+$/.test(guid) || typeof url !== "string"
        || !/^\/production_goods\/[A-Za-z0-9._()-]+\.(?:png|webp)$/i.test(url)) {
      throw new Error(`Invalid goods-icon configuration for ${guid}`);
    }
  }
  return config.icons;
}

export function matchingGoodsChains(config, regions, guid) {
  if (!config) return [];
  const target = String(guid);
  return regions.flatMap((region) => (config.regions[region] || [])
    .filter((chain) => (chain.product && String(chain.product.guid) === target)
      || chain.stages.some((stage) => [...stage.inputs, stage.output]
        .some((good) => String(good.guid) === target)))
    .map((chain) => ({ region, chain })));
}

export function goodsChainsForRegions(config, regions) {
  if (!config) return [];
  return regions.flatMap((region) => (config.regions[region] || [])
    .map((chain) => ({ region, chain })));
}

export function activeGoodsChainsForIsland(config, region, products) {
  const productsByGuid = new Map(products.map((product) => [String(product.guid), product]));
  return goodsChainsForRegions(config, [region]).filter(({ chain }) => {
    const endProduct = chain.product || chain.stages[chain.stages.length - 1].output;
    return productsByGuid.get(String(endProduct.guid))?.buildings > 0;
  });
}

export function goodsCategoriesForRegions(config, regions) {
  const produced = new Set();
  const endProducts = new Set();
  for (const { chain } of goodsChainsForRegions(config, regions)) {
    const finalGood = chain.product || chain.stages[chain.stages.length - 1].output;
    endProducts.add(String(finalGood.guid));
    produced.add(String(finalGood.guid));
    for (const stage of chain.stages) {
      for (const good of [stage.output]) produced.add(String(good.guid));
    }
  }
  const categories = new Map();
  for (const guid of endProducts) categories.set(guid, "end");
  for (const guid of produced) {
    if (!categories.has(guid)) categories.set(guid, "intermediate");
  }
  return categories;
}

export function filterGoodsByCategories(goods, selectedCategories, categories) {
  if (selectedCategories.size === 0) return goods;
  return goods.filter((good) => selectedCategories.has(categories.get(String(good.guid)) || "raw"));
}

export function createGoodsCategoryFilters(onChange) {
  const container = document.createElement("div");
  container.className = "goods-category-filters";
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", i18n.t("goodsCategoryFiltersLabel"));
  const selected = new Set();
  const controls = [];
  for (const [category, label] of [
    ["raw", "rawMaterials"],
    ["intermediate", "intermediateProducts"],
    ["end", "endProducts"],
  ]) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", () => {
      if (input.checked) selected.add(category);
      else selected.delete(category);
      onChange(new Set(selected));
    });
    const text = document.createElement("label");
    text.className = "goods-category-toggle";
    text.append(input, document.createTextNode(i18n.t(label)));
    controls.push({ input, label, text });
    container.append(text);
  }
  return {
    element: container,
    selected: () => new Set(selected),
    reset() {
      selected.clear();
      for (const { input } of controls) input.checked = false;
    },
    updateLabels() {
      container.setAttribute("aria-label", i18n.t("goodsCategoryFiltersLabel"));
      for (const { input, label, text } of controls) {
        text.replaceChildren(input, document.createTextNode(i18n.t(label)));
      }
    },
  };
}

export function appendGoodsChainCards(container, entries, icons, selectedGuid, onSelect) {
  const localizedName = (good) => good.name[i18n.lang] || good.name.en || good.name.de;
  const list = document.createElement("div");
  list.className = "goods-chain-list";
  for (const { region, chain } of entries) {
    const section = document.createElement("section");
    section.className = "goods-chain";
    const title = document.createElement("strong");
    title.textContent = i18n.t("goodsChainFor", {
      product: localizedName(chain.product || chain.stages[chain.stages.length - 1].output),
    });
    section.append(title);
    const regionLabel = document.createElement("span");
    regionLabel.className = "goods-chain-region";
    regionLabel.textContent = region;
    section.append(regionLabel);
    for (const stage of chain.stages) {
      const step = document.createElement("div");
      step.className = "goods-chain-step";
      const appendGood = (good) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "goods-chain-good";
        if (String(good.guid) === String(selectedGuid)) button.classList.add("goods-chain-match");
        const iconUrl = icons?.[String(good.guid)];
        if (iconUrl) {
          const icon = document.createElement("img");
          icon.className = "goods-chain-icon";
          icon.src = iconUrl;
          icon.alt = "";
          icon.setAttribute("aria-hidden", "true");
          icon.loading = "lazy";
          button.append(icon);
        }
        const name = document.createElement("span");
        name.textContent = localizedName(good);
        button.append(name);
        button.addEventListener("click", () => onSelect(good));
        step.append(button);
      };
      stage.inputs.forEach((good, index) => {
        if (index > 0) step.append(document.createTextNode(" + "));
        appendGood(good);
      });
      step.append(document.createTextNode(" \u2192 "));
      appendGood(stage.output);
      section.append(step);
    }
    list.append(section);
  }
  container.replaceChildren(list);
}
