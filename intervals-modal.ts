import { App, Modal, TFile } from "obsidian";
import type ReviewTrackerPlugin from "./main";
import { FM_DATE_FORMATS } from "./data-utils";

const DAY_MS = 24 * 60 * 60 * 1000;

export class IntervalsModal extends Modal {
  private plugin: ReviewTrackerPlugin;
  private file: TFile;
  private intervals: number[];
  private baseTs: number | null = null;

  private initialDone!: Set<number>;
  private draftDone!: Set<number>;
  private editing = false;
  private dirty = false;

  private progressEl!: HTMLDivElement;
  private actionsEl!: HTMLDivElement;
  private editBtn!: HTMLButtonElement;
  private saveBtn!: HTMLButtonElement;

  constructor(app: App, plugin: ReviewTrackerPlugin, file: TFile, intervals: number[]) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.intervals = dedupeAndSort(intervals);

    const nameNoExt = file.name.replace(/\.md$/i, "");
    this.setTitle(nameNoExt);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("rr-intervals-modal");
    this.modalEl.addClass("rr-intervals");


    this.baseTs = findFrontmatterStart(this.app, this.file.path);

    this.initialDone = new Set<number>();
    for (const d of this.intervals) {
      const key = `${this.file.path}:::${d}`;
      if (this.plugin.readStatus.has(key)) this.initialDone.add(d);
    }
    this.draftDone = new Set(this.initialDone);

    let _tomorrow: number | null = null;
    let createdUTC: number | null = null;
    let todayUTC: number | null = null;

    if (this.plugin.settings.highlightOneDayInStats || this.plugin.settings.highlightMissedIntervals) {
      const ts = (this.baseTs ?? this.file.stat.ctime) || 0;
      if (ts) {
        const c = new Date(ts), t = new Date();
        createdUTC = Date.UTC(c.getFullYear(), c.getMonth(), c.getDate());
        todayUTC   = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
        if (this.plugin.settings.highlightOneDayInStats) {
          const diff = Math.floor((todayUTC - createdUTC) / DAY_MS); // може бути < 0
          _tomorrow = diff >= 0 ? diff + 1 : null; // майбутні дати не підсвічуємо
        }
      }
    }

    const meta = contentEl.createEl("div", { cls: "rr-int-meta" });
    this.progressEl = meta.createEl("div", { cls: "rr-progress" });

    // хелпери для підсвіток
    const isMissed = (day: number) =>
      !!(this.plugin.settings.highlightMissedIntervals &&
        createdUTC != null && todayUTC != null &&
        (createdUTC + day * DAY_MS) < todayUTC);

    const isTomorrow = (day: number) =>
      !!(this.plugin.settings.highlightOneDayInStats &&
        _tomorrow != null && day === _tomorrow);

    const wrap = contentEl.createEl("div", { cls: "rr-pills-wrap" });
    for (const d of this.intervals) {
      const isDone = this.draftDone.has(d);

      // тултіп: календарна дата для інтервалу
      let tooltip = `${d}d`;
      if (this.baseTs != null) {
        const due = new Date(this.baseTs + d * DAY_MS);
        tooltip = formatDate(due);
      }

      const classes = ["pill", isDone ? "pill-done" : "pill-pending"];
      if (!isDone && isMissed(d))   classes.push("pill-missed");
      if (!isDone && isTomorrow(d)) classes.push("pill-tomorrow");

      const pill = wrap.createEl("span", {
        cls: classes.join(" "),
        text: `${d}d`,
      });
      pill.setAttr("data-days", String(d));
      pill.setAttr("aria-label", tooltip);


      pill.addEventListener("click", () => {
        if (!this.editing) return;
        const day = Number(pill.getAttr("data-days"));
        const wasDone = this.draftDone.has(day);

        if (wasDone) {

          this.draftDone.delete(day);
          pill.classList.remove("pill-done");
          pill.classList.add("pill-pending");
          pill.toggleClass("pill-missed",   isMissed(day));
          pill.toggleClass("pill-tomorrow", isTomorrow(day));
        } else {

          this.draftDone.add(day);
          pill.classList.remove("pill-pending", "pill-missed", "pill-tomorrow");
          pill.classList.add("pill-done");
        }

        const changed = this.initialDone.has(day) !== this.draftDone.has(day);
        pill.toggleClass("pill-changed", changed);

        this.markDirty();
        this.updateProgress();
      });
    }




