import type { ScoreRow, ScoreWeek } from "@/lib/types";

function escapeXml(value: string | number) {
  return String(value).replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function shortName(value: string) {
  return value.length > 12 ? `${value.slice(0, 11)}…` : value;
}

export function buildWeeklyReportSvg(input: {
  week: ScoreWeek;
  rows: ScoreRow[];
  sentDays: number;
}) {
  const { week, rows, sentDays } = input;
  const total = rows.reduce((sum, row) => sum + row.score, 0);
  const participants = rows.filter((row) => row.score > 0).length;
  const firstRound = rows.filter((row) => row.score >= 40).length;
  const laterRound = rows.filter((row) => row.score >= 60).length;
  const topRows = rows.slice(0, 5);
  const topList = topRows.map((row, index) => {
    const y = 750 + index * 112;
    return `<g>
      <rect x="84" y="${y}" width="1032" height="88" rx="22" fill="${index === 0 ? "#fff0dc" : "#fffaf1"}" stroke="#e4d7c3"/>
      <circle cx="132" cy="${y + 44}" r="25" fill="${index < 3 ? ["#dc642d", "#55765e", "#c39443"][index] : "#776c5d"}"/>
      <text x="132" y="${y + 53}" text-anchor="middle" class="rank">${index + 1}</text>
      <text x="184" y="${y + 54}" class="member">${escapeXml(shortName(row.displayName))}</text>
      <text x="1060" y="${y + 55}" text-anchor="end" class="score">${row.score} 分</text>
    </g>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1400" viewBox="0 0 1200 1400">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f8ebd3"/><stop offset="1" stop-color="#e5d6ba"/></linearGradient>
      <linearGradient id="head" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#19392c"/><stop offset="1" stop-color="#285440"/></linearGradient>
      <filter id="shadow"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-opacity=".16"/></filter>
      <style>
        text { font-family: "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; fill: #272922; }
        .eyebrow { font-size: 23px; font-weight: 700; letter-spacing: 5px; fill: #f3bb70; }
        .title { font-size: 62px; font-weight: 900; fill: #fff9ee; }
        .sub { font-size: 25px; fill: #d5dfd6; }
        .number { font-size: 47px; font-weight: 900; fill: #d95d28; }
        .label { font-size: 20px; fill: #766b5d; }
        .section { font-size: 32px; font-weight: 800; }
        .rank { font-size: 22px; font-weight: 900; fill: white; }
        .member { font-size: 27px; font-weight: 750; }
        .score { font-size: 27px; font-weight: 900; fill: #d95d28; }
      </style>
    </defs>
    <rect width="1200" height="1400" fill="url(#bg)"/>
    <circle cx="1080" cy="170" r="210" fill="#ef9d4c" opacity=".15"/><circle cx="70" cy="1320" r="250" fill="#2b5944" opacity=".1"/>
    <rect x="48" y="48" width="1104" height="1304" rx="42" fill="#fffaf0" filter="url(#shadow)"/>
    <path d="M90 48h1020a42 42 0 0 1 42 42v360H48V90a42 42 0 0 1 42-42z" fill="url(#head)"/>
    <text x="84" y="126" class="eyebrow">FORTRESS WEEKLY REPORT</text>
    <text x="84" y="218" class="title">不良人 · 每周要塞战报</text>
    <text x="84" y="274" class="sub">${escapeXml(week.title)}　·　${escapeXml(week.eventDate)}</text>
    <text x="84" y="365" class="sub">3767区 · 2组　每一分战绩，都有迹可循</text>
    <g>
      <rect x="84" y="492" width="240" height="150" rx="26" fill="#fff2e3"/><text x="112" y="552" class="label">组织总分</text><text x="112" y="612" class="number">${total}</text>
      <rect x="348" y="492" width="240" height="150" rx="26" fill="#eef4e8"/><text x="376" y="552" class="label">参战成员</text><text x="376" y="612" class="number">${participants}</text>
      <rect x="612" y="492" width="240" height="150" rx="26" fill="#f8f0d9"/><text x="640" y="552" class="label">60分达标</text><text x="640" y="612" class="number">${laterRound}</text>
      <rect x="876" y="492" width="240" height="150" rx="26" fill="#e8efeb"/><text x="904" y="552" class="label">已发包天数</text><text x="904" y="612" class="number">${sentDays}/8</text>
    </g>
    <text x="84" y="708" class="section">本周前五</text>
    ${topList}
    <text x="84" y="1340" class="label">第一轮资格 ${firstRound} 人　·　后续轮次资格 ${laterRound} 人　·　naruto.riordon.xyz</text>
  </svg>`;
}
