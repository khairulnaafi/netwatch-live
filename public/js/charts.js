/* Lightweight canvas charts — no external dependencies. */
(function () {
  'use strict';

  const DPR = () => Math.min(window.devicePixelRatio || 1, 2);

  function niceMax(value) {
    if (!Number.isFinite(value) || value <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const norm = value / magnitude;
    let nice;
    if (norm <= 1) nice = 1;
    else if (norm <= 2) nice = 2;
    else if (norm <= 2.5) nice = 2.5;
    else if (norm <= 5) nice = 5;
    else nice = 10;
    return nice * magnitude;
  }

  function formatTick(value) {
    if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
    if (value >= 100) return String(Math.round(value));
    if (value >= 10) return String(Math.round(value));
    if (value >= 1) return String(Math.round(value * 10) / 10);
    return String(Math.round(value * 100) / 100);
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function hexToRgba(hex, alpha) {
    const clean = String(hex).replace('#', '');
    const value = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const num = parseInt(value, 16);
    if (Number.isNaN(num)) return `rgba(34, 211, 238, ${alpha})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  class LineChart {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.options = {
        yFormat: (v) => formatTick(v),
        xFormat: (t) => {
          const d = new Date(t);
          return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        },
        tooltipFormat: null,
        fill: true,
        lineWidth: 1.8,
        minY: 0,
        maxY: null,
        ...options,
      };
      this.labels = [];
      this.series = [];
      this.mouse = null;
      this.pad = { top: 12, right: 12, bottom: 22, left: 42 };
      this.rect = { width: 0, height: 0 };

      this.onMove = this.onMove.bind(this);
      this.onLeave = this.onLeave.bind(this);
      canvas.addEventListener('mousemove', this.onMove);
      canvas.addEventListener('mouseleave', this.onLeave);

      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(canvas.parentElement || canvas);
      this.resize();
    }

    resize() {
      const parent = this.canvas.parentElement || this.canvas;
      const rect = parent.getBoundingClientRect();
      const width = Math.max(40, rect.width);
      const height = Math.max(40, rect.height);
      const dpr = DPR();
      this.rect = { width, height };
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    }

    setData(labels, series) {
      this.labels = labels || [];
      this.series = (series || []).map((s) => ({ ...s, data: s.data || [] }));
      this.draw();
    }

    onMove(event) {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      this.draw();
    }

    onLeave() {
      this.mouse = null;
      this.draw();
    }

    destroy() {
      this.ro.disconnect();
      this.canvas.removeEventListener('mousemove', this.onMove);
      this.canvas.removeEventListener('mouseleave', this.onLeave);
    }

    bounds() {
      const all = [];
      for (const s of this.series) for (const v of s.data) if (v != null && Number.isFinite(v)) all.push(v);
      let max = all.length ? Math.max(...all) : 1;
      if (this.options.maxY != null) max = this.options.maxY;
      const yMax = Math.max(niceMax(max), this.options.minY || 0, 0.001);
      return { yMax, yMin: this.options.minY || 0 };
    }

    draw() {
      const ctx = this.ctx;
      const { width, height } = this.rect;
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);

      const pad = this.pad;
      const plotW = Math.max(1, width - pad.left - pad.right);
      const plotH = Math.max(1, height - pad.top - pad.bottom);
      const { yMax, yMin } = this.bounds();
      const count = this.labels.length;

      ctx.font = '9px "Cascadia Code", Consolas, monospace';
      ctx.textBaseline = 'middle';

      // Horizontal grid + y labels
      const rows = 4;
      for (let i = 0; i <= rows; i += 1) {
        const ratio = i / rows;
        const y = pad.top + plotH * ratio;
        const value = yMax - (yMax - yMin) * ratio;
        ctx.beginPath();
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
        ctx.lineWidth = 1;
        ctx.moveTo(pad.left, y);
        ctx.lineTo(width - pad.right, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(139, 155, 182, 0.75)';
        ctx.textAlign = 'right';
        ctx.fillText(this.options.yFormat(value), pad.left - 8, y);
      }

      if (!count) {
        ctx.fillStyle = 'rgba(100, 116, 139, 0.8)';
        ctx.textAlign = 'center';
        ctx.fillText('Belum ada data', width / 2, height / 2);
        return;
      }

      const xAt = (i) => (count === 1 ? pad.left + plotW / 2 : pad.left + (plotW * i) / (count - 1));
      const yAt = (v) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

      // X labels
      const ticks = Math.min(5, count);
      ctx.fillStyle = 'rgba(100, 116, 139, 0.85)';
      ctx.textAlign = 'center';
      for (let i = 0; i < ticks; i += 1) {
        const index = Math.round((i / Math.max(1, ticks - 1)) * (count - 1));
        const label = this.options.xFormat(this.labels[index], index);
        const x = xAt(index);
        if (i === 0) ctx.textAlign = 'left';
        else if (i === ticks - 1) ctx.textAlign = 'right';
        else ctx.textAlign = 'center';
        ctx.fillText(label, x, height - 8);
      }

      // Series
      for (const s of this.series) {
        const color = s.color || '#22d3ee';
        const data = s.data;
        let segment = [];

        const drawSegment = (points) => {
          if (!points.length) return;
          if (points.length === 1) {
            ctx.beginPath();
            ctx.arc(points[0].x, points[0].y, 2, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            return;
          }
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length - 1; i += 1) {
            const xc = (points[i].x + points[i + 1].x) / 2;
            const yc = (points[i].y + points[i + 1].y) / 2;
            ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
          }
          const last = points[points.length - 1];
          ctx.lineTo(last.x, last.y);
          ctx.strokeStyle = color;
          ctx.lineWidth = this.options.lineWidth;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.shadowColor = hexToRgba(color, 0.45);
          ctx.shadowBlur = 7;
          ctx.stroke();
          ctx.shadowBlur = 0;

          if (this.options.fill && s.fill !== false) {
            const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
            gradient.addColorStop(0, hexToRgba(color, 0.22));
            gradient.addColorStop(1, hexToRgba(color, 0));
            ctx.beginPath();
            ctx.moveTo(points[0].x, pad.top + plotH);
            ctx.lineTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length - 1; i += 1) {
              const xc = (points[i].x + points[i + 1].x) / 2;
              const yc = (points[i].y + points[i + 1].y) / 2;
              ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
            }
            ctx.lineTo(last.x, last.y);
            ctx.lineTo(last.x, pad.top + plotH);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();
          }
        };

        data.forEach((value, i) => {
          if (value == null || !Number.isFinite(value)) {
            drawSegment(segment);
            segment = [];
          } else {
            segment.push({ x: xAt(i), y: yAt(value), value, index: i });
          }
        });
        drawSegment(segment);
      }

      // Hover crosshair
      if (this.mouse && this.mouse.x >= pad.left && this.mouse.x <= width - pad.right) {
        const ratio = (this.mouse.x - pad.left) / plotW;
        const index = Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
        const x = xAt(index);
        ctx.beginPath();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 1;
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        const lines = [];
        for (const s of this.series) {
          const value = s.data[index];
          if (value == null || !Number.isFinite(value)) continue;
          const y = yAt(value);
          ctx.beginPath();
          ctx.arc(x, y, 2.6, 0, Math.PI * 2);
          ctx.fillStyle = s.color || '#22d3ee';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x, y, 4.8, 0, Math.PI * 2);
          ctx.strokeStyle = hexToRgba(s.color || '#22d3ee', 0.35);
          ctx.lineWidth = 1;
          ctx.stroke();
          lines.push({
            name: s.name || '',
            color: s.color || '#22d3ee',
            text: this.options.tooltipFormat
              ? this.options.tooltipFormat(s, value)
              : this.options.yFormat(value),
          });
        }

        const timeLabel = this.options.xFormat(this.labels[index], index);
        const boxW = 132;
        const boxH = 24 + lines.length * 14 + 10;
        let boxX = x + 12;
        if (boxX + boxW > width - 4) boxX = x - boxW - 12;
        boxX = Math.max(4, boxX);
        let boxY = this.mouse.y - boxH / 2;
        boxY = Math.max(4, Math.min(height - boxH - 4, boxY));

        ctx.fillStyle = 'rgba(9, 16, 28, 0.96)';
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
        ctx.lineWidth = 1;
        roundRect(ctx, boxX, boxY, boxW, boxH, 7);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '9px "Cascadia Code", Consolas, monospace';
        ctx.fillStyle = 'rgba(139, 155, 182, 0.9)';
        ctx.fillText(timeLabel, boxX + 9, boxY + 12);
        lines.forEach((line, i) => {
          const ly = boxY + 27 + i * 14;
          ctx.beginPath();
          ctx.arc(boxX + 12, ly, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = line.color;
          ctx.fill();
          ctx.fillStyle = 'rgba(232, 238, 251, 0.92)';
          ctx.fillText(line.name.slice(0, 12), boxX + 19, ly);
          ctx.textAlign = 'right';
          ctx.fillStyle = 'rgba(232, 238, 251, 0.95)';
          ctx.fillText(line.text, boxX + boxW - 9, ly);
          ctx.textAlign = 'left';
        });
      }
    }
  }

  function sparkline(canvas, values, color, options = {}) {
    if (!canvas) return;
    const parent = canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect();
    const width = Math.max(20, options.width || canvas.clientWidth || rect.width || 80);
    const height = Math.max(12, options.height || canvas.clientHeight || 28);
    const dpr = DPR();
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const data = (values || []).filter((v) => v != null && Number.isFinite(v));
    if (data.length < 2) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.beginPath();
      ctx.moveTo(0, height - 3);
      ctx.lineTo(width, height - 3);
      ctx.stroke();
      return;
    }
    const max = Math.max(...data);
    const min = Math.min(...data);
    const flat = max === min;
    const span = max - min || 1;
    const pad = 3;
    const points = data.map((value, i) => ({
      x: (i / (data.length - 1)) * width,
      y: flat ? height / 2 : pad + (1 - (value - min) / span) * (height - pad * 2),
    }));

    ctx.beginPath();
    ctx.moveTo(points[0].x, height);
    ctx.lineTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.lineTo(points[points.length - 1].x, height);
    ctx.closePath();
    if (!flat) {
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, hexToRgba(color, 0.22));
      gradient.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(last.x - 1, last.y, 1.7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  window.NWCharts = { LineChart, sparkline, formatTick, hexToRgba };
})();
