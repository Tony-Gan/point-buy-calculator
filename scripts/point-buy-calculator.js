const PointBuyCalculatorBase = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);

class PointBuyCalculator extends PointBuyCalculatorBase {
  constructor(options = {}) {
    super(options);
    this.resetData();
  }

  static DEFAULT_OPTIONS = {
    id: "point-buy-calculator",
    classes: ["point-buy-calculator"],
    position: { width: 400, height: 540 },
    window: {
      title: "D&D 5E 购点计算器",
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

    maxStat = Math.min(20, Math.max(8, Math.round(maxStat)));
    totalPoints = Math.max(0, Math.round(totalPoints));

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
      actor.type === "character" && actor.isOwner
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
      ownedCharacters: ownedCharacters
    };
  }

  calculateStatCost(value) {
    if (value <= 8) return 0;
    if (value <= 13) return value - 8;
    return 5 + (value - 13) * 2;
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

  populateCharacterDropdown(html) {
    const dropdown = html.querySelector("#character-select");
    if (!dropdown) return;

    const ownedCharacters = game.actors.filter(actor =>
      actor.type === "character" && actor.isOwner
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

    return stats.every(stat => abilities[stat].value === 8);
  }

  async applyStatsToCharacter(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) {
      ui.notifications.error("找不到指定的角色！");
      return;
    }

    try {
      const updateData = {
        "system.abilities.str.value": this.data.stats.str,
        "system.abilities.dex.value": this.data.stats.dex,
        "system.abilities.con.value": this.data.stats.con,
        "system.abilities.int.value": this.data.stats.int,
        "system.abilities.wis.value": this.data.stats.wis,
        "system.abilities.cha.value": this.data.stats.cha
      };

      await actor.update(updateData);

      ui.notifications.info(`属性已成功应用到角色 "${actor.name}"！`);

    } catch (error) {
      console.error("应用属性时发生错误:", error);
      ui.notifications.error("应用属性失败，请检查控制台错误信息。");
    }
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

    this.populateCharacterDropdown(htmlElement);
    this.updateRemainingPoints();
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
    range: { min: 15, max: 24, step: 1 }
  });

  game.settings.register("point-buy-calculator", "totalPoints", {
    name: "总点数",
    hint: "购点计算器中的总点数",
    scope: "world",
    config: true,
    restricted: true,
    type: Number,
    default: 27,
    range: { min: 21, max: 35, step: 1 }
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
