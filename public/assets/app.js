(() => {
  const DATA_BASE = './data';
  const STATUS_CONFIG = {
    operational: { label: 'Operational', barColor: 'bg-emerald-500', dotColor: 'bg-emerald-500', textColor: 'text-emerald-600 dark:text-emerald-400' },
    degraded: { label: 'Degraded', barColor: 'bg-yellow-400', dotColor: 'bg-yellow-400', textColor: 'text-yellow-600 dark:text-yellow-400' },
    partial_outage: { label: 'Partial Outage', barColor: 'bg-orange-500', dotColor: 'bg-orange-500', textColor: 'text-orange-600 dark:text-orange-400' },
    major_outage: { label: 'Major Outage', barColor: 'bg-red-500', dotColor: 'bg-red-500', textColor: 'text-red-600 dark:text-red-400' },
    unknown: { label: 'No Data', barColor: 'bg-slate-200 dark:bg-slate-700', dotColor: 'bg-slate-400 dark:bg-slate-500', textColor: 'text-slate-500 dark:text-slate-400' }
  };
  const OVERALL = {
    all_systems_operational: ['All Systems Operational', 'bg-emerald-50 dark:bg-emerald-950/30', 'border-emerald-200 dark:border-emerald-800/50', 'bg-emerald-500', 'text-emerald-700 dark:text-emerald-300', '✓'],
    minor_service_disruption: ['Minor Service Disruption', 'bg-yellow-50 dark:bg-yellow-950/30', 'border-yellow-200 dark:border-yellow-800/50', 'bg-yellow-500', 'text-yellow-700 dark:text-yellow-300', '!'],
    partial_system_outage: ['Partial System Outage', 'bg-orange-50 dark:bg-orange-950/30', 'border-orange-200 dark:border-orange-800/50', 'bg-orange-500', 'text-orange-700 dark:text-orange-300', '!'],
    major_system_outage: ['Major System Outage', 'bg-red-50 dark:bg-red-950/30', 'border-red-200 dark:border-red-800/50', 'bg-red-500', 'text-red-700 dark:text-red-300', '×'],
    no_data: ['Status Data Unavailable', 'bg-slate-50 dark:bg-slate-900/40', 'border-slate-300 dark:border-slate-700', 'bg-slate-500', 'text-slate-700 dark:text-slate-300', '?']
  };
  let currentDays = 1;
  let requestSequence = 0;
  let hasRenderedData = false;

  function formatDate(value) {
    return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function renderBanner(data) {
    const config = OVERALL[data.range.overall_status] || OVERALL.no_data;
    const banner = document.getElementById('overall-banner');
    banner.className = `rounded-2xl p-5 mb-6 text-center border ${config[1]} ${config[2]}`;
    const icon = document.getElementById('overall-icon');
    icon.className = `inline-flex items-center justify-center w-10 h-10 rounded-full mb-2 text-white font-bold text-lg ${config[3]}`;
    icon.textContent = config[5];
    const text = document.getElementById('overall-text');
    text.className = `text-xl font-semibold font-display ${config[4]}`;
    text.textContent = config[0];
    document.getElementById('overall-sub').textContent = `Generated ${formatDate(data.generated_at)} · Data through ${formatDate(data.data_through)}`;
    document.getElementById('stale-banner').hidden = !data.stale;
  }

  function tooltip(bucket) {
    const element = document.createElement('div');
    element.className = 'bar-tooltip px-2 py-1 rounded-md text-[11px] bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-lg';
    const date = document.createElement('div');
    date.className = 'font-medium';
    date.textContent = formatDate(bucket.started_at);
    const detail = document.createElement('div');
    detail.textContent = bucket.no_data ? 'No Data' : `${bucket.uptime.toFixed(1)}% uptime`;
    element.append(date, detail);
    return element;
  }

  function renderService(service) {
    const config = STATUS_CONFIG[service.status] || STATUS_CONFIG.unknown;
    const card = document.createElement('div');
    card.className = 'glass rounded-xl px-4 py-3';
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between mb-2';
    const identity = document.createElement('div');
    identity.className = 'flex items-center gap-2';
    const dot = document.createElement('span');
    dot.className = `w-2 h-2 rounded-full ${config.dotColor}`;
    const title = document.createElement('span');
    title.className = 'font-medium text-[13px]';
    title.textContent = service.title || service.alias;
    identity.append(dot, title);
    const summary = document.createElement('div');
    summary.className = 'flex items-center gap-2';
    const label = document.createElement('span');
    label.className = `text-[11px] ${config.textColor} font-medium`;
    label.textContent = config.label;
    const uptime = document.createElement('span');
    uptime.className = 'text-[11px] text-slate-400 dark:text-slate-500';
    uptime.textContent = service.uptime === null ? 'No Data' : `${service.uptime.toFixed(1)}%`;
    summary.append(label, uptime);
    header.append(identity, summary);

    const bars = document.createElement('div');
    bars.className = 'flex items-end gap-[1px] h-7';
    for (const bucket of service.buckets) {
      const wrapper = document.createElement('div');
      wrapper.className = 'bar-wrapper relative flex-1 h-full flex items-end';
      const bar = document.createElement('div');
      const bucketConfig = STATUS_CONFIG[bucket.status] || STATUS_CONFIG.unknown;
      bar.className = `w-full h-full rounded-[2px] transition-all duration-150 hover:opacity-75 cursor-pointer ${bucketConfig.barColor}`;
      wrapper.append(tooltip(bucket), bar);
      bars.appendChild(wrapper);
    }
    const labels = document.createElement('div');
    labels.className = 'flex justify-between mt-1 text-[10px] text-slate-400 dark:text-slate-500';
    const first = document.createElement('span');
    const middle = document.createElement('span');
    const last = document.createElement('span');
    first.textContent = service.buckets.length ? new Date(service.buckets[0].started_at).toLocaleDateString() : '';
    middle.textContent = service.uptime === null ? 'No Data' : `${service.uptime.toFixed(1)}% uptime`;
    last.textContent = service.buckets.length ? new Date(service.buckets.at(-1).started_at).toLocaleDateString() : '';
    labels.append(first, middle, last);
    card.append(header, bars, labels);
    return card;
  }

  function validResponse(data) {
    return data && data.schema_version === 1 && typeof data.generated_at === 'string' && typeof data.stale === 'boolean' && data.range && Array.isArray(data.range.services);
  }

  function renderError(message) {
    document.getElementById('stale-banner').hidden = false;
    const banner = document.getElementById('overall-banner');
    banner.className = 'rounded-2xl p-5 mb-6 text-center border bg-slate-50 dark:bg-slate-900/40 border-slate-300 dark:border-slate-700';
    const icon = document.getElementById('overall-icon');
    icon.className = 'inline-flex items-center justify-center w-10 h-10 rounded-full mb-2 text-white font-bold text-lg bg-slate-500';
    icon.textContent = '!';
    const overall = document.getElementById('overall-text');
    overall.className = 'text-xl font-semibold font-display text-slate-700 dark:text-slate-300';
    overall.textContent = 'Status Data Unavailable';
    document.getElementById('overall-sub').textContent = 'The latest status request failed.';
    const container = document.getElementById('services-container');
    container.replaceChildren();
    const box = document.createElement('div');
    box.className = 'text-center py-10 text-slate-400';
    const title = document.createElement('p');
    title.className = 'text-base font-medium';
    title.textContent = 'Unable to load status data';
    const detail = document.createElement('p');
    detail.className = 'text-sm mt-1';
    detail.textContent = message;
    box.append(title, detail);
    container.appendChild(box);
  }

  async function load() {
    const sequence = ++requestSequence;
    const requestedDays = currentDays;
    try {
      const response = await fetch(`${DATA_BASE}/status_${requestedDays}.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!validResponse(data)) throw new Error('Invalid status snapshot');
      if (sequence !== requestSequence || requestedDays !== currentDays) return;
      renderBanner(data);
      hasRenderedData = true;
      document.querySelectorAll('.range-btn').forEach((button) => button.classList.toggle('active', Number(button.dataset.range) === currentDays));
      const container = document.getElementById('services-container');
      container.replaceChildren();
      if (!data.range.services.length) {
        const empty = document.createElement('p');
        empty.className = 'text-center text-slate-400 py-10';
        empty.textContent = 'All monitored services are operational.';
        container.appendChild(empty);
      } else {
        [...data.range.services].sort((a, b) => a.alias.localeCompare(b.alias)).forEach((service) => container.appendChild(renderService(service)));
      }
    } catch (error) {
      if (sequence !== requestSequence || requestedDays !== currentDays) return;
      console.error('Failed to load status:', error);
      document.getElementById('stale-banner').hidden = false;
      if (!hasRenderedData) renderError(error instanceof Error ? error.message : String(error));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.range-btn').forEach((button) => button.addEventListener('click', () => {
      currentDays = Number(button.dataset.range);
      load();
    }));
    load();
  });
  setInterval(load, 60_000);
})();
