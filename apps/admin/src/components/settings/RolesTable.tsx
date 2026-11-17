import { Check, KeyRound, Minus, Wallet } from "lucide-react";
import { fa } from "@/i18n/fa";
import { faInt } from "@namilux/core/client";
import { PERMISSION_LABEL, PERMISSION_GROUPS, ROLE_HINT } from "@/i18n/admin-guidance";

/**
 * The read-only permission matrix: every permission by area, one column per role, in Persian. The
 * key marks the two kinds of permission that behave specially - a fresh two-step code (sudo) before
 * the action, and the money column only the owner holds (or, for one site, the role confined to it).
 */
export function RolesTable({ roles, permissions, matrix, sudo, money }: { roles: readonly string[]; permissions: readonly string[]; matrix: Record<string, readonly string[]>; sudo: readonly string[]; money: readonly string[] }) {
  const roleName = (r: string): string => {
    const key = `role.${r}` as keyof typeof fa;
    return key in fa ? fa[key] : r;
  };
  const grouped = PERMISSION_GROUPS.map((g) => ({ ...g, perms: g.perms.filter((p) => permissions.includes(p)) })).filter((g) => g.perms.length > 0);
  const listed = new Set(grouped.flatMap((g) => g.perms));
  const rest = permissions.filter((p) => !listed.has(p));
  if (rest.length > 0) grouped.push({ title: fa["roles.other"], perms: rest });

  return (
    <div className="grid gap-5">
      <div className="roles-cards">
        {roles.map((r) => (
          <div key={r} className="roles-card">
            <b>{roleName(r)}</b>
            <p>{ROLE_HINT[r] ?? ""}</p>
            <small>{fa["roles.count"].replace("{n}", faInt((matrix[r] ?? []).length))}</small>
          </div>
        ))}
      </div>
      <div className="admin-table-scroll">
        <table className="admin-data-table roles-matrix" style={{ minInlineSize: `${String(260 + roles.length * 96)}px` }}>
          <thead>
            <tr>
              <th>{fa["roles.permission"]}</th>
              {roles.map((r) => (
                <th key={r} className="roles-matrix__role">
                  {roleName(r)}
                </th>
              ))}
            </tr>
          </thead>
          {grouped.map((g) => (
            <tbody key={g.title}>
              <tr className="roles-matrix__group">
                <td colSpan={roles.length + 1}>{g.title}</td>
              </tr>
              {g.perms.map((p) => (
                <tr key={p}>
                  <td>
                    <span className="roles-matrix__perm">
                      {PERMISSION_LABEL[p] ?? p}
                      {sudo.includes(p) ? (
                        <span className="roles-matrix__mark" title={fa["sudo.title"]}>
                          <KeyRound size={13} aria-label={fa["sudo.title"]} />
                        </span>
                      ) : null}
                      {money.includes(p) ? (
                        <span className="roles-matrix__mark roles-matrix__mark--money" title={fa["roles.moneyNote"]}>
                          <Wallet size={13} aria-label={fa["roles.moneyNote"]} />
                        </span>
                      ) : null}
                    </span>
                  </td>
                  {roles.map((r) => (
                    <td key={r} className="roles-matrix__cell">
                      {(matrix[r] ?? []).includes(p) ? <Check size={16} className="roles-matrix__yes" aria-label={fa["common.yes"]} /> : <Minus size={14} className="roles-matrix__no" aria-label={fa["common.no"]} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <div className="roles-legend">
        <span>
          <KeyRound size={13} aria-hidden="true" /> {fa["roles.legend.sudo"]}
        </span>
        <span>
          <Wallet size={13} aria-hidden="true" /> {fa["roles.moneyNote"]}
        </span>
        <span>{fa["roles.readonly"]}</span>
      </div>
    </div>
  );
}
