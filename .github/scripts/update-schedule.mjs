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
  await page.waitForFunction(() => {
    const body = document.body.innerText;
    return body.includes("No streams locked in this month") ||
      Array.from(document.querySelectorAll("section > h3"))
        .some((heading) => /[A-Za-z]+\s+\d{1,2}/.test(heading.textContent || ""));
  }, null, { timeout: 30000 });

  const { days, noStreamsThisMonth } = await page.evaluate(() => ({
    noStreamsThisMonth: document.body.innerText.includes("No streams locked in this month"),
    days: Array.from(document.querySelectorAll("section"))
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
      .filter(Boolean)
  }));

  const jerusalemDateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(new Date());
  const jerusalemDate = Object.fromEntries(jerusalemDateParts.map(({ type, value }) => [type, value]));
  const localToday = new Date(Date.UTC(
    Number(jerusalemDate.year),
    Number(jerusalemDate.month) - 1,
    Number(jerusalemDate.day)
  ));
  const weekStart = new Date(localToday);
  weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const daysWithoutYear = days.map((day) => ({
    ...day,
    date: (() => {
      const match = day.label.match(/([A-Za-z]+)\s+(\d{1,2})/);
      if (!match) return null;
      const monthIndex = new Date(`${match[1]} 1, 2000 UTC`).getUTCMonth();
      if (Number.isNaN(monthIndex)) return null;
      const candidates = [Number(jerusalemDate.year) - 1, Number(jerusalemDate.year), Number(jerusalemDate.year) + 1]
        .map((year) => new Date(Date.UTC(year, monthIndex, Number(match[2]))));
      return candidates.sort((a, b) =>
        Math.abs(a.getTime() - localToday.getTime()) - Math.abs(b.getTime() - localToday.getTime())
      )[0];
    })()
  }));

  const currentWeek = daysWithoutYear.filter((day) => day.date && day.date >= weekStart && day.date < weekEnd);

  if (currentWeek.length === 0) {
    if (!noStreamsThisMonth) {
      const labels = days.map((day) => day.label).join(", ") || "none";
      throw new Error(`Kick schedule could not be read for Israel week ${weekStart.toISOString().slice(0, 10)}. Headings found: ${labels}. Existing schedule.json was preserved.`);
    }

    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(weekStart);
      date.setUTCDate(date.getUTCDate() + offset);
      currentWeek.push({ date, streams: [] });
    }
    console.log("Kick confirms there are no streams scheduled this month; publishing an empty week.");
  }

  const currentSchedule = JSON.parse(await readFile("schedule.json", "utf8"));
  const hasStreams = currentWeek.some((day) => day.streams.length > 0);
  if (!noStreamsThisMonth && !hasStreams && currentSchedule.weekStart === weekStart.toISOString().slice(0, 10) && currentSchedule.streams?.length > 0) {
    throw new Error("Kick page showed no streams although the saved current-week schedule has streams. Refusing to erase it; check Kick's page structure/API.");
  }

  const result = {
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

  const scheduleUnchanged =
    currentSchedule.weekStart === result.weekStart &&
    JSON.stringify(currentSchedule.emptyDays) === JSON.stringify(result.emptyDays) &&
    JSON.stringify(currentSchedule.streams) === JSON.stringify(result.streams);

  if (scheduleUnchanged) {
    console.log("Kick schedule is unchanged.");
  } else {
    result.updatedAt = new Date().toISOString();
    const output = `${JSON.stringify(result, null, 2)}\n`;
    await writeFile("schedule.json.tmp", output, "utf8");
    await rename("schedule.json.tmp", "schedule.json");
    console.log(JSON.stringify(result, null, 2));
  }
} finally {
  await browser.close();
}
