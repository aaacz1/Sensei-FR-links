import { chromium } from "playwright";
import { readFile, rename, writeFile } from "node:fs/promises";

const scheduleUrl = "https://kick.com/sensei_fr/schedule";
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({
    locale: "en-US",
    userAgent: "Mozilla/5.0 (compatible; SenseiFRScheduleBot/1.0)"
  });

  const response = await page.goto(scheduleUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  if (!response?.ok()) throw new Error(`Kick schedule returned HTTP ${response?.status() ?? "no response"}`);
  await page.waitForSelector("h3", { timeout: 30000 });

  const days = await page.evaluate(() => Array.from(document.querySelectorAll("section"))
    .map((section) => {
      const heading = section.querySelector(":scope > h3");
      if (!heading) return null;

      const streams = Array.from(section.querySelectorAll(":scope button")).map((button) => ({
        title: button.querySelector("p")?.textContent?.trim() || "לייב",
        time: button.querySelectorAll("p")[1]?.textContent?.trim() || "",
        category: button.querySelector("img")?.alt?.trim() || "Just Chatting",
        thumbnail: button.querySelector("img")?.src || null
      }));

      return {
        label: heading.textContent.replace("(Today)", "").trim(),
        streams
      };
    })
    .filter(Boolean));

  const currentYear = new Date().getUTCFullYear();
  const parseDate = (label) => {
    const normalized = label.replace(/\\s+/g, " ").trim();
    const withYear = /\\b\\d{4}\\b/.test(normalized) ? normalized : `${normalized}, ${currentYear}`;
    const parsed = new Date(`${withYear} 00:00:00 UTC`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const now = new Date();
  const weekStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - now.getUTCDay()
  ));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const currentWeek = days
    .map((day) => ({ ...day, date: parseDate(day.label) }))
    .filter((day) => day.date && day.date >= weekStart && day.date < weekEnd);

  if (currentWeek.length === 0) {
    throw new Error(`Kick schedule did not expose any dates for week ${weekStart.toISOString().slice(0, 10)}. Existing schedule.json was preserved.`);
  }

  const currentSchedule = JSON.parse(await readFile("schedule.json", "utf8"));
  const hasStreams = currentWeek.some((day) => day.streams.length > 0);
  if (!hasStreams && currentSchedule.weekStart === weekStart.toISOString().slice(0, 10) && currentSchedule.streams?.length > 0) {
    throw new Error("Kick page showed no streams although the saved current-week schedule has streams. Refusing to erase it; check Kick's page structure/API.");
  }

  const result = {
    updatedAt: new Date().toISOString(),
    weekStart: weekStart.toISOString().slice(0, 10),
    emptyDays: currentWeek
      .filter((day) => day.streams.length === 0)
      .map((day) => day.date.toISOString().slice(0, 10)),
    streams: currentWeek.flatMap((day) => day.streams.map((stream) => ({
      date: day.date.toISOString(),
      title: stream.title,
      time: stream.time,
      category: stream.category,
      thumbnail: stream.thumbnail
    })))
  };

  const output = `${JSON.stringify(result, null, 2)}\\n`;
  await writeFile("schedule.json.tmp", output, "utf8");
  await rename("schedule.json.tmp", "schedule.json");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
