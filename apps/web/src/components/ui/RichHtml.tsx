import { sanitizeHtml } from "@namilux/core";
// One of the two sanctioned HTML sinks. The seed and the admin already sanitise at write time; this
// second pass is deliberate defence in depth - a DB-level compromise still cannot put
// a script, an event handler or a third-party <img src> onto the page.
export function RichHtml({ html, className }: {
    html: string;
    className?: string;
}): React.ReactNode {
    const sanitized = sanitizeHtml(html, { allowImages: true });
    const clean = sanitized;
    return (<div className={["prose", className ?? ""].filter((c) => c !== "").join(" ")} dangerouslySetInnerHTML={{ __html: clean }}/>);
}
