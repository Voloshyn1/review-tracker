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

    attachStyleOnce();

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

      //  v*loshyn authop
      pill.addEventListener("click", () => {
        if (!this.editing) return;
        const day = Number(pill.getAttr("data-days"));
        const wasDone = this.draftDone.has(day);

        if (wasDone) {
          // стало «не зроблено»
          this.draftDone.delete(day);
          pill.classList.remove("pill-done");
          pill.classList.add("pill-pending");
          // повертаємо релевантні підсвітки
          pill.toggleClass("pill-missed",   isMissed(day));
          pill.toggleClass("pill-tomorrow", isTomorrow(day));
        } else {
          // стало «зроблено»
          this.draftDone.add(day);
          // знімаємо будь-які червоні/жовті, ставимо зелене
          pill.classList.remove("pill-pending", "pill-missed", "pill-tomorrow");
          pill.classList.add("pill-done");
        }

        const changed = this.initialDone.has(day) !== this.draftDone.has(day);
        pill.toggleClass("pill-changed", changed);

        this.markDirty();
        this.updateProgress();
      });
    }




    // нижня панель дій
    this.actionsEl = contentEl.createEl("div", { cls: "rr-actions rr-actions-bottom" });
    this.editBtn = this.actionsEl.createEl("button", { text: "Edit", cls: "rr-btn rr-btn-secondary" });
    this.editBtn.onclick = () => this.toggleEdit();

    this.saveBtn = this.actionsEl.createEl("button", { text: "Save", cls: "rr-btn rr-btn-primary" }) as HTMLButtonElement;
    this.saveBtn.disabled = true;
    this.saveBtn.onclick = () => this.applyChanges();

    this.updateProgress();
  }

  /** Вхід/вихід із режиму редагування */
  private toggleEdit() {
    const goingToEdit = !this.editing;

    if (goingToEdit) {
      // входимо в редагування
      this.editing = true;
      this.modalEl.addClass("is-editing");
      this.editBtn.textContent = "Cancel";
      return;
    }

    // виходимо з редагування (без збереження = відкотити чернетку)
    this.editing = false;
    this.modalEl.removeClass("is-editing");
    this.editBtn.textContent = "Edit";

    if (this.dirty) {
      // скасувати незбережені зміни
      this.draftDone = new Set(this.initialDone);
      this.refreshPillsFrom(this.initialDone); // повернути класи і прибрати .pill-changed
      this.dirty = false;
      this.saveBtn.disabled = true;
    }
    this.updateProgress();
  }

  /** Перемальовує всі пілюлі відповідно до переданого набору "done" */
  private refreshPillsFrom(source: Set<number>) {
    // перераховуємо базові дати щоразу — дешево і надійно
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

      // скидаємо підсвітки і, якщо треба, додаємо знову
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

/* ===== helpers ===== */
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

let styleAttached = false;
function attachStyleOnce(): void {
  if (styleAttached) return;
  styleAttached = true;

  const style = document.createElement("style");
  style.id = "rr-intervals-modal-style";
  style.textContent = `
  .modal.rr-intervals { --rr-left-pad: 0px; --rr-x-space: 44px; --rr-title-right-pad: 8px; }
  .modal.rr-intervals .modal-title {
    padding-left: var(--rr-left-pad);
    padding-right: var(--rr-title-right-pad);
    max-width: calc(100% - var(--rr-x-space) - var(--rr-title-right-pad));
    white-space: normal; word-break: break-word; line-height: 1.25; margin: 0;
  }
  .modal.rr-intervals .modal-content { padding-left: var(--rr-left-pad); }

  .modal .rr-intervals-modal { display: flex; flex-direction: column; gap: 12px; padding-top: 4px; }
  .rr-intervals-modal .rr-int-meta { display: flex; justify-content: flex-start; align-items: baseline; gap: 12px; }
  .rr-intervals-modal .rr-progress { opacity: .8; font-size: 12px; }

  .rr-intervals-modal .rr-pills-wrap {
    display: flex; flex-wrap: wrap; gap: 6px; max-height: 55vh; overflow: auto; padding: 2px 0 6px; margin-left: 0;
  }

  .rr-intervals-modal .pill {
    display: inline-block; border-radius: 999px; padding: 2px 6px; font-size: .72em; line-height: 1.3em;
    margin: 0; user-select: none; white-space: nowrap; border: 1px solid var(--background-modifier-border);
    transition: box-shadow .12s ease, transform .02s ease;
  }
  .rr-intervals-modal .pill-done { background: #4caf50; color:#fff; border-color: transparent; }
  .rr-intervals-modal .pill-pending { background: #55585e; color:#bbb; }
  .rr-intervals-modal .pill-tomorrow {
    background: #F4D03F;
    color: #222;
  }
  .rr-intervals-modal .pill-missed {
    background-color: #c84537ff;
    color: #fff;
  }


  /* hover підсвітка тільки в режимі редагування */
  .modal.rr-intervals.is-editing .pill { cursor: pointer; }
  .modal.rr-intervals.is-editing .pill:hover { box-shadow: 0 0 0 2px var(--interactive-accent); }

  /* пілюля змінена відносно початкового стану (поки не збережено) */
  .rr-intervals-modal .pill-changed { box-shadow: 0 0 0 2px var(--interactive-accent); }

  .rr-intervals-modal .rr-actions-bottom {
    display: flex; gap: 8px; justify-content: flex-end; border-top: 1px solid var(--background-modifier-border);
    padding-top: 10px; position: sticky; bottom: 0; background: var(--background-primary);
  }
  .rr-intervals-modal .rr-btn {
    padding: 6px 12px; border-radius: 8px; font-size: 12px; line-height: 1;
    border: 1px solid var(--background-modifier-border); background: var(--background-modifier-form-field); cursor: pointer;
  }
  .rr-intervals-modal .rr-btn[disabled] { opacity: .6; cursor: default; }
  .rr-intervals-modal .rr-btn-primary { background: var(--interactive-accent); color: var(--text-on-accent); border-color: transparent; }
  `;
  document.head.appendChild(style);
}
