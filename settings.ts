import { App, PluginSettingTab, Setting, SliderComponent } from "obsidian";

/**
 * Data structure representing a single folder. Each folder has a name,
 * collapsed state and an array of file paths (e.g. "folder/note.md").
 */
export interface FolderData {
  name: string;
  collapsed: boolean;
  files: string[];
}

/**
 * Overall plugin settings definition. These values are persisted to disk.
 */
export interface ReviewTrackerSettings {
  tag: string;
  intervals: number[];
  folders: FolderData[];

  enableStatsHoverTooltips: boolean;
  highlightOneDayInStats?: boolean;
  highlightMissedIntervals?: boolean;

  tooltipInitialDelayMs: number;
  tooltipResetDelayMs: number;

  graphMaxDay: number;
  memoryLineStep: number;
  continuationPercent: number;

  showBackgroundGrid?: boolean;
}

/**
 * Default settings used when the plugin is first installed.
 */
export const DEFAULT_SETTINGS: ReviewTrackerSettings = {
  tag: "#repeat",
  intervals: [1, 3, 7, 14, 30, 60],
  folders: [],

  enableStatsHoverTooltips: true,
  tooltipInitialDelayMs: 1000,
  tooltipResetDelayMs: 200,
  graphMaxDay: 30,
  memoryLineStep: 10,
  continuationPercent: 100,
  showBackgroundGrid: false,
  highlightOneDayInStats: false,
  highlightMissedIntervals: false,


};


export class ReviewTrackerSettingTab extends PluginSettingTab {
  plugin: { settings: ReviewTrackerSettings; saveSettings: () => Promise<void> };

