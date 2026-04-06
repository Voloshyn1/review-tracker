// main.ts
import {
  Plugin,
  TFile,
  WorkspaceLeaf,
  ItemView,
  moment,
  addIcon,
  Events,
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  ReviewTrackerSettings,
  ReviewTrackerSettingTab,
} from "./settings";
import { StatsModal } from "./stats-modal";
import { FM_DATE_FORMATS } from "./data-utils";

const VIEW_TYPE = "review-tracker-view";

export default class ReviewTrackerPlugin extends Plugin {
  settings: ReviewTrackerSettings;
  ribbonIconEl: HTMLElement | null = null;
  readStatus: Set<string> = new Set();
  folders: { name: string; files: string[]; collapsed?: boolean }[] = [];
  reviewStats: Record<string, { customIntervals: number[] }> = {};
  emitter: Events = new Events();


  async onload() {
    await this.loadSettings();

    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {

        const oldPrefix = `${oldPath}:::`;
        const updatedStatus = new Set<string>();
        for (const key of this.readStatus) {
          if (key.startsWith(oldPrefix)) {
            const interval = key.split(":::")[1];
            updatedStatus.add(`${file.path}:::${interval}`);
          } else {
            updatedStatus.add(key);
          }
        }


        for (const folder of this.settings.folders) {
          folder.files = folder.files.map(p => p === oldPath ? file.path : p);
        }

        this.readStatus = updatedStatus;
        await this.saveSettings();
      })
    );



    this.readStatus = new Set((await this.loadData())?.readStatus || []);

    addIcon("repeat-custom", `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-2.05-4.95L15 10h6V4l-2.59 2.59A8.962 8.962 0 0 0 12 3z" fill="currentColor"/>
      </svg>
    `);

    this.ribbonIconEl = this.addRibbonIcon("repeat-custom", "Review Tracker", () => {
      this.toggleView();
    });

    this.addCommand({
      id: "toggle-view",
      name: "Toggle view",
      callback: () => {
        this.toggleView();
      },
    });

    this.addSettingTab(new ReviewTrackerSettingTab(this.app, this));
    this.registerView(VIEW_TYPE, (leaf) => new ReviewTrackerView(leaf, this));
  }

  onunload() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => leaf.detach());
    this.ribbonIconEl?.remove();
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await rightLeaf.setViewState({
        type: VIEW_TYPE,
        active: true,
      });
      leaf = rightLeaf;
    }

    workspace.revealLeaf(leaf);
  }

  async toggleView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length > 0) {
      leaves.forEach((leaf) => leaf.detach());
    } else {
      await this.activateView();
    }
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    this.readStatus = new Set(data?.readStatus || []);
    this.settings.folders = data?.folders || [];

  }

  async saveSettings() {
    await this.saveData({
      ...this.settings,
      readStatus: Array.from(this.readStatus),
      folders: this.settings.folders || []

    });
    this.emitter.trigger("rr:refresh");
  }

}

class ReviewTrackerView extends ItemView {
  plugin: ReviewTrackerPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: ReviewTrackerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Notes scheduled for review";
  }

    async onOpen() {
      const container = this.containerEl.children[1];
      container.empty();


    const statsButton = container.createEl("button", { text: "Statistics", cls: "repeat-refresh-button" });

    statsButton.addEventListener("click", (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.blur();                                     
      this.app.workspace.containerEl.focus();         
      setTimeout(() => new StatsModal(this.app, this.plugin).open(), 0);  
    });

    const refreshButton = container.createEl("button", { text: "Refresh", cls: "repeat-refresh-button" });
    refreshButton.onclick = () => this.render();
    refreshButton.addEventListener("click", (e) => (e.currentTarget as HTMLButtonElement).blur());

    this.registerEvent(this.app.vault.on("create", () => this.render()));
    this.registerEvent(this.app.vault.on("modify", () => this.render()));
    this.registerEvent(this.app.vault.on("delete", () => this.render()));
    this.registerEvent(this.app.vault.on("rename", () => this.render()));

    this.registerEvent(this.app.metadataCache.on("changed", () => this.render()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.render()));


    this.registerEvent(this.plugin.emitter.on("rr:refresh", () => this.render()));


    this.registerEvent(this.app.workspace.on("file-open", () => this.render()));



    await this.render();
  }

  async render() {
    const container = this.containerEl.children[1];
    container.querySelectorAll(".repeat-content").forEach(el => el.remove());

    const { tag, intervals } = this.plugin.settings;
    const now = window.moment();
    const files = this.app.vault.getMarkdownFiles();
    const toReview: { [key: number]: TFile[] } = {};

    intervals.forEach((day) => (toReview[day] = []));

    for (const file of files) {
      const cache = this.app.metadataCache.getCache(file.path);
      const frontmatter = cache?.frontmatter;
      if (!frontmatter) continue;

      const tagKeyword = tag.replace("#", "");
      const hasKeyword = Object.entries(frontmatter).some(([key, value]) => {
        const keyMatch = key.includes(tagKeyword);
        const valueMatch = typeof value === "string" && value.includes(tagKeyword) ||
          Array.isArray(value) && value.some(v => typeof v === "string" && v.includes(tagKeyword));
        return keyMatch || valueMatch;
      });

      if (!hasKeyword) continue;

    let foundDate: moment.Moment | null = null;

    for (const key in frontmatter) {
      const value = frontmatter[key];
      if (typeof value === "string") {
        const m = moment(value, FM_DATE_FORMATS, true); 
        if (m.isValid()) { foundDate = m; break; }
      }
    }
    if (!foundDate) continue;


      const daysSince = now.diff(foundDate, "days");

      for (const interval of intervals) {
        if (daysSince === interval) {
          toReview[interval].push(file);
        }
      }
    }

    const contentWrapper = container.createEl("div", { cls: "repeat-content" });
    contentWrapper.createEl("h2", { text: "Notes to review by age" });

    for (const interval of intervals) {
      const section = contentWrapper.createEl("div", { cls: "repeat-section" });
      section.createEl("h3", { text: `${interval} days old`, cls: "repeat-section-title" });

      const files = toReview[interval];
      if (files.length === 0) {
        section.createEl("p", { text: "No files to review.", cls: "repeat-empty" });
      } else {
        const ul = section.createEl("ul", { cls: "repeat-file-list" });
        for (const file of files) {
          const li = ul.createEl("li", { cls: "repeat-file-item" });

          const box = li.createEl("div", { cls: "repeat-status-box" });
          const statusKey = `${file.path}:::${interval}`;
          if (this.plugin.readStatus.has(statusKey)) box.classList.add("read");

          box.onclick = () => {
            const isRead = this.plugin.readStatus.has(statusKey);
            if (isRead) {
              this.plugin.readStatus.delete(statusKey);
              box.classList.remove("read");
            } else {
              this.plugin.readStatus.add(statusKey);
              box.classList.add("read");
            }
            this.plugin.saveSettings();
          };

          const link = li.createEl("a", {
            text: file.basename,
            href: `#${file.path}`,
            cls: "repeat-file-link"
          });
          link.onclick = (e) => {
            e.preventDefault();
            this.app.workspace.openLinkText(file.path, file.path);
          };
        }
      }
    }
  }

  async onClose() {

  }
}
