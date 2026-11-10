import { i18n } from "./i18n.js";

export function validateGoodsChains(config) {
  const invalid = (path) => new Error(`Invalid goods-chain configuration at ${path}`);
  if (!config || typeof config !== "object" || !config.regions || typeof config.regions !== "object"
      || Array.isArray(config.regions)) {
    throw invalid("regions");
  }
  if (config.endProducts !== undefined
      && (!Array.isArray(config.endProducts) || config.endProducts.some((guid) => !Number.isInteger(guid)))) {
    throw invalid("endProducts");
  }
  if (config.producedGoods !== undefined
      && (!Array.isArray(config.producedGoods) || config.producedGoods.some((guid) => !Number.isInteger(guid)))) {
    throw invalid("producedGoods");
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
        if (!good || typeof good !== "object" || !Number.isInteger(good.guid)) {
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
          if (!good || typeof good !== "object" || !Number.isInteger(good.guid)) {
            throw invalid(`${stagePath}.goods`);
          }
        }
      }
    }
  }
  return config;
}

export function createGoodsChainsLoader(fetchConfig, fetchNames) {
  let config = null;
  let pending = null;

  return {
    load() {
      if (config) return Promise.resolve(config);
      if (!pending) {
        // Share concurrent reads, but only cache validated data so a failed
        // request can be retried by the next caller.
        pending = Promise.resolve()
          .then(fetchConfig)
          .then(validateGoodsChains)
          .then(async (validated) => {
            if (!fetchNames) return validated;
            const goods = new Map();
            for (const { chain } of goodsChainsForRegions(validated, Object.keys(validated.regions))) {
              for (const good of [
                ...(chain.product ? [chain.product] : []),
                ...chain.stages.flatMap((stage) => [...stage.inputs, stage.output]),
              ]) {
                const guid = String(good.guid);
                if (!goods.has(guid)) goods.set(guid, []);
                goods.get(guid).push(good);
              }
            }
            const names = await fetchNames([...goods.keys()], validated);
            if (!names || typeof names !== "object" || Array.isArray(names)) {
              throw new Error("Invalid product-name catalog response");
            }
            for (const [guid, occurrences] of goods) {
              const localized = names[guid];
              if (!localized || typeof localized !== "object" || Array.isArray(localized)
                  || !Object.values(localized).some((name) => typeof name === "string" && name !== "")) {
                throw new Error(`Product ${guid} is missing from the catalog response`);
              }
              for (const good of occurrences) good.name = localized;
            }
            return validated;
          })
          .then((validated) => {
            config = validated;
            return config;
          })
          .finally(() => {
            pending = null;
          });
      }
      return pending;
    },
  };
}

export function validateGoodsIcons(config) {
  if (!config || typeof config !== "object" || !config.icons || typeof config.icons !== "object"
      || Array.isArray(config.icons)) {
    throw new Error("Invalid goods-icon configuration at icons");
  }
  const iconURLs = {};
  for (const [guid, entry] of Object.entries(config.icons)) {
    if (!/^\d+$/.test(guid) || !entry || typeof entry !== "object" || Array.isArray(entry)
        || typeof entry.icon !== "string"
        || !/^\/production_goods\/[A-Za-z0-9._()-]+\.(?:png|webp)$/i.test(entry.icon)
        || !entry.names || typeof entry.names !== "object" || Array.isArray(entry.names)
        || typeof entry.names.english !== "string" || entry.names.english === ""
        || typeof entry.names.german !== "string" || entry.names.german === "") {
      throw new Error(`Invalid goods-icon configuration for ${guid}`);
    }
    iconURLs[guid] = entry.icon;
  }
  return iconURLs;
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
    // A chain is active on this island only when it has buildings for the
    // chain's declared end product, not merely one of its intermediate goods.
    const endProduct = chain.product || chain.stages[chain.stages.length - 1].output;
    return productsByGuid.get(String(endProduct.guid))?.buildings > 0;
  });
}

export function goodsCategories(config) {
  const produced = new Set((config?.producedGoods || []).map(String));
  const endProducts = new Set((config?.endProducts || []).map(String));
  for (const { chain } of goodsChainsForRegions(config, Object.keys(config?.regions || {}))) {
    const finalGood = chain.product || chain.stages[chain.stages.length - 1].output;
    produced.add(String(finalGood.guid));
    // Stage outputs are produced goods; chain inputs without any production
    // stage remain raw materials when categories are assigned below.
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

export function goodsName(good) {
  const names = good.name || {};
  return names[i18n.apiLang()] || names[i18n.lang] || names.english
    || names.en || names.de || `#${good.guid}`;
}

export function filterGoodsByCategories(goods, selectedCategories, categories) {
  // An empty selection intentionally means no category filtering.
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
  const list = document.createElement("div");
  list.className = "goods-chain-list";
  for (const { region, chain } of entries) {
    const section = document.createElement("section");
    section.className = "goods-chain";
    const title = document.createElement("strong");
    title.textContent = i18n.t("goodsChainFor", {
      product: goodsName(chain.product || chain.stages[chain.stages.length - 1].output),
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
        name.textContent = goodsName(good);
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
