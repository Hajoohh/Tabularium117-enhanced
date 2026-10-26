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
