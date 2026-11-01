// A small, consistent icon set (24px grid, 1.75 stroke). Inline SVG so there is nothing to download and no extra package.
const P: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V20h5v-6h4v6h5V9.5",
  users: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm10 8v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.2a3.5 3.5 0 0 1 0 6.6",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  grip: "M9 5.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Z M15 5.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Z M9 11.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Z M15 11.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Z M9 17.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Z M15 17.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2Z",
  layers: "m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 17.5l9 5 9-5",
  briefcase: "M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Zm5-3h6a1 1 0 0 1 1 1v2H8V6a1 1 0 0 1 1-1ZM4 13h16",
  wallet: "M4 7.5A2.5 2.5 0 0 1 6.5 5H19v3M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5ZM16 13.5h.01",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  calendar: "M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-2.6.9.7-1.5 2.6-1.1-.4a7 7 0 0 1-1.7 1l-.2 1.2h-3l-.2-1.2a7 7 0 0 1-1.7-1l-1.1.4-1.5-2.6.9-.7a7 7 0 0 1 0-2l-.9-.7 1.5-2.6 1.1.4a7 7 0 0 1 1.7-1l.2-1.2h3l.2 1.2a7 7 0 0 1 1.7 1l1.1-.4 1.5 2.6-.9.7a7 7 0 0 1 0 2Z",
  search: "m21 21-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4a2 2 0 0 0 4 0",
  plus: "M12 5v14M5 12h14",
  chevron: "m9 6 6 6-6 6",
  down: "m6 9 6 6 6-6",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6 6 18",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z",
  chart: "M4 20V10m6 10V4m6 16v-8m5 8H3",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3 2",
  shield: "M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Zm-3 9 2 2 4-4",
  sparkles: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Zm7 11 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z",
  mail: "M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm0 1 8 6 8-6",
  file: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm7 0v5h5",
  building: "M5 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M15 10h3a1 1 0 0 1 1 1v10M3 21h18M9 8h2M9 12h2M9 16h2",
  check: "m5 12.5 4.5 4.5L19 7.5",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10",
  activity: "M3 12h4l3 8 4-16 3 8h4",
  truck: "M3 7h11v9H3V7Zm11 3h4l3 3v3h-7M7 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  key: "M14.5 9.5a4.5 4.5 0 1 1-4.1 6.3L3 16v-3h3v-2h2.1l2.3-2.3a4.5 4.5 0 0 1 4.1-1.2ZM16.5 8.5h.01",
  video: "M3 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm12 3.5 6-3.5v10l-6-3.5",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm-6-3a6 6 0 0 0 12 0M12 18v3",
  micoff: "M3 3l18 18M9 9v3a3 3 0 0 0 5 2.2M15 10V6a3 3 0 0 0-5.7-1.3M6 12a6 6 0 0 0 9.5 4.9M12 18v3",
  videooff: "M3 3l18 18M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2m0-4.5 6 3.5V7l-6 3.5",
  screen: "M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm5 15h6m-3-3v3",
  chat: "M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  edit: "M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Zm9-13 3 3",
  pin: "M12 17v5m-4-9 1-8h6l1 8m-8 0h8l1.5 4h-11L8 13Z",
};

export type IconName = keyof typeof P;

export default function Icon({ name, className = "h-[18px] w-[18px]" }: { name: IconName | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      <path d={P[name] ?? P.folder} />
    </svg>
  );
}
