const { checkSlotAvailable } = require('./chatbot.js');

const mockBookings = [
  { date: "2026-06-10", time: "09:00" },
  { date: "2026-06-10", time: "09:30" }, // 2 bookings in hour 9
  { date: "2026-06-10", time: "10:15" }, // 1 booking in hour 10
  { date: "2026-06-10", time: "12:00" },
  { date: "2026-06-10", time: "12:59" }, // 2 bookings in hour 12
  { date: "2026-06-10", time: "17:30" }, // 1 booking in hour 17
];

const testCases = [
  {
    name: "Slot available in empty hour (11:00)",
    date: "2026-06-10",
    time: "11:00",
    expected: true
  },
  {
    name: "Slot available when only 1 booking exists in the hour (10:00)",
    date: "2026-06-10",
    time: "10:00",
    expected: true
  },
  {
    name: "Slot unavailable when 2 bookings exist in the hour (09:15)",
    date: "2026-06-10",
    time: "09:15",
    expected: false
  },
  {
    name: "Slot unavailable when 2 bookings exist in the hour (12:30)",
    date: "2026-06-10",
    time: "12:30",
    expected: false
  },
  {
    name: "Slot unavailable before operating hours (08:30)",
    date: "2026-06-10",
    time: "08:30",
    expected: false
  },
  {
    name: "Slot unavailable after operating hours (18:00)",
    date: "2026-06-10",
    time: "18:00",
    expected: false
  },
  {
    name: "Slot unavailable after operating hours (19:30)",
    date: "2026-06-10",
    time: "19:30",
    expected: false
  },
  {
    name: "Slot available in late booking hour (17:00)",
    date: "2026-06-10",
    time: "17:00",
    expected: true
  }
];

let failed = false;
console.log("Starting Slot Availability Logic Tests...");
console.log("-----------------------------------------");

for (const tc of testCases) {
  const result = checkSlotAvailable(mockBookings, tc.date, tc.time);
  if (result === tc.expected) {
    console.log(`✅ PASS: ${tc.name}`);
  } else {
    console.error(`❌ FAIL: ${tc.name} | Got: ${result}, Expected: ${tc.expected}`);
    failed = true;
  }
}

console.log("-----------------------------------------");
if (failed) {
  console.error("Some tests FAILED.");
  process.exit(1);
} else {
  console.log("All slot checking tests PASSED successfully!");
  process.exit(0);
}
