import "dotenv/config";
import crypto from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "../src/generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 };
const hashPassword = (p: string) => hash(p, ARGON2);

function dateOnly(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

async function main() {
  console.log("→ Seeding DESCO Attendance…");

  /* ---------------- global settings ---------------- */
  await prisma.setting.upsert({
    where: { id: "global" },
    update: {},
    create: { id: "global" },
  });

  /* ---------------- offices (geofences) ------------ */
  const offices = [
    {
      code: "HQ",
      name: "DESCO Head Office — Nikunja",
      address: "DESCO Bhaban, Nikunja-2, Khilkhet, Dhaka 1229",
      latitude: 23.8281,
      longitude: 90.4239,
      radiusMeters: 200,
    },
    {
      code: "ZN-MIRPUR",
      name: "Mirpur Zonal Office",
      address: "Mirpur-2, Dhaka 1216",
      latitude: 23.8069,
      longitude: 90.3687,
      radiusMeters: 150,
    },
    {
      code: "ZN-UTTARA",
      name: "Uttara Zonal Office",
      address: "Sector 7, Uttara, Dhaka 1230",
      latitude: 23.8759,
      longitude: 90.3795,
      radiusMeters: 150,
    },
    {
      code: "ZN-GULSHAN",
      name: "Gulshan Zonal Office",
      address: "Gulshan-1, Dhaka 1212",
      latitude: 23.7808,
      longitude: 90.4152,
      radiusMeters: 150,
    },
  ];

  for (const o of offices) {
    await prisma.office.upsert({
      where: { code: o.code },
      update: {},
      create: { ...o, timezone: "Asia/Dhaka" },
    });
  }
  const hq = await prisma.office.findUniqueOrThrow({ where: { code: "HQ" } });
  const mirpur = await prisma.office.findUniqueOrThrow({ where: { code: "ZN-MIRPUR" } });
  const uttara = await prisma.office.findUniqueOrThrow({ where: { code: "ZN-UTTARA" } });

  /* ---------------- departments -------------------- */
  const departments = [
    { code: "ITD", name: "Information Technology Division" },
    { code: "ENG", name: "Engineering & Operations" },
    { code: "FIN", name: "Finance & Accounts" },
    { code: "HRD", name: "Human Resources" },
    { code: "CSD", name: "Customer Service" },
    { code: "PRD", name: "Procurement" },
  ];
  for (const d of departments) {
    await prisma.department.upsert({
      where: { code: d.code },
      update: {},
      create: d,
    });
  }
  const itd = await prisma.department.findUniqueOrThrow({ where: { code: "ITD" } });
  const eng = await prisma.department.findUniqueOrThrow({ where: { code: "ENG" } });
  const hrd = await prisma.department.findUniqueOrThrow({ where: { code: "HRD" } });
  const csd = await prisma.department.findUniqueOrThrow({ where: { code: "CSD" } });

  /* ---------------- shifts ------------------------- */
  // Bangladesh government week: Sunday–Thursday (ISO 7,1,2,3,4)
  const general = await prisma.shift.upsert({
    where: { name: "General Shift" },
    update: {},
    create: {
      name: "General Shift",
      startTime: "09:00",
      endTime: "17:00",
      graceMinutes: 15,
      halfDayAfterMinutes: 180,
      minWorkMinutes: 480,
      workingDays: [7, 1, 2, 3, 4],
    },
  });

  await prisma.shift.upsert({
    where: { name: "Control Room — Morning" },
    update: {},
    create: {
      name: "Control Room — Morning",
      startTime: "06:00",
      endTime: "14:00",
      graceMinutes: 10,
      minWorkMinutes: 480,
      workingDays: [7, 1, 2, 3, 4, 5, 6],
    },
  });

  await prisma.shift.upsert({
    where: { name: "Control Room — Night" },
    update: {},
    create: {
      name: "Control Room — Night",
      startTime: "22:00",
      endTime: "06:00",
      graceMinutes: 10,
      minWorkMinutes: 480,
      workingDays: [7, 1, 2, 3, 4, 5, 6],
    },
  });

  /* ---------------- leave types -------------------- */
  const leaveTypes = [
    { code: "CL", name: "Casual Leave", daysPerYear: 10, color: "#0B7A3B" },
    { code: "SL", name: "Sick Leave", daysPerYear: 14, color: "#B45309" },
    { code: "EL", name: "Earned Leave", daysPerYear: 20, color: "#0E4C92" },
    { code: "ML", name: "Maternity Leave", daysPerYear: 112, color: "#9333EA" },
    { code: "LWP", name: "Leave Without Pay", daysPerYear: 0, paid: false, color: "#DC2626" },
  ];
  for (const lt of leaveTypes) {
    await prisma.leaveType.upsert({
      where: { code: lt.code },
      update: {},
      create: lt,
    });
  }

  /* ---------------- holidays ----------------------- */
  const year = new Date().getUTCFullYear();
  const holidays = [
    { date: `${year}-02-21`, name: "Shaheed Day / International Mother Language Day" },
    { date: `${year}-03-26`, name: "Independence Day" },
    { date: `${year}-04-14`, name: "Pahela Baishakh" },
    { date: `${year}-05-01`, name: "May Day" },
    { date: `${year}-08-15`, name: "National Mourning Day" },
    { date: `${year}-12-16`, name: "Victory Day" },
    { date: `${year}-12-25`, name: "Christmas Day" },
  ];
  for (const h of holidays) {
    await prisma.holiday.upsert({
      where: { date: dateOnly(h.date) },
      update: {},
      create: { date: dateOnly(h.date), name: h.name, type: "PUBLIC" },
    });
  }

  /* ---------------- users -------------------------- */
  const people = [
    {
      employeeCode: "DESCO-0001",
      name: "System Administrator",
      email: "admin@desco.gov.bd",
      password: "Admin@Desco2026",
      role: "SUPER_ADMIN" as const,
      designation: "System Administrator",
      departmentId: itd.id,
      officeId: hq.id,
    },
    {
      employeeCode: "DESCO-0002",
      name: "Nasrin Akter",
      email: "hr@desco.gov.bd",
      password: "Hr@Desco2026",
      role: "HR" as const,
      designation: "Deputy Manager (HR)",
      departmentId: hrd.id,
      officeId: hq.id,
    },
    {
      employeeCode: "DESCO-0003",
      name: "Mahedi Hasan",
      email: "mahedi@desco.gov.bd",
      password: "Employee@2026",
      role: "MANAGER" as const,
      designation: "Assistant Manager (IT)",
      departmentId: itd.id,
      officeId: hq.id,
    },
    {
      employeeCode: "DESCO-0004",
      name: "Rakibul Islam",
      email: "rakibul@desco.gov.bd",
      password: "Employee@2026",
      role: "EMPLOYEE" as const,
      designation: "Sub-Assistant Engineer",
      departmentId: eng.id,
      officeId: mirpur.id,
    },
    {
      employeeCode: "DESCO-0005",
      name: "Farhana Yesmin",
      email: "farhana@desco.gov.bd",
      password: "Employee@2026",
      role: "EMPLOYEE" as const,
      designation: "Customer Service Officer",
      departmentId: csd.id,
      officeId: uttara.id,
    },
    {
      employeeCode: "DESCO-0006",
      name: "Tanvir Ahmed",
      email: "tanvir@desco.gov.bd",
      password: "Employee@2026",
      role: "EMPLOYEE" as const,
      designation: "Assistant Engineer",
      departmentId: eng.id,
      officeId: hq.id,
    },
    {
      employeeCode: "DESCO-0007",
      name: "Sumaiya Rahman",
      email: "sumaiya@desco.gov.bd",
      password: "Employee@2026",
      role: "EMPLOYEE" as const,
      designation: "Programmer",
      departmentId: itd.id,
      officeId: hq.id,
    },
  ];

  for (const p of people) {
    const passwordHash = await hashPassword(p.password);
    await prisma.user.upsert({
      where: { email: p.email },
      update: {},
      create: {
        employeeCode: p.employeeCode,
        name: p.name,
        email: p.email,
        passwordHash,
        role: p.role,
        designation: p.designation,
        departmentId: p.departmentId,
        officeId: p.officeId,
        shiftId: general.id,
        status: "ACTIVE",
        joinedAt: new Date(`${year - 2}-01-15T00:00:00.000Z`),
      },
    });
  }

  /* ---------------- sample attendance -------------- */
  const employees = await prisma.user.findMany({
    where: { role: { in: ["EMPLOYEE", "MANAGER"] } },
    include: { office: true },
  });

  const today = new Date();
  let created = 0;

  for (let back = 1; back <= 21; back++) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - back);
    const iso = day.toISOString().slice(0, 10);
    const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();

    // Friday (5) and Saturday (6) are the weekend.
    if (weekday === 5 || weekday === 6) continue;

    for (const emp of employees) {
      const roll = Math.random();
      if (roll < 0.06) continue; // absent

      const lateMin = roll > 0.82 ? Math.floor(Math.random() * 45) + 16 : 0;
      const checkIn = new Date(`${iso}T03:00:00.000Z`); // 09:00 Asia/Dhaka
      checkIn.setUTCMinutes(checkIn.getUTCMinutes() + lateMin - (lateMin ? 0 : Math.floor(Math.random() * 20)));

      const workMinutes = 480 + Math.floor(Math.random() * 70) - 20;
      const checkOut = new Date(checkIn.getTime() + workMinutes * 60_000);

      const jitter = () => (Math.random() - 0.5) * 0.0008;
      const lat = (emp.office?.latitude ?? 23.8281) + jitter();
      const lng = (emp.office?.longitude ?? 90.4239) + jitter();

      await prisma.attendance.upsert({
        where: { userId_date: { userId: emp.id, date: dateOnly(iso) } },
        update: {},
        create: {
          userId: emp.id,
          date: dateOnly(iso),
          officeId: emp.officeId,
          checkInAt: checkIn,
          checkOutAt: checkOut,
          status: lateMin > 0 ? "LATE" : "PRESENT",
          source: "WEB",
          workedMinutes: workMinutes,
          lateMinutes: lateMin,
          checkInLat: lat,
          checkInLng: lng,
          checkInAccuracy: 8 + Math.random() * 20,
          checkInDistance: Math.random() * 60,
          checkOutLat: lat,
          checkOutLng: lng,
          checkOutAccuracy: 8 + Math.random() * 20,
          checkOutDistance: Math.random() * 60,
          riskScore: Math.random() > 0.92 ? 40 : 0,
          flagged: Math.random() > 0.95,
          flagReasons: Math.random() > 0.95 ? ["LOW_ACCURACY"] : [],
        },
      });
      created++;
    }
  }

  /* ---------------- simulated biometric enrolment ---------------- */
  // Demo mode: no camera or sensor exists, so these are synthetic records.
  // Each is stamped simulated = true and must never be read as real proof.
  const allUsers = await prisma.user.findMany();

  function syntheticDescriptor(seed: string): number[] {
    const out: number[] = [];
    let block = crypto.createHash("sha512").update(seed).digest();
    let cursor = 0;
    for (let i = 0; i < 1024; i++) {
      if (cursor + 2 > block.length) {
        block = crypto.createHash("sha512").update(block).digest();
        cursor = 0;
      }
      out.push(block.readUInt16BE(cursor) / 65535 - 0.5);
      cursor += 2;
    }
    const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
    return out.map((v) => v / norm);
  }

  let enrolled = 0;
  for (const u of allUsers) {
    const existingFace = await prisma.faceTemplate.findFirst({
      where: { userId: u.id, status: "ACTIVE" },
    });
    if (!existingFace) {
      await prisma.faceTemplate.create({
        data: {
          userId: u.id,
          descriptor: syntheticDescriptor(`${u.id}:FACE`),
          dimensions: 1024,
          quality: 0.92,
          liveness: 0.9,
          realScore: 0.9,
          status: "ACTIVE",
          simulated: true,
          label: "Simulated face template",
        },
      });
      enrolled++;
    }

    const existingCred = await prisma.webAuthnCredential.findFirst({
      where: { userId: u.id, status: "ACTIVE" },
    });
    if (!existingCred) {
      await prisma.webAuthnCredential.create({
        data: {
          userId: u.id,
          credentialId: `sim_${crypto.randomBytes(16).toString("base64url")}`,
          publicKey: "SIMULATED-NO-KEY-MATERIAL",
          algorithm: -7,
          status: "ACTIVE",
          simulated: true,
          userVerified: true,
          label: "Simulated fingerprint",
          transports: ["internal"],
        },
      });
      enrolled++;
    }
  }

  console.log(`✓ Seed complete. ${people.length} users, ${offices.length} offices, ${created} attendance rows, ${enrolled} simulated biometric records.`);
  console.log("");
  console.log("  Admin    : admin@desco.gov.bd    / Admin@Desco2026");
  console.log("  HR       : hr@desco.gov.bd       / Hr@Desco2026");
  console.log("  Employee : mahedi@desco.gov.bd   / Employee@2026");
  console.log("");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
