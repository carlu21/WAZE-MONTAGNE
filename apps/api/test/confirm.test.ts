import { describe, expect, it } from "vitest";
import type { Confirmation, Report } from "@mountain-live/core";
import { call, CORSICA_BBOX, registerUser, setup } from "./helpers";

const { app, sqlite } = await setup();

async function createReport(token: string, subtype = "fallen_tree") {
  const res = await call<{ report: Report }>(app, "POST", "/reports", {
    token,
    body: { subtype, lat: 42.2312, lng: 9.0538, dangerLevel: "moderate" },
  });
  expect(res.status).toBe(201);
  return res.body.report;
}

describe("Confirmation communautaire", () => {
  it("interdit à l'auteur de voter sur son propre signalement", async () => {
    const author = await registerUser(app);
    const report = await createReport(author.token);
    const res = await call<{ error: { code: string } }>(app, "POST", `/reports/${report.id}/confirm`, {
      token: author.token,
      body: { kind: "still_present" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("own_report");
  });

  it("passe en « confirmé » après deux votes, met à jour les compteurs et la réputation", async () => {
    const author = await registerUser(app);
    const voter1 = await registerUser(app);
    const voter2 = await registerUser(app);
    const report = await createReport(author.token);

    const first = await call<{ report: Report; confirmation: Confirmation }>(app, "POST", `/reports/${report.id}/confirm`, {
      token: voter1.token,
      body: { kind: "still_present", comment: "Toujours là" },
    });
    expect(first.status).toBe(200);
    expect(first.body.report.confirmationsCount).toBe(1);
    expect(first.body.report.status).toBe("active");
    expect(first.body.report.lastConfirmationAt).toBeTruthy();
    expect(first.body.confirmation.kind).toBe("still_present");
    expect(first.body.report.myConfirmation).toBe("still_present");

    const second = await call<{ report: Report }>(app, "POST", `/reports/${report.id}/confirm`, {
      token: voter2.token,
      body: { kind: "still_present" },
    });
    expect(second.body.report.confirmationsCount).toBe(2);
    expect(second.body.report.status).toBe("confirmed");
    expect(second.body.report.confidenceScore).toBeGreaterThan(report.confidenceScore);

    // L'auteur est notifié et la fiche détaillée liste les votes.
    const notifs = await call<{ notifications: { type: string }[]; unreadCount: number }>(app, "GET", "/notifications", { token: author.token });
    expect(notifs.body.notifications.filter((n) => n.type === "report_confirmed")).toHaveLength(2);
    expect(notifs.body.unreadCount).toBe(2);
    const detail = await call<{ confirmations: Confirmation[] }>(app, "GET", `/reports/${report.id}`);
    expect(detail.body.confirmations).toHaveLength(2);

    const authorRow = sqlite.prepare("SELECT reputation_score, reports_count FROM users WHERE id = ?").get(author.id) as { reputation_score: number; reports_count: number };
    expect(authorRow.reports_count).toBe(1);
    expect(authorRow.reputation_score).toBeGreaterThan(2);
    const voterRow = sqlite.prepare("SELECT confirmations_count FROM users WHERE id = ?").get(voter1.id) as { confirmations_count: number };
    expect(voterRow.confirmations_count).toBe(1);
  });

  it("n'accepte qu'un vote par utilisateur, modifiable (upsert)", async () => {
    const author = await registerUser(app);
    const voter = await registerUser(app);
    const report = await createReport(author.token, "herd");

    await call(app, "POST", `/reports/${report.id}/confirm`, { token: voter.token, body: { kind: "still_present" } });
    const changed = await call<{ report: Report; confirmation: Confirmation }>(app, "POST", `/reports/${report.id}/confirm`, {
      token: voter.token,
      body: { kind: "gone" },
    });
    expect(changed.status).toBe(200);
    expect(changed.body.report.confirmationsCount).toBe(0);
    expect(changed.body.report.resolvedVotesCount).toBe(1);
    expect(changed.body.confirmation.kind).toBe("gone");
    const count = sqlite.prepare("SELECT COUNT(*) AS n FROM report_confirmations WHERE report_id = ?").get(report.id) as { n: number };
    expect(count.n).toBe(1);

    const list = await call<{ reports: Report[] }>(app, "GET", `/reports?bbox=${CORSICA_BBOX}`, { token: voter.token });
    expect(list.body.reports.find((r) => r.id === report.id)?.myConfirmation).toBe("gone");
    const anonList = await call<{ reports: Report[] }>(app, "GET", `/reports?bbox=${CORSICA_BBOX}`);
    expect(anonList.body.reports.find((r) => r.id === report.id)).not.toHaveProperty("myConfirmation");
  });

  it("passe en « probablement résolu » puis « contesté » selon les votes", async () => {
    const author = await registerUser(app);
    const a = await registerUser(app);
    const b = await registerUser(app);
    const report = await createReport(author.token, "path_cluttered");
    await call(app, "POST", `/reports/${report.id}/confirm`, { token: a.token, body: { kind: "gone" } });
    const gone = await call<{ report: Report }>(app, "POST", `/reports/${report.id}/confirm`, { token: b.token, body: { kind: "gone" } });
    expect(gone.body.report.status).toBe("probably_resolved");
    expect(gone.body.report.resolvedVotesCount).toBe(2);

    const other = await createReport(author.token, "aggressive_animal");
    await call(app, "POST", `/reports/${other.id}/confirm`, { token: a.token, body: { kind: "disputed" } });
    const disputed = await call<{ report: Report }>(app, "POST", `/reports/${other.id}/confirm`, { token: b.token, body: { kind: "disputed" } });
    expect(disputed.body.report.status).toBe("disputed");
    expect(disputed.body.report.disputesCount).toBe(2);
  });

  it("refuse les votes sur un signalement clôturé", async () => {
    const author = await registerUser(app);
    const voter = await registerUser(app);
    const report = await createReport(author.token);
    await call(app, "PATCH", `/reports/${report.id}`, { token: author.token, body: { status: "resolved" } });
    const res = await call<{ error: { code: string } }>(app, "POST", `/reports/${report.id}/confirm`, { token: voter.token, body: { kind: "still_present" } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("report_closed");
  });
});
