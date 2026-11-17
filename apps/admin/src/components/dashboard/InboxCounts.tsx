import Link from "next/link";
import { ChevronLeft, HelpCircle, Mail, MessageCircleQuestion, Star, Undo2 } from "lucide-react";
import { faInt } from "@namilux/core";
import { Card } from "@/components/kit";
import { fa } from "@/i18n/fa";

export function InboxCounts({ inbox }: { inbox: { concierge: number; questions: number; reviews: number; returns: number; contact: number } }) {
  const rows = [
    { href: "/inbox?tab=concierge", label: fa["dash.inbox.concierge"], n: inbox.concierge, Icon: MessageCircleQuestion },
    { href: "/inbox?tab=questions", label: fa["dash.inbox.questions"], n: inbox.questions, Icon: HelpCircle },
    { href: "/inbox?tab=contact", label: fa["dash.inbox.contact"], n: inbox.contact, Icon: Mail },
    { href: "/reviews", label: fa["dash.inbox.reviews"], n: inbox.reviews, Icon: Star },
    { href: "/returns", label: fa["dash.inbox.returns"], n: inbox.returns, Icon: Undo2 },
  ];
  const waiting = rows.reduce((s, r) => s + r.n, 0);
  return (
    <Card title={fa["dash.inbox"]} description={waiting === 0 ? fa["dash.inbox.clear"] : fa["dash.inbox.waiting"].replace("{n}", faInt(waiting))}>
      <ul className="stat-list">
        {rows.map(({ href, label, n, Icon }) => (
          <li key={href}>
            <Link href={href} className="stat-list__row" data-strong={n > 0 ? "" : undefined}>
              <Icon size={16} aria-hidden="true" className="stat-list__icon" />
              <span className="stat-list__label">{label}</span>
              {n > 0 ? <span className="count-pill">{faInt(n)}</span> : <b className="text-ink-3">{faInt(0)}</b>}
              <ChevronLeft size={15} aria-hidden="true" className="stat-list__go" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
