(() => {
  const API_BASE = 'https://platform.acedata.cloud/api/v1/status/';

  let currentDays = 1; // default: 24 hours
  let currentGranularity = 'hourly'; // set from API response

  const STATUS_CONFIG = {
    operational:    { label: 'Operational',     barColor: 'bg-emerald-500', dotColor: 'bg-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-400' },
    degraded:       { label: 'Degraded',        barColor: 'bg-yellow-500',  dotColor: 'bg-yellow-500',  textColor: 'text-yellow-600 dark:text-yellow-400' },
    partial_outage: { label: 'Partial Outage',  barColor: 'bg-orange-500',  dotColor: 'bg-orange-500',  textColor: 'text-orange-600 dark:text-orange-400' },
    major_outage:   { label: 'Major Outage',    barColor: 'bg-red-500',     dotColor: 'bg-red-500',     textColor: 'text-red-600 dark:text-red-400' },
    unknown:        { label: 'No Data',         barColor: 'bg-slate-200 dark:bg-slate-700', dotColor: 'bg-slate-400', textColor: 'text-slate-500' },
  };

  const OVERALL_BANNERS = {
    'All Systems Operational': { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800/50', icon: '\u2713', iconBg: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
    'Minor Service Disruption': { bg: 'bg-yellow-50 dark:bg-yellow-950/30', border: 'border-yellow-200 dark:border-yellow-800/50', icon: '!', iconBg: 'bg-yellow-500', text: 'text-yellow-700 dark:text-yellow-300' },
    'Partial System Outage': { bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-200 dark:border-orange-800/50', icon: '!', iconBg: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-300' },
    'Major System Outage': { bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800/50', icon: '\u2715', iconBg: 'bg-red-500', text: 'text-red-700 dark:text-red-300' },
  };

  /* ---------- Time slot generators ---------- */

  function getLast24Hours() {
    const slots = [];
    const now = new Date();
    // Round down to current hour
    now.setMinutes(0, 0, 0);
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600000);
      // Format as YYYY-MM-DDTHH:00 to match backend key
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      slots.push(`${yyyy}-${mm}-${dd}T${hh}:00`);
    }
    return slots;
  }

  function getLastNDays(n) {
    const days = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    return days;
  }

  function getTimeSlots() {
    if (currentGranularity === 'hourly') return getLast24Hours();
    return getLastNDays(currentDays);
  }

  /* ---------- Helpers ---------- */

  function dayStatusFromUptime(uptime) {
    if (uptime >= 95) return 'operational';
    if (uptime >= 80) return 'degraded';
    if (uptime >= 50) return 'partial_outage';
    return 'major_outage';
  }

  function cleanTitle(raw) {
    if (!raw) return '';
    const m = raw.match(/^\$t\((.+)\)$/);
    if (m) {
      return m[1]
        .replace(/^service_title_/, '')
        .split('_')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
    return raw;
  }

  function formatSlotLabel(slot) {
    if (currentGranularity === 'hourly') {
      // slot = "2026-02-28T14:00"
      const hour = parseInt(slot.slice(11, 13), 10);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      return `${h12} ${ampm}`;
    }
    // daily: "2026-02-28"
    const d = new Date(slot);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatTooltipDate(slot) {
    if (currentGranularity === 'hourly') {
      // "2026-02-28T14:00" → "Feb 28, 2 PM"
      const d = new Date(slot.replace('T', ' ').replace(':00', ':00:00'));
      const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const hour = parseInt(slot.slice(11, 13), 10);
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      return `${datePart}, ${h12} ${ampm}`;
    }
    const d = new Date(slot);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /* ---------- Rendering ---------- */

  function renderBanner(overallStatus) {
    const banner = document.getElementById('overall-banner');
    const iconEl = document.getElementById('overall-icon');
    const textEl = document.getElementById('overall-text');
    const subEl = document.getElementById('overall-sub');

    const cfg = OVERALL_BANNERS[overallStatus] || OVERALL_BANNERS['All Systems Operational'];

    banner.className = `rounded-2xl p-6 mb-8 text-center border ${cfg.bg} ${cfg.border}`;
    iconEl.className = `inline-flex items-center justify-center w-12 h-12 rounded-full mb-3 text-white font-bold text-xl ${cfg.iconBg}`;
    iconEl.textContent = cfg.icon;
    textEl.className = `text-2xl font-semibold font-display ${cfg.text}`;
    textEl.textContent = overallStatus;
    subEl.textContent = `Last updated: ${new Date().toLocaleString()}`;
  }

  function renderService(service) {
    const allSlots = getTimeSlots();
    const dataMap = {};
    (service.daily || []).forEach(d => { dataMap[d.date] = d; });

    const cfg = STATUS_CONFIG[service.current_status] || STATUS_CONFIG.unknown;
    const title = cleanTitle(service.service_title) || service.service_alias || 'Unknown';

    const card = document.createElement('div');
    card.className = 'glass rounded-xl p-5';

    // Header row
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between mb-3';
    header.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full ${cfg.dotColor}"></span>
        <span class="font-semibold text-sm">${title}</span>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs ${cfg.textColor} font-medium">${cfg.label}</span>
        <span class="text-xs text-slate-400 dark:text-slate-500">${service.uptime_90d.toFixed(2)}% uptime</span>
      </div>
    `;
    card.appendChild(header);

    // Bar chart
    const barContainer = document.createElement('div');
    barContainer.className = 'flex items-end gap-px h-8';

    allSlots.forEach(slot => {
      const slotData = dataMap[slot];
      const wrapper = document.createElement('div');
      wrapper.className = 'bar-wrapper relative flex-1 h-full flex items-end';

      const bar = document.createElement('div');
      bar.className = 'w-full rounded-sm transition-all duration-150 hover:opacity-80 cursor-pointer';

      if (slotData) {
        const status = dayStatusFromUptime(slotData.uptime);
        const barCfg = STATUS_CONFIG[status];
        bar.className += ` ${barCfg.barColor}`;
        bar.style.height = '100%';

        const tooltip = document.createElement('div');
        tooltip.className = 'bar-tooltip px-2.5 py-1.5 rounded-lg text-xs bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-lg';
        tooltip.innerHTML = `
          <div class="font-medium">${formatTooltipDate(slot)}</div>
          <div>${slotData.uptime.toFixed(2)}% uptime</div>
          ${slotData.server_error_count > 0 ? `<div class="text-red-400 dark:text-red-600">${slotData.server_error_count} errors</div>` : ''}
        `;
        wrapper.appendChild(tooltip);
      } else {
        bar.className += ' bg-emerald-500';
        bar.style.height = '100%';
      }

      wrapper.appendChild(bar);
      barContainer.appendChild(wrapper);
    });

    card.appendChild(barContainer);

    // Date labels
    const dateLabels = document.createElement('div');
    dateLabels.className = 'flex justify-between mt-1.5 text-[10px] text-slate-400 dark:text-slate-500';
    const firstLabel = formatSlotLabel(allSlots[0]);
    const lastLabel = formatSlotLabel(allSlots[allSlots.length - 1]);
    dateLabels.innerHTML = `
      <span>${firstLabel}</span>
      <span>${service.uptime_90d.toFixed(2)}% uptime</span>
      <span>${lastLabel}</span>
    `;
    card.appendChild(dateLabels);

    return card;
  }

  function renderError(message) {
    const container = document.getElementById('services-container');
    container.innerHTML = `
      <div class="text-center py-12 text-slate-400">
        <p class="text-lg font-medium">Unable to load status data</p>
        <p class="text-sm mt-1">${message}</p>
        <button onclick="location.reload()" class="mt-4 px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm transition-colors">
          Retry
        </button>
      </div>
    `;
  }

  function updateRangeButtons() {
    document.querySelectorAll('.range-btn').forEach(btn => {
      const range = parseInt(btn.dataset.range, 10);
      if (range === currentDays) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  async function load() {
    try {
      const res = await fetch(`${API_BASE}?days=${currentDays}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      currentGranularity = data.granularity || (currentDays === 1 ? 'hourly' : 'daily');

      renderBanner(data.overall_status);
      updateRangeButtons();

      const container = document.getElementById('services-container');
      container.innerHTML = '';

      if (!data.services || data.services.length === 0) {
        container.innerHTML = '<p class="text-center text-slate-400 py-12">No services are being monitored yet.</p>';
        return;
      }

      data.services
        .sort((a, b) => (a.service_alias || '').localeCompare(b.service_alias || ''))
        .forEach(svc => {
          container.appendChild(renderService(svc));
        });

    } catch (err) {
      console.error('Failed to load status:', err);
      renderError(err.message);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentDays = parseInt(btn.dataset.range, 10);
        load();
      });
    });
    load();
  });

  // Auto-refresh every 5 minutes
  setInterval(load, 5 * 60 * 1000);
})();