  constructor(app: App, plugin: any) {
    super(app, plugin);
    this.plugin = plugin as any;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Review Tracker Settings" });

    // Tag input
    new Setting(containerEl)
      .setName("Tag")
      .setDesc("Tag to search for in frontmatter (e.g. #repeat).")
      .addText((text) =>
        text
          .setPlaceholder("#repeat")
          .setValue(this.plugin.settings.tag)
          .onChange(async (value) => {
            this.plugin.settings.tag = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    // Intervals input and graph
    new Setting(containerEl)
      .setName("Intervals (days)")
      .setDesc(
        "Enter intervals in days, separated by commas (e.g. 1, 3, 7, 14).",
      )
      .addText((text) =>
        text
          .setPlaceholder("1, 3, 7, 14, 30, 60")
          .setValue(this.plugin.settings.intervals.join(", "))
          .onChange(async (value) => {
            const intervals = value
              .split(",")
              .map((v) => parseInt(v.trim()))
              .filter((n) => !isNaN(n) && n > 0);
            const unique = Array.from(new Set(intervals)).sort((a, b) => a - b);
            this.plugin.settings.intervals = unique;
            await this.plugin.saveSettings();
            updateScrollLimits();
            drawGraph();
          }),
      );


    const styleId = "review-tracker-graph-style";
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement("style");
      styleEl.id = styleId;
      styleEl.textContent = `
        /* Wrapper for the forgetting curve graph */
        .rr-interval-graph-wrapper {
          margin-top: 0.75em;
          width: 100%;
          border: 1px solid var(--background-modifier-border);
          border-radius: 6px;
          background-color: var(--background-primary);
          box-sizing: border-box;
          overflow: hidden;
          height: 260px;
        }
        .rr-interval-graph-wrapper canvas {
          display: block;
          width: 100%;
          height: 260px;
        }
        /* Updated scroll bar wrapper and content */
        .rr-scroll-bar-wrapper {
          margin-top: 0.5em;
          width: 100%;
          overflow-x: auto;
          overflow-y: hidden;
          height: 18px; /* збільшено для кращої видимості */
          box-sizing: border-box;
        }
        .rr-scroll-bar-content {
          height: 1px;
          min-width: 200%; /* гарантоване переповнення */
        }
        /* Локальний WebKit scrollbar для macOS (та Chromium/Electron) */
        .rr-scroll-bar-wrapper::-webkit-scrollbar { height: 12px; }

        /* Використовуємо змінні з JS: --rr-scroll-thumb-color та --rr-scroll-halo-color */
        .rr-scroll-bar-wrapper::-webkit-scrollbar-thumb {
          background: var(--rr-scroll-thumb-color, var(--interactive-accent));
          border-radius: 8px;
          /* «ореол» навколо бігунка — завжди видно на будь-якому треку */
          border: 2px solid var(--rr-scroll-halo-color, var(--background-primary));
          /* легкий внутрішній контур для читабельності на насичених акцентах */
          box-shadow: inset 0 0 0 1px rgba(0,0,0,.15);
        }
        .rr-scroll-bar-wrapper:hover::-webkit-scrollbar-thumb { filter: brightness(1.05); }
        .rr-scroll-bar-wrapper:active::-webkit-scrollbar-thumb { filter: brightness(0.95); }

        .rr-scroll-bar-wrapper::-webkit-scrollbar-track {
          background: var(--background-modifier-border);
        }
      `;
      document.head.appendChild(styleEl);
    }

    // Graph container
    const graphWrapper = containerEl.createDiv({
      cls: "rr-interval-graph-wrapper",
    });
    const canvas = graphWrapper.createEl("canvas");

    // Scroll bar below the graph
    const scrollBarWrapper = containerEl.createDiv({
      cls: "rr-scroll-bar-wrapper",
    });
    const scrollBarContent = scrollBarWrapper.createDiv({
      cls: "rr-scroll-bar-content",
    });


    /**
     * Normalize any CSS color string to an RGBA object using a canvas context.
     */
    const getRGBA = (cssColor: string) => {
      const ctx =
        (getRGBA as any)._ctx ||
        ((getRGBA as any)._ctx =
          document.createElement("canvas").getContext("2d"));
      ctx!.fillStyle = "#000";
      ctx!.fillStyle = cssColor;
      const s = ctx!.fillStyle as string; // "#rrggbb" або "rgba(r,g,b,a)"
      if (s.startsWith("#")) {
        const v = s.slice(1);
        const r = parseInt(v.substring(0, 2), 16);
        const g = parseInt(v.substring(2, 4), 16);
        const b = parseInt(v.substring(4, 6), 16);
        return { r, g, b, a: 1 };
      }
      const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
      if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] ? +m[4] : 1 };
      // fallback
      return { r: 0, g: 0, b: 0, a: 1 };
    };

    /**
     * Compute relative luminance of an RGB color.
     */
    const relLum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const norm = (x: number) => {
        x /= 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      const R = norm(r);
      const G = norm(g);
      const B = norm(b);
      return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    };

    /**
     * Compute the WCAG contrast ratio between two colors.
     */
    const contrastRatio = (c1: string, c2: string) => {
      const L1 = relLum(getRGBA(c1));
      const L2 = relLum(getRGBA(c2));
      const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1];
      return (hi + 0.05) / (lo + 0.05);
    };

    /**
     * Apply appropriate colors to the scroll thumb and halo depending on contrast.
     */
    const applyScrollbarContrast = () => {
      const cs = getComputedStyle(document.body);
      const accent =
        cs.getPropertyValue("--interactive-accent").trim() || "#7aa2ff";
      const track =
        cs.getPropertyValue("--background-modifier-border").trim() || "#444";
      const bg =
        cs.getPropertyValue("--background-primary").trim() || "#111";
      const text =
        cs.getPropertyValue("--text-normal").trim() || "#fff";

      // Measure contrast of accent against track and background
      const c1 = contrastRatio(accent, track);
      const c2 = contrastRatio(accent, bg);
      const best = Math.max(c1, c2);
      let thumb = accent;

      // If contrast is too low (<3:1), fallback to text color
      if (best < 3) {
        thumb = text;
      }

      scrollBarWrapper.style.setProperty("--rr-scroll-thumb-color", thumb);
      // Halo uses background color to create a clear edge against the track
      scrollBarWrapper.style.setProperty("--rr-scroll-halo-color", bg);
    };

    // Initial application
    applyScrollbarContrast();

