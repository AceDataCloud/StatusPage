(() => {
  const DATA_BASE = "./data";

  let currentDays = 1;
  let currentGranularity = "daily"; // overridden by API response

  /* ---------- Service display names (alias → English) ---------- */
  const SERVICE_NAMES = {
    aichat: "AI Chat",
    claude: "Claude AI",
    deepseek: "DeepSeek AI",
    flux: "Flux Image",
    gemini: "Gemini AI",
    hailuo: "Hailuo Video",
    headshots: "AI Headshots",
    kimi: "Kimi AI",
    kling: "Kling Video",
    luma: "Luma Video",
    midjourney: "Midjourney",
    "nano-banana": "Nano Banana",
    openai: "OpenAI",
    pika: "Pika Video",
    pixverse: "Pixverse Video",
    seedance: "Seedance Video",
    seedream: "Seedream Image",
    serp: "Web Search",
    sora: "Sora Video",
    suno: "Suno Music",
    veo: "Veo Video",
    wan: "Wan Video",
  };

  const STATUS_CONFIG = {
    operational: {
      label: "Operational",
      barColor: "bg-emerald-500",
      dotColor: "bg-emerald-500",
      textColor: "text-emerald-600 dark:text-emerald-400",
    },
    degraded: {
      label: "Degraded",
      barColor: "bg-yellow-400",
      dotColor: "bg-yellow-400",
      textColor: "text-yellow-600 dark:text-yellow-400",
    },
    partial_outage: {
      label: "Partial Outage",
      barColor: "bg-orange-500",
      dotColor: "bg-orange-500",
      textColor: "text-orange-600 dark:text-orange-400",
    },
    major_outage: {
      label: "Major Outage",
      barColor: "bg-red-500",
      dotColor: "bg-red-500",
      textColor: "text-red-600 dark:text-red-400",
    },
    unknown: {
      label: "No Data",
      barColor: "bg-emerald-500",
      dotColor: "bg-emerald-500",
      textColor: "text-emerald-600 dark:text-emerald-400",
    },
  };

  const OVERALL_BANNERS = {
    "All Systems Operational": {
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      border: "border-emerald-200 dark:border-emerald-800/50",
      icon: "\u2713",
      iconBg: "bg-emerald-500",
      text: "text-emerald-700 dark:text-emerald-300",
    },
    "Minor Service Disruption": {
      bg: "bg-yellow-50 dark:bg-yellow-950/30",
      border: "border-yellow-200 dark:border-yellow-800/50",
      icon: "!",
      iconBg: "bg-yellow-500",
      text: "text-yellow-700 dark:text-yellow-300",
    },
    "Partial System Outage": {
      bg: "bg-orange-50 dark:bg-orange-950/30",
      border: "border-orange-200 dark:border-orange-800/50",
      icon: "!",
      iconBg: "bg-orange-500",
      text: "text-orange-700 dark:text-orange-300",
    },
    "Major System Outage": {
      bg: "bg-red-50 dark:bg-red-950/30",
      border: "border-red-200 dark:border-red-800/50",
      icon: "\u2715",
      iconBg: "bg-red-500",
      text: "text-red-700 dark:text-red-300",
    },
  };

  /* ---------- Time slot generators ---------- */

  /* ---------- Bucket configs: granularity → (bucketMinutes, numSlots) ---------- */
  const BUCKET_CONFIG = {
    quarter: { minutes: 15, slots: 96 },
    "2hour": { minutes: 120, slots: 84 },
    "8hour": { minutes: 480, slots: 90 },
  };

  /** Generate time-bucketed slots in local time for any bucket size. */
  function getBucketedSlots(bucketMinutes, numSlots) {
    const slots = [];
    const now = new Date();
    // Align to bucket boundary
    const totalMin = now.getHours() * 60 + now.getMinutes();
    const alignedMin = Math.floor(totalMin / bucketMinutes) * bucketMinutes;
    now.setHours(Math.floor(alignedMin / 60), alignedMin % 60, 0, 0);
    for (let i = numSlots - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * bucketMinutes * 60000);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      slots.push(`${yyyy}-${mm}-${dd}T${hh}:${mi}`);
    }
    return slots;
  }

  function getLastNDays(n) {
    const days = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      days.push(`${yyyy}-${mm}-${dd}`);
    }
    return days;
  }

  function getTimeSlots() {
    const cfg = BUCKET_CONFIG[currentGranularity];
    if (cfg) return getBucketedSlots(cfg.minutes, cfg.slots);
    return getLastNDays(currentDays);
  }

  /* ---------- Helpers ---------- */

  function dayStatusFromUptime(uptime) {
    if (uptime >= 95) return "operational";
    if (uptime >= 80) return "degraded";
    if (uptime >= 50) return "partial_outage";
    return "major_outage";
  }

  function getServiceName(alias, rawTitle) {
    if (SERVICE_NAMES[alias]) return SERVICE_NAMES[alias];
    // Try cleaning $t() pattern
    if (rawTitle) {
      const m = rawTitle.match(/^\$t\((.+)\)$/);
      if (m) {
        return m[1]
          .replace(/^service_title_/, "")
          .split("_")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
      }
    }
    // Capitalize alias as fallback
    return alias
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  /** Whether the current granularity uses time-of-day (not just date). */
  function isBucketedGranularity() {
    return !!BUCKET_CONFIG[currentGranularity];
  }

  function formatSlotLabel(slot) {
    if (isBucketedGranularity()) {
      // Show date for multi-day views, hour for 24h
      if (currentGranularity === "quarter") {
        const hour = parseInt(slot.slice(11, 13), 10);
        const ampm = hour >= 12 ? "PM" : "AM";
        const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
        return `${h12}${ampm}`;
      }
      // 2hour / 8hour: show "Feb 28"
      const d = new Date(slot.slice(0, 10) + "T00:00:00");
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    const d = new Date(slot + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function formatTooltipDate(slot) {
    if (isBucketedGranularity()) {
      const datePart = new Date(
        slot.slice(0, 10) + "T00:00:00",
      ).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const hour = parseInt(slot.slice(11, 13), 10);
      const min = slot.slice(14, 16);
      const ampm = hour >= 12 ? "PM" : "AM";
      const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      return `${datePart}, ${h12}:${min} ${ampm}`;
    }
    return new Date(slot + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  /* ---------- Rendering ---------- */

  function renderBanner(overallStatus) {
    const banner = document.getElementById("overall-banner");
    const iconEl = document.getElementById("overall-icon");
    const textEl = document.getElementById("overall-text");
    const subEl = document.getElementById("overall-sub");
    const cfg =
      OVERALL_BANNERS[overallStatus] ||
      OVERALL_BANNERS["All Systems Operational"];

    banner.className = `rounded-2xl p-5 mb-6 text-center border ${cfg.bg} ${cfg.border}`;
    iconEl.className = `inline-flex items-center justify-center w-10 h-10 rounded-full mb-2 text-white font-bold text-lg ${cfg.iconBg}`;
    iconEl.textContent = cfg.icon;
    textEl.className = `text-xl font-semibold font-display ${cfg.text}`;
    textEl.textContent = overallStatus;
    subEl.textContent = `Last updated: ${new Date().toLocaleString()}`;
  }

  /** Convert a data entry's date to a local-time display key. */
  function entryToLocalSlot(dateStr) {
    if (isBucketedGranularity()) {
      // Data dates are UTC — convert to local time
      const utc = new Date(dateStr + "Z");
      const yyyy = utc.getFullYear();
      const mm = String(utc.getMonth() + 1).padStart(2, "0");
      const dd = String(utc.getDate()).padStart(2, "0");
      const hh = String(utc.getHours()).padStart(2, "0");
      const mi = String(utc.getMinutes()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    }
    return dateStr; // daily dates are already date-only strings
  }

  function renderService(service) {
    const entries = service.daily || [];

    const cfg = STATUS_CONFIG[service.current_status] || STATUS_CONFIG.unknown;
    const title = getServiceName(service.service_alias, service.service_title);

    const card = document.createElement("div");
    card.className = "glass rounded-xl px-4 py-3";

    // Header
    const header = document.createElement("div");
    header.className = "flex items-center justify-between mb-2";
    header.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full ${cfg.dotColor}"></span>
        <span class="font-medium text-[13px]">${title}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[11px] ${cfg.textColor} font-medium">${cfg.label}</span>
        <span class="text-[11px] text-slate-400 dark:text-slate-500">${service.uptime_90d.toFixed(2)}%</span>
      </div>
    `;
    card.appendChild(header);

    // Bar chart — iterate directly over data entries to avoid timezone key mismatch
    const barContainer = document.createElement("div");
    barContainer.className = "flex items-end gap-[1px] h-7";

    entries.forEach((entry) => {
      const slot = entryToLocalSlot(entry.date);
      const wrapper = document.createElement("div");
      wrapper.className = "bar-wrapper relative flex-1 h-full flex items-end";

      const bar = document.createElement("div");
      bar.className =
        "w-full rounded-[2px] transition-all duration-150 hover:opacity-75 cursor-pointer";

      const isNoData =
        entry.total_requests === 0 || entry.uptime === null;

      if (!isNoData) {
        const status = dayStatusFromUptime(entry.uptime);
        const barCfg = STATUS_CONFIG[status];
        bar.className += ` ${barCfg.barColor}`;
        bar.style.height = "100%";

        const tooltip = document.createElement("div");
        tooltip.className =
          "bar-tooltip px-2 py-1 rounded-md text-[11px] bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-lg";
        tooltip.innerHTML = `
          <div class="font-medium">${formatTooltipDate(slot)}</div>
          <div>${entry.uptime.toFixed(2)}% uptime</div>
          ${entry.server_error_count > 0 ? `<div class="text-red-400 dark:text-red-600">${entry.server_error_count} errors</div>` : ""}
        `;
        wrapper.appendChild(tooltip);
      } else {
        // No data for this time slot — show green (operational appearance)
        bar.className += ` ${STATUS_CONFIG.unknown.barColor}`;
        bar.style.height = "100%";

        const tooltip = document.createElement("div");
        tooltip.className =
          "bar-tooltip px-2 py-1 rounded-md text-[11px] bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-lg";
        tooltip.innerHTML = `<div class="font-medium">${formatTooltipDate(slot)}</div><div>No data</div>`;
        wrapper.appendChild(tooltip);
      }

      wrapper.appendChild(bar);
      barContainer.appendChild(wrapper);
    });

    card.appendChild(barContainer);

    // Date labels from first/last data entries
    const firstSlot = entries.length > 0 ? entryToLocalSlot(entries[0].date) : "";
    const lastSlot = entries.length > 0 ? entryToLocalSlot(entries[entries.length - 1].date) : "";
    const dateLabels = document.createElement("div");
    dateLabels.className =
      "flex justify-between mt-1 text-[10px] text-slate-400 dark:text-slate-500";
    dateLabels.innerHTML = `
      <span>${firstSlot ? formatSlotLabel(firstSlot) : ""}</span>
      <span>${service.uptime_90d.toFixed(2)}% uptime</span>
      <span>${lastSlot ? formatSlotLabel(lastSlot) : ""}</span>
    `;
    card.appendChild(dateLabels);

    return card;
  }

  function renderError(message) {
    document.getElementById("services-container").innerHTML = `
      <div class="text-center py-10 text-slate-400">
        <p class="text-base font-medium">Unable to load status data</p>
        <p class="text-sm mt-1">${message}</p>
        <button onclick="location.reload()" class="mt-3 px-4 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm transition-colors">Retry</button>
      </div>
    `;
  }

  function updateRangeButtons() {
    document.querySelectorAll(".range-btn").forEach((btn) => {
      const range = parseInt(btn.dataset.range, 10);
      btn.classList.toggle("active", range === currentDays);
    });
  }

  async function load() {
    try {
      const res = await fetch(
        `${DATA_BASE}/status_${currentDays}.json?t=${Date.now()}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Use API-provided granularity; fallback to daily if not present
      currentGranularity = data.granularity || "daily";

      renderBanner(data.overall_status);
      updateRangeButtons();

      const container = document.getElementById("services-container");
      container.innerHTML = "";

      if (!data.services || data.services.length === 0) {
        container.innerHTML =
          '<p class="text-center text-slate-400 py-10">No services are being monitored yet.</p>';
        return;
      }

      data.services
        .sort((a, b) =>
          (a.service_alias || "").localeCompare(b.service_alias || ""),
        )
        .forEach((svc) => container.appendChild(renderService(svc)));
    } catch (err) {
      console.error("Failed to load status:", err);
      renderError(err.message);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".range-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentDays = parseInt(btn.dataset.range, 10);
        load();
      });
    });
    load();
  });

  setInterval(load, 60 * 1000);
})();
