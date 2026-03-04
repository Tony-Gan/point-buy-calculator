const PointBuyCalculatorBase = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);

class PointBuyCalculator extends PointBuyCalculatorBase {
  constructor(options = {}) {
    super(options);
    this.resetData();
    this.activeTab = "calculator";
    this.validatorResult = "";
  }

  async close(options = {}) {
    const closed = await super.close(options);
    ui.controls?.render?.();
    return closed;
  }

  static DEFAULT_OPTIONS = {
    id: "point-buy-calculator",
    classes: ["point-buy-calculator"],
    position: { width: 400, height: "auto" },
    window: {
      title: "购点工具箱",
      icon: "fas fa-calculator",
      resizable: false
    }
  };

  static PARTS = {
    main: { template: "modules/point-buy-calculator/templates/point-buy-window.html" }
  };

  resetData() {
    let maxStat = 15;
    let totalPoints = 27;

    try {
      maxStat = Number(game.settings.get("point-buy-calculator", "maxStat"));
    } catch (_err) {}

    try {
      totalPoints = Number(game.settings.get("point-buy-calculator", "totalPoints"));
    } catch (_err) {}

    if (!Number.isFinite(maxStat)) maxStat = 15;
    if (!Number.isFinite(totalPoints)) totalPoints = 27;

    maxStat = Math.min(18, Math.max(8, Math.round(maxStat)));
    totalPoints = Math.min(50, Math.max(0, Math.round(totalPoints)));

    this.data = {
      maxStat: maxStat,
      totalPoints: totalPoints,
      remainingPoints: totalPoints,
      stats: {
        str: 8,
        dex: 8,
        con: 8,
        int: 8,
        wis: 8,
        cha: 8
      }
    };
  }

  async _prepareContext(_options) {
    const ownedCharacters = game.actors.filter(actor =>
      actor.type === "character" && (game.user.isGM || actor.isOwner)
    );

    return {
      data: this.data,
      statLabels: {
        str: "力量[STR]",
        dex: "敏捷[DEX]",
        con: "体质[CON]",
        int: "智力[INT]",
        wis: "感知[WIS]",
        cha: "魅力[CHA]"
      },
      ownedCharacters: ownedCharacters,
      canShowValidator: game.user.isGM
    };
  }

  _requestAutoSize() {
    if (!this.rendered) return;
    requestAnimationFrame(() => {
      try {
        this.setPosition({ height: "auto" });
      } catch (_err) {}
    });
  }

  calculateStatCost(value) {
    if (value <= 8) return 0;
    if (value <= 13) return value - 8;
    if (value <= 15) return 5 + (value - 13) * 2;
    if (value <= 17) return 9 + (value - 15) * 3;
    if (value === 18) return 19;
    return 19;
  }

  calculateTotalCost() {
    let total = 0;
    for (let stat in this.data.stats) {
      total += this.calculateStatCost(this.data.stats[stat]);
    }
    return total;
  }

  updateRemainingPoints() {
    const totalCost = this.calculateTotalCost();
    this.data.remainingPoints = this.data.totalPoints - totalCost;

    if (!this.rendered) return;

    const remainingPointsElement = this.element.querySelector("#remaining-points");
    if (remainingPointsElement) {
      if (remainingPointsElement instanceof HTMLInputElement) {
        remainingPointsElement.value = this.data.remainingPoints;
      } else {
        remainingPointsElement.textContent = this.data.remainingPoints;
      }
    }

    const applyButton = this.element.querySelector("#apply-stats");
    if (applyButton) {
      if (this.data.remainingPoints < 0) {
        applyButton.disabled = true;
        applyButton.classList.add("disabled");
      } else {
        applyButton.disabled = false;
        applyButton.classList.remove("disabled");
      }
    }
  }

  reRender() {
    this.resetData();
    this.render({ force: true });
  }

  populateCharacterDropdown(html, selector = "#character-select") {
    const dropdown = html.querySelector(selector);
    if (!dropdown) return;

    const ownedCharacters = game.actors.filter(actor =>
      actor.type === "character" && (game.user.isGM || actor.isOwner)
    );

    dropdown.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "-- 请选择角色 --";
    dropdown.appendChild(placeholder);

    ownedCharacters.forEach(actor => {
      const option = document.createElement("option");
      option.value = actor.id;
      option.textContent = actor.name;
      dropdown.appendChild(option);
    });
  }