    // Respond to theme/class changes on the body (Obsidian toggles theme-dark/theme-light)
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "attributes" && m.attributeName === "class") {
          applyScrollbarContrast();
          break;
        }
      }
    });
    mo.observe(document.body, { attributes: true });

    // Also respond to system-level color scheme changes
    matchMedia("(prefers-color-scheme: dark)").addEventListener(
      "change",
      applyScrollbarContrast,
    );

    // Constants
    const ZOOM_LIMIT = 400;

    // Sliders
    let graphRangeSlider: SliderComponent | null = null;
    let graphRangeSetting!: Setting;
    let continuationSetting!: Setting;

    // Horizontal scroll state
    let scrollOffset = 0;
    let maxScrollOffset = 0;


    let suppressScrollHandler = false;


    const getCurrentMaxDay = () => {
      const rawIntervals: number[] = Array.isArray(this.plugin.settings.intervals)
        ? this.plugin.settings.intervals
        : [];
      const sorted = rawIntervals
        .map((n) => (typeof n === "number" ? n : parseInt(String(n), 10)))
        .filter((n) => !isNaN(n) && n > 0)
        .sort((a, b) => a - b);
      const defaultGraphRange =
        sorted.length > 0 ? Math.max(...sorted, 30) : 30;
      const userMax =
        typeof this.plugin.settings.graphMaxDay === "number" &&
        this.plugin.settings.graphMaxDay > 0
          ? this.plugin.settings.graphMaxDay
          : undefined;
      return Math.min(userMax ?? defaultGraphRange, ZOOM_LIMIT);
    };

    /** ⬅️ NEW: скільки днів припадає на 1 піксель поточного вікна */
    const getDaysPerPx = () => {
      const wrapperWidth =
        graphWrapper.clientWidth || containerEl.clientWidth || 400;
      const padLeft = 40,
        padRight = 20;
      const chartW = Math.max(wrapperWidth - padLeft - padRight, 1);
      return getCurrentMaxDay() / chartW;
    };

    /** ⬅️ NEW: єдине джерело правди для виставлення scrollOffset */
    const setScrollOffset = (newOffset: number) => {
      const clamped = Math.max(0, Math.min(newOffset, maxScrollOffset));
      if (clamped === scrollOffset) return;
      scrollOffset = clamped;

      // синхронізуємо "повзунок" унизу, але не запускаємо його scroll-handler
      const availableScroll =
        scrollBarWrapper.scrollWidth - scrollBarWrapper.clientWidth;
      if (availableScroll > 0 && maxScrollOffset > 0) {
        const targetLeft = (scrollOffset / maxScrollOffset) * availableScroll;
        suppressScrollHandler = true;
        scrollBarWrapper.scrollLeft = targetLeft;
        requestAnimationFrame(() => {
          suppressScrollHandler = false;
        });
      } else {
        scrollBarWrapper.scrollLeft = 0;
      }
      drawGraph();
    };

    /**
     * Updated scroll limit calculator.
     * Ми задаємо ширину scrollBarContent у пікселях відносно ширини видимого контейнера.
     * Потім у requestAnimationFrame читаємо scrollWidth, щоб гарантувати, що layout перераховано.
     */
    const updateScrollLimits = () => {
      const raw: number[] = Array.isArray(this.plugin.settings.intervals)
        ? this.plugin.settings.intervals
        : [];
      const sortedList = raw
        .map((n) => (typeof n === "number" ? n : parseInt(String(n), 10)))
        .filter((n) => !isNaN(n) && n > 0)
        .sort((a, b) => a - b);
      const largest =
        sortedList.length > 0 ? sortedList[sortedList.length - 1] : 0;
      let baseLen = 0;
      if (sortedList.length > 1) {
        baseLen = largest - sortedList[sortedList.length - 2];
      } else if (sortedList.length === 1) {
        baseLen = sortedList[0];
      }
      const contFactor =
        (this.plugin.settings.continuationPercent ?? 100) / 100;
      const extendedAbs = largest + baseLen * contFactor;
      let maxRange = Math.max(largest, extendedAbs);
      const currentMaxDay = Math.min(
        typeof this.plugin.settings.graphMaxDay === "number" &&
          this.plugin.settings.graphMaxDay > 0
          ? this.plugin.settings.graphMaxDay
          : sortedList.length > 0
          ? Math.max(...sortedList, 30)
          : 30,
        ZOOM_LIMIT,
      );
      let maxOffset = maxRange - currentMaxDay;
      if (maxOffset < 0) maxOffset = 0;
      maxScrollOffset = maxOffset;
      if (scrollOffset > maxScrollOffset) {
        setScrollOffset(maxScrollOffset);
      }
      if (scrollBarWrapper && scrollBarContent) {
        const ratio =
          maxRange > 0 && currentMaxDay > 0 ? maxRange / currentMaxDay : 1;
        const base =
          scrollBarWrapper.clientWidth || containerEl.clientWidth || 400;
        const targetWidthPx = Math.max(base * ratio, base + 1);
        scrollBarContent.style.width = `${Math.ceil(targetWidthPx)}px`;
        requestAnimationFrame(() => {
          const availableScroll =
            scrollBarWrapper.scrollWidth - scrollBarWrapper.clientWidth;
          if (availableScroll > 0 && maxScrollOffset > 0) {
            const pct = scrollOffset / maxScrollOffset;
            suppressScrollHandler = true;
            scrollBarWrapper.scrollLeft = pct * availableScroll;
            requestAnimationFrame(() => {
              suppressScrollHandler = false;
            });
          } else {
            scrollBarWrapper.scrollLeft = 0;
          }
        });
      }
    };

    // Graph drawing logic (не змінювався)
    const drawGraph = () => {
      if (!canvas || !this.plugin) return;
      const wrapperWidth =
        graphWrapper.clientWidth || containerEl.clientWidth || 400;
      const width = Math.max(wrapperWidth, 200);
      const height = 260;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const rawIntervals: number[] = Array.isArray(
        this.plugin.settings.intervals,
      )
        ? this.plugin.settings.intervals
        : [];
      const sorted = rawIntervals
        .map((n) => (typeof n === "number" ? n : parseInt(String(n), 10)))
        .filter((n) => !isNaN(n) && n > 0)
        .sort((a, b) => a - b);

      const defaultGraphRange =
        sorted.length > 0 ? Math.max(...sorted, 30) : 30;
      const userMax =
        typeof this.plugin.settings.graphMaxDay === "number" &&
        this.plugin.settings.graphMaxDay > 0
          ? this.plugin.settings.graphMaxDay
          : undefined;
      const maxDay = Math.min(userMax ?? defaultGraphRange, ZOOM_LIMIT);
      const viewStart = scrollOffset;
      const viewEnd = viewStart + maxDay;

      const padLeft = 40;
      const padRight = 20;
      const padTop = 20;
      const padBottom = 40;
      const chartW = width - padLeft - padRight;
      const chartH = height - padTop - padBottom;

      const mapX = (d: number) =>
        padLeft + (chartW * (d - viewStart)) / maxDay;
      const mapY = (r: number) => padTop + chartH - r * chartH;

      const rootStyle = getComputedStyle(document.body);
      const accentColor =
        rootStyle.getPropertyValue("--interactive-accent")?.trim() ||
        "#0080FF";
      const axisColor =
        rootStyle.getPropertyValue("--text-muted")?.trim() || "#666666";
      const textColor =
        rootStyle.getPropertyValue("--text-normal")?.trim() || "#222222";
      const greyColor = "#888888";

      const drawBackgroundGrid = () => {

        const DAILY_GRID_MIN_PX = 6; 
        const MAX_DAILY_LINES = 450; 


        const EMPH_EVERY = 10;
        const EMPH_OFFSET = 0; 

        const daysVisible = Math.ceil(viewEnd - viewStart);
        const pxPerDay = chartW / (viewEnd - viewStart);
        const drawDaily =
          pxPerDay >= DAILY_GRID_MIN_PX && daysVisible <= MAX_DAILY_LINES;

   
        const DAILY_ALPHA = 0.18; 
        const MAJOR_ALPHA = 0.25; 
        const DAILY_W = 1.0;
        const MAJOR_W = 1.8;


        ctx.save();
        ctx.strokeStyle = axisColor;
        ctx.setLineDash([]);


        if (drawDaily) {
          const startDay = Math.ceil(viewStart);
          for (let d = startDay; d <= viewEnd; d += 1) {
            if (((d - EMPH_OFFSET) % EMPH_EVERY) === 0) continue;

            const x = Math.round(mapX(d)) + 0.5;
            ctx.lineWidth = DAILY_W;
            ctx.globalAlpha = DAILY_ALPHA;

            ctx.beginPath();
            ctx.moveTo(x, padTop);
            ctx.lineTo(x, padTop + chartH);
            ctx.stroke();
          }
        }


        const firstMajor =
          Math.ceil((viewStart - EMPH_OFFSET) / EMPH_EVERY) *
            EMPH_EVERY +
          EMPH_OFFSET;

        for (let d = firstMajor; d <= viewEnd; d += EMPH_EVERY) {
          const x = Math.round(mapX(d)) + 0.5;
          ctx.lineWidth = MAJOR_W;
          ctx.globalAlpha = MAJOR_ALPHA;

          ctx.beginPath();
          ctx.moveTo(x, padTop);
          ctx.lineTo(x, padTop + chartH);
          ctx.stroke();
        }

        ctx.restore();


        const minorAlpha = 0.12;
        ctx.save();
        ctx.globalAlpha = minorAlpha;
        const stepY = 0.1;
        for (let r = 0; r <= 1 + 1e-9; r += stepY) {
          const y = Math.round(mapY(r)) + 0.5;
          ctx.strokeStyle = axisColor;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(mapX(viewStart), y);
          ctx.lineTo(mapX(viewEnd), y);
          ctx.stroke();
        }
        ctx.restore();
      };

      if (this.plugin.settings.showBackgroundGrid) {
        drawBackgroundGrid();
      }

      ctx.strokeStyle = axisColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(mapX(viewStart), mapY(1));
      ctx.lineTo(mapX(viewStart), mapY(0));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mapX(viewStart), mapY(0));
      ctx.lineTo(mapX(viewEnd), mapY(0));
      ctx.stroke();

      ctx.fillStyle = textColor;
      ctx.font = "11px sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText("100%", padLeft - 4, mapY(1));
      ctx.fillText("0%", padLeft - 4, mapY(0));

      if (this.plugin.settings.showBackgroundGrid) {
        for (let p = 90; p >= 10; p -= 10) {
          const yLine = mapY(p / 100);
          ctx.fillStyle = textColor;
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          ctx.fillText(`${p}%`, padLeft - 4, yLine);
        }
      }

      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const entries: { day: number; x: number }[] = [];
      for (const day of sorted) {
        if (day >= viewStart && day <= viewEnd) {
          entries.push({ day, x: mapX(day) });
        }
      }
      for (const e of entries) {
        ctx.strokeStyle = accentColor;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(e.x, mapY(1));
        ctx.lineTo(e.x, mapY(0));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      const MIN_LABEL_PX = 16;
      const clusters: { day: number; x: number }[][] = [];
      for (const e of entries) {
        const lastCluster = clusters[clusters.length - 1];
        if (
          !lastCluster ||
          e.x - lastCluster[lastCluster.length - 1].x >= MIN_LABEL_PX
        ) {
          clusters.push([e]);
        } else {
          lastCluster.push(e);
        }
      }
      const tickHeight = 6;
      for (const cluster of clusters) {
        ctx.strokeStyle = axisColor;
        for (const e of cluster) {
          ctx.beginPath();
          ctx.moveTo(e.x, mapY(0));
          ctx.lineTo(e.x, mapY(0) + tickHeight);
          ctx.stroke();
        }
        let label = "";
        if (cluster.length === 1) {
          label = `${cluster[0].day}d`;
        } else {
          const maxItems = 4;
          const list = cluster.slice(0, maxItems).map((c) => c.day);
          label =
            list.join(",") + (cluster.length > maxItems ? "…" : "");
        }
        const midX =
          (cluster[0].x + cluster[cluster.length - 1].x) / 2;
        ctx.fillStyle = textColor;
        ctx.textAlign = "center";
        ctx.fillText(label, midX, mapY(0) + 6 + tickHeight);
      }

      const S1 = 2.0;
      const alpha = 1.5;
      const getStability = (n: number) => S1 * Math.pow(1 + alpha, n - 1);
      const retention = (t: number, S: number) => Math.exp(-t / S);
      const continuationFactor =
        (this.plugin.settings.continuationPercent ?? 100) / 100;
      const numCurves = sorted.length + 1;
      for (let n = 1; n <= numCurves; n++) {
        const startAbs = n === 1 ? 0 : sorted[n - 2];
        const rawEndAbs = n <= sorted.length ? sorted[n - 1] : viewEnd;
        const endAbsSegment = rawEndAbs;
        const rawNextReviewAbs = n < sorted.length ? sorted[n] : null;
        const S = getStability(n);

        if (endAbsSegment > viewStart && startAbs < viewEnd) {
          const segStart = Math.max(startAbs, viewStart);
          const segEnd = Math.min(endAbsSegment, viewEnd);
          if (segEnd > segStart) {
            const pixelStart = mapX(segStart);
            const pixelEnd = mapX(segEnd);
            const steps = Math.max(Math.floor(pixelEnd - pixelStart), 1);
            const stepSize = (segEnd - segStart) / steps;
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.beginPath();
            for (let i = 0; i <= steps; i++) {
              const tAbs = segStart + i * stepSize;
              const tRel = tAbs - startAbs;
              const r = retention(tRel, S);
              const x = mapX(tAbs);
              const y = mapY(r);
              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
            }
            ctx.stroke();
          }
        }

        if (rawNextReviewAbs !== null) {
          const baseLength = rawNextReviewAbs - endAbsSegment;
          const extendedAbs = endAbsSegment + baseLength * continuationFactor;
          const zeroThreshold = 0.0001;
          const zeroTime = S * Math.log(1 / zeroThreshold);
          const zeroAbs = startAbs + zeroTime;
          let nextReviewClamped = Math.min(extendedAbs, zeroAbs);
          if (nextReviewClamped > endAbsSegment) {
            if (
              nextReviewClamped > viewStart &&
              endAbsSegment < viewEnd
            ) {
              const segStart = Math.max(endAbsSegment, viewStart);
              const segEnd = Math.min(nextReviewClamped, viewEnd);
              if (segEnd > segStart) {
                const pixelStartGrey = mapX(segStart);
                const pixelEndGrey = mapX(segEnd);
                const stepsGrey = Math.max(
                  Math.floor(pixelEndGrey - pixelStartGrey),
                  1,
                );
                const stepSizeGrey = (segEnd - segStart) / stepsGrey;
                ctx.strokeStyle = greyColor;
                ctx.lineWidth = 1.5;
                ctx.setLineDash([]);
                ctx.beginPath();
                for (let i = 0; i <= stepsGrey; i++) {
                  const tAbs = segStart + i * stepSizeGrey;
                  const tRel = tAbs - startAbs;
                  const r = retention(tRel, S);
                  const x = mapX(tAbs);
                  const y = mapY(r);
                  if (i === 0) {
                    ctx.moveTo(x, y);
                  } else {
                    ctx.lineTo(x, y);
                  }
                  if (y >= mapY(0)) {
                    break;
                  }
                }
                ctx.stroke();
              }
            }
          }
        }
      }
    };

    // Draw the initial graph after layout
    setTimeout(drawGraph, 0);

    // Graph width slider
    const rawIntervalsForSlider: number[] = Array.isArray(
      this.plugin.settings.intervals,
    )
      ? this.plugin.settings.intervals
      : [];
    const sortedForSlider = rawIntervalsForSlider
      .map((n) => (typeof n === "number" ? n : parseInt(String(n), 10)))
      .filter((n) => !isNaN(n) && n > 0)
      .sort((a, b) => a - b);
    const maxIntervalForSlider =
      sortedForSlider.length > 0
        ? Math.max(...sortedForSlider)
        : 30;
    const sliderMinDays = 5;
    const sliderMaxDays = Math.min(
      Math.max(maxIntervalForSlider * 2, 60),
      ZOOM_LIMIT,
    );

    graphRangeSetting = new Setting(containerEl);
    graphRangeSetting.setName("Graph width (max days)");
    graphRangeSetting.setDesc(
      `Maximum number of days shown on the graph. Current: ${this.plugin.settings.graphMaxDay}`,
    );
    graphRangeSetting.addSlider((slider: SliderComponent) => {
      slider.setLimits(sliderMinDays, sliderMaxDays, 1);
      const initialRange =
        typeof this.plugin.settings.graphMaxDay === "number" &&
        this.plugin.settings.graphMaxDay > 0
          ? Math.min(this.plugin.settings.graphMaxDay, ZOOM_LIMIT)
          : Math.max(maxIntervalForSlider, 30);
      const updateRange = async (val: number) => {
        const clamped = Math.min(
          Math.max(val, sliderMinDays),
          ZOOM_LIMIT,
        );
        this.plugin.settings.graphMaxDay = clamped;
        await this.plugin.saveSettings();
        graphRangeSetting.setDesc(
          `Maximum number of days shown on the graph. Current: ${clamped}`,
        );
        updateScrollLimits();
        drawGraph();
      };
      slider.setValue(initialRange);
      updateRange(initialRange);
      slider.onChange(async (value) => {
        await updateRange(value);
      });
      ((slider as any).inputEl ?? (slider as any).sliderEl).addEventListener(
        "input",
        async () => {
          const value = slider.getValue();
          await updateRange(value);
        },
      );
      graphRangeSlider = slider;
    });

    // Continuation factor slider
    continuationSetting = new Setting(containerEl);
    continuationSetting.setName("Continuation length (%)");
    continuationSetting.setDesc(
      `Grey segment length as a percentage of the next interval. Current: ${this.plugin.settings.continuationPercent}%`,
    );
    continuationSetting.addSlider((slider: SliderComponent) => {
      slider.setLimits(100, 1000, 5);
      const initialCont =
        typeof this.plugin.settings.continuationPercent ===
          "number" && this.plugin.settings.continuationPercent >= 100
          ? this.plugin.settings.continuationPercent
          : 100;
      const updateContinuation = async (val: number) => {
        const clamped = Math.max(
          100,
          Math.min(val, 1000),
        );
        this.plugin.settings.continuationPercent = clamped;
        await this.plugin.saveSettings();
        continuationSetting.setDesc(
          `Grey segment length as a percentage of the next interval. Current: ${clamped}%`,
        );
        updateScrollLimits();
        drawGraph();
      };
      slider.setValue(initialCont);
      updateContinuation(initialCont);
      slider.onChange(async (value) => {
        await updateContinuation(value);
      });
      ((slider as any).inputEl ?? (slider as any).sliderEl).addEventListener(
        "input",
        async () => {
          const value = slider.getValue();
          await updateContinuation(value);
        },
      );
    });

    // Toggle background grid
    new Setting(containerEl)
      .setName("Show background grid")
      .setDesc(
        "Draw a thin, transparent grid on the forgetting curve graph.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showBackgroundGrid ?? false)
          .onChange(async (v) => {
            this.plugin.settings.showBackgroundGrid = v;
            await this.plugin.saveSettings();
            drawGraph();
          }),
      );

    // Wheel zoom + horizontal pan on trackpads
    canvas.addEventListener(
      "wheel",
      async (e: WheelEvent) => {
        // ⌘/Ctrl + колесо — зум (як у тебе було)
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const currentRange =
            typeof this.plugin.settings.graphMaxDay === "number" &&
            this.plugin.settings.graphMaxDay > 0
              ? this.plugin.settings.graphMaxDay
              : Math.max(
                  Array.isArray(this.plugin.settings.intervals) &&
                  this.plugin.settings.intervals.length
                    ? Math.max(...this.plugin.settings.intervals)
                    : 30,
                  30,
                );

          const scaleFactor = e.deltaY > 0 ? 1.2 : 0.8;
          let newRange = Math.round(
            Math.min(
              Math.max(currentRange * scaleFactor, sliderMinDays),
              sliderMaxDays,
            ),
          );
          if (newRange !== currentRange) {
            const clamped = Math.min(newRange, ZOOM_LIMIT);
            this.plugin.settings.graphMaxDay = clamped;
            await this.plugin.saveSettings();
            if (graphRangeSlider) graphRangeSlider.setValue(clamped);
            if (graphRangeSetting) {
              graphRangeSetting.setDesc(
                `Maximum number of days shown on the graph. Current: ${clamped}`,
              );
            }
            updateScrollLimits();
            drawGraph();
          }
          return;
        }

        // ⬅️ NEW: горизонтальна прокрутка двома пальцями (trackpad) або Shift+wheel
        const dominantHorizontal =
          Math.abs(e.deltaX) >= Math.abs(e.deltaY);
        let pxDelta = 0;

        if (dominantHorizontal) {
          pxDelta = e.deltaX;
        } else if (e.shiftKey) {
          // традиційний шарткат: Shift + колесо = горизонталь
          pxDelta = e.deltaY;
        }

        if (pxDelta !== 0) {
          e.preventDefault();
          // нормалізуємо різні deltaMode (0=pixel, 1=line, 2=page)
          if (e.deltaMode === 1) pxDelta *= 16; // приблизно один рядок ~16px
          else if (e.deltaMode === 2)
            pxDelta *= graphWrapper.clientWidth || 400;

          const daysPerPx = getDaysPerPx();
          setScrollOffset(scrollOffset + pxDelta * daysPerPx);
        }
      },
      { passive: false },
    );


    let isPanning = false;
    let panStartX = 0;
    let panStartOffset = 0;
    canvas.addEventListener(
      "pointerdown",
      (e: PointerEvent) => {
        if (e.button !== 0) return; // лише ЛКМ
        isPanning = true;
        panStartX = e.clientX;
        panStartOffset = scrollOffset;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        e.preventDefault();
      },
      { passive: false },
    );

    canvas.addEventListener(
      "pointermove",
      (e: PointerEvent) => {
        if (!isPanning) return;
        const dx = e.clientX - panStartX;
        const daysPerPx = getDaysPerPx();
        // тягнемо вліво — йдемо вправо по часу (тому мінус dx)
        setScrollOffset(panStartOffset - dx * daysPerPx);
      },
      { passive: false },
    );

    const endPan = (e: PointerEvent) => {
      if (!isPanning) return;
      isPanning = false;
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    };
    canvas.addEventListener("pointerup", endPan);
    canvas.addEventListener("pointercancel", endPan);

    new Setting(containerEl)
      .setName("Enable hover tooltips in Statistics")
      .setDesc("Show delayed popups when hovering rows in the stats modal.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableStatsHoverTooltips)
          .onChange(async (v) => {
            this.plugin.settings.enableStatsHoverTooltips = v;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Tomorrow hint (highlight next-day interval)")
      .setDesc("When enabled, highlights the interval pill that equals 'days since creation + 1' (i.e., due tomorrow) in the Stats table.")
      .addToggle(t => t
        .setValue(!!this.plugin.settings.highlightOneDayInStats)
        .onChange(async (v) => {
          this.plugin.settings.highlightOneDayInStats = v;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Highlight missed intervals (red)")
      .setDesc("When enabled, any interval whose due date is before today and not done is highlighted in red.")
      .addToggle(t => t
        .setValue(!!this.plugin.settings.highlightMissedIntervals)
        .onChange(async v => {
          this.plugin.settings.highlightMissedIntervals = v;
          await this.plugin.saveSettings();
        }));
  


    scrollBarWrapper.addEventListener("scroll", () => {
      if (suppressScrollHandler) return;
      const availableScroll =
        scrollBarWrapper.scrollWidth - scrollBarWrapper.clientWidth;
      if (availableScroll > 0 && maxScrollOffset > 0) {
        const pct = scrollBarWrapper.scrollLeft / availableScroll;
        setScrollOffset(pct * maxScrollOffset);
      } else {
        setScrollOffset(0);
      }
    });


    scrollBarWrapper.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          scrollBarWrapper.scrollLeft += e.deltaY;
        }
      },
      { passive: false },
    );

    // Initial computation of scroll limits and bar sizing
    updateScrollLimits();
  }
}