    this.actionsEl = contentEl.createEl("div", { cls: "rr-actions rr-actions-bottom" });
    this.editBtn = this.actionsEl.createEl("button", { text: "Edit", cls: "rr-btn rr-btn-secondary" });
    this.editBtn.onclick = () => this.toggleEdit();

    this.saveBtn = this.actionsEl.createEl("button", { text: "Save", cls: "rr-btn rr-btn-primary" }) as HTMLButtonElement;
    this.saveBtn.disabled = true;
    this.saveBtn.onclick = () => this.applyChanges();

    this.updateProgress();
  }

  private toggleEdit() {
    const goingToEdit = !this.editing;

    if (goingToEdit) {

      this.editing = true;
      this.modalEl.addClass("is-editing");
      this.editBtn.textContent = "Cancel";
      return;
    }


    this.editing = false;
    this.modalEl.removeClass("is-editing");
    this.editBtn.textContent = "Edit";

    if (this.dirty) {
      // скасувати незбережені зміни
      this.draftDone = new Set(this.initialDone);
      this.refreshPillsFrom(this.initialDone); 
      this.dirty = false;
      this.saveBtn.disabled = true;
    }
    this.updateProgress();
  }


  private refreshPillsFrom(source: Set<number>) {
    let createdUTC: number | null = null;
    let todayUTC: number | null = null;
    let tomorrow: number | null = null;

    const ts = (this.baseTs ?? this.file.stat.ctime) || 0;
    if (ts) {
      const c = new Date(ts), t = new Date();
      createdUTC = Date.UTC(c.getFullYear(), c.getMonth(), c.getDate());
      todayUTC   = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
      if (this.plugin.settings.highlightOneDayInStats) {
        const diff = Math.floor((todayUTC - createdUTC) / DAY_MS);
        tomorrow = diff >= 0 ? diff + 1 : null;
      }
    }

    const doMissed   = !!this.plugin.settings.highlightMissedIntervals;
    const doTomorrow = !!this.plugin.settings.highlightOneDayInStats;

    this.contentEl.findAll(".pill").forEach((el) => {
      const day = Number((el as any).getAttr?.("data-days") ?? el.getAttribute("data-days"));
      const done = source.has(day);

      el.removeClass("pill-changed");
      el.toggleClass("pill-done", done);
      el.toggleClass("pill-pending", !done);


      el.removeClass("pill-missed");
      el.removeClass("pill-tomorrow");
      if (!done) {
        if (doMissed && createdUTC != null && todayUTC != null && (createdUTC + day * DAY_MS) < todayUTC) {
          el.addClass("pill-missed");
        }
        if (doTomorrow && tomorrow != null && day === tomorrow) {
          el.addClass("pill-tomorrow");
        }
      }
    });
  }


  private markDirty() {
    this.dirty = true;
    this.saveBtn.disabled = false;
  }

  private updateProgress() {
    this.progressEl.setText(`Progress: ${this.draftDone.size} / ${this.intervals.length}${this.dirty ? " *" : ""}`);
  }

  private async applyChanges() {
    for (const d of this.intervals) {
      const key = `${this.file.path}:::${d}`;
      const was = this.initialDone.has(d);
      const now = this.draftDone.has(d);
      if (was === now) continue;
      if (now) this.plugin.readStatus.add(key);
      else this.plugin.readStatus.delete(key);
    }
    await this.plugin.saveSettings();

    // зафіксували
    this.initialDone = new Set(this.draftDone);
    this.refreshPillsFrom(this.initialDone);
    this.dirty = false;
    this.saveBtn.disabled = true;
    this.editing = false;
    this.modalEl.removeClass("is-editing");
    this.editBtn.textContent = "Edit";
    this.updateProgress();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}


function dedupeAndSort(values: number[]): number[] {
  const uniq = Array.from(new Set(values.filter((v) => Number.isFinite(v) && v > 0)));
  uniq.sort((a, b) => a - b);
  return uniq;
}

function findFrontmatterStart(app: App, path: string): number | null {
  const cache = app.metadataCache.getCache(path);
  const fm = cache?.frontmatter;
  if (!fm) return null;
  for (const key in fm) {
    const val = (fm as any)[key];
    if (typeof val === "string") {
      const m = (window as any).moment?.(val.trim(), [...FM_DATE_FORMATS], true);
      if (m?.isValid?.()) return m.valueOf();
      const d = new Date(val);
      if (!Number.isNaN(d.valueOf())) return d.valueOf();
    }
  }
  return null;
}

function formatDate(date: Date): string {
  const m = (window as any).moment;
  if (m && typeof m === "function") return m(date).format("DD.MM.YYYY");
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