  checkCharacterHasDefaultStats(actor) {
    const abilities = actor.system.abilities;
    const stats = ["str", "dex", "con", "int", "wis", "cha"];

    return stats.every(stat => abilities[stat].value === 10);
  }

  async applyStatsToCharacter(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) {
      ui.notifications.error("找不到指定的角色！");
      return;
    }
    try {
      const abilities = ["str", "dex", "con", "int", "wis", "cha"];

      const backgroundItem = actor.items?.find(i => i.type === "background");
      const backgroundAdv = this._getAbilityDeltasFromAdvancements(backgroundItem);

      const featAdv = this._emptyAbilityMap();
      const featItems = actor.items?.filter(i => i.type === "feat") ?? [];
      featItems.forEach((it) => {
        this._addAbilityMap(featAdv, this._getAbilityDeltasFromAdvancements(it));
      });

      const effectBuckets = this._getEffectAbilityDeltasByBucket(actor);
      const otherAdv = this._getOtherAbilityDeltasFromAdvancements(actor);

      const updateData = {};
      for (const k of abilities) {
        const desiredPointBuy = Number(this.data.stats?.[k] ?? 8);

        const current = Number(actor.system?.abilities?.[k]?.value ?? 0);
        const source = Number(actor._source?.system?.abilities?.[k]?.value ?? current);

        const backgroundEffect = effectBuckets.background[k] ?? 0;
        const featEffect = effectBuckets.feat[k] ?? 0;
        const otherEffect = effectBuckets.other[k] ?? 0;
        const totalEffectDelta = current - source;

        const background = (backgroundAdv[k] ?? 0) + backgroundEffect;
        const feat = (featAdv[k] ?? 0) + featEffect;

        const accountedEffect = backgroundEffect + featEffect + otherEffect;
        const remainderEffect = totalEffectDelta - accountedEffect;
        const other = (otherAdv[k] ?? 0) + otherEffect + remainderEffect;

        const pointBuy = current - background - feat - other;
        const targetSource = source + (desiredPointBuy - pointBuy);

        updateData[`system.abilities.${k}.value`] = Number.isFinite(targetSource) ? Math.round(targetSource) : desiredPointBuy;
      }

      await actor.update(updateData);

      ui.notifications.info(`属性已成功应用到角色 "${actor.name}"！`);

    } catch (error) {
      console.error("应用属性时发生错误:", error);
      ui.notifications.error("应用属性失败，请检查控制台错误信息。");
    }
  }

  applyTabState(htmlElement) {
    if (!game.user.isGM) this.activeTab = "calculator";
    const tabs = htmlElement.querySelectorAll(".point-buy-tab");
    const panels = htmlElement.querySelectorAll(".point-buy-tab-panel");

    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === this.activeTab);
      tab.setAttribute("aria-selected", String(tab.dataset.tab === this.activeTab));
    });

    panels.forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.tab === this.activeTab);
    });
  }

  activateTab(tabId, htmlElement) {
    this.activeTab = tabId;
    this.applyTabState(htmlElement);
    this._requestAutoSize();
  }

  _emptyAbilityMap() {
    return { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  }

  _addAbilityMap(target, add) {
    if (!add) return;
    for (const k of Object.keys(target)) {
      target[k] += Number(add?.[k] ?? 0) || 0;
    }
  }

  _getItemAdvancements(item) {
    const adv = item?.advancement;
    if (adv?.contents) return Array.from(adv.contents);
    if (adv?.byId instanceof Map) return Array.from(adv.byId.values());
    if (adv?.byId && typeof adv.byId === "object") return Object.values(adv.byId);

    const sysAdv = item?.system?.advancement;
    if (Array.isArray(sysAdv)) return sysAdv;
    if (sysAdv?.byId instanceof Map) return Array.from(sysAdv.byId.values());
    if (sysAdv?.byId && typeof sysAdv.byId === "object") return Object.values(sysAdv.byId);
    if (sysAdv && typeof sysAdv === "object") return Object.values(sysAdv);

    return [];
  }

  _getAbilityDeltasFromAdvancements(item) {
    const totals = this._emptyAbilityMap();
    if (!item) return totals;

    const advancements = this._getItemAdvancements(item);
    for (const adv of advancements) {
      const value = adv?.value ?? adv?.system?.value ?? adv?.data?.value ?? null;
      const changeType = value?.type ?? value?.data?.type ?? null;
      if (changeType !== "asi") continue;

      const assignments = value?.assignments ?? value?.data?.assignments ?? adv?.assignments ?? null;
      if (!assignments || typeof assignments !== "object") continue;

      for (const [ability, delta] of Object.entries(assignments)) {
        if (!(ability in totals)) continue;
        totals[ability] += Number(delta) || 0;
      }
    }

    return totals;
  }

  _getOtherAbilityDeltasFromAdvancements(actor) {
    const totals = this._emptyAbilityMap();
    const items = actor?.items ?? [];
    for (const item of items) {
      if (item?.type === "background") continue;
      if (item?.type === "feat") continue;
      this._addAbilityMap(totals, this._getAbilityDeltasFromAdvancements(item));
    }
    return totals;
  }

  _getOriginItemFromEffect(effect, actor) {
    const origin = effect?.origin ?? effect?.system?.origin;
    if (!origin) return null;
    const m = origin.match(/\.Item\.([^.]+)(?:\.|$)/);
    const itemId = m?.[1];
    if (!itemId) return null;
    return actor?.items?.get?.(itemId) ?? null;
  }

  _getEffectAbilityDeltasByBucket(actor) {
    const out = {
      background: this._emptyAbilityMap(),
      feat: this._emptyAbilityMap(),
      other: this._emptyAbilityMap()
    };

    const effects = actor?.appliedEffects ?? actor?.effects ?? [];
    const ADD = CONST?.ACTIVE_EFFECT_MODES?.ADD ?? 2;

    for (const effect of effects) {
      if (effect?.disabled || effect?.system?.disabled) continue;

      const originItem = this._getOriginItemFromEffect(effect, actor);
      let bucket = "other";
      if (originItem?.type === "background") bucket = "background";
      else if (originItem?.type === "feat") bucket = "feat";

      const changes = effect?.changes ?? effect?.system?.changes ?? [];
      for (const ch of changes) {
        const key = ch?.key ?? ch?.system?.key;
        if (!key) continue;

        const km = String(key).match(/^system\.abilities\.(str|dex|con|int|wis|cha)\.value$/);
        if (!km) continue;

        const mode = Number(ch?.mode ?? ch?.system?.mode);
        if (mode !== ADD) continue;

        const delta = Number(ch?.value ?? ch?.system?.value);
        if (!Number.isFinite(delta)) continue;

        out[bucket][km[1]] += delta;
      }
    }

    return out;
  }

  handleValidatePoints() {
    const dropdown = this.element.querySelector("#validator-character-select");
    const selectedActorId = dropdown?.value;

    const output = this.element.querySelector("#validator-output");
    if (!output) return;

    const breakdown = output.querySelector(".validator-breakdown");
    const result = output.querySelector(".validator-result");
    if (!breakdown || !result) return;

    result.classList.remove("success", "info", "error");

    if (!selectedActorId) {
      ui.notifications.warn("请先选择一个角色！");
      breakdown.textContent = "";
      result.textContent = "请先选择一个角色。";
      result.classList.add("error");
      return;
    }

    const actor = game.actors.get(selectedActorId);
    if (!actor) {
      breakdown.textContent = "";
      result.textContent = "找不到指定的角色。";
      result.classList.add("error");
      return;
    }

    const abilities = ["str", "dex", "con", "int", "wis", "cha"];
    const labels = {
      str: "力量[STR]",
      dex: "敏捷[DEX]",
      con: "体质[CON]",
      int: "智力[INT]",
      wis: "感知[WIS]",
      cha: "魅力[CHA]"
    };

    const backgroundItem = actor.items?.find(i => i.type === "background");
    const backgroundAdv = this._getAbilityDeltasFromAdvancements(backgroundItem);

    const featAdv = this._emptyAbilityMap();
    const featItems = actor.items?.filter(i => i.type === "feat") ?? [];
    featItems.forEach((it) => {
      this._addAbilityMap(featAdv, this._getAbilityDeltasFromAdvancements(it));
    });

    const effectBuckets = this._getEffectAbilityDeltasByBucket(actor);
    const otherAdv = this._getOtherAbilityDeltasFromAdvancements(actor);

    const rows = abilities.map((k) => {
      const current = Number(actor.system?.abilities?.[k]?.value ?? 0);
      const source = Number(actor._source?.system?.abilities?.[k]?.value ?? current);

      const backgroundEffect = effectBuckets.background[k] ?? 0;
      const featEffect = effectBuckets.feat[k] ?? 0;
      const otherEffect = effectBuckets.other[k] ?? 0;
      const totalEffectDelta = current - source;

      const background = (backgroundAdv[k] ?? 0) + backgroundEffect;
      const feat = (featAdv[k] ?? 0) + featEffect;

      const accountedEffect = backgroundEffect + featEffect + otherEffect;
      const remainderEffect = totalEffectDelta - accountedEffect;
      const other = (otherAdv[k] ?? 0) + otherEffect + remainderEffect;

      const pointBuy = current - background - feat - other;

      return {
        label: labels[k] ?? k.toUpperCase(),
        key: k,
        pointBuy,
        background,
        feat,
        other
      };
    });

    const tableHtml = `
      <table class="validator-table">
        <thead>
          <tr>
            <th></th>
            <th>购点</th>
            <th>背景</th>
            <th>专长</th>
            <th>其他</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <th scope="row">${r.label}</th>
              <td>${r.pointBuy}</td>
              <td>${r.background}</td>
              <td>${r.feat}</td>
              <td>${r.other}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    breakdown.innerHTML = tableHtml;

    const maxStat = Number(this.data.maxStat) || 15;
    const totalPoints = Number(this.data.totalPoints) || 27;

    for (const r of rows) {
      const pb = Number(r.pointBuy);
      if (!Number.isFinite(pb)) continue;

      if (pb > maxStat) {
        result.textContent = `验证未通过，当前${r.label}的购点值超过所允许的上限（${maxStat}）`;
        result.classList.add("error");
        this._requestAutoSize();
        return;
      }

      if (pb < 8) {
        result.textContent = `验证未通过，当前${r.label}的购点值小于8`;
        result.classList.add("error");
        this._requestAutoSize();
        return;
      }
    }

    const usedPoints = rows.reduce((sum, r) => sum + this.calculateStatCost(Number(r.pointBuy)), 0);

    if (usedPoints < totalPoints) {
      result.textContent = "验证通过，当前使用点数小于可用点数";
      result.classList.add("info");
    } else if (usedPoints > totalPoints) {
      result.textContent = "验证未通过，当前使用点数大于可用点数";
      result.classList.add("error");
    } else {
      result.textContent = "验证通过";
      result.classList.add("success");
    }

    this._requestAutoSize();
  }

  async handleApplyStats() {
    if (this.data.remainingPoints < 0) {
      ui.notifications.warn("当前剩余点数小于0，请重新分配点数");
      return;
    }

    const dropdown = this.element.querySelector("#character-select");
    const selectedActorId = dropdown?.value;

    if (!selectedActorId) {
      ui.notifications.warn("请先选择一个角色！");
      return;
    }

    const actor = game.actors.get(selectedActorId);
    const hasDefaultStats = this.checkCharacterHasDefaultStats(actor);

    let dialogTitle, dialogContent;

    if (hasDefaultStats) {
      dialogTitle = "确认应用";
      dialogContent = `<p>是否将当前属性应用到角色 "<strong>${actor.name}</strong>"？</p>`;

      if (this.data.remainingPoints > 0) {
        dialogContent += `<p style="color: #0066cc; font-weight: bold;">提示：当前剩余点数大于0（剩余 ${this.data.remainingPoints} 点）</p>`;
      }
    } else {
      dialogTitle = "属性覆盖确认";
      dialogContent = `<p>检测到角色 "<strong>${actor.name}</strong>" 的属性非默认值，是否覆盖？</p>`;

      if (this.data.remainingPoints > 0) {
        dialogContent += `<p style="color: #0066cc; font-weight: bold;">提示：当前剩余点数大于0（剩余 ${this.data.remainingPoints} 点）</p>`;
      }
    }

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: dialogTitle },
      content: dialogContent,
      modal: true,
      rejectClose: false
    });

    if (confirmed) {
      await this.applyStatsToCharacter(selectedActorId);
    }
  }

  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    if (partId !== "main") return;

    htmlElement.querySelectorAll(".stat-input").forEach((input) => {
      input.addEventListener("change", (event) => {
        const statName = event.target.dataset.stat;
        let value = parseInt(event.target.value);

        if (value < 8) value = 8;
        if (value > this.data.maxStat) value = this.data.maxStat;

        event.target.value = value;
        this.data.stats[statName] = value;
        this.updateRemainingPoints();
      });
    });

    htmlElement.querySelectorAll(".stat-adjust").forEach((button) => {
      button.addEventListener("click", (event) => {
        const btn = event.currentTarget;
        const statName = btn.dataset.stat;
        const adjustment = parseInt(btn.dataset.adjust);
        const input = htmlElement.querySelector(`input[data-stat="${statName}"]`);

        let newValue = this.data.stats[statName] + adjustment;

        if (newValue < 8) newValue = 8;
        if (newValue > this.data.maxStat) newValue = this.data.maxStat;

        this.data.stats[statName] = newValue;
        if (input) input.value = newValue;
        this.updateRemainingPoints();

        btn.blur();
      });
    });

    htmlElement.querySelector("#apply-stats")?.addEventListener("click", async (event) => {
      event.currentTarget.blur();
      await this.handleApplyStats();
    });

    htmlElement.querySelectorAll(".point-buy-tab")?.forEach((tab) => {
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        const tabId = event.currentTarget?.dataset?.tab;
        if (!tabId) return;
        this.activateTab(tabId, htmlElement);
      });
    });

    htmlElement.querySelector("#validate-points")?.addEventListener("click", (event) => {
      event.currentTarget.blur();
      this.handleValidatePoints();
    });

    this.populateCharacterDropdown(htmlElement, "#character-select");
    this.populateCharacterDropdown(htmlElement, "#validator-character-select");
    this.applyTabState(htmlElement);
    this.updateRemainingPoints();
    this._requestAutoSize();
  }
}

Hooks.once("init", () => {
  game.settings.register("point-buy-calculator", "maxStat", {
    name: "单属性最大值",
    hint: "购点计算器中单项属性允许的最大值",
    scope: "world",
    config: true,
    restricted: true,
    type: Number,
    default: 15,
    range: { min: 15, max: 18, step: 1 } 
  });

  game.settings.register("point-buy-calculator", "totalPoints", {
    name: "总点数",
    hint: "购点计算器中的总点数",
    scope: "world",
    config: true,
    restricted: true,
    type: Number,
    default: 27,
    range: { min: 27, max: 50, step: 1 }
  });

  game.settings.register("point-buy-calculator", "allowPlayers", {
    name: "允许玩家使用",
    hint: "是否允许玩家使用购点计算器",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.on("getSceneControlButtons", (controls) => {
  const allowPlayers = game.settings.get("point-buy-calculator", "allowPlayers");
  if (!game.user.isGM && !allowPlayers) return;

  const tokenControls = controls.tokens;
  if (!tokenControls) return;

  const TOOL_ID = "point-buy-calculator";
  const existing = foundry.applications.instances.get(TOOL_ID);
  const isActive = Boolean(existing?.rendered);

  tokenControls.tools ??= {};
  tokenControls.tools[TOOL_ID] = {
    name: TOOL_ID,
    title: "购点计算器",
    icon: "fas fa-calculator",
    order: Object.keys(tokenControls.tools).length,
    button: true,
    toggle: true,
    active: isActive,
    visible: true,
    onChange: async (_event, active) => {
      try {
        const app = foundry.applications.instances.get(TOOL_ID);
        if (active) {
          if (app) app.bringToFront?.();
          else new PointBuyCalculator().render({ force: true });
        } else {
          await app?.close?.();
        }
      } catch (err) {
        console.error("[point-buy-calculator] 打开/关闭失败", err);
        ui.notifications?.error?.("购点计算器打开失败：请查看 F12 控制台错误信息。");
      } finally {
        ui.controls?.render?.();
      }
    }
  };
});

Hooks.on("closePointBuyCalculator", () => {
  ui.controls?.render?.();
});
