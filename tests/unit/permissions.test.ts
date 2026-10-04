import { describe, expect, it } from "vitest";
import { SystemRole, Workspace } from "@/lib/domain/roles";
import type { Actor } from "@/server/authz/actor";
import * as P from "@/server/authz/permissions";

const actor = (systemRole: SystemRole, userId = "u1"): Actor => ({
  userId,
  agencyId: "a1",
  systemRole,
  name: "x",
  email: "x@example.test",
  image: null,
});
const A = actor(SystemRole.ADMIN);
const M = actor(SystemRole.MANAGER);
const S = actor(SystemRole.STAFF);
const C = actor(SystemRole.CLIENT);

describe("capability matrix", () => {
  const matrix: [string, (a: Actor) => boolean, [boolean, boolean, boolean, boolean]][] = [
    //                                         ADMIN  MANAGER STAFF  CLIENT
    ["canManageUsers", P.canManageUsers, [true, false, false, false]],
    ["canManageRoles", P.canManageRoles, [true, false, false, false]],
    ["canManageSettings", P.canManageSettings, [true, false, false, false]],
    ["canManageProduction", P.canManageProduction, [true, true, false, false]],
    ["canCreateContent", P.canCreateContent, [true, true, false, false]],
    ["canApproveContent", P.canApproveContent, [true, true, false, false]],
    ["canManageClientApprovals", P.canManageClientApprovals, [true, true, false, false]],
    ["canViewAllExpenses", P.canViewAllExpenses, [true, true, false, false]],
    ["canApproveExpenses", P.canApproveExpenses, [true, true, false, false]],
    ["canViewProductionBoard", P.canViewProductionBoard, [true, true, false, false]],
    ["canSubmitExpenses", P.canSubmitExpenses, [true, true, true, false]],
    ["canProposeIdeas", P.canProposeIdeas, [true, true, true, false]],
  ];
  it.each(matrix)("%s", (_name, fn, expected) => {
    expect([A, M, S, C].map(fn)).toEqual(expected);
  });
});

describe("workspaces", () => {
  it("maps roles to workspaces", () => {
    expect(P.permissionSetFor(A).workspaces).toEqual({ admin: true, work: true, client: false });
    expect(P.permissionSetFor(M).workspaces).toEqual({ admin: true, work: true, client: false });
    expect(P.permissionSetFor(S).workspaces).toEqual({ admin: false, work: true, client: false });
    expect(P.permissionSetFor(C).workspaces).toEqual({ admin: false, work: false, client: true });
  });

  it("home workspace per role", () => {
    expect([A, M, S, C].map(P.homePathFor)).toEqual(["/admin", "/admin", "/work", "/client"]);
  });

  it("client never reaches internal workspaces", () => {
    expect(P.canAccessWorkspace(C, Workspace.ADMIN)).toBe(false);
    expect(P.canAccessWorkspace(C, Workspace.WORK)).toBe(false);
  });
});

describe("user administration rules", () => {
  it("admin may administer non-admin others", () => {
    expect(P.canAdministerUser(A, { id: "u2", role: SystemRole.STAFF })).toBe(true);
    expect(P.canAdministerUser(A, { id: "u2", role: SystemRole.MANAGER })).toBe(true);
    expect(P.canAdministerUser(A, { id: "u2", role: SystemRole.CLIENT })).toBe(true);
  });
  it("admin may not administer self or other admins", () => {
    expect(P.canAdministerUser(A, { id: "u1", role: SystemRole.ADMIN })).toBe(false);
    expect(P.canAdministerUser(A, { id: "u2", role: SystemRole.ADMIN })).toBe(false);
  });
  it("non-admins may administer no one", () => {
    for (const a of [M, S, C])
      expect(P.canAdministerUser(a, { id: "u9", role: SystemRole.STAFF })).toBe(false);
  });
  it("ADMIN is never assignable through the UI", () => {
    expect(P.canAssignRole(A, SystemRole.ADMIN)).toBe(false);
    expect(P.canAssignRole(A, SystemRole.MANAGER)).toBe(true);
    expect(P.canAssignRole(M, SystemRole.STAFF)).toBe(false);
  });
  it("assertCan throws a FORBIDDEN AppError", () => {
    expect(() => P.assertCan(false)).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});
