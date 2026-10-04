/**
 * DEMO DATA — development only. Clearly labelled, never production.
 *
 *   npm run seed:demo
 *
 * Creates a few brands suffixed "(demo)" and placeholder people on
 * @demo.photoxo.test (status INVITED, no password → they cannot sign in),
 * then assigns them to brand roles through the real services, so audit
 * logs and invariants (primary uploader, compatibility) apply as usual.
 * Demo shoots (titles end in "(demo)") are scheduled around today, crewed by
 * the first ACTIVE staff account (placeholders cannot be crew), including one
 * deliberate, audited crew overlap so the conflict UI has something to show.
 * Stage 8 adds: a manager placeholder, a third brand, a posted-and-revised
 * item (V1 posting history kept, V2 in progress) and demo expenses in every
 * state, submitted by the first ACTIVE staff account and decided by the admin.
 * Notifications are produced by the services themselves, as in production.
 * No passwords or secrets are created here.
 * Idempotent: re-running skips what already exists.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const PEOPLE = [
  ["Karan Mehta", "STAFF"],
  ["Aman Gupta", "STAFF"],
  ["Rohit Verma", "STAFF"],
  ["Vikas Rao", "STAFF"],
  ["Priya Nair", "STAFF"],
  ["Neha Kapoor", "STAFF"],
  ["Mohit Jain", "STAFF"],
  ["Amit Shah", "CLIENT"],
  ["Sanjana Iyer", "MANAGER"],
] as const;

const BRANDS: { name: string; description: string; team: [string, string][] }[] = [
  {
    name: "Mamaearth (demo)",
    description: "Demo brand. Natural personal-care products; warm, mother-and-baby tone.",
    team: [
      ["Karan Mehta", "VIDEOGRAPHER"],
      ["Aman Gupta", "EDITOR"],
      ["Rohit Verma", "EDITOR"],
      ["Vikas Rao", "PHOTOGRAPHER"],
      ["Priya Nair", "DESIGNER"],
      ["Neha Kapoor", "UPLOADER"],
      ["Mohit Jain", "UPLOADER"],
      ["Amit Shah", "CLIENT"],
    ],
  },
  {
    name: "Adidas (demo)",
    description: "Demo brand. Sportswear; energetic, athlete-first content.",
    team: [
      ["Karan Mehta", "VIDEOGRAPHER"],
      ["Karan Mehta", "EDITOR"],
      ["Priya Nair", "DESIGNER"],
      ["Mohit Jain", "UPLOADER"],
    ],
  },
  {
    name: "boAt (demo)",
    description: "Demo brand. Consumer audio; bold, youthful product content.",
    team: [
      ["Vikas Rao", "PHOTOGRAPHER"],
      ["Rohit Verma", "EDITOR"],
      ["Neha Kapoor", "UPLOADER"],
    ],
  },
];

async function main() {
  const { env } = await import("../src/lib/env");
  if (env.NODE_ENV === "production") throw new Error("seed:demo refuses to run in production.");

  const { connectDb, disconnectDb } = await import("../src/server/db/connect");
  const { UserModel, BrandModel } = await import("../src/server/db/models");
  const { insertUser } = await import("../src/server/repositories/users.repo");
  const { createBrand } = await import("../src/server/services/brands.service");
  const { addMember } = await import("../src/server/services/brand-team.service");
  const { createBrief } = await import("../src/server/services/content.service");
  const { createShoot } = await import("../src/server/services/shoots.service");
  const { createBriefSchema } = await import("../src/features/content/schemas");
  const { createShootSchema } = await import("../src/features/shoots/schemas");
  const { ShootModel } = await import("../src/server/db/models");
  const { addDays, todayInTimeZone } = await import("../src/lib/dates");

  await connectDb();
  try {
    const admin = await UserModel.findOne({ role: "ADMIN", status: "ACTIVE" }).lean();
    if (!admin) throw new Error("Run `npm run create-admin` first.");
    const actor = {
      userId: String(admin._id),
      agencyId: String(admin.agencyId),
      systemRole: admin.role,
      name: admin.name,
      email: admin.email,
      image: null,
    } as const;

    const ids = new Map<string, string>();
    for (const [name, role] of PEOPLE) {
      const email = `${name.split(" ")[0]!.toLowerCase()}@demo.photoxo.test`;
      const existing = await UserModel.findOne({ email }).lean();
      const user =
        existing ??
        (await insertUser({
          agencyId: actor.agencyId,
          name,
          email,
          emailVerified: false,
          image: null,
          role,
          status: "INVITED",
          invitedBy: actor.userId,
          invitedAt: new Date(),
          activatedAt: null,
          suspendedAt: null,
          deactivatedAt: null,
        }));
      ids.set(name, String(user._id));
    }

    for (const b of BRANDS) {
      const existing = await BrandModel.findOne({ agencyId: admin.agencyId, name: b.name }).lean();
      const brandId =
        existing?._id.toString() ??
        (
          await createBrand(actor, {
            name: b.name,
            description: b.description,
            logoUrl: null,
            status: "ACTIVE",
            socialHandles: [
              {
                platform: "INSTAGRAM",
                url: "https://instagram.com/",
                handle: "@demo",
                label: null,
              },
              { platform: "WEBSITE", url: "https://example.com/", handle: null, label: null },
            ],
          })
        ).id;
      for (const [person, role] of b.team) {
        await addMember(actor, { brandId, userId: ids.get(person)!, role: role as never }).catch(
          (e: Error) => {
            if (!/Already assigned/.test(e.message)) throw e;
          },
        );
      }
      console.log(`✔ ${b.name}`);
    }
    await seedShoots();
    await seedApprovals();
    await seedPosting();
    await seedRevision();
    await seedExpenses();
    console.log("\nDemo data ready (people are INVITED placeholders and cannot sign in).");

    function staffActor(u: {
      _id: unknown;
      agencyId: unknown;
      role: string;
      name: string;
      email: string;
    }) {
      return {
        userId: String(u._id),
        agencyId: String(u.agencyId),
        systemRole: u.role,
        name: u.name,
        email: u.email,
        image: null,
      } as never;
    }
    async function realStaff() {
      return UserModel.findOne({
        agencyId: admin!.agencyId,
        role: "STAFF",
        status: "ACTIVE",
        email: { $not: /@demo\.photoxo\.test$/ },
      }).lean();
    }

    /**
     * Post-publication revision demo: approved → posted on Instagram + Facebook
     * by the real staff uploader → admin starts a revision. V1 and its posts stay.
     */
    async function seedRevision() {
      const title = "Festive gift box reel (demo)";
      const { ContentModel } = await import("../src/server/db/models");
      if (await ContentModel.exists({ agencyId: admin!.agencyId, title })) return;
      const staff = await realStaff();
      const clientUser = await UserModel.findOne({
        agencyId: admin!.agencyId,
        role: "CLIENT",
        status: "ACTIVE",
        email: { $not: /@demo\.photoxo\.test$/ },
      }).lean();
      if (!staff || !clientUser)
        return console.log("· Need ACTIVE staff + client accounts — skipping the revision demo.");
      const { createVersion } = await import("../src/server/services/versions.service");
      const approvals = await import("../src/server/services/approvals.service");
      const { confirmPosted } = await import("../src/server/services/postings.service");
      const { setUploaderOverride } = await import("../src/server/services/content.service");
      const { confirmPostedSchema, startRevisionSchema } =
        await import("../src/features/postings/schemas");
      const brand = await BrandModel.findOne({
        agencyId: admin!.agencyId,
        name: "Mamaearth (demo)",
      }).lean();
      const brandId = String(brand!._id);
      await addMember(actor, {
        brandId,
        userId: String(staff._id),
        role: "UPLOADER" as never,
      }).catch((e: Error) => {
        if (!/Already assigned/.test(e.message)) throw e;
      });
      const { id } = await createBrief(
        actor,
        createBriefSchema.parse({
          brandId,
          title,
          contentType: "REEL",
          origin: "ADMIN_BRIEF",
          targetPlatforms: ["INSTAGRAM", "FACEBOOK"],
        }),
      );
      await setUploaderOverride(actor, id, String(staff._id));
      const v1 = (
        await createVersion(actor, {
          contentId: id,
          assetIds: [],
          links: [{ url: "https://www.canva.com/design/demo/view", label: "Gift box reel – V1" }],
          caption: "Gift goodness this festive season 🎁",
          hashtags: ["mamaearth", "giftbox"],
          changeNote: "first cut",
        })
      ).id;
      await approvals.submitForInternalReview(actor, { contentId: id, versionId: v1 });
      await approvals.decideInternalReview(actor, {
        contentId: id,
        versionId: v1,
        decision: "APPROVED",
        comment: "Ready for the client.",
      });
      await approvals.decideClientReview(staffActor(clientUser), {
        contentId: id,
        versionId: v1,
        decision: "APPROVED",
        comment: "Perfect.",
      });
      for (const platform of ["INSTAGRAM", "FACEBOOK"] as const) {
        await confirmPosted(
          staffActor(staff),
          confirmPostedSchema.parse({
            contentId: id,
            versionId: v1,
            platform,
            postUrl: `https://www.${platform.toLowerCase()}.com/p/demo-gift-box`,
          }),
        );
      }
      await approvals.startRevision(
        actor,
        startRevisionSchema.parse({
          contentId: id,
          reason: "Client asked for an updated price card after launch.",
        }),
      );
      console.log(`✔ ${title} · posted (V1) → revision started`);
    }

    /** Demo expenses in every state, owned by the real staff account; decisions by the admin. */
    async function seedExpenses() {
      const { ExpenseModel, ShootModel: Shoots } = await import("../src/server/db/models");
      if (await ExpenseModel.exists({ agencyId: admin!.agencyId, title: / \(demo\)$/ })) return;
      const staff = await realStaff();
      if (!staff) return console.log("· No ACTIVE staff account — skipping demo expenses.");
      const exp = await import("../src/server/services/expenses.service");
      const { createExpenseSchema, decideExpenseSchema } =
        await import("../src/features/expenses/schemas");
      const me = staffActor(staff);
      const brand = await BrandModel.findOne({
        agencyId: admin!.agencyId,
        name: "Mamaearth (demo)",
      }).lean();
      const shoot = await Shoots.findOne({
        agencyId: admin!.agencyId,
        title: "Summer skincare reels (demo)",
      }).lean();
      const today = todayInTimeZone("Asia/Kolkata");
      const rows = [
        {
          title: "Cab to Andheri studio (demo)",
          category: "TRAVEL",
          amount: "640",
          day: 0,
          shoot: true,
          submit: true,
          decide: "APPROVED",
        },
        {
          title: "Crew lunch (demo)",
          category: "FOOD",
          amount: "1,850.50",
          day: 0,
          shoot: true,
          submit: true,
          decide: null,
        },
        {
          title: "Props: flowers and trays (demo)",
          category: "PROPS",
          amount: "2400",
          day: -2,
          shoot: false,
          submit: true,
          decide: "REJECTED",
        },
        {
          title: "Extra SD card (demo)",
          category: "EQUIPMENT",
          amount: "1299",
          day: -5,
          shoot: false,
          submit: false,
          decide: null,
        },
      ] as const;
      for (const r of rows) {
        const { id } = await exp.createExpense(
          me,
          createExpenseSchema.parse({
            title: r.title,
            category: r.category,
            amount: r.amount,
            incurredOn: addDays(today, r.day),
            brandId: String(brand!._id),
            shootId: r.shoot && shoot ? String(shoot._id) : null,
            receiptUrl: "https://example.com/receipt-demo.pdf",
            submit: r.submit,
          }),
        );
        if (r.decide) {
          await exp.decideExpense(
            actor,
            decideExpenseSchema.parse({
              expenseId: id,
              decision: r.decide,
              reason:
                r.decide === "REJECTED"
                  ? "Props were covered by the client — please check with them."
                  : null,
            }),
          );
        }
        console.log(`✔ ${r.title} · ${r.decide ?? (r.submit ? "submitted" : "draft")}`);
      }
    }

    /**
     * Posting demo: demo items without platforms get Instagram + Facebook,
     * and READY_TO_POST demo items are routed (per-content override) to the
     * first ACTIVE non-demo STAFF account, made an UPLOADER on the brand.
     */
    async function seedPosting() {
      const { ContentModel } = await import("../src/server/db/models");
      const { setTargetPlatforms } = await import("../src/server/services/postings.service");
      const { setUploaderOverride } = await import("../src/server/services/content.service");
      const staff = await UserModel.findOne({
        agencyId: admin!.agencyId,
        role: "STAFF",
        status: "ACTIVE",
        email: { $not: /@demo\.photoxo\.test$/ },
      }).lean();
      const demo = await ContentModel.find({
        agencyId: admin!.agencyId,
        title: / \(demo\)$/,
        status: { $nin: ["CANCELLED", "COMPLETED", "POSTED"] },
      }).lean();
      for (const c of demo) {
        if ((c.targetPlatforms ?? []).length === 0) {
          await setTargetPlatforms(actor, {
            contentId: String(c._id),
            platforms: ["INSTAGRAM", "FACEBOOK"],
          });
        }
      }
      if (!staff) return;
      for (const c of demo.filter((d) => d.status === "READY_TO_POST")) {
        await addMember(actor, {
          brandId: String(c.brandId),
          userId: String(staff._id),
          role: "UPLOADER" as never,
        }).catch((e: Error) => {
          if (!/Already assigned/.test(e.message)) throw e;
        });
        if (String(c.uploaderOverrideId) !== String(staff._id))
          await setUploaderOverride(actor, String(c._id), String(staff._id));
        console.log(`✔ ${c.title} · routed to ${staff.name} for posting`);
      }
    }

    /**
     * Demo review states (titles end in "(demo)"), driven through the real
     * approval service so records, audit and invariants are genuine. The
     * client side uses the first ACTIVE non-demo CLIENT account, if any.
     */
    async function seedApprovals() {
      const { createVersion } = await import("../src/server/services/versions.service");
      const approvals = await import("../src/server/services/approvals.service");
      const { ContentModel } = await import("../src/server/db/models");
      const clientUser = await UserModel.findOne({
        agencyId: admin!.agencyId,
        role: "CLIENT",
        status: "ACTIVE",
        email: { $not: /@demo\.photoxo\.test$/ },
      }).lean();
      if (!clientUser) {
        console.log("· No ACTIVE client account — skipping demo approvals.");
        return;
      }
      const brand = await BrandModel.findOne({
        agencyId: admin!.agencyId,
        name: "Mamaearth (demo)",
      }).lean();
      await addMember(actor, {
        brandId: String(brand!._id),
        userId: String(clientUser._id),
        role: "CLIENT" as never,
      }).catch((e: Error) => {
        if (!/Already assigned/.test(e.message)) throw e;
      });
      const clientActor = {
        userId: String(clientUser._id),
        agencyId: String(clientUser.agencyId),
        systemRole: clientUser.role,
        name: clientUser.name,
        email: clientUser.email,
        image: null,
      } as const;
      const plan: [string, "INTERNAL" | "CLIENT" | "CHANGES" | "READY"][] = [
        ["Diwali offer post (demo)", "INTERNAL"],
        ["Monsoon hair-care carousel (demo)", "CLIENT"],
        ["Onion shampoo story (demo)", "CHANGES"],
        ["New launch teaser (demo)", "READY"],
      ];
      for (const [title, target] of plan) {
        if (await ContentModel.exists({ agencyId: admin!.agencyId, title })) continue;
        const { id } = await createBrief(
          actor,
          createBriefSchema.parse({
            brandId: String(brand!._id),
            title,
            contentType: "GRAPHIC",
            origin: "ADMIN_BRIEF",
            notes: "Internal: use the festive palette",
            targetPlatforms: ["INSTAGRAM", "FACEBOOK"],
          }),
        );
        const version = async (note: string) =>
          (
            await createVersion(actor, {
              contentId: id,
              assetIds: [],
              links: [
                {
                  url: "https://www.canva.com/design/demo/view",
                  label: `${title.replace(" (demo)", "")} – ${note}`,
                },
              ],
              caption: "Celebrate the season with natural care ✨ Shop now — link in bio.",
              hashtags: ["mamaearth", "goodnessinside", "festive"],
              changeNote: note,
            })
          ).id;
        const v1 = await version("first cut");
        await approvals.submitForInternalReview(actor, { contentId: id, versionId: v1 });
        if (target === "INTERNAL") {
          console.log(`✔ ${title} · internal review`);
          continue;
        }
        await approvals.decideInternalReview(actor, {
          contentId: id,
          versionId: v1,
          decision: "APPROVED",
          comment: "Good to go to the client.",
        });
        if (target === "CHANGES") {
          await approvals.decideClientReview(clientActor, {
            contentId: id,
            versionId: v1,
            decision: "CHANGES_REQUESTED",
            comment: "Please use our new logo and a warmer background.",
          });
        }
        if (target === "READY") {
          await approvals.decideClientReview(clientActor, {
            contentId: id,
            versionId: v1,
            decision: "APPROVED",
            comment: "Looks lovely!",
          });
        }
        console.log(`✔ ${title} · ${target.toLowerCase()}`);
      }
    }

    async function seedShoots() {
      const staff = await UserModel.findOne({
        agencyId: admin!.agencyId,
        role: "STAFF",
        status: "ACTIVE",
        email: { $not: /@demo\.photoxo\.test$/ },
      }).lean();
      if (!staff) {
        console.log("· No ACTIVE staff account — skipping demo shoots (invite one first).");
        return;
      }
      const brandId = async (name: string) =>
        String((await BrandModel.findOne({ agencyId: admin!.agencyId, name }).lean())!._id);
      const mama = await brandId("Mamaearth (demo)");
      const adidas = await brandId("Adidas (demo)");
      for (const b of [mama, adidas]) {
        await addMember(actor, {
          brandId: b,
          userId: String(staff._id),
          role: "VIDEOGRAPHER" as never,
        }).catch((e: Error) => {
          if (!/Already assigned/.test(e.message)) throw e;
        });
      }
      const today = todayInTimeZone("Asia/Kolkata");
      const brief = async (b: string, title: string, contentType: string, route: string) =>
        (
          await createBrief(
            actor,
            createBriefSchema.parse({
              brandId: b,
              title,
              contentType,
              origin: "ADMIN_BRIEF",
              route,
            }),
          )
        ).id;
      const plan = [
        {
          brandId: mama,
          title: "Summer skincare reels (demo)",
          date: today,
          startTime: "10:00",
          endTime: "13:00",
          locationName: "Studio 4, Andheri West",
          locationAddress: "Andheri West, Mumbai",
          content: [
            ["Sunscreen morning routine (demo)", "REEL", "SHOOT_AND_EDIT"],
            ["Ubtan face wash demo (demo)", "REEL", "SHOOT_THEN_EDIT"],
          ],
          brandRole: "VIDEOGRAPHER",
          overrideReason: undefined,
        },
        {
          brandId: adidas,
          title: "Running shoe launch (demo)",
          date: today,
          startTime: "12:00",
          endTime: "15:00",
          locationName: "Marine Drive promenade",
          locationAddress: null,
          content: [["Ultraboost city run (demo)", "REEL", "SHOOT_AND_EDIT"]],
          brandRole: "VIDEOGRAPHER",
          overrideReason: "Demo data: deliberate overlap to show conflict handling",
        },
        {
          brandId: mama,
          title: "Baby care lifestyle shoot (demo)",
          date: addDays(today, 1),
          startTime: "09:30",
          endTime: "12:00",
          locationName: "Client office, Lower Parel",
          locationAddress: null,
          content: [["Bath-time essentials (demo)", "REEL", "SHOOT_AND_EDIT"]],
          brandRole: "VIDEOGRAPHER",
          overrideReason: undefined,
        },
      ];
      for (const p of plan) {
        if (await ShootModel.exists({ agencyId: admin!.agencyId, title: p.title, date: p.date }))
          continue;
        const contentIds: string[] = [];
        for (const [title, type, route] of p.content)
          contentIds.push(await brief(p.brandId, title!, type!, route!));
        const make = (overrideReason: string | undefined) =>
          createShoot(
            actor,
            createShootSchema.parse({
              brandId: p.brandId,
              title: p.title,
              date: p.date,
              startTime: p.startTime,
              endTime: p.endTime,
              locationName: p.locationName,
              locationAddress: p.locationAddress,
              contentIds,
              crew: [{ userId: String(staff._id), brandRole: p.brandRole }],
              overrideReason,
            }),
          );
        // Re-runs on later days may collide with real shoots: override (audited) rather than fail.
        await make(p.overrideReason).catch((e: Error) => {
          if (!/already booked/.test(e.message)) throw e;
          return make("Demo data: overlaps an existing shoot");
        });
        console.log(`✔ ${p.title} · ${p.date} ${p.startTime}`);
      }
    }
  } finally {
    await disconnectDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
